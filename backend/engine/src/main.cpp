#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <stdexcept>
#include <string>

#include "config.hpp"
#include "runner.hpp"

namespace {

void print_usage() {
    std::cerr
        << "usage: aegis-run --job-id ID --rootfs PATH --job-dir PATH\n"
        << "                 [--cgroup-root PATH] [--memory-bytes N] [--cpu-quota-us N]\n"
        << "                 [--max-pids N] [--timeout-ms N] [--stdin FILE] [--stdout FILE]\n"
        << "                 [--stderr FILE] [--baseline FILE] [--strict-seccomp]\n"
        << "                 [--enable-network] -- COMMAND [ARG...]\n";
}

unsigned long long parse_unsigned(const std::string& text, const std::string& flag) {
    try {
        std::size_t consumed = 0;
        const unsigned long long value = std::stoull(text, &consumed);
        if (consumed != text.size()) {
            throw std::invalid_argument("trailing characters");
        }
        return value;
    } catch (...) {
        std::cerr << "aegis-run: invalid numeric value for " << flag << ": " << text << "\n";
        std::exit(2);
    }
}

}

int main(int argc, char** argv) {
    aegis::SandboxConfig config;
    bool command_started = false;

    auto next_value = [&](int& index, const std::string& flag) -> std::string {
        if (index + 1 >= argc) {
            std::cerr << "aegis-run: missing value for " << flag << "\n";
            std::exit(2);
        }
        return argv[++index];
    };

    for (int index = 1; index < argc; ++index) {
        const std::string argument = argv[index];
        if (command_started) {
            config.command.push_back(argument);
            continue;
        }
        if (argument == "--") {
            command_started = true;
        } else if (argument == "--job-id") {
            config.job_id = next_value(index, argument);
        } else if (argument == "--rootfs") {
            config.rootfs_path = next_value(index, argument);
        } else if (argument == "--job-dir") {
            config.job_dir = next_value(index, argument);
        } else if (argument == "--cgroup-root") {
            config.cgroup_root = next_value(index, argument);
        } else if (argument == "--baseline") {
            config.baseline_path = next_value(index, argument);
        } else if (argument == "--memory-bytes") {
            config.memory_limit_bytes = parse_unsigned(next_value(index, argument), argument);
        } else if (argument == "--cpu-quota-us") {
            config.cpu_quota_us = parse_unsigned(next_value(index, argument), argument);
        } else if (argument == "--max-pids") {
            config.max_pids = static_cast<std::uint32_t>(parse_unsigned(next_value(index, argument), argument));
        } else if (argument == "--timeout-ms") {
            config.timeout_ms = static_cast<std::uint32_t>(parse_unsigned(next_value(index, argument), argument));
        } else if (argument == "--stdin") {
            config.stdin_file = next_value(index, argument);
        } else if (argument == "--stdout") {
            config.stdout_file = next_value(index, argument);
        } else if (argument == "--stderr") {
            config.stderr_file = next_value(index, argument);
        } else if (argument == "--strict-seccomp") {
            config.strict_seccomp = true;
        } else if (argument == "--no-strict-seccomp") {
            config.strict_seccomp = false;
        } else if (argument == "--enable-network") {
            config.enable_network = true;
        } else if (argument == "--help" || argument == "-h") {
            print_usage();
            return 0;
        } else {
            command_started = true;
            config.command.push_back(argument);
        }
    }

    if (config.job_id.empty() || config.rootfs_path.empty() || config.job_dir.empty() ||
        config.command.empty()) {
        std::cerr << "aegis-run: job-id, rootfs, job-dir and a command are required\n";
        print_usage();
        return 2;
    }

    if (config.stdin_file.empty()) {
        config.stdin_file = "/dev/null";
    }
    if (config.stdout_file.empty()) {
        config.stdout_file = "/dev/null";
    }
    if (config.stderr_file.empty()) {
        config.stderr_file = "/dev/null";
    }

    const aegis::ExecutionResult result = aegis::run_sandbox(config);
    std::cout << aegis::result_to_json(result) << std::endl;
    return 0;
}
