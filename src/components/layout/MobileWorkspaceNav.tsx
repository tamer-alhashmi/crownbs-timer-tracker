"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, ClipboardList, Gauge, History, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type WorkspaceNavTab<Tab extends string> = {
  id: Tab;
  label: string;
  Icon: LucideIcon;
  href?: string;
  tabButtonId?: string;
  panelId?: string;
};

export const DEFAULT_WORKSPACE_TABS = [
  { id: "overview", label: "Overview", Icon: Gauge },
  { id: "operations", label: "Live", Icon: Activity },
  { id: "work-logs", label: "Logs", Icon: ClipboardList },
  { id: "financials", label: "Financials", Icon: Wallet },
  { id: "audit", label: "Audit", Icon: History },
] as const;

export function MobileWorkspaceNav<Tab extends string>({
  activeTab,
  onSelect,
  tabs,
}: {
  activeTab: Tab | null;
  onSelect?: (tab: Tab) => void;
  tabs: readonly WorkspaceNavTab<Tab>[];
}) {
  const links = tabs;
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const updateVisibility = () => {
      const active = document.activeElement;
      setHidden(active instanceof HTMLElement && Boolean(
        active.closest("[contenteditable='true']")
        || active.matches("input, textarea, select, [role='textbox']")
      ));
    };
    let focusTimer = 0;
    const handleFocusOut = () => {
      window.clearTimeout(focusTimer);
      focusTimer = window.setTimeout(updateVisibility, 0);
    };
    document.addEventListener("focusin", updateVisibility);
    document.addEventListener("focusout", handleFocusOut);
    return () => {
      document.removeEventListener("focusin", updateVisibility);
      document.removeEventListener("focusout", handleFocusOut);
      window.clearTimeout(focusTimer);
    };
  }, []);

  return (
    <nav
      aria-label="Workspace sections"
      style={{ gridTemplateColumns: `repeat(${links.length}, minmax(0, 1fr))` }}
      className={`mobile-workspace-nav fixed inset-x-0 bottom-0 z-40 grid h-14 border-t border-line bg-surface/95 backdrop-blur transition-transform duration-200 md:hidden ${hidden ? "translate-y-full" : "translate-y-0"}`}
      aria-hidden={hidden}
    >
      {links.map(({ id, label, Icon, href }) => (
        href
          ? <Link
                key={id}
                href={href}
                aria-label={label}
                aria-current={activeTab === id ? "page" : undefined}
                tabIndex={hidden ? -1 : undefined}
                className={`relative flex min-w-0 flex-col items-center justify-center gap-0.5 text-[10px] font-semibold ${activeTab === id ? "brand-accent-text" : "nav-inactive text-ink-secondary"}`}
              >
                {activeTab === id && <span className="brand-accent-indicator absolute inset-x-3 top-0 h-0.5 rounded-full" />}
                <Icon aria-hidden="true" className="h-4 w-4" />
                <span className="truncate">{label}</span>
              </Link>
          : <button
                key={id}
                type="button"
                aria-label={label}
                aria-current={activeTab === id ? "page" : undefined}
                onClick={() => onSelect?.(id)}
                tabIndex={hidden ? -1 : undefined}
                className={`relative flex min-w-0 flex-col items-center justify-center gap-0.5 text-[10px] font-semibold ${activeTab === id ? "brand-accent-text" : "nav-inactive text-ink-secondary"}`}
              >
                {activeTab === id && <span className="brand-accent-indicator absolute inset-x-3 top-0 h-0.5 rounded-full" />}
                <Icon aria-hidden="true" className="h-4 w-4" />
                <span className="truncate">{label}</span>
              </button>
      ))}
    </nav>
  );
}
