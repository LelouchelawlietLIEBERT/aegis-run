import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  BatteryFull,
  Cpu,
  FileCode2,
  Folder,
  Grid3x3,
  Info,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Terminal,
  Volume2,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";

import { env } from "../config/env";
import type { ConnectionState } from "../types/ui";
import { useWindowManager, WINDOW_TITLES } from "./WindowManager";
import type { WindowId } from "./WindowManager";

interface DesktopPanelProps {
  connection: ConnectionState;
  mode: string;
  onRefreshHealth: () => void;
}

type MenuKey = "applications" | "places" | "system";

interface MenuItemProps {
  icon: ReactNode;
  label: string;
  meta?: string;
  onClick: () => void;
}

const WINDOW_ORDER: WindowId[] = ["editor", "kernel", "telemetry"];

const WINDOW_ICONS: Record<WindowId, ReactNode> = {
  editor: <FileCode2 size={13} />,
  kernel: <Cpu size={13} />,
  telemetry: <Terminal size={13} />,
};

const PLACES: { label: string; path: string }[] = [
  { label: "Sandbox Workspace", path: "/app" },
  { label: "Shared Memory Jobs", path: "/dev/shm/aegis_jobs" },
  { label: "Cgroup v2 Root", path: "/sys/fs/cgroup" },
  { label: "Alpine Rootfs", path: "/opt/aegis/rootfs" },
];

function MenuItem({ icon, label, meta, onClick }: MenuItemProps) {
  return (
    <button type="button" className="panel-menu-item" onClick={onClick}>
      <span className="flex-shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
      {meta ? <span className="panel-menu-item__meta">{meta}</span> : null}
    </button>
  );
}

