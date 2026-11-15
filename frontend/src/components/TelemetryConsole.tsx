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
import GtkWindow from "./GtkWindow";

interface TelemetryConsoleProps {
  result: SandboxResult | null;
  running: boolean;
  error: string | null;
}

type Tone = "success" | "warning" | "danger";

interface StatusStyle {
  label: string;
  tone: Tone;
  description: string;
}

const STATUS_STYLES: Record<string, StatusStyle> = {
  EXIT_SUCCESS: {
    label: "EXIT_SUCCESS",
    tone: "success",
    description: "Sandboxed process returned exit code 0",
  },
  MEMORY_LIMIT_EXCEEDED: {
    label: "MEMORY_LIMIT_EXCEEDED",
    tone: "danger",
    description: "memory.max ceiling reached and the cgroup OOM killer fired",
  },
  OOM_KILLED: {
    label: "OOM_KILLED",
    tone: "danger",
    description: "memory.events reports an OOM kill",
  },
  PID_LIMIT_HIT: {
    label: "PID_LIMIT_HIT",
    tone: "warning",
    description: "pids.max rejected a fork or clone attempt",
  },
  SECURITY_VIOLATION: {
    label: "SECURITY_VIOLATION",
    tone: "danger",
    description: "Seccomp-BPF terminated the process with SIGSYS",
  },
  TIME_LIMIT_EXCEEDED: {
    label: "TIME_LIMIT_EXCEEDED",
    tone: "warning",
    description: "The kernel watchdog fired before the process completed",
  },
  COMPILATION_ERROR: {
    label: "COMPILATION_ERROR",
    tone: "warning",
    description: "Pass 1 compilation sandbox rejected the source",
  },
  EXIT_FAILURE: {
    label: "EXIT_FAILURE",
    tone: "warning",
    description: "The sandboxed process returned a non-zero exit code",
  },
  ENGINE_ERROR: {
    label: "ENGINE_ERROR",
    tone: "danger",
    description: "aegis-run could not establish the sandbox",
  },
};

