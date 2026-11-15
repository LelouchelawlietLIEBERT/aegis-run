import { AlertTriangle, Cpu, Gauge, Hash, MemoryStick, Network, ShieldCheck, Timer } from "lucide-react";
import type { ReactNode } from "react";

import type { SandboxLimits } from "../config/presets";

interface KernelConfigPaneProps {
  limits: SandboxLimits;
  onChange: (limits: SandboxLimits) => void;
  disabled?: boolean;
}

interface SliderRowProps {
  icon: ReactNode;
  label: string;
  metric: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}

function SliderRow({
  icon,
  label,
  metric,
  value,
  display,
  min,
  max,
  step,
  disabled,
  onChange,
}: SliderRowProps) {
  return (
    <div className="rounded-lg border border-stroke/70 bg-ink/40 px-3 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-slate-500">{icon}</span>
          <div>
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-300">
              {label}
            </div>
            <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-slate-600">{metric}</div>
          </div>
        </div>
        <span className="rounded border border-stroke bg-panel px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-200">
          {display}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-3 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-700/70 disabled:cursor-not-allowed disabled:opacity-50"
      />
    </div>
  );
}

interface ToggleRowProps {
  icon: ReactNode;
  label: string;
  metric: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

function ToggleRow({ icon, label, metric, checked, disabled, onChange }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-stroke/70 bg-ink/40 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className={checked ? "text-emerald" : "text-slate-500"}>{icon}</span>
        <div>
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-300">
            {label}
          </div>
          <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-slate-600">{metric}</div>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full border transition disabled:cursor-not-allowed disabled:opacity-50 ${
          checked ? "border-emerald/50 bg-emerald/80" : "border-stroke bg-slate-700/70"
        }`}
      >
        <span
          className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-all ${
            checked ? "left-[18px]" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}

export default function KernelConfigPane({ limits, onChange, disabled }: KernelConfigPaneProps) {
  const update = <K extends keyof SandboxLimits>(key: K, value: SandboxLimits[K]) => {
    onChange({ ...limits, [key]: value });
  };

  const networkIsolated = !limits.enableNetwork;

  const pills = [
    "NEWPID",
    "NEWNS",
    "NEWUTS",
    "NEWIPC",
    "OVERLAYFS",
    ...(networkIsolated ? ["NEWNET"] : []),
    ...(limits.strictSeccomp ? ["SECCOMP_BPF"] : []),
    "NO_NEW_PRIVS",
  ];

  return (
    <section className="rounded-xl border border-stroke bg-panel shadow-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stroke px-4 py-3">
        <div className="flex items-center gap-2">
          <Cpu size={16} className="text-accent" />
          <h2 className="font-mono text-[11px] font-semibold tracking-[0.18em] text-slate-200">
            KERNEL CONFIGURATION
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded border border-stroke bg-ink/60 px-2 py-0.5 font-mono text-[9px] tracking-[0.12em] text-slate-500">
            cgroup v2
          </span>
          <span className="rounded border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-[9px] tracking-[0.12em] text-accent">
            swap.max = 0
          </span>
        </div>
      </div>

      <div className="grid gap-3 px-4 py-4 sm:grid-cols-2">
        <SliderRow
          icon={<MemoryStick size={15} />}
          label="Memory Cap"
          metric="memory.max"
          value={limits.memoryMb}
          display={`${limits.memoryMb} MB`}
          min={16}
          max={512}
          step={16}
          disabled={disabled}
          onChange={(value) => update("memoryMb", value)}
        />
        <SliderRow
          icon={<Gauge size={15} />}
          label="CPU Quota"
          metric={`cpu.max ${Math.round(limits.cpuCores * 100000)} 100000`}
          value={limits.cpuCores}
          display={`${limits.cpuCores.toFixed(1)} cores`}
          min={0.1}
          max={2}
          step={0.1}
          disabled={disabled}
          onChange={(value) => update("cpuCores", Number(value.toFixed(1)))}
        />
        <SliderRow
          icon={<Hash size={15} />}
          label="Max Processes"
          metric="pids.max"
          value={limits.maxPids}
          display={`${limits.maxPids} PIDs`}
          min={1}
          max={64}
          step={1}
          disabled={disabled}
          onChange={(value) => update("maxPids", value)}
        />
        <SliderRow
          icon={<Timer size={15} />}
          label="Wall Timeout"
          metric="watchdog SIGKILL"
          value={limits.timeoutMs}
          display={`${limits.timeoutMs} ms`}
          min={100}
          max={5000}
          step={100}
          disabled={disabled}
          onChange={(value) => update("timeoutMs", value)}
        />
      </div>

      <div className="grid gap-2 border-t border-stroke px-4 py-3 sm:grid-cols-2">
        <ToggleRow
          icon={<ShieldCheck size={15} />}
          label="Seccomp-BPF Strict Filter"
          metric="SCMP_ACT_KILL_PROCESS"
          checked={limits.strictSeccomp}
          disabled={disabled}
          onChange={(checked) => update("strictSeccomp", checked)}
        />
        <ToggleRow
          icon={<Network size={15} />}
          label="Isolated Network Namespace"
          metric="CLONE_NEWNET"
          checked={networkIsolated}
          disabled={disabled}
          onChange={(checked) => update("enableNetwork", !checked)}
        />
      </div>

      {limits.strictSeccomp && limits.enableNetwork ? (
        <div className="mx-4 mb-3 flex items-start gap-2 rounded-lg border border-amber/30 bg-amber/10 px-3 py-2 font-mono text-[10px] leading-relaxed text-amber">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          Network access removes CLONE_NEWNET isolation and leaves socket, connect, bind, listen and
          accept unblocked. The sandbox shares the host network stack for this run.
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5 border-t border-stroke px-4 py-3">
        <span className="mr-1 font-mono text-[9px] uppercase tracking-[0.18em] text-slate-600">
          ACTIVE
        </span>
        {pills.map((pill) => (
          <span
            key={pill}
            className={`rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-[0.08em] ${
              pill === "SECCOMP_BPF"
                ? "border-emerald/30 bg-emerald/10 text-emerald"
                : pill === "NEWNET"
                  ? "border-accent/30 bg-accent/10 text-accent"
                  : "border-stroke bg-ink/60 text-slate-400"
            }`}
          >
            {pill}
          </span>
        ))}
      </div>
    </section>
  );
}
