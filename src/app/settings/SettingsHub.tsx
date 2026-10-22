"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Building2, CalendarDays, ShieldCheck, UserRound } from "lucide-react";
import type { UserRole } from "@/lib/roles";

type Tab = "profile" | "users" | "properties" | "payroll";
type Props = {
  role: UserRole;
  utility: ReactNode;
  profile: ReactNode;
  payroll?: ReactNode;
  users: ReactNode;
  properties: ReactNode;
};

const tabs: { id: Tab; label: string; icon: typeof UserRound }[] = [
  { id: "profile", label: "Profile & Security", icon: ShieldCheck },
  { id: "payroll", label: "Payroll & History", icon: CalendarDays },
  { id: "users", label: "User Management", icon: UserRound },
  { id: "properties", label: "Properties & Hotels", icon: Building2 },
];

function isTabVisible(id: Tab, role: UserRole) {
  return id === "profile" ||
    (id === "payroll" && role === "cleaner") ||
    (id === "users" && ["admin", "owner", "manager"].includes(role)) ||
    (id === "properties" && ["admin", "owner"].includes(role));
}

export default function SettingsHub({ role, utility, profile, payroll, users, properties }: Props) {
  const visibleTabs = tabs.filter(({ id }) => isTabVisible(id, role));
  const [activeTab, setActiveTab] = useState<Tab>("profile");
  useEffect(() => {
    const url = new URL(window.location.href);
    const requestedTab = url.searchParams.get("tab");
    if (requestedTab === "overview") {
      url.searchParams.set("tab", "profile");
      window.history.replaceState(null, "", url);
      return;
    }
    if (requestedTab && tabs.some(({ id }) => id === requestedTab && isTabVisible(id, role))) {
      setActiveTab(requestedTab as Tab);
    }
  }, [role]);
  const content: Record<Tab, ReactNode> = { profile, payroll: payroll ?? null, users, properties };

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-5 text-slate-900 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-7xl">
        <header className="sticky top-0 z-20 mb-5 border-b border-slate-200 bg-slate-50/95 pb-3 pt-2 backdrop-blur">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Account settings</p>
              <h1 className="mt-1 text-2xl font-bold text-slate-950">Settings</h1>
            </div>
            <div className="flex shrink-0 items-center gap-2">{utility}</div>
          </div>
          <nav aria-label="Settings sections" role="tablist" className="flex gap-2 overflow-x-auto">
            {visibleTabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                id={`settings-tab-${id}`}
                role="tab"
                aria-selected={activeTab === id}
                aria-controls={`settings-panel-${id}`}
                onClick={() => setActiveTab(id)}
                className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                  activeTab === id
                    ? "bg-slate-900 text-white shadow-sm"
                    : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                }`}
              >
                <Icon className="h-4 w-4" />
                {role === "cleaner" && id === "profile" ? "Personal Information" : label}
              </button>
            ))}
          </nav>
        </header>
        {visibleTabs.map(({ id }) => (
          <section
            key={id}
            id={`settings-panel-${id}`}
            role="tabpanel"
            aria-labelledby={`settings-tab-${id}`}
            hidden={activeTab !== id}
            className="min-w-0"
          >
            {content[id]}
          </section>
        ))}
      </div>
    </main>
  );
}
