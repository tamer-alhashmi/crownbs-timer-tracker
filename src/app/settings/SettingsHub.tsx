"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Building2, Gauge, ShieldCheck, UserRound } from "lucide-react";
import type { UserRole } from "@/lib/roles";

type Tab = "overview" | "profile" | "users" | "properties";
type Props = {
  role: UserRole;
  utility: ReactNode;
  overview: ReactNode;
  profile: ReactNode;
  users: ReactNode;
  properties: ReactNode;
};

const tabs: { id: Tab; label: string; icon: typeof UserRound }[] = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "profile", label: "Profile & Security", icon: ShieldCheck },
  { id: "users", label: "User Management", icon: UserRound },
  { id: "properties", label: "Properties & Hotels", icon: Building2 },
];

export default function SettingsHub({ role, utility, overview, profile, users, properties }: Props) {
  const visibleTabs = tabs.filter(({ id }) =>
    (id === "overview" && ["owner", "manager"].includes(role)) ||
    id === "profile" ||
    (id === "users" && ["admin", "owner", "manager"].includes(role)) ||
    (id === "properties" && ["admin", "owner"].includes(role))
  );
  const [activeTab, setActiveTab] = useState<Tab>(() =>
    ["owner", "manager"].includes(role) ? "overview" : "profile"
  );
  useEffect(() => {
    const requestedTab = new URLSearchParams(window.location.search).get("tab");
    if (requestedTab && visibleTabs.some((tab) => tab.id === requestedTab)) setActiveTab(requestedTab as Tab);
  }, [role]);
  const content: Record<Tab, ReactNode> = { overview, profile, users, properties };

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
                role="tab"
                aria-selected={activeTab === id}
                onClick={() => setActiveTab(id)}
                className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                  activeTab === id
                    ? "bg-slate-900 text-white shadow-sm"
                    : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </nav>
        </header>
        <section role="tabpanel" className="min-w-0">
          {content[activeTab]}
        </section>
      </div>
    </main>
  );
}
