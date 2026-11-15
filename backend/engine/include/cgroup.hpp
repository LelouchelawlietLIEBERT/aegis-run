#pragma once

#include <sys/types.h>

#include <cstdint>
#include <string>
#include <vector>

#include "config.hpp"

namespace aegis {

class CgroupV2Manager {
public:
    CgroupV2Manager(std::string cgroup_root, std::string job_id);
    ~CgroupV2Manager();

    CgroupV2Manager(const CgroupV2Manager&) = delete;
    CgroupV2Manager& operator=(const CgroupV2Manager&) = delete;

    bool create(std::string& error);
    bool apply_limits(const SandboxConfig& config, std::string& error);
    bool attach(pid_t pid, std::string& error);
    unsigned long long read_peak_memory();
    bool read_oom_killed();
    bool read_pids_max_hit();
    bool read_cpu_usage(long long& user_us, long long& sys_us);
    void kill_all();
    void remove();

    const std::string& path() const { return path_; }
    const std::vector<std::string>& audit() const { return audit_; }

private:
    bool write_file(const std::string& name, const std::string& value, std::string& error);
    std::string read_file(const std::string& name);
    std::uint64_t read_counter(const std::string& file, const std::string& key, bool& found);
    void enable_controller(const std::string& controller);

    std::string cgroup_root_;
    std::string job_id_;
    std::string path_;
    std::vector<std::string> audit_;
    bool removed_ = false;
};

}
