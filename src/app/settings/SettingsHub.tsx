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

const tabs: { id: Tab; label: string; icon: typeof UserRound }[] = [
  { id: "profile", label: "Profile & Security", icon: ShieldCheck },
  { id: "payroll", label: "Payroll & History", icon: CalendarDays },
  { id: "users", label: "User Management", icon: UserRound },
  { id: "properties", label: "Properties & Hotels", icon: Building2 },
  { id: "billing", label: "Billing & Subscription", icon: Wallet },
];

function isTabVisible(id: Tab, role: UserRole) {
  return id === "profile" ||
    (id === "payroll" && role === "cleaner") ||
    (id === "users" && ["super_admin", "admin", "owner", "manager"].includes(role)) ||
    (id === "properties" && ["super_admin", "admin", "owner"].includes(role)) ||
    (id === "billing" && role === "owner");
}

export default function SettingsHub({ role, user, utility, profile, billing, payroll, users, properties }: Props) {
  const visibleTabs = tabs.filter(({ id }) => isTabVisible(id, role) && (id !== "billing" || Boolean(billing)));
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
      } else if (requestedTab && tabs.some(({ id }) => id === requestedTab && isTabVisible(id, role))) {
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
  }, [role]);
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
  const content: Record<Tab, ReactNode> = { profile, payroll: payroll ?? null, users, properties, billing: billing ?? null };

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
        <header className="mb-5 border-b border-line pb-3 pt-2">
          <div className="mb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-secondary">Account settings</p>
              <h1 className="mt-1 text-2xl font-bold text-ink">Settings</h1>
            </div>
          </div>
          <nav aria-label="Settings sections" role="tablist" className="no-scrollbar flex gap-2 overflow-x-auto whitespace-nowrap scroll-smooth [-webkit-overflow-scrolling:touch] md:hidden">
            {visibleTabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                id={`settings-tab-${id}`}
                role="tab"
                aria-selected={activeTab === id}
                aria-controls={`settings-panel-${id}`}
                onClick={() => selectTab(id)}
                className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                  activeTab === id
                    ? "bg-accent text-white shadow-sm"
                    : "border border-line bg-surface text-ink-secondary hover:bg-surface-secondary hover:text-ink"
                }`}
              >
                <Icon className="h-4 w-4" />
                {role === "cleaner" && id === "profile" ? "Personal Information" : label}
              </button>
            ))}
          </nav>
        </header>
        <SharedWorkspaceShell role={role} activeTab={null} tabs={workspaceTabs} user={user ? { ...user, role } : undefined} />
        <div className="mt-4 min-w-0 md:grid md:grid-cols-[15rem_minmax(0,1fr)] md:gap-6">
          <nav aria-label="Desktop settings navigation" role="tablist" className="hidden h-fit rounded-2xl border border-line bg-surface p-2 md:sticky md:top-20 md:block">
            {visibleTabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={activeTab === id}
                aria-controls={`settings-panel-${id}`}
                onClick={() => selectTab(id)}
                className={`mb-1 flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold transition-colors ${
                  activeTab === id ? "bg-accent/10 text-accent" : "text-ink-secondary hover:bg-surface-secondary hover:text-ink"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {role === "cleaner" && id === "profile" ? "Personal Information" : label}
              </button>
            ))}
          </nav>
          <div className="min-w-0">
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
      </div>
    </main>
    </>
  );
}
