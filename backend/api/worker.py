import asyncio
import base64
import binascii
import json
import math
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import uuid
from dataclasses import dataclass, field

from .config import settings
from .languages import LANGUAGE_PROFILES, LanguageProfile, render_command
from .schemas import ExecuteRequest, ExecuteResponse, StageTimings

try:
    import resource as _resource
except ImportError:
    _resource = None

MAX_SOURCE_BYTES = 512 * 1024
MAX_STDIN_BYTES = 1024 * 1024
COMPILE_MEMORY_BYTES = 256 * 1024 * 1024
COMPILE_MAX_PIDS = 32
COMPILE_TIMEOUT_MS = 20000
ENGINE_HARD_MARGIN_SECONDS = 15.0


class JobInputError(ValueError):
    pass


class EngineError(RuntimeError):
    pass


_semaphore: asyncio.Semaphore | None = None


def _get_semaphore() -> asyncio.Semaphore:
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(settings.MAX_CONCURRENT_SANDBOXES)
    return _semaphore


def engine_ready() -> bool:
    if os.name != "posix":
        return False
    try:
        if os.geteuid() != 0:
            return False
    except AttributeError:
        return False
    if not os.path.isfile(settings.AEGIS_BIN_PATH):
        return False
    if not os.access(settings.AEGIS_BIN_PATH, os.X_OK):
        return False
    if not os.path.isdir(settings.AEGIS_ROOTFS_PATH):
        return False
    if not os.path.isfile(os.path.join(settings.AEGIS_CGROUP_ROOT, "cgroup.controllers")):
        return False
    return True


def current_mode() -> str:
    return "kernel" if engine_ready() else "developer_preview"


@dataclass
class PassOutcome:
    status: str
    sub_reason: str = ""
    exit_code: int = 0
    term_signal: int = 0
    setup_ms: float = 0.0
    wall_ms: float = 0.0
    teardown_ms: float = 0.0
    cpu_user_ms: float = 0.0
    cpu_sys_ms: float = 0.0
    peak_memory_bytes: int = 0
    oom_killed: bool = False
    pids_max_hit: bool = False
    blocked_syscall: str = ""
    fs_diff: list[str] = field(default_factory=list)
    audit_log: list[str] = field(default_factory=list)
    namespaces: list[str] = field(default_factory=list)


def _decode_field(value: str, label: str, max_bytes: int) -> bytes:
    if not value:
        return b""
    try:
        decoded = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise JobInputError(f"{label} must be valid Base64") from exc
    if len(decoded) > max_bytes:
        raise JobInputError(f"{label} exceeds the {max_bytes} byte limit")
    return decoded


def _resolve_work_root() -> str:
    candidates = [os.path.join(tempfile.gettempdir(), "aegis_jobs")]
    if os.name == "posix":
        candidates.insert(0, settings.AEGIS_SHM_DIR)
    for root in candidates:
        try:
            os.makedirs(root, exist_ok=True)
            probe = os.path.join(root, f".probe_{uuid.uuid4().hex}")
            with open(probe, "wb") as handle:
                handle.write(b"ok")
            os.remove(probe)
            return root
        except OSError:
            continue
    raise EngineError("No writable staging directory is available")


def _read_text(path: str) -> str:
    try:
        with open(path, "rb") as handle:
            return handle.read().decode("utf-8", errors="replace")
    except OSError:
        return ""


def _combine_outputs(*paths: str) -> str:
    chunks: list[str] = []
    for path in paths:
        if os.path.isfile(path):
            text = _read_text(path)
            if text:
                chunks.append(text)
    return "".join(chunks)


def _scan_files(root: str) -> dict[str, tuple[int, int]]:
    snapshot: dict[str, tuple[int, int]] = {}
    if not os.path.isdir(root):
        return snapshot
    for base, _dirs, files in os.walk(root):
        for name in files:
            full = os.path.join(base, name)
            try:
                stat = os.stat(full)
            except OSError:
                continue
            relative = os.path.relpath(full, root).replace(os.sep, "/")
            snapshot[relative] = (stat.st_size, stat.st_mtime_ns)
    return snapshot


