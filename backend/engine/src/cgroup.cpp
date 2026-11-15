#define _GNU_SOURCE 1
#include "cgroup.hpp"

#include <fcntl.h>
#include <signal.h>
#include <sys/stat.h>
#include <unistd.h>

#include <cerrno>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <utility>

namespace aegis {

CgroupV2Manager::CgroupV2Manager(std::string cgroup_root, std::string job_id)
    : cgroup_root_(std::move(cgroup_root)), job_id_(std::move(job_id)) {
    if (cgroup_root_.empty()) {
        cgroup_root_ = "/sys/fs/cgroup";
    }
}

CgroupV2Manager::~CgroupV2Manager() {
    if (!removed_) {
        kill_all();
        remove();
    }
}

void CgroupV2Manager::enable_controller(const std::string& controller) {
    const std::string path = cgroup_root_ + "/cgroup.subtree_control";
    int fd = ::open(path.c_str(), O_WRONLY | O_CLOEXEC);
    if (fd < 0) {
        return;
    }
    const std::string value = "+" + controller;
    const ssize_t written = ::write(fd, value.data(), value.size());
    ::close(fd);
    if (written == static_cast<ssize_t>(value.size())) {
        audit_.push_back("cgroup: wrote " + path + "=" + value);
    }
}

bool CgroupV2Manager::create(std::string& error) {
    path_ = cgroup_root_ + "/aegis_" + job_id_;
    std::error_code ec;
    std::filesystem::create_directories(path_, ec);
    if (!std::filesystem::is_directory(path_)) {
        error = "unable to create cgroup " + path_ + ": " + ec.message();
        return false;
    }
    audit_.push_back("cgroup: created " + path_);
    enable_controller("cpu");
    enable_controller("memory");
    enable_controller("pids");
    return true;
}

bool CgroupV2Manager::write_file(const std::string& name, const std::string& value, std::string& error) {
    const std::string path = path_ + "/" + name;
    int fd = ::open(path.c_str(), O_WRONLY | O_CLOEXEC);
    if (fd < 0) {
        error = "unable to open " + path + ": " + std::strerror(errno);
        return false;
    }
    const ssize_t written = ::write(fd, value.data(), value.size());
    const int saved_errno = errno;
    ::close(fd);
    if (written != static_cast<ssize_t>(value.size())) {
        error = "unable to write " + path + "=" + value + ": " + std::strerror(saved_errno);
        return false;
    }
    audit_.push_back("cgroup: wrote " + path + "=" + value);
    return true;
}

bool CgroupV2Manager::apply_limits(const SandboxConfig& config, std::string& error) {
    if (!write_file("memory.max", std::to_string(config.memory_limit_bytes), error)) {
        return false;
    }
    if (!write_file("memory.swap.max", "0", error)) {
        return false;
    }
    if (!write_file("memory.oom.group", "1", error)) {
        return false;
    }
    if (!write_file("pids.max", std::to_string(config.max_pids), error)) {
        return false;
    }
    const std::string cpu_value = std::to_string(config.cpu_quota_us) + " 100000";
    if (!write_file("cpu.max", cpu_value, error)) {
        return false;
    }
    return true;
}

bool CgroupV2Manager::attach(pid_t pid, std::string& error) {
    if (!write_file("cgroup.procs", std::to_string(pid), error)) {
        return false;
    }
    return true;
}

std::string CgroupV2Manager::read_file(const std::string& name) {
    const std::string path = path_ + "/" + name;
    std::ifstream stream(path);
    if (!stream.is_open()) {
        return {};
    }
    std::ostringstream buffer;
    buffer << stream.rdbuf();
    const std::string contents = buffer.str();
    audit_.push_back("cgroup: read " + path);
    return contents;
}

std::uint64_t CgroupV2Manager::read_counter(const std::string& file, const std::string& key, bool& found) {
    found = false;
    const std::string contents = read_file(file);
    std::istringstream stream(contents);
    std::string name;
    std::uint64_t value = 0;
    while (stream >> name >> value) {
        if (name == key) {
            found = true;
            return value;
        }
    }
    return 0;
}

unsigned long long CgroupV2Manager::read_peak_memory() {
    std::string contents = read_file("memory.peak");
    if (contents.empty()) {
        contents = read_file("memory.current");
    }
    if (contents.empty()) {
        return 0;
    }
    try {
        return std::stoull(contents);
    } catch (...) {
        return 0;
    }
}

bool CgroupV2Manager::read_oom_killed() {
    bool found = false;
    const std::uint64_t kills = read_counter("memory.events", "oom_kill", found);
    return found && kills > 0;
}

bool CgroupV2Manager::read_pids_max_hit() {
    bool found = false;
    const std::uint64_t hits = read_counter("pids.events", "max", found);
    return found && hits > 0;
}

bool CgroupV2Manager::read_cpu_usage(long long& user_us, long long& sys_us) {
    user_us = 0;
    sys_us = 0;
    bool found_user = false;
    bool found_system = false;
    const std::uint64_t user = read_counter("cpu.stat", "user_usec", found_user);
    const std::uint64_t system = read_counter("cpu.stat", "system_usec", found_system);
    if (!found_user && !found_system) {
        bool found_usage = false;
        const std::uint64_t usage = read_counter("cpu.stat", "usage_usec", found_usage);
        if (!found_usage) {
            return false;
        }
        user_us = static_cast<long long>(usage);
        return true;
    }
    user_us = static_cast<long long>(user);
    sys_us = static_cast<long long>(system);
    return true;
}

void CgroupV2Manager::kill_all() {
    if (path_.empty() || removed_) {
        return;
    }
    const std::string kill_path = path_ + "/cgroup.kill";
    int fd = ::open(kill_path.c_str(), O_WRONLY | O_CLOEXEC);
    if (fd >= 0) {
        const char value = '1';
        const ssize_t written = ::write(fd, &value, 1);
        ::close(fd);
        if (written == 1) {
            audit_.push_back("cgroup: wrote " + kill_path + "=1");
        }
    }
    const std::string procs_path = path_ + "/cgroup.procs";
    std::ifstream stream(procs_path);
    int pid = 0;
    while (stream >> pid) {
        if (pid > 0) {
            ::kill(pid, SIGKILL);
        }
    }
}

void CgroupV2Manager::remove() {
    if (path_.empty() || removed_) {
        return;
    }
    for (int attempt = 0; attempt < 250; ++attempt) {
        if (::rmdir(path_.c_str()) == 0) {
            removed_ = true;
            audit_.push_back("cgroup: removed " + path_);
            return;
        }
        if (errno != EBUSY && errno != ENOTEMPTY) {
            break;
        }
        ::usleep(2000);
    }
    audit_.push_back("cgroup: deferred removal " + path_);
}

}
