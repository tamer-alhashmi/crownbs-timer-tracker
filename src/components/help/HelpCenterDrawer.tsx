"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ArrowRight, HelpCircle, Search, X } from "lucide-react";
import type { UserRole } from "@/lib/roles";

type Guide = { title: string; description: string; href: string; roles: UserRole[] };
const guides: Guide[] = [
  { title: "Set up facilities and named zones", description: "Create properties, branches, locations, and the floors or service areas within them.", href: "/settings?tab=properties", roles: ["super_admin", "admin", "owner"] },
  { title: "Manage units and rooms", description: "Add or update rooms, suites, stations, units, capacities, availability, and floor assignments.", href: "/settings?tab=properties", roles: ["super_admin", "admin", "owner"] },
  { title: "Configure service catalogs", description: "Set up per-unit, hourly, maintenance, delivery, and fixed-rate work types.", href: "/settings?tab=properties", roles: ["super_admin", "admin", "owner"] },
  { title: "Manage team and facility assignments", description: "Maintain the team directory and assign staff across authorized facilities.", href: "/settings?tab=users", roles: ["super_admin", "admin", "owner"] },
  { title: "Review financials and work-log audits", description: "Review payroll summaries, approvals, costs, and operational audit history.", href: "/admin?tab=financials", roles: ["super_admin", "admin", "owner"] },
  { title: "Dispatch a task", description: "Choose a facility, task type, rooms or zone, and an available team member.", href: "?tab=overview&dispatch=1", roles: ["owner", "manager", "hk_admin"] },
  { title: "Monitor live operations", description: "Track active shifts and tasks, inspect duration, and use authorized management controls.", href: "?tab=operations", roles: ["super_admin", "manager", "hk_admin", "housekeeping_admin", "admin", "owner"] },
  { title: "Inspect units and approve quality", description: "Review readiness, inspection notes, and evidence, then move units through their workflow.", href: "/hk-admin?tab=rooms", roles: ["manager", "hk_admin"] },
  { title: "Clock in and manage your shift", description: "Start a master shift before work and clock out after ending active tasks.", href: "/dashboard", roles: ["cleaner"] },
  { title: "Complete assigned tasks", description: "Review incoming assignments, start a task, follow the single-active-task rule, and end work when complete.", href: "/dashboard", roles: ["cleaner"] },
  { title: "Use team chat and review earnings", description: "Contact your team and review completed work and verified earnings.", href: "/dashboard", roles: ["cleaner"] },
  { title: "Open profile and security settings", description: "Update your personal profile, security options, and notification preferences.", href: "/settings?tab=profile", roles: ["super_admin", "admin", "owner", "manager", "housekeeping_admin", "hk_admin", "cleaner"] },
];

export function HelpCenterButton({ role }: { role: UserRole }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const router = useRouter();
  const visibleGuides = useMemo(() => guides.filter((guide) =>
    guide.roles.includes(role) && `${guide.title} ${guide.description}`.toLowerCase().includes(query.trim().toLowerCase())
  ), [query, role]);
  const dashboardHref = role === "manager" ? "/manager" : role === "hk_admin" || role === "housekeeping_admin" ? "/hk-admin" : role === "owner" ? "/owner" : role === "admin" || role === "super_admin" ? "/admin" : "/dashboard";
  const hrefFor = (href: string) => href.startsWith("?") ? `${dashboardHref}${href}` : href;

  return <>
    <button type="button" onClick={() => setOpen(true)} aria-label="Open help and feature guide" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600">
      <HelpCircle className="h-5 w-5" />
    </button>
    {open && typeof document !== "undefined" && createPortal(<div className="fixed inset-0 z-[99] bg-black/40 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="help-center-title" className="fixed inset-y-0 right-0 z-[100] flex h-full max-h-screen w-full max-w-xl flex-col overflow-y-auto overscroll-contain bg-white shadow-2xl [touch-action:pan-y]">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 p-5 backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-sky-700">Operations guide</p><h2 id="help-center-title" className="mt-1 text-xl font-bold text-slate-950">Help & onboarding</h2><p className="mt-1 text-sm text-slate-600">Guides for facilities, branches, units, stations, services, and field operations.</p></div>
            <button type="button" aria-label="Close help center" onClick={() => setOpen(false)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50"><X className="h-4 w-4" /></button>
          </div>
          <label className="relative mt-4 block"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search guides" className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-sky-500" /></label>
        </header>
        <div className="flex-1 space-y-3 overflow-y-auto overscroll-contain p-5">
          {visibleGuides.map((guide) => <article key={guide.title} className="rounded-2xl border border-slate-200 p-4">
            <h3 className="font-semibold text-slate-900">{guide.title}</h3><p className="mt-1 text-sm leading-5 text-slate-600">{guide.description}</p>
            <Link href={hrefFor(guide.href)} onClick={(event) => {
              if (guide.href.startsWith("?")) {
                event.preventDefault();
                const target = new URL(hrefFor(guide.href), window.location.origin);
                window.history.replaceState(window.history.state, "", `${target.pathname}${target.search}`);
                window.dispatchEvent(new Event("management-dashboard-tab-change"));
                router.refresh();
              }
              setOpen(false);
            }} className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-lg bg-sky-50 px-3 text-xs font-bold text-sky-800 hover:bg-sky-100">
              Take me there <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </article>)}
          {!visibleGuides.length && <p className="rounded-xl bg-slate-50 p-5 text-center text-sm text-slate-600">No guides match your search.</p>}
        </div>
      </section>
    </div>, document.body)}
  </>;
}