def _write_baseline(app_dir: str, baseline_path: str) -> dict[str, tuple[int, int]]:
    snapshot = _scan_files(app_dir)
    with open(baseline_path, "w", encoding="utf-8") as handle:
        for relative, (size, mtime) in sorted(snapshot.items()):
            handle.write(f"{relative}\t{size}\t{mtime}\n")
    return snapshot


def _format_diff(before: dict[str, tuple[int, int]], after: dict[str, tuple[int, int]]) -> list[str]:
    changes: list[str] = []
    for relative in sorted(after):
        size, mtime = after[relative]
        previous = before.get(relative)
        if previous is None:
            changes.append(f"+ {relative} ({size} B)")
        elif previous[0] != size or abs(previous[1] - mtime) > 1_000_000:
            changes.append(f"~ {relative} ({size} B)")
    for relative in sorted(before):
        if relative not in after:
            changes.append(f"- {relative}")
    return changes


def _make_preexec(timeout_ms: int):
    def apply_limits() -> None:
        if _resource is None:
            return
        cpu_seconds = max(1, math.ceil(timeout_ms / 1000))
        limits = [
            (_resource.RLIMIT_CPU, cpu_seconds),
            (_resource.RLIMIT_FSIZE, 64 * 1024 * 1024),
            (_resource.RLIMIT_CORE, 0),
        ]
        for resource_id, value in limits:
            try:
                _resource.setrlimit(resource_id, (value, value))
            except (ValueError, OSError):
                continue

    return apply_limits


def _kill_tree(proc: asyncio.subprocess.Process) -> None:
    if os.name == "nt":
        try:
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                capture_output=True,
                check=False,
            )
        except OSError:
            try:
                proc.kill()
            except ProcessLookupError:
                pass
        return
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError):
        try:
            proc.kill()
        except ProcessLookupError:
            pass


async def _monitor_usage(pid: int, holder: list[int], memory_limit_bytes: int) -> None:
    path = f"/proc/{pid}/status"
    while True:
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as handle:
                for line in handle:
                    if line.startswith("VmHWM:"):
                        value = int(line.split()[1]) * 1024
                        if value > holder[0]:
                            holder[0] = value
                    elif line.startswith("VmRSS:"):
                        value = int(line.split()[1]) * 1024
                        if value > holder[0]:
                            holder[0] = value
                        if value > memory_limit_bytes and holder[1] == 0:
                            holder[1] = 1
                            try:
                                os.killpg(pid, signal.SIGKILL)
                            except (ProcessLookupError, PermissionError, OSError):
                                pass
        except (OSError, ValueError, IndexError):
            pass
        await asyncio.sleep(0.005)


async def _monitor_pids(pid: int, holder: list[int], max_pids: int) -> None:
    while True:
        tasks = 0
        try:
            for entry in os.listdir("/proc"):
                if not entry.isdigit():
                    continue
                other = int(entry)
                try:
                    if os.getpgid(other) != pid:
                        continue
                except (ProcessLookupError, PermissionError, OSError):
                    continue
                try:
                    tasks += len(os.listdir(f"/proc/{other}/task"))
                except OSError:
                    tasks += 1
                if tasks > max_pids:
                    break
        except OSError:
            tasks = 0
        if tasks > max_pids and holder[2] == 0:
            holder[2] = 1
            try:
                os.killpg(pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError, OSError):
                pass
        await asyncio.sleep(0.05)


def _dev_command(command: list[str], is_compile: bool) -> list[str]:
    if not command:
        return command
    resolved = list(command)
    if not is_compile and resolved[0] in {"python", "python3"}:
        resolved[0] = sys.executable
        return resolved
    if shutil.which(resolved[0]) is None and resolved[0] == "python3":
        fallback = shutil.which("python")
        if fallback is not None:
            resolved[0] = fallback
    elif shutil.which(resolved[0]) is None and resolved[0] == "node":
        fallback = shutil.which("nodejs")
        if fallback is not None:
            resolved[0] = fallback
    return resolved


