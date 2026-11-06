"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Activity, Building2, CalendarDays, ClipboardList, Gauge, History, ShieldCheck, UserRound, Wallet } from "lucide-react";
import type { UserRole } from "@/lib/roles";
import { SharedWorkspaceShell } from "@/components/layout/SharedWorkspaceShell";
import { WorkspaceHeader } from "@/components/layout/WorkspaceHeader";
import type { WorkspaceNavTab } from "@/components/layout/MobileWorkspaceNav";

type Tab = "profile" | "users" | "properties" | "payroll" | "billing";
type Props = {
  role: UserRole;
  user?: { name: string; email: string; avatarUrl: string | null };
  utility: ReactNode;
  profile: ReactNode;
  billing?: ReactNode;
  payroll?: ReactNode;
  users: ReactNode;
  properties: ReactNode;
};

const tabs: { id: Tab; label: string; shortLabel: string; icon: typeof UserRound }[] = [
  { id: "profile", label: "Profile & Security", shortLabel: "Profile", icon: ShieldCheck },
  { id: "payroll", label: "Payroll & History", shortLabel: "Payroll", icon: CalendarDays },
  { id: "users", label: "User Management", shortLabel: "Users", icon: UserRound },
  { id: "properties", label: "Properties", shortLabel: "Properties", icon: Building2 },
  { id: "billing", label: "Billing & Subscription", shortLabel: "Billing", icon: Wallet },
];

function isTabVisible(id: Tab, role: UserRole) {
  return id === "profile" ||
    (id === "payroll" && role === "cleaner") ||
    (id === "users" && ["super_admin", "admin", "owner", "manager"].includes(role)) ||
    (id === "properties" && ["super_admin", "admin", "owner"].includes(role)) ||
    (id === "billing" && role === "super_admin");
}

