import { ChevronDown, Loader2, Play, ShieldCheck, Wifi, WifiOff } from "lucide-react";

import { LANGUAGE_OPTIONS, PRESETS } from "../config/presets";
import type { LanguageKey } from "../config/presets";
import type { ConnectionState } from "../types/ui";

interface HeaderBarProps {
  language: LanguageKey;
  onLanguageChange: (language: LanguageKey) => void;
  selectedPreset: string;
  onPresetChange: (presetId: string) => void;
  onRun: () => void;
  running: boolean;
  connection: ConnectionState;
  mode: string;
}

const CONNECTION_META: Record<ConnectionState, { label: string; classes: string; dot: string }> = {
  checking: {
    label: "LINK CHECK",
    classes: "border-amber/40 bg-amber/10 text-amber",
    dot: "bg-amber animate-pulse",
  },
  online: {
    label: "ENGINE ONLINE",
    classes: "border-emerald/40 bg-emerald/10 text-emerald",
    dot: "bg-emerald",
  },
  offline: {
    label: "ENGINE OFFLINE",
    classes: "border-crimson/40 bg-crimson/10 text-crimson",
    dot: "bg-crimson",
  },
};

const normalPresets = PRESETS.filter((preset) => preset.category === "normal");
const attackPresets = PRESETS.filter((preset) => preset.category === "attack");

export default function HeaderBar({
  language,
  onLanguageChange,
  selectedPreset,
  onPresetChange,
  onRun,
  running,
  connection,
  mode,
}: HeaderBarProps) {
  const connectionMeta = CONNECTION_META[connection];
  const kernelMode = mode === "kernel";

  return (
    <header className="sticky top-0 z-30 border-b border-stroke/80 bg-ink/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1720px] flex-col gap-4 px-4 py-3 sm:px-6 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-emerald/30 bg-emerald/10 text-emerald shadow-[0_0_35px_-12px_rgba(16,185,129,0.9)]">
            <ShieldCheck size={22} strokeWidth={2.1} />
          </div>
          <div className="leading-tight">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-sm font-semibold tracking-[0.18em] text-slate-100 sm:text-base">
                AEGIS-RUN // KERNEL SANDBOX
              </h1>
              <span className="rounded border border-stroke bg-panel px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-widest text-slate-400">
                v2.4
              </span>
            </div>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.25em] text-slate-500">
              cgroup v2 · overlayfs · seccomp-bpf · sub-3ms runtime
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 font-mono text-[10px] font-semibold tracking-[0.16em] ${connectionMeta.classes}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${connectionMeta.dot}`} />
            {connection === "online" ? <Wifi size={12} /> : <WifiOff size={12} />}
            {connectionMeta.label}
          </div>

          <div className="flex items-center gap-1.5 rounded-lg border border-stroke bg-panel px-2.5 py-1.5 font-mono text-[10px] font-semibold tracking-[0.14em] text-slate-400">
            <span className={`h-1.5 w-1.5 rounded-full ${kernelMode ? "bg-accent" : "bg-amber"}`} />
            {kernelMode ? "KERNEL JAIL" : "DEV PREVIEW"}
          </div>

          <div className="relative">
            <select
              aria-label="Language"
              value={language}
              onChange={(event) => onLanguageChange(event.target.value as LanguageKey)}
              className="h-9 appearance-none rounded-lg border border-stroke bg-panel pl-3 pr-8 font-mono text-xs font-medium text-slate-200 outline-none transition hover:border-slate-600 focus:border-accent"
            >
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
            <ChevronDown
              size={14}
              className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500"
            />
          </div>

          <div className="relative min-w-[220px] flex-1 sm:flex-none">
            <select
              aria-label="Attack preset"
              value={selectedPreset}
              onChange={(event) => onPresetChange(event.target.value)}
              className="h-9 w-full appearance-none rounded-lg border border-stroke bg-panel pl-3 pr-8 font-mono text-xs font-medium text-slate-200 outline-none transition hover:border-slate-600 focus:border-accent"
            >
              <option value="">Custom payload</option>
              <optgroup label="Normal">
                {normalPresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Threat Simulation">
                {attackPresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </optgroup>
            </select>
            <ChevronDown
              size={14}
              className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500"
            />
          </div>

          <button
            type="button"
            onClick={onRun}
            disabled={running}
            className="group inline-flex h-9 items-center gap-2 rounded-lg border border-emerald/50 bg-emerald px-4 font-mono text-[11px] font-bold tracking-[0.16em] text-ink shadow-[0_10px_30px_-16px_rgba(16,185,129,0.9)] transition hover:bg-emerald/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {running ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Play size={15} className="transition group-hover:translate-x-0.5" />
            )}
            {running ? "RUNNING" : "RUN IN SANDBOX"}
          </button>
        </div>
      </div>
    </header>
  );
}
