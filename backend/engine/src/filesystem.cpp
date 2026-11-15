#define _GNU_SOURCE 1
#include "filesystem.hpp"

#include <fcntl.h>
#include <sys/mount.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <map>
#include <sstream>
#include <utility>

namespace aegis {

namespace {

bool ensure_directory(const std::string& path, std::string& error) {
    if (::mkdir(path.c_str(), 0755) == 0) {
        return true;
    }
    if (errno == EEXIST) {
        return true;
    }
    error = "unable to create " + path + ": " + std::strerror(errno);
    return false;
}

long long system_time_ns(const std::filesystem::file_time_type& value) {
    const auto file_now = std::filesystem::file_time_type::clock::now();
    const auto system_now = std::chrono::system_clock::now();
    const auto offset = std::chrono::duration_cast<std::chrono::system_clock::duration>(value - file_now);
    const auto converted = system_now + offset;
    return std::chrono::duration_cast<std::chrono::nanoseconds>(converted.time_since_epoch()).count();
}

std::map<std::string, std::pair<unsigned long long, long long>> snapshot_tree(const std::string& root) {
    std::map<std::string, std::pair<unsigned long long, long long>> snapshot;
    std::error_code ec;
    if (!std::filesystem::is_directory(root, ec)) {
        return snapshot;
    }
    std::filesystem::recursive_directory_iterator iterator(
        root, std::filesystem::directory_options::skip_permission_denied, ec);
    const std::filesystem::recursive_directory_iterator end;
    while (iterator != end) {
        if (ec) {
            ec.clear();
            iterator.increment(ec);
            continue;
        }
        const auto& entry = *iterator;
        std::error_code entry_error;
        if (entry.is_regular_file(entry_error) && !entry_error) {
            std::error_code relative_error;
            const auto relative = std::filesystem::relative(entry.path(), root, relative_error);
            if (!relative_error) {
                std::error_code size_error;
                std::error_code time_error;
                const auto size = std::filesystem::file_size(entry.path(), size_error);
                const auto mtime = std::filesystem::last_write_time(entry.path(), time_error);
                if (!size_error && !time_error) {
                    snapshot[relative.generic_string()] = {size, system_time_ns(mtime)};
                }
            }
        }
        iterator.increment(ec);
    }
    return snapshot;
}

std::map<std::string, std::pair<unsigned long long, long long>> load_baseline(const std::string& path) {
    std::map<std::string, std::pair<unsigned long long, long long>> baseline;
    std::ifstream stream(path);
    if (!stream.is_open()) {
        return baseline;
    }
    std::string line;
    while (std::getline(stream, line)) {
        const auto last_tab = line.rfind('\t');
        if (last_tab == std::string::npos) {
            continue;
        }
        const auto first_tab = line.rfind('\t', last_tab == 0 ? 0 : last_tab - 1);
        if (first_tab == std::string::npos) {
            continue;
        }
        const std::string relative = line.substr(0, first_tab);
        const std::string size_text = line.substr(first_tab + 1, last_tab - first_tab - 1);
        const std::string mtime_text = line.substr(last_tab + 1);
        try {
            baseline[relative] = {std::stoull(size_text), std::stoll(mtime_text)};
        } catch (...) {
            continue;
        }
    }
    return baseline;
}

}

FilesystemIsolation::FilesystemIsolation(std::string rootfs_path, std::string job_dir)
    : rootfs_path_(std::move(rootfs_path)), job_dir_(std::move(job_dir)) {}

bool FilesystemIsolation::mount_overlay(std::string& error) {
    if (rootfs_path_.empty() || job_dir_.empty()) {
        error = "rootfs path and job directory are required";
        return false;
    }
    if (::mount(nullptr, "/", nullptr, MS_REC | MS_PRIVATE, nullptr) != 0) {
        error = std::string("unable to make mount propagation private: ") + std::strerror(errno);
        return false;
    }
    audit_.push_back("mount: / -> MS_REC|MS_PRIVATE");

    upper_ = job_dir_ + "/upper";
    work_ = job_dir_ + "/work";
    merged_ = job_dir_ + "/merged";

    if (!ensure_directory(upper_, error) || !ensure_directory(work_, error) ||
        !ensure_directory(merged_, error)) {
        return false;
    }

    const std::string options =
        "lowerdir=" + rootfs_path_ + ",upperdir=" + upper_ + ",workdir=" + work_;
    if (::mount("overlay", merged_.c_str(), "overlay", 0, options.c_str()) != 0) {
        error = std::string("unable to mount overlayfs: ") + std::strerror(errno);
        return false;
    }
    mounted_ = true;
    audit_.push_back("mount: overlay -> " + merged_ + " (" + options + ")");
    return true;
}

bool FilesystemIsolation::pivot_root(std::string& error) {
    if (!mounted_) {
        error = "pivot_root requested before overlay mount";
        return false;
    }
    const std::string old_root = merged_ + "/old_root";
    if (!ensure_directory(old_root, error)) {
        return false;
    }
    if (::chdir(merged_.c_str()) != 0) {
        error = std::string("unable to chdir into merged root: ") + std::strerror(errno);
        return false;
    }
    if (::syscall(SYS_pivot_root, ".", "old_root") != 0) {
        error = std::string("pivot_root failed: ") + std::strerror(errno);
        return false;
    }
    if (::chdir("/") != 0) {
        error = std::string("unable to chdir to new root: ") + std::strerror(errno);
        return false;
    }
    if (::umount2("/old_root", MNT_DETACH) != 0) {
        error = std::string("unable to detach old root: ") + std::strerror(errno);
        return false;
    }
    ::rmdir("/old_root");
    audit_.push_back("pivot_root: switched root to " + merged_ + " and detached /old_root");
    return true;
}

bool FilesystemIsolation::mount_proc(std::string& error) {
    if (::mount("proc", "/proc", "proc", MS_NOSUID | MS_NOEXEC | MS_NODEV, nullptr) != 0) {
        error = std::string("unable to mount /proc: ") + std::strerror(errno);
        return false;
    }
    audit_.push_back("mount: proc -> /proc (MS_NOSUID|MS_NOEXEC|MS_NODEV)");
    return true;
}

bool FilesystemIsolation::teardown() {
    if (!mounted_) {
        return true;
    }
    if (::umount2(merged_.c_str(), MNT_DETACH) != 0 && errno != EINVAL && errno != ENOENT) {
        return false;
    }
    mounted_ = false;
    return true;
}

std::vector<std::string> collect_fs_diff(const std::string& app_dir, const std::string& baseline_path) {
    const auto baseline = load_baseline(baseline_path);
    const auto current = snapshot_tree(app_dir);

    std::vector<std::string> changes;
    const long long tolerance_ns = 1000000;
    for (const auto& [relative, metadata] : current) {
        const auto& [size, mtime] = metadata;
        const auto previous = baseline.find(relative);
        if (previous == baseline.end()) {
            changes.push_back("+ " + relative + " (" + std::to_string(size) + " B)");
            continue;
        }
        const auto& [old_size, old_mtime] = previous->second;
        const long long delta = mtime > old_mtime ? mtime - old_mtime : old_mtime - mtime;
        if (old_size != size || delta > tolerance_ns) {
            changes.push_back("~ " + relative + " (" + std::to_string(size) + " B)");
        }
    }
    for (const auto& [relative, metadata] : baseline) {
        (void)metadata;
        if (current.find(relative) == current.end()) {
            changes.push_back("- " + relative);
        }
    }
    std::sort(changes.begin(), changes.end());
    return changes;
}

}