export default function DesktopPanel({ connection, mode, onRefreshHealth }: DesktopPanelProps) {
  const [now, setNow] = useState<Date>(() => new Date());
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { hidden, restore, restoreAll } = useWindowManager();

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!openMenu) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenu(null);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMenu]);

  useEffect(() => {
    if (!aboutOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAboutOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [aboutOpen]);

  const toggleMenu = (menu: MenuKey) => {
    setOpenMenu((previous) => (previous === menu ? null : menu));
  };

  const closeMenus = () => setOpenMenu(null);

  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setNotice(`Copied ${path}`);
    } catch {
      setNotice(path);
    }
    closeMenus();
  };

  const handleRestore = (id: WindowId) => {
    restore(id);
    closeMenus();
  };

  const handleRefresh = () => {
    onRefreshHealth();
    closeMenus();
  };

  const handleAbout = () => {
    setAboutOpen(true);
    closeMenus();
  };

  const dateLabel = now.toLocaleDateString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const timeLabel = now.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const connectionLabel =
    connection === "online" ? "Engine online" : connection === "offline" ? "Engine offline" : "Checking link";
  const connectionColor =
    connection === "online" ? "text-[#8ff0a4]" : connection === "offline" ? "text-[#ff7b8a]" : "text-[#f6d32d]";

  return (
    <>
      <div className="desktop-panel" ref={panelRef}>
        <div className="flex min-w-0 items-center gap-0.5">
          <div className="panel-relative">
            <button
              type="button"
              className="panel-trigger"
              data-open={openMenu === "applications"}
              aria-haspopup="menu"
              aria-expanded={openMenu === "applications"}
              onClick={() => toggleMenu("applications")}
            >
              <Grid3x3 size={12} />
              Applications
            </button>
            {openMenu === "applications" ? (
              <div className="panel-menu" role="menu" aria-label="Applications">
                <div className="panel-menu-heading">Open Windows</div>
                {WINDOW_ORDER.map((id) => (
                  <MenuItem
                    key={id}
                    icon={WINDOW_ICONS[id]}
                    label={WINDOW_TITLES[id]}
                    meta={hidden.includes(id) ? "hidden" : "open"}
                    onClick={() => handleRestore(id)}
                  />
                ))}
                <div className="panel-menu-separator" />
                <MenuItem
                  icon={<RotateCcw size={13} />}
                  label="Restore All Windows"
                  onClick={() => {
                    restoreAll();
                    closeMenus();
                  }}
                />
              </div>
            ) : null}
          </div>

          <div className="panel-relative">
            <button
              type="button"
              className="panel-trigger"
              data-open={openMenu === "places"}
              aria-haspopup="menu"
              aria-expanded={openMenu === "places"}
              onClick={() => toggleMenu("places")}
            >
              Places
            </button>
            {openMenu === "places" ? (
              <div className="panel-menu" role="menu" aria-label="Places">
                <div className="panel-menu-heading">Locations</div>
                {PLACES.map((place) => (
                  <MenuItem
                    key={place.path}
                    icon={<Folder size={13} />}
                    label={place.label}
                    meta={place.path}
                    onClick={() => void copyPath(place.path)}
                  />
                ))}
              </div>
            ) : null}
          </div>

          <div className="panel-relative">
            <button
              type="button"
              className="panel-trigger"
              data-open={openMenu === "system"}
              aria-haspopup="menu"
              aria-expanded={openMenu === "system"}
              onClick={() => toggleMenu("system")}
            >
              System
            </button>
            {openMenu === "system" ? (
              <div className="panel-menu" role="menu" aria-label="System">
                <div className="panel-menu-heading">System Status</div>
                <MenuItem
                  icon={connection === "online" ? <Wifi size={13} /> : <WifiOff size={13} />}
                  label={connectionLabel}
                  meta={mode === "kernel" ? "KERNEL" : mode.toUpperCase()}
                  onClick={handleRefresh}
                />
                <MenuItem
                  icon={<RefreshCw size={13} />}
                  label="Check Engine Health"
                  onClick={handleRefresh}
                />
                <MenuItem
                  icon={<RotateCcw size={13} />}
                  label="Restore All Windows"
                  onClick={() => {
                    restoreAll();
                    closeMenus();
                  }}
                />
                <div className="panel-menu-separator" />
                <MenuItem icon={<Info size={13} />} label="About Aegis-Run" onClick={handleAbout} />
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-0.5">
          <span className={`panel-status ${connectionColor}`} title={connectionLabel}>
            {connection === "online" ? <Wifi size={13} /> : <WifiOff size={13} />}
          </span>
          <span className="panel-status hidden sm:inline-flex" title="System volume">
            <Volume2 size={13} />
          </span>
          <span className="panel-status hidden sm:inline-flex" title="Battery">
            <BatteryFull size={14} />
          </span>
          <span
            className="panel-clock"
            title="System clock"
            aria-label={`${dateLabel} ${timeLabel}`}
          >
            <span className="hidden md:inline">{dateLabel}</span>
            <span className="font-semibold tabular-nums">{timeLabel}</span>
          </span>
        </div>

        {notice ? <div className="panel-notice">{notice}</div> : null}
      </div>

      {aboutOpen ? (
        <div
          className="gtk-modal-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) {
              setAboutOpen(false);
            }
          }}
        >
          <div className="gtk-about" role="dialog" aria-modal="true" aria-label="About Aegis-Run">
            <div className="gtk-about__header">
              <span className="text-[12.5px] font-bold">About Aegis-Run</span>
              <button
                type="button"
                className="gtk-control gtk-control--close"
                aria-label="Close About dialog"
                onClick={() => setAboutOpen(false)}
              >
                <X size={12} strokeWidth={3} />
              </button>
            </div>
            <div className="gtk-about__body">
              <div className="flex items-start gap-3.5">
                <div className="gtk-about__icon">
                  <ShieldCheck size={27} strokeWidth={2.1} />
                </div>
                <div className="min-w-0">
                  <div className="text-[19px] font-bold leading-tight text-charcoal">Aegis-Run</div>
                  <div className="mt-0.5 font-mono text-[10.5px] text-muted">
                    Kernel Sandbox Desktop · v2.4.0
                  </div>
                  <p className="mt-2 text-[11.5px] leading-relaxed text-[#3d3846]">
                    A sub-3ms Linux container runtime for untrusted code, wrapped in a classic
                    GTK observability desktop. Every run is isolated with clone namespaces,
                    pivot_root and an ephemeral OverlayFS upperdir.
                  </p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-[#deddda] pt-3">
                <span className="gtk-about__feature">cgroup v2 limits</span>
                <span className="gtk-about__feature">seccomp-bpf gate</span>
                <span className="gtk-about__feature">overlayfs upperdir</span>
                <span className="gtk-about__feature">pivot_root jail</span>
                <span className="gtk-about__feature">clone namespaces</span>
                <span className="gtk-about__feature">swap.max = 0</span>
              </div>
              <div className="mt-3 grid gap-1 rounded border border-[#deddda] bg-[#f6f5f4] px-2.5 py-2 font-mono text-[10px] text-[#5e5c64]">
                <div className="flex justify-between gap-3">
                  <span>ENGINE</span>
                  <span className="text-[#241f31]">
                    {mode === "kernel" ? "kernel jail" : mode || "unknown"}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>LINK</span>
                  <span className="text-[#241f31]">{connectionLabel}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>API</span>
                  <span className="truncate text-[#241f31]">{env.apiBaseUrl || "unconfigured"}</span>
                </div>
              </div>
            </div>
            <div className="gtk-about__footer">
              <button
                type="button"
                className="gtk-button gtk-button--suggested"
                onClick={() => setAboutOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