const TONE_STYLES: Record<Tone, { card: string; text: string; dot: string; soft: string }> = {
  success: {
    card: "border-[#8fdfb6] bg-[#d8f0e3]",
    text: "text-[#1b8553]",
    dot: "bg-[#2ec27e]",
    soft: "bg-[#eaf7f0]",
  },
  warning: {
    card: "border-[#f5c97a] bg-[#fdf0d5]",
    text: "text-[#ad5d00]",
    dot: "bg-[#e5a50a]",
    soft: "bg-[#fdf6e7]",
  },
  danger: {
    card: "border-[#f2a5aa] bg-[#fbd8d8]",
    text: "text-[#c01c28]",
    dot: "bg-[#e01b24]",
    soft: "bg-[#fdecec]",
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
  if (tone === "success") {
    return <CheckCircle2 size={size} className="text-[#1b8553]" />;
  }
  if (tone === "warning") {
    return <AlertTriangle size={size} className="text-[#ad5d00]" />;
  }
  return <XCircle size={size} className="text-[#c01c28]" />;
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
    <div className="flex flex-col rounded border border-[#c0bfbc] bg-[#f6f5f4] p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] font-bold uppercase tracking-[0.08em] text-[#77767b]">
          {label}
        </span>
        <span className="text-[#9a9996]">{icon}</span>
      </div>
      <div className={`mt-1.5 font-mono text-[18px] font-bold leading-none ${valueClass ?? "text-charcoal"}`}>
        {value}
      </div>
      <div className="mt-2 flex-1">{children}</div>
      <div className="mt-1 font-mono text-[9px] leading-tight text-[#77767b]">{detail}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded border border-dashed border-[#c0bfbc] bg-[#f6f5f4] px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[#c0bfbc] bg-white text-[#77767b] shadow-sm">
        <Activity size={22} />
      </div>
      <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.08em] text-[#5e5c64]">
        Awaiting telemetry
      </p>
      <p className="mt-1.5 max-w-md text-[11px] leading-relaxed text-[#77767b]">
        Pick a payload, tune the cgroup envelope and run it. Kernel counters, the waterfall and the
        OverlayFS upperdir diff will stream into this console.
      </p>
    </div>
  );
}

function CodeBlock({ content }: { content: string }) {
  return <pre className="terminal-view max-h-64 whitespace-pre-wrap break-words">{content}</pre>;
}

function OutputTabs({
  result,
  tab,
  onTabChange,
}: {
  result: SandboxResult;
  tab: ConsoleTab;
  onTabChange: (tab: ConsoleTab) => void;
}) {
  const counts: Record<ConsoleTab, number> = {
    stdout: result.stdout ? 1 : 0,
    stderr: result.stderr || result.compilerOutput ? 1 : 0,
    audit: result.auditLog.length,
    diff: result.fsDiff.length,
  };

  return (
    <div className="overflow-hidden rounded border border-[#c0bfbc] bg-white">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-[#c0bfbc] bg-[#deddda] px-1.5 py-1">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onTabChange(item.id)}
            className={`rounded-t border border-b-0 px-2.5 py-1.5 text-[9px] font-bold tracking-[0.05em] transition ${
              tab === item.id
                ? "border-[#c0bfbc] bg-white text-[#1c71d8]"
                : "border-transparent text-[#5e5c64] hover:bg-white/60"
            }`}
          >
            {item.label}
            <span className="ml-1.5 text-[8px] font-normal text-[#9a9996]">{counts[item.id]}</span>
          </button>
        ))}
      </div>

      <div className="p-2.5">
        {tab === "stdout" ? (
          result.stdout ? (
            <CodeBlock content={result.stdout} />
          ) : (
            <p className="px-1 py-4 font-mono text-[11px] text-[#9a9996]">
              No bytes were written to stdout.
            </p>
          )
        ) : null}

        {tab === "stderr" ? (
          <div className="space-y-2">
            {result.compilerOutput ? (
              <div>
                <div className="mb-1 text-[9px] font-bold uppercase tracking-[0.08em] text-[#ad5d00]">
                  Pass 1 compiler
                </div>
                <CodeBlock content={result.compilerOutput} />
              </div>
            ) : null}
            {result.stderr ? (
              <div>
                <div className="mb-1 text-[9px] font-bold uppercase tracking-[0.08em] text-[#c01c28]">
                  Pass 2 stderr
                </div>
                <CodeBlock content={result.stderr} />
              </div>
            ) : null}
            {!result.compilerOutput && !result.stderr ? (
              <p className="px-1 py-4 font-mono text-[11px] text-[#9a9996]">
                No compiler diagnostics or stderr output were produced.
              </p>
            ) : null}
          </div>
        ) : null}

        {tab === "audit" ? (
          result.auditLog.length ? (
            <div className="terminal-view max-h-64">
              {result.auditLog.map((line, index) => (
                <div key={`${index}-${line}`} className="flex gap-2 leading-relaxed">
                  <span className="w-6 shrink-0 text-right text-[#77767b]">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="text-[#deddda]">{line}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-1 py-4 font-mono text-[11px] text-[#9a9996]">
              No kernel audit lines recorded.
            </p>
          )
        ) : null}

        {tab === "diff" ? (
          result.fsDiff.length ? (
            <div className="terminal-view max-h-64 space-y-0.5">
              {result.fsDiff.map((line) => (
                <div
                  key={line}
                  className={`leading-relaxed ${
                    line.startsWith("+")
                      ? "text-[#8ff0a4]"
                      : line.startsWith("~")
                        ? "text-[#f6d32d]"
                        : line.startsWith("-")
                          ? "text-[#ff7b8a]"
                          : "text-[#deddda]"
                  }`}
                >
                  {line}
                </div>
              ))}
            </div>
          ) : (
            <p className="px-1 py-4 font-mono text-[11px] text-[#9a9996]">
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
  const tone = status ? TONE_STYLES[status.tone] : TONE_STYLES.danger;

  const waterfall = result
    ? [
        { label: "Queue Wait", value: result.timings.queueWaitMs, color: "bg-[#9a9996]" },
        { label: "/dev/shm Stage", value: result.timings.shmStageMs, color: "bg-[#62a0ea]" },
        { label: "Pass 1 Compile", value: result.timings.compileMs, color: "bg-[#9141ac]" },
        { label: "Kernel Jail Init", value: result.timings.kernelSetupMs, color: "bg-[#e5a50a]" },
        { label: "Code Execution", value: result.timings.executionMs, color: "bg-[#2ec27e]" },
        { label: "Cgroup Teardown", value: result.timings.teardownMs, color: "bg-[#e01b24]" },
      ]
    : [];
  const waterfallTotal = waterfall.reduce((sum, segment) => sum + segment.value, 0);

  const memoryLimit = result?.memoryLimitBytes ?? 0;
  const memoryPct =
    result && memoryLimit > 0 ? Math.min(100, (result.peakMemoryBytes / memoryLimit) * 100) : 0;
  const memoryBar =
    result?.oomKilled || memoryPct >= 98
      ? "bg-[#e01b24]"
      : memoryPct >= 80
        ? "bg-[#e5a50a]"
        : "bg-[#3584e4]";
  const cpuTotal = result ? result.cpuUserMs + result.cpuSysMs : 0;
  const userPct = cpuTotal > 0 && result ? (result.cpuUserMs / cpuTotal) * 100 : 0;

  return (
    <GtkWindow
      id="telemetry"
      title="Telemetry Console"
      icon={<Terminal size={14} />}
      bodyClassName="bg-white"
      badges={
        <>
          {result ? (
            <span className="gtk-badge hidden sm:inline-flex">JOB {result.jobId.slice(0, 12)}</span>
          ) : null}
          <span
            className={`gtk-badge ${
              result?.mode === "kernel"
                ? "gtk-badge--success"
                : result
                  ? "gtk-badge--warning"
                  : ""
            }`}
          >
            {result?.mode === "kernel" ? "KERNEL" : result ? "DEV PREVIEW" : "STANDBY"}
          </span>
        </>
      }
    >
      <div className="space-y-2.5 p-3">
        {error ? (
          <div className="flex items-start gap-2.5 rounded border border-[#f2a5aa] bg-[#fdecec] px-3 py-2.5">
            <XCircle size={17} className="mt-0.5 shrink-0 text-[#c01c28]" />
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#c01c28]">
                Operation failed
              </div>
              <div className="mt-0.5 font-mono text-[10.5px] leading-relaxed text-[#3d3846]">
                {error}
              </div>
            </div>
          </div>
        ) : null}

        {running ? (
          <div className="flex items-center gap-2.5 rounded border border-[#99c1f1] bg-[#e8f1fb] px-3 py-2.5">
            <Loader2 size={16} className="animate-spin text-[#1c71d8]" />
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#1c71d8]">
                Sandbox scheduled
              </div>
              <div className="mt-0.5 font-mono text-[10px] text-[#3d3846]">
                semaphore slot → /dev/shm staging → compile → pivot_root → seccomp → wait4
              </div>
            </div>
          </div>
        ) : null}

        {result && status ? (
          <>
            <div className={`flex flex-wrap items-center justify-between gap-3 rounded border px-3 py-2.5 ${tone.card}`}>
              <div className="flex items-center gap-2.5">
                <div className={`flex h-9 w-9 items-center justify-center rounded-full border border-white/70 shadow-sm ${tone.soft}`}>
                  <StatusGlyph tone={status.tone} />
                </div>
                <div>
                  <div className={`font-mono text-[13px] font-bold tracking-[0.03em] ${tone.text}`}>
                    {status.label}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] leading-snug text-[#3d3846]">
                    {result.subReason || status.description}
                  </div>
                </div>
              </div>
              <div className="flex gap-5 font-mono text-[9px] uppercase tracking-[0.06em] text-[#5e5c64]">
                <div>
                  <div>Exit code</div>
                  <div className="mt-0.5 text-[11px] normal-case tracking-normal text-charcoal">
                    {result.exitCode}
                  </div>
                </div>
                <div>
                  <div>Signal</div>
                  <div className="mt-0.5 text-[11px] normal-case tracking-normal text-charcoal">
                    {signalLabel(result.termSignal)}
                  </div>
                </div>
                <div>
                  <div>Total wall</div>
                  <div className="mt-0.5 text-[11px] normal-case tracking-normal text-charcoal">
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
                <div className="h-1.5 overflow-hidden rounded-full bg-[#deddda]">
                  <div className="h-full w-full bg-[#e5a50a]/70" />
                </div>
              </MetricCard>

              <MetricCard
                icon={<Cpu size={14} />}
                label="CPU Time"
                value={formatMs(result.cpuUserMs + result.cpuSysMs)}
                detail={`user ${result.cpuUserMs.toFixed(2)} ms · kernel ${result.cpuSysMs.toFixed(2)} ms`}
              >
                <div className="flex h-1.5 overflow-hidden rounded-full bg-[#deddda]">
                  <div className="h-full bg-[#3584e4]" style={{ width: `${userPct}%` }} />
                  <div className="h-full bg-[#9141ac]" style={{ width: `${100 - userPct}%` }} />
                </div>
              </MetricCard>

              <MetricCard
                icon={<MemoryStick size={14} />}
                label="Peak Cgroup RAM"
                value={formatBytes(result.peakMemoryBytes)}
                valueClass={result.oomKilled ? "text-[#c01c28]" : "text-charcoal"}
                detail={`memory.max = ${formatBytes(memoryLimit)} · swap.max = 0`}
              >
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#deddda]">
                    <div className={`h-full ${memoryBar}`} style={{ width: `${memoryPct}%` }} />
                  </div>
                  {result.oomKilled ? (
                    <span className="gtk-badge gtk-badge--danger px-1 py-0 text-[8px] font-bold">
                      OOM
                    </span>
                  ) : null}
                </div>
              </MetricCard>

              <MetricCard
                icon={<Lock size={14} />}
                label="PIDs & Syscall Gate"
                value={result.pidsMaxHit ? "CEILING HIT" : "WITHIN CAP"}
                valueClass={result.pidsMaxHit ? "text-[#ad5d00]" : "text-[#1b8553]"}
                detail={`pids.max = ${result.maxPids} · seccomp ${
                  result.blockedSyscall ? result.blockedSyscall : "armed"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      result.pidsMaxHit ? "bg-[#e5a50a]" : "bg-[#2ec27e]"
                    }`}
                  />
                  <span className="text-[9px] uppercase tracking-[0.04em] text-[#5e5c64]">
                    {result.blockedSyscall ? "syscall blocked" : "filter loaded"}
                  </span>
                </div>
              </MetricCard>
            </div>

            <div className="rounded border border-[#c0bfbc] bg-[#f6f5f4] p-2.5">
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[9px] font-bold uppercase tracking-[0.08em] text-[#77767b]">
                  Execution Waterfall
                </span>
                <span className="font-mono text-[9px] text-[#77767b]">
                  total {formatMs(waterfallTotal)}
                </span>
              </div>
              <div className="flex h-2.5 overflow-hidden rounded-full border border-[#c0bfbc] bg-[#deddda]">
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
                  <div className="h-full w-full bg-[#deddda]" />
                )}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                {waterfall.map((segment) => (
                  <div key={segment.label} className="flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${segment.color}`} />
                    <span className="text-[9px] text-[#5e5c64]">{segment.label}</span>
                    <span className="ml-auto font-mono text-[9px] text-[#3d3846]">
                      {formatMs(segment.value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <OutputTabs result={result} tab={tab} onTabChange={setTab} />

            <div className="grid gap-x-3 gap-y-1 border-t border-[#deddda] pt-2 font-mono text-[9px] uppercase tracking-[0.04em] text-[#77767b] sm:grid-cols-3">
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
    </GtkWindow>
  );
}
