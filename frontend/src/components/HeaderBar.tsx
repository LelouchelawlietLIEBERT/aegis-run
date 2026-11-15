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

const CONNECTION_META: Record<ConnectionState, { label: string; badge: string; icon: "on" | "off" }> = {
  checking: { label: "LINK CHECK", badge: "gtk-badge--warning", icon: "off" },
  online: { label: "ENGINE ONLINE", badge: "gtk-badge--success", icon: "on" },
  offline: { label: "ENGINE OFFLINE", badge: "gtk-badge--danger", icon: "off" },
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
    <header className="gtk-toolbar">
      <div className="mx-auto flex w-full max-w-[1720px] flex-col gap-2.5 px-3 py-2.5 sm:px-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-[#99c1f1] bg-gradient-to-b from-[#eef5fd] to-[#d5e6f9] text-[#1c71d8] shadow-sm">
            <ShieldCheck size={19} strokeWidth={2.1} />
          </div>
          <div className="min-w-0 leading-tight">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h1 className="text-[13.5px] font-bold tracking-[0.04em] text-charcoal">
                AEGIS-RUN
                <span className="ml-1.5 font-semibold text-[#5e5c64]">// KERNEL SANDBOX</span>
              </h1>
              <span className="gtk-badge">v2.4</span>
            </div>
            <p className="mt-0.5 truncate text-[10.5px] text-muted">
              Classic desktop console · cgroup v2 · overlayfs · seccomp-bpf · sub-3ms runtime
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div className="flex items-center gap-1.5 pb-0.5">
            <span className={`gtk-badge ${connectionMeta.badge}`}>
              {connectionMeta.icon === "on" ? <Wifi size={11} /> : <WifiOff size={11} />}
              {connectionMeta.label}
            </span>
            <span className={`gtk-badge ${kernelMode ? "gtk-badge--accent" : "gtk-badge--warning"}`}>
              {kernelMode ? "KERNEL JAIL" : "DEV PREVIEW"}
            </span>
          </div>

          <label className="w-[128px]">
            <span className="gtk-field-label">Language</span>
            <span className="relative block">
              <select
                aria-label="Language"
                value={language}
                onChange={(event) => onLanguageChange(event.target.value as LanguageKey)}
                className="gtk-select"
              >
                {LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={13}
                className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[#5e5c64]"
              />
            </span>
          </label>

          <label className="w-[262px] max-w-full">
            <span className="gtk-field-label">Preset Payload</span>
            <span className="relative block">
              <select
                aria-label="Attack preset"
                value={selectedPreset}
                onChange={(event) => onPresetChange(event.target.value)}
                className="gtk-select"
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
                size={13}
                className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[#5e5c64]"
              />
            </span>
          </label>

          <button
            type="button"
            onClick={onRun}
            disabled={running}
            className="gtk-button gtk-button--suggested px-4 text-[11.5px] font-bold tracking-[0.05em]"
          >
            {running ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Play size={14} strokeWidth={2.4} />
            )}
            {running ? "RUNNING" : "RUN IN SANDBOX"}
          </button>
        </div>
      </div>
    </header>
  );
}
