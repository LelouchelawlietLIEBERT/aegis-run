from typing import Literal

from pydantic import BaseModel, Field

Language = Literal["cpp", "c", "python", "javascript"]


class Limits(BaseModel):
    memory_mb: int = Field(default=128, ge=16, le=512)
    cpu_cores: float = Field(default=1.0, ge=0.1, le=2.0)
    max_pids: int = Field(default=16, ge=1, le=64)
    timeout_ms: int = Field(default=2000, ge=100, le=5000)
    strict_seccomp: bool = True
    enable_network: bool = False


class ExecuteRequest(BaseModel):
    language: Language
    source_code_b64: str
    stdin_b64: str = ""
    limits: Limits = Field(default_factory=Limits)


class StageTimings(BaseModel):
    queue_wait_ms: float = 0.0
    shm_stage_ms: float = 0.0
    compile_ms: float = 0.0
    kernel_setup_ms: float = 0.0
    execution_ms: float = 0.0
    teardown_ms: float = 0.0


class ExecuteResponse(BaseModel):
    job_id: str
    mode: str
    status: str
    sub_reason: str = ""
    exit_code: int = 0
    term_signal: int = 0
    total_wall_ms: float = 0.0
    wall_time_ms: float = 0.0
    cpu_user_ms: float = 0.0
    cpu_sys_ms: float = 0.0
    peak_memory_bytes: int = 0
    memory_limit_bytes: int = 0
    max_pids: int = 0
    oom_killed: bool = False
    pids_max_hit: bool = False
    blocked_syscall: str = ""
    stdout: str = ""
    stderr: str = ""
    compiler_output: str = ""
    fs_diff: list[str] = Field(default_factory=list)
    timings: StageTimings = Field(default_factory=StageTimings)
    audit_log: list[str] = Field(default_factory=list)
    namespaces: list[str] = Field(default_factory=list)
