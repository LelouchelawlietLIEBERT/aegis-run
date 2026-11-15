#pragma once

#include <string>
#include <vector>

namespace aegis {

class FilesystemIsolation {
public:
    FilesystemIsolation(std::string rootfs_path, std::string job_dir);

    bool mount_overlay(std::string& error);
    bool pivot_root(std::string& error);
    bool mount_proc(std::string& error);
    bool teardown();

    const std::string& merged_path() const { return merged_; }
    const std::vector<std::string>& audit() const { return audit_; }

private:
    std::string rootfs_path_;
    std::string job_dir_;
    std::string merged_;
    std::string upper_;
    std::string work_;
    bool mounted_ = false;
    std::vector<std::string> audit_;
};

std::vector<std::string> collect_fs_diff(const std::string& app_dir, const std::string& baseline_path);

}
