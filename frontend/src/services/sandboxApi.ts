import { env } from "../config/env";
import type { LanguageKey, SandboxLimits } from "../config/presets";

export interface StageTimings {
  queueWaitMs: number;
  shmStageMs: number;
  compileMs: number;
  kernelSetupMs: number;
  executionMs: number;
  teardownMs: number;
}

export interface SandboxResult {
  jobId: string;
  mode: string;
  status: string;
  subReason: string;
  exitCode: number;
  termSignal: number;
  totalWallMs: number;
  wallTimeMs: number;
  cpuUserMs: number;
  cpuSysMs: number;
  peakMemoryBytes: number;
  memoryLimitBytes: number;
  maxPids: number;
  oomKilled: boolean;
  pidsMaxHit: boolean;
  blockedSyscall: string;
  stdout: string;
  stderr: string;
  compilerOutput: string;
  fsDiff: string[];
  timings: StageTimings;
  auditLog: string[];
  namespaces: string[];
}

export interface HealthStatus {
  status: string;
  version: string;
  engineReady: boolean;
  mode: string;
  maxConcurrent: number;
}

export interface ExecuteOptions {
  language: LanguageKey;
  sourceCode: string;
  stdin: string;
  limits: SandboxLimits;
}

interface RawTimings {
  queue_wait_ms?: number;
  shm_stage_ms?: number;
  compile_ms?: number;
  kernel_setup_ms?: number;
  execution_ms?: number;
  teardown_ms?: number;
}

interface RawExecuteResponse {
  job_id?: string;
  mode?: string;
  status?: string;
  sub_reason?: string;
  exit_code?: number;
  term_signal?: number;
  total_wall_ms?: number;
  wall_time_ms?: number;
  cpu_user_ms?: number;
  cpu_sys_ms?: number;
  peak_memory_bytes?: number;
  memory_limit_bytes?: number;
  max_pids?: number;
  oom_killed?: boolean;
  pids_max_hit?: boolean;
  blocked_syscall?: string;
  stdout?: string;
  stderr?: string;
  compiler_output?: string;
  fs_diff?: string[];
  timings?: RawTimings;
  audit_log?: string[];
  namespaces?: string[];
}

interface RawHealthResponse {
  status?: string;
  version?: string;
  engine_ready?: boolean;
  mode?: string;
  max_concurrent?: number;
}

export class SandboxApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "SandboxApiError";
    this.status = status;
  }
}

export function encodeBase64(input: string): string {
  if (!input) {
    return "";
  }
  const bytes = new TextEncoder().encode(input);
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function decodeBase64(input: string): string {
  if (!input) {
    return "";
  }
  const binary = atob(input);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

function requireConfig(): void {
  if (!env.apiBaseUrl) {
    throw new SandboxApiError("VITE_API_BASE_URL is not configured in frontend/.env", 0);
  }
  if (!env.apiKey) {
    throw new SandboxApiError("VITE_API_KEY is not configured in frontend/.env", 0);
  }
}

async function readDetail(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { detail?: unknown };
    if (typeof payload.detail === "string") {
      return payload.detail;
    }
  } catch {
    return `${response.status} ${response.statusText}`.trim();
  }
  return `${response.status} ${response.statusText}`.trim();
}

function mapResult(raw: RawExecuteResponse): SandboxResult {
  const timings = raw.timings ?? {};
  return {
    jobId: raw.job_id ?? "",
    mode: raw.mode ?? "unknown",
    status: raw.status ?? "ENGINE_ERROR",
    subReason: raw.sub_reason ?? "",
    exitCode: raw.exit_code ?? 0,
    termSignal: raw.term_signal ?? 0,
    totalWallMs: raw.total_wall_ms ?? 0,
    wallTimeMs: raw.wall_time_ms ?? 0,
    cpuUserMs: raw.cpu_user_ms ?? 0,
    cpuSysMs: raw.cpu_sys_ms ?? 0,
    peakMemoryBytes: raw.peak_memory_bytes ?? 0,
    memoryLimitBytes: raw.memory_limit_bytes ?? 0,
    maxPids: raw.max_pids ?? 0,
    oomKilled: Boolean(raw.oom_killed),
    pidsMaxHit: Boolean(raw.pids_max_hit),
    blockedSyscall: raw.blocked_syscall ?? "",
    stdout: raw.stdout ?? "",
    stderr: raw.stderr ?? "",
    compilerOutput: raw.compiler_output ?? "",
    fsDiff: raw.fs_diff ?? [],
    timings: {
      queueWaitMs: timings.queue_wait_ms ?? 0,
      shmStageMs: timings.shm_stage_ms ?? 0,
      compileMs: timings.compile_ms ?? 0,
      kernelSetupMs: timings.kernel_setup_ms ?? 0,
      executionMs: timings.execution_ms ?? 0,
      teardownMs: timings.teardown_ms ?? 0,
    },
    auditLog: raw.audit_log ?? [],
    namespaces: raw.namespaces ?? [],
  };
}

export async function checkHealth(signal?: AbortSignal): Promise<HealthStatus> {
  requireConfig();
  const response = await fetch(`${env.apiBaseUrl}/api/v1/health`, {
    method: "GET",
    headers: { "X-API-Key": env.apiKey },
    signal,
  });
  if (!response.ok) {
    throw new SandboxApiError(await readDetail(response), response.status);
  }
  const raw = (await response.json()) as RawHealthResponse;
  return {
    status: raw.status ?? "unknown",
    version: raw.version ?? "unknown",
    engineReady: Boolean(raw.engine_ready),
    mode: raw.mode ?? "unknown",
    maxConcurrent: raw.max_concurrent ?? 0,
  };
}

export async function executeSandbox(
  options: ExecuteOptions,
  signal?: AbortSignal,
): Promise<SandboxResult> {
  requireConfig();
  const body = {
    language: options.language,
    source_code_b64: encodeBase64(options.sourceCode),
    stdin_b64: encodeBase64(options.stdin),
    limits: {
      memory_mb: options.limits.memoryMb,
      cpu_cores: options.limits.cpuCores,
      max_pids: options.limits.maxPids,
      timeout_ms: options.limits.timeoutMs,
      strict_seccomp: options.limits.strictSeccomp,
      enable_network: options.limits.enableNetwork,
    },
  };
  const response = await fetch(`${env.apiBaseUrl}/api/v1/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": env.apiKey,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    throw new SandboxApiError(await readDetail(response), response.status);
  }
  const raw = (await response.json()) as RawExecuteResponse;
  return mapResult(raw);
}