async def _dev_pass(
    profile: LanguageProfile,
    is_compile: bool,
    app_dir: str,
    stdin_path: str,
    out_path: str,
    err_path: str,
    memory_bytes: int,
    max_pids: int,
    timeout_ms: int,
    baseline: dict[str, tuple[int, int]] | None,
) -> PassOutcome:
    template = profile.compile_command if is_compile else profile.run_command
    command = _dev_command(render_command(template, app_dir), is_compile)
    if not command:
        raise EngineError("No command configured for the selected language")

    environment = os.environ.copy()
    environment["HOME"] = app_dir
    environment["TMPDIR"] = app_dir
    environment["TEMP"] = app_dir
    environment["TMP"] = app_dir

    kwargs: dict[str, object] = {}
    if os.name == "posix":
        kwargs["preexec_fn"] = _make_preexec(timeout_ms)
        kwargs["start_new_session"] = True
    else:
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)

    cpu_before = None
    if _resource is not None:
        cpu_before = _resource.getrusage(_resource.RUSAGE_CHILDREN)

    started = time.perf_counter()
    holder = [0, 0, 0]
    monitor: asyncio.Task[None] | None = None
    pid_monitor: asyncio.Task[None] | None = None
    with open(stdin_path, "rb") as stdin_handle, open(out_path, "wb") as stdout_handle, open(
        err_path, "wb"
    ) as stderr_handle:
        try:
            proc = await asyncio.create_subprocess_exec(
                *command,
                cwd=app_dir,
                stdin=stdin_handle,
                stdout=stdout_handle,
                stderr=stderr_handle,
                env=environment,
                **kwargs,
            )
        except OSError as exc:
            raise EngineError(f"developer preview could not launch {command[0]}: {exc}") from exc
        if os.name == "posix" and os.path.isdir("/proc"):
            monitor = asyncio.create_task(_monitor_usage(proc.pid, holder, memory_bytes))
            pid_monitor = asyncio.create_task(_monitor_pids(proc.pid, holder, max_pids))
        timed_out = False
        try:
            await asyncio.wait_for(proc.wait(), timeout=max(0.1, timeout_ms / 1000.0))
        except asyncio.TimeoutError:
            timed_out = True
            _kill_tree(proc)
            await proc.wait()
        finally:
            if monitor is not None:
                monitor.cancel()
                try:
                    await monitor
                except asyncio.CancelledError:
                    pass
            if pid_monitor is not None:
                pid_monitor.cancel()
                try:
                    await pid_monitor
                except asyncio.CancelledError:
                    pass
    wall_ms = (time.perf_counter() - started) * 1000.0

    cpu_user_ms = 0.0
    cpu_sys_ms = 0.0
    if _resource is not None and cpu_before is not None:
        cpu_after = _resource.getrusage(_resource.RUSAGE_CHILDREN)
        cpu_user_ms = max(0.0, (cpu_after.ru_utime - cpu_before.ru_utime) * 1000.0)
        cpu_sys_ms = max(0.0, (cpu_after.ru_stime - cpu_before.ru_stime) * 1000.0)

    return_code = proc.returncode if proc.returncode is not None else 0
    term_signal = 0
    oom_exceeded = holder[1] == 1
    pids_limit_hit = holder[2] == 1
    if oom_exceeded:
        status = "MEMORY_LIMIT_EXCEEDED"
        sub_reason = f"developer preview RSS watchdog fired above {memory_bytes} bytes"
        exit_code = 0
        term_signal = int(getattr(signal, "SIGKILL", 9))
    elif pids_limit_hit:
        status = "PID_LIMIT_HIT"
        sub_reason = f"developer preview task watchdog fired above {max_pids} tasks"
        exit_code = 0
        term_signal = int(getattr(signal, "SIGKILL", 9))
    elif timed_out:
        status = "TIME_LIMIT_EXCEEDED"
        sub_reason = f"developer preview watchdog fired after {timeout_ms} ms"
        exit_code = 0
        term_signal = int(getattr(signal, "SIGKILL", 9))
    elif return_code < 0:
        term_signal = -return_code
        exit_code = 0
        if term_signal == int(getattr(signal, "SIGSYS", 31)):
            status = "SECURITY_VIOLATION"
            sub_reason = "process terminated by SIGSYS"
        else:
            status = "EXIT_FAILURE"
            sub_reason = f"terminated by signal {term_signal}"
    elif return_code == 0:
        status = "EXIT_SUCCESS"
        sub_reason = "completed with exit code 0"
        exit_code = 0
    elif is_compile:
        status = "COMPILATION_ERROR"
        sub_reason = f"compiler exited with code {return_code}"
        exit_code = return_code
    else:
        status = "EXIT_FAILURE"
        sub_reason = f"exit code {return_code}"
        exit_code = return_code

    changes: list[str] = []
    if baseline is not None:
        changes = _format_diff(baseline, _scan_files(app_dir))

    audit = [
        "developer_preview: cgroup v2 accounting unavailable",
        "developer_preview: mount, PID, network and seccomp isolation unavailable",
        f"developer_preview: applied RLIMIT_CPU={max(1, math.ceil(timeout_ms / 1000))} with RSS watchdog",
        f"developer_preview: memory ceiling {memory_bytes} bytes enforced by RSS watchdog",
        f"developer_preview: pids.max={max_pids} enforced by task watchdog",
        f"developer_preview: exec {' '.join(command)}",
    ]

    return PassOutcome(
        status=status,
        sub_reason=sub_reason,
        exit_code=exit_code,
        term_signal=term_signal,
        setup_ms=0.0,
        wall_ms=wall_ms,
        cpu_user_ms=cpu_user_ms,
        cpu_sys_ms=cpu_sys_ms,
        peak_memory_bytes=holder[0],
        oom_killed=oom_exceeded,
        pids_max_hit=pids_limit_hit,
        blocked_syscall="",
        fs_diff=changes,
        audit_log=audit,
        namespaces=["DEVELOPER_PREVIEW"],
    )


