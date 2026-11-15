import { AlertTriangle, Cpu, Gauge, Hash, MemoryStick, Network, ShieldCheck, Timer } from "lucide-react";
import type { ReactNode } from "react";

import type { SandboxLimits } from "../config/presets";
import GtkWindow from "./GtkWindow";

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
    <div className="rounded border border-[#c0bfbc] bg-[#f6f5f4] px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[#5e5c64]">{icon}</span>
          <div>
            <div className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-charcoal">
              {label}
            </div>
            <div className="font-mono text-[9px] uppercase tracking-[0.03em] text-[#77767b]">
              {metric}
            </div>
          </div>
        </div>
        <span className="gtk-badge bg-white font-semibold text-charcoal">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        className="gtk-scale mt-2"
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
    <div className="flex items-center justify-between gap-3 rounded border border-[#c0bfbc] bg-white px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className={checked ? "text-[#3584e4]" : "text-[#77767b]"}>{icon}</span>
        <div>
          <div className="text-[10.5px] font-bold uppercase tracking-[0.05em] text-charcoal">
            {label}
          </div>
          <div className="font-mono text-[9px] uppercase tracking-[0.03em] text-[#77767b]">
            {metric}
          </div>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="gtk-switch disabled:opacity-50"
      >
        <span className="gtk-switch__knob" />
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
    <GtkWindow
      id="kernel"
      title="Kernel Configuration"
      icon={<Cpu size={14} />}
      bodyClassName="bg-white"
      badges={
        <>
          <span className="gtk-badge hidden sm:inline-flex">cgroup v2</span>
          <span className="gtk-badge gtk-badge--accent hidden sm:inline-flex">swap.max = 0</span>
        </>
      }
    >
      <div className="grid gap-2.5 p-3 sm:grid-cols-2">
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

      <div className="grid gap-2 border-t border-[#deddda] bg-[#f6f5f4] p-3 sm:grid-cols-2">
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
        <div className="mx-3 mb-3 flex items-start gap-2 rounded border border-[#f5c97a] bg-[#fdf0d5] px-3 py-2 text-[10.5px] leading-relaxed text-[#8a4d00]">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            Network access removes CLONE_NEWNET isolation and leaves socket, connect, bind, listen
            and accept unblocked. The sandbox shares the host network stack for this run.
          </span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5 border-t border-[#deddda] bg-[#f6f5f4] px-3 py-2.5">
        <span className="mr-1 text-[9px] font-bold uppercase tracking-[0.1em] text-[#77767b]">
          Active
        </span>
        {pills.map((pill) => (
          <span
            key={pill}
            className={`gtk-badge ${
              pill === "SECCOMP_BPF"
                ? "gtk-badge--success"
                : pill === "NEWNET"
                  ? "gtk-badge--accent"
                  : ""
            }`}
          >
            {pill}
          </span>
        ))}
      </div>
    </GtkWindow>
  );
}
