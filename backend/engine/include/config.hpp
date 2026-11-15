#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace aegis {

struct SandboxConfig {
    std::string job_id;
    std::string rootfs_path;
    std::string job_dir;
    std::string cgroup_root = "/sys/fs/cgroup";
    std::string baseline_path;
    std::uint64_t memory_limit_bytes = 128ull * 1024ull * 1024ull;
    std::uint64_t cpu_quota_us = 100000;
    std::uint32_t max_pids = 16;
    std::uint32_t timeout_ms = 2000;
    bool enable_network = false;
    bool strict_seccomp = false;
    std::string stdin_file;
    std::string stdout_file;
    std::string stderr_file;
    std::vector<std::string> command;
};

struct ExecutionResult {
    std::string status = "EXIT_SUCCESS";
    std::string sub_reason;
    int exit_code = 0;
    int term_signal = 0;
    long long wall_time_us = 0;
    long long setup_time_us = 0;
    long long teardown_time_us = 0;
    long long cpu_user_us = 0;
    long long cpu_sys_us = 0;
    unsigned long long peak_memory_bytes = 0;
    bool oom_killed = false;
    bool pids_max_hit = false;
    std::string blocked_syscall;
    std::vector<std::string> fs_diff;
    std::vector<std::string> audit_log;
    std::vector<std::string> namespaces;
};

}