async def _engine_pass(
    job_id: str,
    stage: str,
    job_dir: str,
    profile: LanguageProfile,
    is_compile: bool,
    stdin_path: str,
    out_path: str,
    err_path: str,
    memory_bytes: int,
    cpu_quota_us: int,
    max_pids: int,
    timeout_ms: int,
    strict_seccomp: bool,
    enable_network: bool,
    baseline_path: str | None,
) -> PassOutcome:
    template = profile.compile_command if is_compile else profile.run_command
    command = render_command(template, "/app")
    if not command:
        raise EngineError("No command configured for the selected language")

    args = [
        settings.AEGIS_BIN_PATH,
        "--job-id",
        f"{job_id}{stage}",
        "--rootfs",
        settings.AEGIS_ROOTFS_PATH,
        "--job-dir",
        job_dir,
        "--cgroup-root",
        settings.AEGIS_CGROUP_ROOT,
        "--memory-bytes",
        str(memory_bytes),
        "--cpu-quota-us",
        str(cpu_quota_us),
        "--max-pids",
        str(max_pids),
        "--timeout-ms",
        str(timeout_ms),
        "--stdin",
        stdin_path,
        "--stdout",
        out_path,
        "--stderr",
        err_path,
    ]
    if strict_seccomp:
        args.append("--strict-seccomp")
    if enable_network:
        args.append("--enable-network")
    if baseline_path is not None:
        args.extend(["--baseline", baseline_path])
    args.append("--")
    args.extend(command)

    try:
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except OSError as exc:
        raise EngineError(f"unable to launch aegis-run: {exc}") from exc
    hard_timeout = max(1.0, timeout_ms / 1000.0) + ENGINE_HARD_MARGIN_SECONDS
    try:
        stdout_bytes, stderr_bytes = await asyncio.wait_for(proc.communicate(), timeout=hard_timeout)
    except asyncio.TimeoutError as exc:
        _kill_tree(proc)
        await proc.communicate()
        raise EngineError(f"aegis-run {stage} pass exceeded the supervisor deadline") from exc

    stderr_text = stderr_bytes.decode("utf-8", errors="replace")
    stdout_text = stdout_bytes.decode("utf-8", errors="replace").strip()
    if not stdout_text:
        raise EngineError(
            f"aegis-run {stage} pass produced no telemetry"
            + (f": {stderr_text.strip()}" if stderr_text.strip() else "")
        )

    line = stdout_text.splitlines()[-1]
    try:
        payload = json.loads(line)
    except json.JSONDecodeError as exc:
        raise EngineError(f"aegis-run returned malformed telemetry: {line[:512]}") from exc

    audit = [str(item) for item in payload.get("audit_log", [])]
    if stderr_text.strip():
        for entry in stderr_text.strip().splitlines():
            audit.append(f"engine: {entry}")

    return PassOutcome(
        status=str(payload.get("status", "ENGINE_ERROR")),
        sub_reason=str(payload.get("sub_reason", "")),
        exit_code=int(payload.get("exit_code", 0) or 0),
        term_signal=int(payload.get("term_signal", 0) or 0),
        setup_ms=float(payload.get("setup_time_us", 0) or 0) / 1000.0,
        wall_ms=float(payload.get("wall_time_us", 0) or 0) / 1000.0,
        teardown_ms=float(payload.get("teardown_time_us", 0) or 0) / 1000.0,
        cpu_user_ms=float(payload.get("cpu_user_us", 0) or 0) / 1000.0,
        cpu_sys_ms=float(payload.get("cpu_sys_us", 0) or 0) / 1000.0,
        peak_memory_bytes=int(payload.get("peak_memory_bytes", 0) or 0),
        oom_killed=bool(payload.get("oom_killed", False)),
        pids_max_hit=bool(payload.get("pids_max_hit", False)),
        blocked_syscall=str(payload.get("blocked_syscall", "")),
        fs_diff=[str(item) for item in payload.get("fs_diff", [])],
        audit_log=audit,
        namespaces=[str(item) for item in payload.get("namespaces", [])],
    )


