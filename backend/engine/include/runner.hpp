#pragma once

#include <string>

#include "config.hpp"

namespace aegis {

ExecutionResult run_sandbox(const SandboxConfig& config);
std::string result_to_json(const ExecutionResult& result);

}
