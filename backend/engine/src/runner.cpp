#define _GNU_SOURCE 1
#include "runner.hpp"

#include <fcntl.h>
#include <poll.h>
#include <sched.h>
#include <signal.h>
#include <sys/mman.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include "cgroup.hpp"
#include "filesystem.hpp"
#include "seccomp_filter.hpp"

namespace aegis {

namespace {

using SteadyClock = std::chrono::steady_clock;

struct ChildContext {
    const SandboxConfig* config;
    int ready_fd;
    int go_fd;
    int audit_fd;
};

void write_audit_lines(int fd, const std::vector<std::string>& lines) {
    if (fd < 0) {
        return;
    }
    for (const auto& line : lines) {
        const std::string payload = line + "\n";
        (void)::write(fd, payload.data(), payload.size());
    }
}

int child_fail(ChildContext& context, const std::string& message, int code) {
    if (context.ready_fd >= 0) {
        const std::string payload = "E" + message;
        (void)::write(context.ready_fd, payload.data(), payload.size());
        ::close(context.ready_fd);
        context.ready_fd = -1;
    }
    write_audit_lines(context.audit_fd, {"child: setup failed: " + message});
    if (context.audit_fd >= 0) {
        ::close(context.audit_fd);
        context.audit_fd = -1;
    }
    ::_exit(code);
    return code;
}

int child_entry(void* raw_context) {
    auto* context = static_cast<ChildContext*>(raw_context);
    const SandboxConfig& config = *context->config;

    char gate = 0;
    const ssize_t gate_read = ::read(context->go_fd, &gate, 1);
    if (context->go_fd >= 0) {
        ::close(context->go_fd);
        context->go_fd = -1;
    }
    if (gate_read != 1) {
        child_fail(*context, "parent gate closed before sandbox start", 126);
    }

    int stdin_fd = ::open(config.stdin_file.c_str(), O_RDONLY | O_CLOEXEC);
    if (stdin_fd < 0) {
        stdin_fd = ::open("/dev/null", O_RDONLY | O_CLOEXEC);
    }
    int stdout_fd =
        ::open(config.stdout_file.c_str(), O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0644);
    if (stdout_fd < 0) {
        stdout_fd = ::open("/dev/null", O_WRONLY | O_CLOEXEC);
    }
    int stderr_fd =
        ::open(config.stderr_file.c_str(), O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0644);
    if (stderr_fd < 0) {
        stderr_fd = ::open("/dev/null", O_WRONLY | O_CLOEXEC);
    }

    FilesystemIsolation filesystem(config.rootfs_path, config.job_dir);
    std::size_t flushed = 0;
    auto flush_filesystem_audit = [&]() {
        const auto& entries = filesystem.audit();
        for (; flushed < entries.size(); ++flushed) {
            write_audit_lines(context->audit_fd, {entries[flushed]});
        }
    };

    std::string error;
    if (!filesystem.mount_overlay(error)) {
        child_fail(*context, error, 2);
    }
    flush_filesystem_audit();
    if (!filesystem.pivot_root(error)) {
        child_fail(*context, error, 3);
    }
    flush_filesystem_audit();
    if (!filesystem.mount_proc(error)) {
        child_fail(*context, error, 4);
    }
    flush_filesystem_audit();

    if (stdin_fd >= 0) {
        (void)::dup2(stdin_fd, STDIN_FILENO);
        ::close(stdin_fd);
    }
    if (stdout_fd >= 0) {
        (void)::dup2(stdout_fd, STDOUT_FILENO);
        ::close(stdout_fd);
    }
    if (stderr_fd >= 0) {
        (void)::dup2(stderr_fd, STDERR_FILENO);
        ::close(stderr_fd);
    }

    ::setenv("HOME", "/tmp", 1);
    ::setenv("TMPDIR", "/tmp", 1);
    ::setenv("PATH", "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", 1);
    ::umask(022);

    if (::chdir("/app") != 0) {
        child_fail(*context, std::string("unable to enter /app: ") + std::strerror(errno), 5);
    }

    std::vector<std::string> security_audit;
    if (!apply_security(config.strict_seccomp, config.enable_network, security_audit, error)) {
        write_audit_lines(context->audit_fd, security_audit);
        child_fail(*context, error, 6);
    }
    write_audit_lines(context->audit_fd, security_audit);

    if (context->ready_fd >= 0) {
        const char ready = 'R';
        (void)::write(context->ready_fd, &ready, 1);
        ::close(context->ready_fd);
        context->ready_fd = -1;
    }
    if (context->audit_fd >= 0) {
        ::close(context->audit_fd);
        context->audit_fd = -1;
    }

    std::vector<char*> arguments;
    arguments.reserve(config.command.size() + 1);
    for (const auto& part : config.command) {
        arguments.push_back(const_cast<char*>(part.c_str()));
    }
    arguments.push_back(nullptr);

    ::execvp(arguments[0], arguments.data());
    const std::string message =
        std::string("exec failed for ") + arguments[0] + ": " + std::strerror(errno) + "\n";
    (void)::write(STDERR_FILENO, message.data(), message.size());
    ::_exit(127);
    return 127;
}

std::vector<std::string> read_lines(const std::string& path) {
    std::vector<std::string> lines;
    std::ifstream stream(path);
    if (!stream.is_open()) {
        return lines;
    }
    std::string line;
    while (std::getline(stream, line)) {
        lines.push_back(line);
    }
    return lines;
}

std::string describe_flags(int flags) {
    std::vector<std::string> names;
    if (flags & CLONE_NEWPID) names.emplace_back("NEWPID");
    if (flags & CLONE_NEWNS) names.emplace_back("NEWNS");
    if (flags & CLONE_NEWUTS) names.emplace_back("NEWUTS");
    if (flags & CLONE_NEWIPC) names.emplace_back("NEWIPC");
    if (flags & CLONE_NEWNET) names.emplace_back("NEWNET");
    std::string joined;
    for (std::size_t index = 0; index < names.size(); ++index) {
        if (index > 0) joined += "|";
        joined += names[index];
    }
    return joined;
}

std::string escape_json(const std::string& input) {
    std::string output;
    output.reserve(input.size() + 16);
    for (char character : input) {
        const unsigned char value = static_cast<unsigned char>(character);
        switch (value) {
            case '"': output += "\\\""; break;
            case '\\': output += "\\\\"; break;
            case '\n': output += "\\n"; break;
            case '\r': output += "\\r"; break;
            case '\t': output += "\\t"; break;
            case '\b': output += "\\b"; break;
            case '\f': output += "\\f"; break;
            default:
                if (value < 0x20) {
                    char buffer[7] = {0};
                    std::snprintf(buffer, sizeof(buffer), "\\u%04x", value);
                    output += buffer;
                } else {
                    output += character;
                }
                break;
        }
    }
    return output;
}

void append_string_array(std::ostringstream& stream, const std::vector<std::string>& values) {
    stream << "[";
    for (std::size_t index = 0; index < values.size(); ++index) {
        if (index > 0) {
            stream << ",";
        }
        stream << "\"" << escape_json(values[index]) << "\"";
    }
    stream << "]";
}

}

ExecutionResult run_sandbox(const SandboxConfig& config) {
    ExecutionResult result;
    result.namespaces = {"NEWPID", "NEWNS", "NEWUTS", "NEWIPC"};
    if (!config.enable_network) {
        result.namespaces.emplace_back("NEWNET");
    }
    result.namespaces.emplace_back("OVERLAYFS");
    result.namespaces.emplace_back("PIVOT_ROOT");
    result.namespaces.emplace_back("UID_65534");
    if (config.strict_seccomp) {
        result.namespaces.emplace_back("SECCOMP_BPF");
    }

    CgroupV2Manager cgroup(config.cgroup_root, config.job_id);
    std::string error;

    auto finalize = [&]() {
        const auto child_audit = read_lines(config.job_dir + "/child_audit.log");
        result.audit_log.insert(result.audit_log.end(), child_audit.begin(), child_audit.end());
        const auto teardown_start = SteadyClock::now();
        cgroup.kill_all();
        cgroup.remove();
        const auto& cgroup_audit = cgroup.audit();
        result.audit_log.insert(result.audit_log.end(), cgroup_audit.begin(), cgroup_audit.end());
        result.teardown_time_us =
            std::chrono::duration_cast<std::chrono::microseconds>(SteadyClock::now() - teardown_start)
                .count();
    };

    auto engine_error = [&](const std::string& reason) {
        result.status = "ENGINE_ERROR";
        result.sub_reason = reason;
        finalize();
        return result;
    };

    if (!cgroup.create(error)) {
        return engine_error(error);
    }
    if (!cgroup.apply_limits(config, error)) {
        return engine_error(error);
    }

    int ready_pipe[2] = {-1, -1};
    int go_pipe[2] = {-1, -1};
    const bool pipes_ready =
        ::pipe2(ready_pipe, O_CLOEXEC) == 0 && ::pipe2(go_pipe, O_CLOEXEC) == 0;
    if (!pipes_ready) {
        error = std::string("unable to create synchronization pipes: ") + std::strerror(errno);
        if (ready_pipe[0] >= 0) ::close(ready_pipe[0]);
        if (ready_pipe[1] >= 0) ::close(ready_pipe[1]);
        if (go_pipe[0] >= 0) ::close(go_pipe[0]);
        if (go_pipe[1] >= 0) ::close(go_pipe[1]);
        return engine_error(error);
    }

    const std::string child_audit_path = config.job_dir + "/child_audit.log";
    const int audit_fd =
        ::open(child_audit_path.c_str(), O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0644);

    constexpr std::size_t stack_size = 1024 * 1024;
    void* stack = ::mmap(nullptr, stack_size, PROT_READ | PROT_WRITE,
                         MAP_PRIVATE | MAP_ANONYMOUS | MAP_STACK, -1, 0);
    if (stack == MAP_FAILED) {
        ::close(ready_pipe[0]);
        ::close(ready_pipe[1]);
        ::close(go_pipe[0]);
        ::close(go_pipe[1]);
        if (audit_fd >= 0) ::close(audit_fd);
        return engine_error(std::string("unable to allocate clone stack: ") + std::strerror(errno));
    }

    void* stack_top = static_cast<unsigned char*>(stack) + stack_size;
    stack_top = reinterpret_cast<void*>(reinterpret_cast<std::uintptr_t>(stack_top) &
                                        ~static_cast<std::uintptr_t>(0xF));

    ChildContext context{&config, ready_pipe[1], go_pipe[0], audit_fd};

    int flags = CLONE_NEWPID | CLONE_NEWNS | CLONE_NEWUTS | CLONE_NEWIPC | SIGCHLD;
    if (!config.enable_network) {
        flags |= CLONE_NEWNET;
    }

    const auto clone_start = SteadyClock::now();
    const pid_t pid = ::clone(child_entry, stack_top, flags, &context);
    if (pid < 0) {
        error = std::string("clone failed: ") + std::strerror(errno);
        ::close(ready_pipe[0]);
        ::close(ready_pipe[1]);
        ::close(go_pipe[0]);
        ::close(go_pipe[1]);
        if (audit_fd >= 0) ::close(audit_fd);
        ::munmap(stack, stack_size);
        return engine_error(error);
    }

    result.audit_log.push_back("clone: pid=" + std::to_string(pid) + " flags=" + describe_flags(flags));
    ::close(ready_pipe[1]);
    ::close(go_pipe[0]);
    if (audit_fd >= 0) {
        ::close(audit_fd);
    }

    if (!cgroup.attach(pid, error)) {
        ::kill(pid, SIGKILL);
        int status = 0;
        while (::waitpid(pid, &status, 0) < 0 && errno == EINTR) {
        }
        ::close(ready_pipe[0]);
        ::close(go_pipe[1]);
        ::munmap(stack, stack_size);
        result.term_signal = SIGKILL;
        return engine_error("cgroup attach failed: " + error);
    }

    const char gate = 'G';
    const ssize_t gate_written = ::write(go_pipe[1], &gate, 1);
    ::close(go_pipe[1]);
    if (gate_written != 1) {
        ::kill(pid, SIGKILL);
        int status = 0;
        while (::waitpid(pid, &status, 0) < 0 && errno == EINTR) {
        }
        ::close(ready_pipe[0]);
        ::munmap(stack, stack_size);
        return engine_error("unable to release sandbox child gate");
    }

    std::string ready_payload;
    const auto setup_deadline = SteadyClock::now() + std::chrono::milliseconds(15000);
    bool setup_timeout = false;
    while (true) {
        const auto now = SteadyClock::now();
        if (now >= setup_deadline) {
            setup_timeout = true;
            break;
        }
        const auto remaining = std::chrono::duration_cast<std::chrono::milliseconds>(
                                   setup_deadline - now)
                                   .count();
        pollfd descriptor{ready_pipe[0], POLLIN, 0};
        const int polled = ::poll(&descriptor, 1, static_cast<int>(std::max<long long>(1, remaining)));
        if (polled < 0) {
            if (errno == EINTR) {
                continue;
            }
            break;
        }
        if (polled == 0) {
            setup_timeout = true;
            break;
        }
        char buffer[512];
        const ssize_t count = ::read(ready_pipe[0], buffer, sizeof(buffer));
        if (count <= 0) {
            break;
        }
        ready_payload.append(buffer, static_cast<std::size_t>(count));
        if (ready_payload.size() > 4096) {
            break;
        }
    }
    ::close(ready_pipe[0]);

    result.setup_time_us =
        std::chrono::duration_cast<std::chrono::microseconds>(SteadyClock::now() - clone_start).count();

    if (setup_timeout || ready_payload.empty() || ready_payload.front() != 'R') {
        ::kill(pid, SIGKILL);
        int status = 0;
        while (::wait4(pid, &status, 0, nullptr) < 0 && errno == EINTR) {
        }
        ::munmap(stack, stack_size);
        result.term_signal = SIGKILL;
        std::string reason = "sandbox setup failed";
        if (setup_timeout) {
            reason = "sandbox setup timed out";
        } else if (!ready_payload.empty() && ready_payload.front() == 'E') {
            reason = ready_payload.substr(1);
        } else if (ready_payload.empty()) {
            reason = "sandbox child exited before readiness signal";
        }
        return engine_error(reason);
    }

    result.audit_log.push_back("clone: sandbox child signalled readiness");

    const auto exec_start = SteadyClock::now();
    int status = 0;
    struct rusage usage {};
    bool timed_out = false;
    bool reaped = false;
    auto reap_blocking = [&]() -> bool {
        pid_t waited = 0;
        do {
            waited = ::wait4(pid, &status, 0, &usage);
        } while (waited < 0 && errno == EINTR);
        return waited == pid;
    };
    const auto deadline = exec_start + std::chrono::milliseconds(config.timeout_ms);
    while (true) {
        const pid_t waited = ::wait4(pid, &status, WNOHANG, &usage);
        if (waited == pid) {
            reaped = true;
            break;
        }
        if (waited < 0) {
            if (errno == EINTR) {
                continue;
            }
            break;
        }
        if (SteadyClock::now() >= deadline) {
            timed_out = true;
            result.audit_log.push_back(
                "watchdog: firing SIGKILL after " + std::to_string(config.timeout_ms) + " ms");
            cgroup.kill_all();
            ::kill(pid, SIGKILL);
            reaped = reap_blocking();
            break;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }
    if (!reaped) {
        return engine_error("failed to collect the sandbox exit status");
    }
    result.wall_time_us =
        std::chrono::duration_cast<std::chrono::microseconds>(SteadyClock::now() - exec_start).count();

    result.peak_memory_bytes = cgroup.read_peak_memory();
    result.oom_killed = cgroup.read_oom_killed();
    result.pids_max_hit = cgroup.read_pids_max_hit();

    long long cgroup_user_us = 0;
    long long cgroup_sys_us = 0;
    if (cgroup.read_cpu_usage(cgroup_user_us, cgroup_sys_us) &&
        (cgroup_user_us > 0 || cgroup_sys_us > 0)) {
        result.cpu_user_us = cgroup_user_us;
        result.cpu_sys_us = cgroup_sys_us;
    } else {
        result.cpu_user_us =
            static_cast<long long>(usage.ru_utime.tv_sec) * 1000000LL + usage.ru_utime.tv_usec;
        result.cpu_sys_us =
            static_cast<long long>(usage.ru_stime.tv_sec) * 1000000LL + usage.ru_stime.tv_usec;
    }

    if (WIFSIGNALED(status)) {
        result.term_signal = WTERMSIG(status);
    } else if (WIFEXITED(status)) {
        result.exit_code = WEXITSTATUS(status);
    }

    result.fs_diff = collect_fs_diff(config.job_dir + "/upper/app", config.baseline_path);
    result.audit_log.push_back("fs: overlay upperdir diff entries=" +
                               std::to_string(result.fs_diff.size()));

    if (result.term_signal == SIGSYS) {
        result.status = "SECURITY_VIOLATION";
        result.sub_reason = "seccomp filter terminated the process with SIGSYS";
        result.blocked_syscall = "seccomp:SIGSYS";
    } else if (result.oom_killed) {
        result.status = "MEMORY_LIMIT_EXCEEDED";
        result.sub_reason = "memory.events reports oom_kill";
    } else if (result.pids_max_hit) {
        result.status = "PID_LIMIT_HIT";
        result.sub_reason = "pids.events reports max";
    } else if (timed_out) {
        result.status = "TIME_LIMIT_EXCEEDED";
        result.sub_reason = "watchdog fired after " + std::to_string(config.timeout_ms) + " ms";
        result.term_signal = SIGKILL;
    } else if (WIFEXITED(status) && result.exit_code == 0) {
        result.status = "EXIT_SUCCESS";
        result.sub_reason = "completed with exit code 0";
    } else if (result.term_signal != 0) {
        result.status = "EXIT_FAILURE";
        result.sub_reason = "terminated by signal " + std::to_string(result.term_signal);
    } else {
        result.status = "EXIT_FAILURE";
        result.sub_reason = "exit code " + std::to_string(result.exit_code);
    }

    ::munmap(stack, stack_size);
    finalize();
    return result;
}

std::string result_to_json(const ExecutionResult& result) {
    std::ostringstream stream;
    stream << "{";
    stream << "\"status\":\"" << escape_json(result.status) << "\"";
    stream << ",\"sub_reason\":\"" << escape_json(result.sub_reason) << "\"";
    stream << ",\"exit_code\":" << result.exit_code;
    stream << ",\"term_signal\":" << result.term_signal;
    stream << ",\"wall_time_us\":" << result.wall_time_us;
    stream << ",\"setup_time_us\":" << result.setup_time_us;
    stream << ",\"teardown_time_us\":" << result.teardown_time_us;
    stream << ",\"cpu_user_us\":" << result.cpu_user_us;
    stream << ",\"cpu_sys_us\":" << result.cpu_sys_us;
    stream << ",\"peak_memory_bytes\":" << result.peak_memory_bytes;
    stream << ",\"oom_killed\":" << (result.oom_killed ? "true" : "false");
    stream << ",\"pids_max_hit\":" << (result.pids_max_hit ? "true" : "false");
    stream << ",\"blocked_syscall\":\"" << escape_json(result.blocked_syscall) << "\"";
    stream << ",\"fs_diff\":";
    append_string_array(stream, result.fs_diff);
    stream << ",\"audit_log\":";
    append_string_array(stream, result.audit_log);
    stream << ",\"namespaces\":";
    append_string_array(stream, result.namespaces);
    stream << "}";
    return stream.str();
}

}
