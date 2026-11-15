import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type WindowId = "editor" | "kernel" | "telemetry";

export const WINDOW_TITLES: Record<WindowId, string> = {
  editor: "Source Editor",
  kernel: "Kernel Configuration",
  telemetry: "Telemetry Console",
};

interface WindowManagerValue {
  hidden: WindowId[];
  collapsed: WindowId[];
  maximized: WindowId | null;
  minimize: (id: WindowId) => void;
  maximize: (id: WindowId) => void;
  close: (id: WindowId) => void;
  restore: (id: WindowId) => void;
  restoreAll: () => void;
}

const WindowManagerContext = createContext<WindowManagerValue | null>(null);

export function WindowManagerProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState<WindowId[]>([]);
  const [collapsed, setCollapsed] = useState<WindowId[]>([]);
  const [maximized, setMaximized] = useState<WindowId | null>(null);

  const minimize = useCallback((id: WindowId) => {
    setCollapsed((previous) =>
      previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id],
    );
  }, []);

  const maximize = useCallback((id: WindowId) => {
    setMaximized((previous) => (previous === id ? null : id));
    setCollapsed((previous) => previous.filter((item) => item !== id));
  }, []);

  const close = useCallback((id: WindowId) => {
    setHidden((previous) => (previous.includes(id) ? previous : [...previous, id]));
    setCollapsed((previous) => previous.filter((item) => item !== id));
    setMaximized((previous) => (previous === id ? null : previous));
  }, []);

  const restore = useCallback((id: WindowId) => {
    setHidden((previous) => previous.filter((item) => item !== id));
  }, []);

  const restoreAll = useCallback(() => {
    setHidden([]);
    setCollapsed([]);
    setMaximized(null);
  }, []);

  const value = useMemo(
    () => ({ hidden, collapsed, maximized, minimize, maximize, close, restore, restoreAll }),
    [hidden, collapsed, maximized, minimize, maximize, close, restore, restoreAll],
  );

  return <WindowManagerContext.Provider value={value}>{children}</WindowManagerContext.Provider>;
}

export function useWindowManager(): WindowManagerValue {
  const value = useContext(WindowManagerContext);
  if (!value) {
    throw new Error("useWindowManager must be used within WindowManagerProvider");
  }
  return value;
}
