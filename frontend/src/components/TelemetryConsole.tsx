import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Cpu,
  HardDrive,
  Loader2,
  Lock,
  MemoryStick,
  Server,
  Terminal,
  Timer,
  XCircle,
} from "lucide-react";

import type { SandboxResult } from "../services/sandboxApi";
import type { ConsoleTab } from "../types/ui";

interface TelemetryConsoleProps {
  result: SandboxResult | null;
  running: boolean;
  error: string | null;
}

type Tone = "emerald" | "amber" | "crimson";

interface StatusStyle {
  label: string;
  tone: Tone;
  description: string;
}

const STATUS_STYLES: Record<string, StatusStyle> = {
  EXIT_SUCCESS: {
    label: "EXIT_SUCCESS",
    tone: "emerald",
    description: "Sandboxed process returned exit code 0",
  },
  MEMORY_LIMIT_EXCEEDED: {
    label: "MEMORY_LIMIT_EXCEEDED",
    tone: "crimson",
    description: "memory.max ceiling reached and the cgroup OOM killer fired",
  },
  OOM_KILLED: {
    label: "OOM_KILLED",
    tone: "crimson",
    description: "memory.events reports an OOM kill",
  },
  PID_LIMIT_HIT: {
    label: "PID_LIMIT_HIT",
    tone: "amber",
    description: "pids.max rejected a fork or clone attempt",
  },
  SECURITY_VIOLATION: {
    label: "SECURITY_VIOLATION",
    tone: "crimson",
    description: "Seccomp-BPF terminated the process with SIGSYS",
  },
  TIME_LIMIT_EXCEEDED: {
    label: "TIME_LIMIT_EXCEEDED",
    tone: "amber",
    description: "The kernel watchdog fired before the process completed",
  },
  COMPILATION_ERROR: {
    label: "COMPILATION_ERROR",
    tone: "amber",
    description: "Pass 1 compilation sandbox rejected the source",
  },
  EXIT_FAILURE: {
    label: "EXIT_FAILURE",
    tone: "amber",
    description: "The sandboxed process returned a non-zero exit code",
  },
  ENGINE_ERROR: {
    label: "ENGINE_ERROR",
    tone: "crimson",
    description: "aegis-run could not establish the sandbox",
  },
};

const TONE_STYLES: Record<Tone, { card: string; text: string; dot: string }> = {
  emerald: {
    card: "border-emerald/40 bg-emerald/10",
    text: "text-emerald",
    dot: "bg-emerald",
  },
  amber: {
    card: "border-amber/40 bg-amber/10",
    text: "text-amber",
    dot: "bg-amber",
  },
  crimson: {
    card: "border-crimson/40 bg-crimson/10",
    text: "text-crimson",
    dot: "bg-crimson",
  },
};

const SIGNAL_NAMES: Record<number, string> = {
  2: "SIGINT",
  6: "SIGABRT",
  9: "SIGKILL",
  11: "SIGSEGV",
  15: "SIGTERM",
  31: "SIGSYS",
};

const TABS: { id: ConsoleTab; label: string }[] = [
  { id: "stdout", label: "STDOUT" },
  { id: "stderr", label: "STDERR / COMPILER" },
  { id: "audit", label: "KERNEL AUDIT LOG" },
  { id: "diff", label: "OVERLAYFS DIFF" },
];

