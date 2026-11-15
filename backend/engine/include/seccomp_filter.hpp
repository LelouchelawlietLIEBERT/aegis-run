#pragma once

#include <string>
#include <vector>

namespace aegis {

bool apply_security(bool strict_seccomp, bool enable_network, std::vector<std::string>& audit, std::string& error);

}
