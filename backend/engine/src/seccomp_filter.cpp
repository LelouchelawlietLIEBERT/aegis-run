#define _GNU_SOURCE 1
#include "seccomp_filter.hpp"

#include <grp.h>
#include <seccomp.h>
#include <sys/prctl.h>
#include <unistd.h>

#include <cerrno>
#include <cstring>
#include <string>
#include <vector>

namespace aegis {

namespace {

constexpr gid_t kSandboxGid = 65534;
constexpr uid_t kSandboxUid = 65534;

}

bool apply_security(bool strict_seccomp, bool enable_network, std::vector<std::string>& audit, std::string& error) {
    if (::prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) {
        error = std::string("PR_SET_NO_NEW_PRIVS failed: ") + std::strerror(errno);
        return false;
    }
    audit.push_back("security: PR_SET_NO_NEW_PRIVS=1");

    if (::setgroups(0, nullptr) != 0) {
        error = std::string("setgroups failed: ") + std::strerror(errno);
        return false;
    }
    if (::setgid(kSandboxGid) != 0) {
        error = std::string("setgid(65534) failed: ") + std::strerror(errno);
        return false;
    }
    if (::setuid(kSandboxUid) != 0) {
        error = std::string("setuid(65534) failed: ") + std::strerror(errno);
        return false;
    }
    audit.push_back("security: dropped privileges to uid=65534 gid=65534");

    if (!strict_seccomp) {
        audit.push_back("seccomp: strict filter disabled");
        return true;
    }

    static const char* kBlocked[] = {
        "socket",          "connect",       "bind",         "listen",        "accept",
        "accept4",         "ptrace",        "mount",        "umount2",       "pivot_root",
        "reboot",          "swapon",        "swapoff",      "kexec_load",    "init_module",
        "finit_module",    "delete_module", "bpf",          "perf_event_open", "chroot",
    };

    scmp_filter_ctx context = ::seccomp_init(SCMP_ACT_ALLOW);
    if (context == nullptr) {
        error = "seccomp_init failed";
        return false;
    }

    for (const char* name : kBlocked) {
        if (enable_network) {
            const std::string syscall_name(name);
            if (syscall_name == "socket" || syscall_name == "connect" || syscall_name == "bind" ||
                syscall_name == "listen" || syscall_name == "accept" || syscall_name == "accept4") {
                continue;
            }
        }
        const int number = ::seccomp_syscall_resolve_name(name);
        if (number == __NR_SCMP_ERROR) {
            continue;
        }
        const int result = ::seccomp_rule_add(context, SCMP_ACT_KILL_PROCESS, number, 0);
        if (result != 0) {
            const std::string message = std::string("seccomp_rule_add failed for ") + name + ": " +
                                        std::strerror(-result);
            ::seccomp_release(context);
            error = message;
            return false;
        }
        audit.push_back(std::string("seccomp: SCMP_ACT_KILL_PROCESS syscall=") + name);
    }

    const int load_result = ::seccomp_load(context);
    ::seccomp_release(context);
    if (load_result != 0) {
        error = std::string("seccomp_load failed: ") + std::strerror(-load_result);
        return false;
    }
    audit.push_back("seccomp: filter loaded with default SCMP_ACT_ALLOW");
    return true;
}

}