function formatMs(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0.00 ms";
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)} s`;
  }
  return `${value.toFixed(2)} ms`;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let scaled = value;
  let unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  return `${scaled.toFixed(scaled >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function signalLabel(signal: number): string {
  if (signal <= 0) {
    return "none";
  }
  return `${SIGNAL_NAMES[signal] ?? "SIG?"} (${signal})`;
}

function StatusGlyph({ tone, size = 20 }: { tone: Tone; size?: number }) {
  if (tone === "emerald") {
    return <CheckCircle2 size={size} className="text-emerald" />;
  }
  if (tone === "amber") {
    return <AlertTriangle size={size} className="text-amber" />;
  }
  return <XCircle size={size} className="text-crimson" />;
}

interface MetricCardProps {
  icon: ReactNode;
  label: string;
  value: string;
  valueClass?: string;
  detail: string;
  children?: ReactNode;
}

function MetricCard({ icon, label, value, valueClass, detail, children }: MetricCardProps) {
  return (
    <div className="flex flex-col rounded-lg border border-stroke/70 bg-ink/40 p-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          {label}
        </span>
        <span className="text-slate-600">{icon}</span>
      </div>
      <div className={`mt-2 font-mono text-lg font-semibold leading-none ${valueClass ?? "text-slate-100"}`}>
        {value}
      </div>
      <div className="mt-2 flex-1">{children}</div>
      <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-slate-600">{detail}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-stroke bg-ink/30 px-6 py-14 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-stroke bg-panel text-slate-500">
        <Activity size={22} />
      </div>
      <p className="mt-4 font-mono text-[11px] font-semibold tracking-[0.16em] text-slate-400">
        AWAITING TELEMETRY
      </p>
      <p className="mt-2 max-w-md font-mono text-[10px] leading-relaxed tracking-[0.06em] text-slate-600">
        Pick a payload, tune the cgroup envelope and run it. Kernel counters, the waterfall and the
        overlayfs upperdir diff will stream into this console.
      </p>
    </div>
  );
}

function CodeBlock({ content }: { content: string }) {
  return (
    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-stroke/70 bg-[#070b14] px-3 py-3 font-mono text-[11px] leading-relaxed text-slate-300">
      {content}
    </pre>
  );
}

function OutputTabs({ result, tab, onTabChange }: { result: SandboxResult; tab: ConsoleTab; onTabChange: (tab: ConsoleTab) => void }) {
  const counts: Record<ConsoleTab, number> = {
    stdout: result.stdout ? 1 : 0,
    stderr: result.stderr || result.compilerOutput ? 1 : 0,
    audit: result.auditLog.length,
    diff: result.fsDiff.length,
  };

  return (
    <div className="rounded-lg border border-stroke/70 bg-ink/30">
      <div className="flex flex-wrap items-center gap-1 border-b border-stroke/70 px-2 py-1.5">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onTabChange(item.id)}
            className={`rounded px-2.5 py-1.5 font-mono text-[9px] font-semibold tracking-[0.12em] transition ${
              tab === item.id
                ? "bg-panel text-accent"
                : "text-slate-500 hover:bg-panel/60 hover:text-slate-300"
            }`}
          >
            {item.label}
            <span className="ml-1.5 text-[8px] text-slate-600">{counts[item.id]}</span>
          </button>
        ))}
      </div>

      <div className="p-3">
        {tab === "stdout" ? (
          result.stdout ? (
            <CodeBlock content={result.stdout} />
          ) : (
            <p className="px-1 py-4 font-mono text-[11px] text-slate-600">No bytes were written to stdout.</p>
          )
        ) : null}

        {tab === "stderr" ? (
          <div className="space-y-2">
            {result.compilerOutput ? (
              <div>
                <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.16em] text-amber">
                  PASS 1 COMPILER
                </div>
                <CodeBlock content={result.compilerOutput} />
              </div>
            ) : null}
            {result.stderr ? (
              <div>
                <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.16em] text-crimson">
                  PASS 2 STDERR
                </div>
                <CodeBlock content={result.stderr} />
              </div>
            ) : null}
            {!result.compilerOutput && !result.stderr ? (
              <p className="px-1 py-4 font-mono text-[11px] text-slate-600">
                No compiler diagnostics or stderr output were produced.
              </p>
            ) : null}
          </div>
        ) : null}

        {tab === "audit" ? (
          result.auditLog.length ? (
            <div className="max-h-64 overflow-auto rounded-lg border border-stroke/70 bg-[#070b14] px-3 py-2">
              {result.auditLog.map((line, index) => (
                <div key={`${index}-${line}`} className="flex gap-2 font-mono text-[10px] leading-relaxed">
                  <span className="w-6 shrink-0 text-right text-slate-700">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="text-slate-400">{line}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-1 py-4 font-mono text-[11px] text-slate-600">No kernel audit lines recorded.</p>
          )
        ) : null}

        {tab === "diff" ? (
          result.fsDiff.length ? (
            <div className="max-h-64 space-y-1 overflow-auto rounded-lg border border-stroke/70 bg-[#070b14] px-3 py-2">
              {result.fsDiff.map((line) => (
                <div
                  key={line}
                  className={`font-mono text-[10px] leading-relaxed ${
                    line.startsWith("+")
                      ? "text-emerald"
                      : line.startsWith("~")
                        ? "text-amber"
                        : line.startsWith("-")
                          ? "text-crimson"
                          : "text-slate-400"
                  }`}
                >
                  {line}
                </div>
              ))}
            </div>
          ) : (
            <p className="px-1 py-4 font-mono text-[11px] text-slate-600">
              No files were created, modified or deleted inside the ephemeral overlay upperdir.
            </p>
          )
        ) : null}
      </div>
    </div>
  );
}

export default function TelemetryConsole({ result, running, error }: TelemetryConsoleProps) {
  const [tab, setTab] = useState<ConsoleTab>("stdout");

  useEffect(() => {
    setTab("stdout");
  }, [result?.jobId]);

  const status = result ? STATUS_STYLES[result.status] ?? STATUS_STYLES.EXIT_FAILURE : null;
  const tone = status ? TONE_STYLES[status.tone] : TONE_STYLES.crimson;

  const waterfall = result
    ? [
        { label: "Queue Wait", value: result.timings.queueWaitMs, color: "bg-slate-500" },
        { label: "/dev/shm Stage", value: result.timings.shmStageMs, color: "bg-sky-500" },
        { label: "Pass 1 Compile", value: result.timings.compileMs, color: "bg-violet-500" },
        { label: "Kernel Jail Init", value: result.timings.kernelSetupMs, color: "bg-amber" },
        { label: "Code Execution", value: result.timings.executionMs, color: "bg-emerald" },
        { label: "Cgroup Teardown", value: result.timings.teardownMs, color: "bg-rose-500" },
      ]
    : [];
  const waterfallTotal = waterfall.reduce((sum, segment) => sum + segment.value, 0);

  const memoryLimit = result?.memoryLimitBytes ?? 0;
  const memoryPct =
    result && memoryLimit > 0 ? Math.min(100, (result.peakMemoryBytes / memoryLimit) * 100) : 0;
  const memoryBar =
    result?.oomKilled || memoryPct >= 98
      ? "bg-crimson"
      : memoryPct >= 80
        ? "bg-amber"
        : "bg-accent";
  const cpuTotal = result ? result.cpuUserMs + result.cpuSysMs : 0;
  const userPct = cpuTotal > 0 && result ? (result.cpuUserMs / cpuTotal) * 100 : 0;

  return (
    <section className="rounded-xl border border-stroke bg-panel shadow-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stroke px-4 py-3">
        <div className="flex items-center gap-2">
          <Terminal size={16} className="text-accent" />
          <h2 className="font-mono text-[11px] font-semibold tracking-[0.18em] text-slate-200">
            TELEMETRY CONSOLE
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {result ? (
            <span className="max-w-[180px] truncate rounded border border-stroke bg-ink/60 px-2 py-0.5 font-mono text-[9px] tracking-[0.08em] text-slate-500">
              JOB {result.jobId.slice(0, 12)}
            </span>
          ) : null}
          <span
            className={`rounded border px-2 py-0.5 font-mono text-[9px] font-semibold tracking-[0.12em] ${
              result?.mode === "kernel"
                ? "border-emerald/30 bg-emerald/10 text-emerald"
                : "border-amber/30 bg-amber/10 text-amber"
            }`}
          >
            {result?.mode === "kernel" ? "KERNEL" : result ? "DEV PREVIEW" : "STANDBY"}
          </span>
        </div>
      </div>

      <div className="space-y-3 p-4">
        {error ? (
          <div className="flex items-start gap-3 rounded-lg border border-crimson/40 bg-crimson/10 px-4 py-3">
            <XCircle size={18} className="mt-0.5 shrink-0 text-crimson" />
            <div>
              <div className="font-mono text-[10px] font-semibold tracking-[0.16em] text-crimson">
                OPERATION FAILED
              </div>
              <div className="mt-1 font-mono text-[10px] leading-relaxed text-slate-300">{error}</div>
            </div>
          </div>
        ) : null}

        {running ? (
          <div className="flex items-center gap-3 rounded-lg border border-accent/30 bg-accent/10 px-4 py-3">
            <Loader2 size={16} className="animate-spin text-accent" />
            <div>
              <div className="font-mono text-[10px] font-semibold tracking-[0.16em] text-accent">
                SANDBOX SCHEDULED
              </div>
              <div className="mt-0.5 font-mono text-[10px] text-slate-400">
                semaphore slot → /dev/shm staging → compile → pivot_root → seccomp → wait4
              </div>
            </div>
          </div>
        ) : null}

        {result && status ? (
          <>
            <div className={`flex flex-wrap items-center justify-between gap-4 rounded-lg border px-4 py-3 ${tone.card}`}>
              <div className="flex items-center gap-3">
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg border border-stroke/40 bg-ink/40 ${tone.text}`}>
                  <StatusGlyph tone={status.tone} />
                </div>
                <div>
                  <div className={`font-mono text-sm font-bold tracking-[0.1em] ${tone.text}`}>
                    {status.label}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] text-slate-400">
                    {result.subReason || status.description}
                  </div>
                </div>
              </div>
              <div className="flex gap-5 font-mono text-[9px] uppercase tracking-[0.12em] text-slate-500">
                <div>
                  <div>EXIT CODE</div>
                  <div className="mt-0.5 text-xs tracking-normal text-slate-200">{result.exitCode}</div>
                </div>
                <div>
                  <div>SIGNAL</div>
                  <div className="mt-0.5 text-xs tracking-normal text-slate-200">
                    {signalLabel(result.termSignal)}
                  </div>
                </div>
                <div>
                  <div>TOTAL WALL</div>
                  <div className="mt-0.5 text-xs tracking-normal text-slate-200">
                    {formatMs(result.totalWallMs)}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                icon={<Timer size={14} />}
                label="Cold-Start Tax"
                value={formatMs(result.timings.kernelSetupMs)}
                detail="clone + pivot_root + proc mount"
              >
                <div className="h-1.5 overflow-hidden rounded-full bg-ink">
                  <div className="h-full w-full bg-amber/60" />
                </div>
              </MetricCard>

              <MetricCard
                icon={<Cpu size={14} />}
                label="CPU Time"
                value={formatMs(result.cpuUserMs + result.cpuSysMs)}
                detail={`user ${result.cpuUserMs.toFixed(2)} ms · kernel ${result.cpuSysMs.toFixed(2)} ms`}
              >
                <div className="flex h-1.5 overflow-hidden rounded-full bg-ink">
                  <div className="h-full bg-accent" style={{ width: `${userPct}%` }} />
                  <div className="h-full bg-violet-500" style={{ width: `${100 - userPct}%` }} />
                </div>
              </MetricCard>

              <MetricCard
                icon={<MemoryStick size={14} />}
                label="Peak Cgroup RAM"
                value={formatBytes(result.peakMemoryBytes)}
                valueClass={result.oomKilled ? "text-crimson" : "text-slate-100"}
                detail={`memory.max = ${formatBytes(memoryLimit)} · swap.max = 0`}
              >
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink">
                    <div className={`h-full ${memoryBar}`} style={{ width: `${memoryPct}%` }} />
                  </div>
                  {result.oomKilled ? (
                    <span className="rounded border border-crimson/40 bg-crimson/10 px-1.5 py-0.5 font-mono text-[8px] font-bold tracking-[0.12em] text-crimson">
                      OOM
                    </span>
                  ) : null}
                </div>
              </MetricCard>

              <MetricCard
                icon={<Lock size={14} />}
                label="PIDs & Syscall Gate"
                value={result.pidsMaxHit ? "CEILING HIT" : "WITHIN CAP"}
                valueClass={result.pidsMaxHit ? "text-amber" : "text-emerald"}
                detail={`pids.max = ${result.maxPids} · seccomp ${
                  result.blockedSyscall ? result.blockedSyscall : "armed"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${result.pidsMaxHit ? "bg-amber" : "bg-emerald"}`} />
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-slate-500">
                    {result.blockedSyscall ? "syscall blocked" : "filter loaded"}
                  </span>
                </div>
              </MetricCard>
            </div>

            <div className="rounded-lg border border-stroke/70 bg-ink/30 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  EXECUTION WATERFALL
                </span>
                <span className="font-mono text-[9px] tracking-[0.1em] text-slate-600">
                  total {formatMs(waterfallTotal)}
                </span>
              </div>
              <div className="flex h-2.5 overflow-hidden rounded-full bg-ink">
                {waterfallTotal > 0 ? (
                  waterfall
                    .filter((segment) => segment.value > 0)
                    .map((segment) => (
                      <div
                        key={segment.label}
                        title={`${segment.label}: ${formatMs(segment.value)}`}
                        className={`${segment.color} h-full`}
                        style={{ width: `${(segment.value / waterfallTotal) * 100}%` }}
                      />
                    ))
                ) : (
                  <div className="h-full w-full bg-slate-700" />
                )}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                {waterfall.map((segment) => (
                  <div key={segment.label} className="flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${segment.color}`} />
                    <span className="font-mono text-[9px] tracking-[0.06em] text-slate-500">
                      {segment.label}
                    </span>
                    <span className="ml-auto font-mono text-[9px] text-slate-400">
                      {formatMs(segment.value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <OutputTabs result={result} tab={tab} onTabChange={setTab} />

            <div className="grid gap-2 font-mono text-[9px] uppercase tracking-[0.1em] text-slate-600 sm:grid-cols-3">
              <div className="flex items-center gap-1.5">
                <Clock3 size={12} /> Execution {formatMs(result.timings.executionMs)}
              </div>
              <div className="flex items-center gap-1.5">
                <HardDrive size={12} /> Upperdir mutations {result.fsDiff.length}
              </div>
              <div className="flex items-center gap-1.5">
                <Server size={12} /> Namespaces {result.namespaces.length}
              </div>
            </div>
          </>
        ) : null}

        {!result && !running && !error ? <EmptyState /> : null}
      </div>
    </section>
  );
}