export default function SettingsHub({ role, user, utility, profile, billing, payroll, users, properties }: Props) {
  const visibleTabs = tabs.filter(({ id }) => isTabVisible(id, role) && (id !== "billing" || Boolean(billing)));
  const useGridTabs = visibleTabs.length <= 3;
  const workspacePath = role === "cleaner" ? "/dashboard"
    : role === "owner" ? "/owner"
      : role === "manager" ? "/manager"
        : ["hk_admin", "housekeeping_admin"].includes(role) ? "/hk-admin"
          : "/admin";
  const workspaceTabs: readonly WorkspaceNavTab<string>[] = role === "cleaner"
    ? [
      { id: "operations", label: "My shifts", Icon: Activity, href: `${workspacePath}#operations-panel` },
      { id: "history", label: "History", Icon: ClipboardList, href: `${workspacePath}#history-panel` },
    ]
    : ["hk_admin", "housekeeping_admin"].includes(role)
      ? [
        { id: "overview", label: "Overview", Icon: Gauge, href: `${workspacePath}?tab=overview` },
        { id: "operations", label: "Live", Icon: Activity, href: `${workspacePath}?tab=operations` },
        { id: "rooms", label: "Rooms", Icon: Building2, href: `${workspacePath}?tab=rooms` },
        { id: "history", label: "Logs", Icon: ClipboardList, href: `${workspacePath}?tab=history` },
      ]
      : [
        { id: "overview", label: "Overview", Icon: Gauge, href: `${workspacePath}?tab=overview` },
        { id: "operations", label: "Live", Icon: Activity, href: `${workspacePath}?tab=operations` },
        { id: "work-logs", label: "Logs", Icon: ClipboardList, href: `${workspacePath}?tab=work-logs` },
        { id: "financials", label: "Financials", Icon: Wallet, href: `${workspacePath}?tab=financials` },
        { id: "audit", label: "Audit", Icon: History, href: `${workspacePath}?tab=audit` },
      ];
  const [activeTab, setActiveTab] = useState<Tab>("profile");
  const [requestedHash, setRequestedHash] = useState("");
  useEffect(() => {
    const syncFromUrl = () => {
      const url = new URL(window.location.href);
      const requestedTab = url.searchParams.get("tab");
      if (requestedTab === "overview") {
        url.searchParams.set("tab", "profile");
        window.history.replaceState(window.history.state, "", url);
      } else if (requestedTab === "billing" && role !== "super_admin") {
        url.searchParams.set("tab", "profile");
        window.history.replaceState(window.history.state, "", url);
        setActiveTab("profile");
      } else if (requestedTab && tabs.some(({ id }) => id === requestedTab && isTabVisible(id, role) && (id !== "billing" || Boolean(billing)))) {
        setActiveTab(requestedTab as Tab);
      }
      setRequestedHash(url.hash);
    };
    syncFromUrl();
    window.addEventListener("help-center-navigate", syncFromUrl);
    window.addEventListener("popstate", syncFromUrl);
    return () => {
      window.removeEventListener("help-center-navigate", syncFromUrl);
      window.removeEventListener("popstate", syncFromUrl);
    };
  }, [billing, role]);
  useEffect(() => {
    if (!requestedHash) return;
    let attempts = 0;
    const scrollToPanel = () => {
      const target = document.getElementById(decodeURIComponent(requestedHash.slice(1)));
      if (target && target.getClientRects().length > 0) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        target.classList.add("ring-2", "ring-accent", "ring-offset-2");
        window.setTimeout(() => target.classList.remove("ring-2", "ring-accent", "ring-offset-2"), 1800);
        setRequestedHash("");
      } else if (attempts++ < 10) window.requestAnimationFrame(scrollToPanel);
    };
    window.requestAnimationFrame(scrollToPanel);
  }, [activeTab, requestedHash]);
  const content: Record<Tab, ReactNode> = {
    profile,
    payroll: payroll ?? null,
    users,
    properties,
    billing: role === "super_admin" ? billing ?? null : null,
  };

  const selectTab = (tab: Tab) => {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState(window.history.state, "", url);
  };

  return (
    <>
    <WorkspaceHeader name={user?.name ?? "Account"} email={user?.email ?? ""} avatarUrl={user?.avatarUrl} role={role} actions={utility} />
    <main className="theme-workspace min-h-screen overflow-y-auto bg-canvas px-3 pt-5 pb-[calc(env(safe-area-inset-bottom,0px)+5rem)] text-ink sm:px-6 sm:pt-8 md:ml-64 md:pb-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-5 border-b border-line pb-4 pt-2">
          <div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-secondary">Account settings</p>
              <h1 className="mt-1 text-2xl font-bold text-ink">Settings</h1>
            </div>
          </div>
          <nav
            aria-label="Settings sections"
            role="tablist"
            className={`mt-4 min-w-0 rounded-2xl border border-line p-1.5 ${
              useGridTabs
                ? "grid w-full gap-1.5 bg-surface-secondary/50"
                : "no-scrollbar flex gap-2 overflow-x-auto whitespace-nowrap bg-surface scroll-smooth [-webkit-overflow-scrolling:touch]"
            }`}
            style={useGridTabs ? { gridTemplateColumns: `repeat(${visibleTabs.length}, minmax(0, 1fr))` } : undefined}
          >
            {visibleTabs.map(({ id, label, shortLabel, icon: Icon }) => (
              <button
                key={id}
                type="button"
                id={`settings-tab-${id}`}
                role="tab"
                aria-selected={activeTab === id}
                aria-controls={`settings-panel-${id}`}
                aria-label={role === "cleaner" && id === "profile" ? "Personal Information" : label}
                title={role === "cleaner" && id === "profile" ? "Personal Information" : label}
                onClick={() => selectTab(id)}
                className={`flex min-h-12 min-w-0 items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-center text-xs font-medium leading-tight transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:px-3 sm:text-sm ${
                  useGridTabs ? "w-full" : "min-w-[7rem] shrink-0 sm:min-w-[10rem]"
                } ${
                  activeTab === id
                    ? "border-accent/30 bg-accent/10 text-accent shadow-sm"
                    : "border-transparent text-ink-secondary hover:border-line hover:bg-surface-secondary hover:text-ink"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="hidden min-w-0 truncate sm:inline-flex">
                  {role === "cleaner" && id === "profile" ? "Personal Information" : label}
                </span>
                <span className="min-w-0 truncate sm:hidden">{shortLabel}</span>
              </button>
            ))}
          </nav>
        </header>
        <SharedWorkspaceShell role={role} activeTab={null} tabs={workspaceTabs} user={user ? { ...user, role } : undefined} />
        <div className="mt-4 min-w-0">
          {visibleTabs.map(({ id }) => (
            <section
              key={id}
              id={`settings-panel-${id}`}
              role="tabpanel"
              aria-labelledby={`settings-tab-${id}`}
              hidden={activeTab !== id}
              className="min-w-0 pb-8"
            >
              {content[id]}
            </section>
          ))}
        </div>
      </div>
    </main>
    </>
  );
}
