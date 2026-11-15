import { Maximize2, Minimize2, Minus, X } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";

import { useWindowManager } from "./WindowManager";
import type { WindowId } from "./WindowManager";

interface GtkWindowProps {
  id: WindowId;
  title: string;
  icon: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
}

export default function GtkWindow({
  id,
  title,
  icon,
  badges,
  actions,
  children,
  bodyClassName,
}: GtkWindowProps) {
  const { hidden, collapsed, maximized, minimize, maximize, close } = useWindowManager();

  if (hidden.includes(id)) {
    return null;
  }

  const isCollapsed = collapsed.includes(id);
  const isMaximized = maximized === id;

  const handleHeaderDoubleClick = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, input, select, textarea, a")) {
      return;
    }
    maximize(id);
  };

  return (
    <section
      className={`gtk-window${isMaximized ? " gtk-window--maximized" : ""}`}
      role="region"
      aria-label={title}
    >
      <header className="gtk-headerbar" onDoubleClick={handleHeaderDoubleClick}>
        <div className="gtk-title">
          <span className="gtk-title-icon">{icon}</span>
          <span className="gtk-title-text">{title}</span>
          {badges ? <div className="gtk-badges">{badges}</div> : null}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {actions}
          <div className="gtk-controls">
            <button
              type="button"
              className="gtk-control gtk-control--minimize"
              aria-label={`Minimize ${title}`}
              title="Minimize"
              onClick={() => minimize(id)}
            >
              <Minus size={12} strokeWidth={3} />
            </button>
            <button
              type="button"
              className="gtk-control gtk-control--maximize"
              aria-label={`${isMaximized ? "Restore" : "Maximize"} ${title}`}
              title={isMaximized ? "Restore" : "Maximize"}
              onClick={() => maximize(id)}
            >
              {isMaximized ? <Minimize2 size={11} strokeWidth={2.6} /> : <Maximize2 size={11} strokeWidth={2.6} />}
            </button>
            <button
              type="button"
              className="gtk-control gtk-control--close"
              aria-label={`Close ${title}`}
              title="Close"
              onClick={() => close(id)}
            >
              <X size={12} strokeWidth={3} />
            </button>
          </div>
        </div>
      </header>
      {isCollapsed ? null : <div className={`gtk-window-body ${bodyClassName ?? ""}`}>{children}</div>}
    </section>
  );
}