async def run_job(request: ExecuteRequest) -> ExecuteResponse:
    started = time.perf_counter()
    semaphore = _get_semaphore()
    async with semaphore:
        queue_wait_ms = (time.perf_counter() - started) * 1000.0
        return await _run_locked(request, queue_wait_ms)


async def _run_locked(request: ExecuteRequest, queue_wait_ms: float) -> ExecuteResponse:
    profile = LANGUAGE_PROFILES[request.language]
    limits = request.limits
    job_id = uuid.uuid4().hex
    work_root = _resolve_work_root()
    job_dir = os.path.join(work_root, job_id)
    app_dir = os.path.join(job_dir, "upper", "app")
    logs_dir = os.path.join(job_dir, "logs")
    os.makedirs(app_dir, exist_ok=True)
    os.makedirs(logs_dir, exist_ok=True)

    stdin_path = os.path.join(job_dir, "stdin.bin")
    source_path = os.path.join(app_dir, profile.filename)
    mode = current_mode()
    memory_bytes = limits.memory_mb * 1024 * 1024
    cpu_quota_us = max(1, int(round(limits.cpu_cores * 100000)))
    timings = StageTimings(queue_wait_ms=queue_wait_ms)
    audit_log: list[str] = []
    namespaces: list[str] = []
    cleanup_done = False

    compile_out = os.path.join(logs_dir, "compile.stdout")
    compile_err = os.path.join(logs_dir, "compile.stderr")
    run_out = os.path.join(logs_dir, "run.stdout")
    run_err = os.path.join(logs_dir, "run.stderr")

    try:
        stage_start = time.perf_counter()
        source_bytes = _decode_field(request.source_code_b64, "source_code_b64", MAX_SOURCE_BYTES)
        stdin_bytes = _decode_field(request.stdin_b64, "stdin_b64", MAX_STDIN_BYTES)
        if not source_bytes.strip():
            raise JobInputError("source_code_b64 decoded to an empty payload")
        with open(source_path, "wb") as handle:
            handle.write(source_bytes)
        with open(stdin_path, "wb") as handle:
            handle.write(stdin_bytes)
        if os.name == "posix":
            os.chmod(app_dir, 0o777)
            os.chmod(source_path, 0o644)
        timings.shm_stage_ms = (time.perf_counter() - stage_start) * 1000.0

        audit_log.append(f"worker: staged {len(source_bytes)} source bytes in {app_dir}")
        audit_log.append(
            f"worker: mode={mode} memory.max={memory_bytes} cpu.max={cpu_quota_us} 100000 pids.max={limits.max_pids} timeout_ms={limits.timeout_ms}"
        )

        compile_ms = 0.0
        compile_outcome: PassOutcome | None = None
        if profile.compile_command is not None:
            if mode == "kernel":
                compile_outcome = await _engine_pass(
                    job_id=job_id,
                    stage="c",
                    job_dir=job_dir,
                    profile=profile,
                    is_compile=True,
                    stdin_path=stdin_path,
                    out_path=compile_out,
                    err_path=compile_err,
                    memory_bytes=COMPILE_MEMORY_BYTES,
                    cpu_quota_us=100000,
                    max_pids=COMPILE_MAX_PIDS,
                    timeout_ms=COMPILE_TIMEOUT_MS,
                    strict_seccomp=False,
                    enable_network=False,
                    baseline_path=None,
                )
            else:
                compile_outcome = await _dev_pass(
                    profile=profile,
                    is_compile=True,
                    app_dir=app_dir,
                    stdin_path=stdin_path,
                    out_path=compile_out,
                    err_path=compile_err,
                    memory_bytes=COMPILE_MEMORY_BYTES,
                    max_pids=COMPILE_MAX_PIDS,
                    timeout_ms=COMPILE_TIMEOUT_MS,
                    baseline=None,
                )
            compile_ms = compile_outcome.setup_ms + compile_outcome.wall_ms
            timings.compile_ms = compile_ms
            audit_log.extend(compile_outcome.audit_log)
            audit_log.append(f"worker: pass 1 compilation finished with {compile_outcome.status} in {compile_ms:.3f} ms")
            if compile_outcome.status != "EXIT_SUCCESS":
                compile_text = _combine_outputs(compile_out, compile_err)
                teardown_start = time.perf_counter()
                shutil.rmtree(job_dir, ignore_errors=True)
                cleanup_done = True
                timings.teardown_ms = compile_outcome.teardown_ms + (
                    time.perf_counter() - teardown_start
                ) * 1000.0
                total_wall = (
                    timings.queue_wait_ms
                    + timings.shm_stage_ms
                    + timings.compile_ms
                    + timings.teardown_ms
                )
                return ExecuteResponse(
                    job_id=job_id,
                    mode=mode,
                    status=compile_outcome.status,
                    sub_reason=compile_outcome.sub_reason or "compilation sandbox rejected the source",
                    exit_code=compile_outcome.exit_code,
                    term_signal=compile_outcome.term_signal,
                    total_wall_ms=total_wall,
                    wall_time_ms=compile_outcome.wall_ms,
                    cpu_user_ms=compile_outcome.cpu_user_ms,
                    cpu_sys_ms=compile_outcome.cpu_sys_ms,
                    peak_memory_bytes=compile_outcome.peak_memory_bytes,
                    memory_limit_bytes=memory_bytes,
                    max_pids=limits.max_pids,
                    oom_killed=compile_outcome.oom_killed,
                    pids_max_hit=compile_outcome.pids_max_hit,
                    blocked_syscall=compile_outcome.blocked_syscall,
                    stdout="",
                    stderr="",
                    compiler_output=compile_text,
                    fs_diff=compile_outcome.fs_diff,
                    timings=timings,
                    audit_log=audit_log,
                    namespaces=compile_outcome.namespaces,
                )

        baseline_path = os.path.join(job_dir, "baseline.tsv")
        baseline = _write_baseline(app_dir, baseline_path)

        if mode == "kernel":
            run_outcome = await _engine_pass(
                job_id=job_id,
                stage="r",
                job_dir=job_dir,
                profile=profile,
                is_compile=False,
                stdin_path=stdin_path,
                out_path=run_out,
                err_path=run_err,
                memory_bytes=memory_bytes,
                cpu_quota_us=cpu_quota_us,
                max_pids=limits.max_pids,
                timeout_ms=limits.timeout_ms,
                strict_seccomp=limits.strict_seccomp,
                enable_network=limits.enable_network,
                baseline_path=baseline_path,
            )
            fs_diff = run_outcome.fs_diff
            timings.kernel_setup_ms = run_outcome.setup_ms
            timings.execution_ms = run_outcome.wall_ms
        else:
            run_outcome = await _dev_pass(
                profile=profile,
                is_compile=False,
                app_dir=app_dir,
                stdin_path=stdin_path,
                out_path=run_out,
                err_path=run_err,
                memory_bytes=memory_bytes,
                max_pids=limits.max_pids,
                timeout_ms=limits.timeout_ms,
                baseline=baseline,
            )
            fs_diff = _format_diff(baseline, _scan_files(app_dir))
            timings.kernel_setup_ms = 0.0
            timings.execution_ms = run_outcome.wall_ms

        audit_log.extend(run_outcome.audit_log)
        audit_log.append(
            f"worker: pass 2 execution finished with {run_outcome.status} in {timings.execution_ms:.3f} ms"
        )
        namespaces = run_outcome.namespaces
        if mode == "developer_preview":
            audit_log.append("worker: kernel telemetry degraded because the engine cannot run unprivileged")

        stdout_text = _read_text(run_out)
        stderr_text = _read_text(run_err)
        compiler_text = _combine_outputs(compile_out, compile_err) if compile_outcome is not None else ""

        teardown_start = time.perf_counter()
        shutil.rmtree(job_dir, ignore_errors=True)
        cleanup_done = True
        timings.teardown_ms = run_outcome.teardown_ms + (
            time.perf_counter() - teardown_start
        ) * 1000.0

        total_wall = (
            timings.queue_wait_ms
            + timings.shm_stage_ms
            + timings.compile_ms
            + timings.kernel_setup_ms
            + timings.execution_ms
            + timings.teardown_ms
        )

        return ExecuteResponse(
            job_id=job_id,
            mode=mode,
            status=run_outcome.status,
            sub_reason=run_outcome.sub_reason,
            exit_code=run_outcome.exit_code,
            term_signal=run_outcome.term_signal,
            total_wall_ms=total_wall,
            wall_time_ms=run_outcome.wall_ms,
            cpu_user_ms=run_outcome.cpu_user_ms,
            cpu_sys_ms=run_outcome.cpu_sys_ms,
            peak_memory_bytes=run_outcome.peak_memory_bytes,
            memory_limit_bytes=memory_bytes,
            max_pids=limits.max_pids,
            oom_killed=run_outcome.oom_killed,
            pids_max_hit=run_outcome.pids_max_hit,
            blocked_syscall=run_outcome.blocked_syscall,
            stdout=stdout_text,
            stderr=stderr_text,
            compiler_output=compiler_text,
            fs_diff=fs_diff,
            timings=timings,
            audit_log=audit_log,
            namespaces=namespaces,
        )
    finally:
        if not cleanup_done:
            shutil.rmtree(job_dir, ignore_errors=True)
