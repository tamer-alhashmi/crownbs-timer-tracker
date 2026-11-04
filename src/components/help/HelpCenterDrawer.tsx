"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  ArrowRight,
  BedDouble,
  Building2,
  CheckCheck,
  CircleDollarSign,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  HelpCircle,
  ListChecks,
  Search,
  Settings,
  ShieldCheck,
  ScrollText,
  UsersRound,
  Wallet,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import type { UserRole } from "@/lib/roles";

type Guide = {
  category: string;
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  roles: readonly UserRole[];
};

const administrators: readonly UserRole[] = ["super_admin", "admin"];
const tenantManagers: readonly UserRole[] = ["super_admin", "admin", "owner"];
const operationsManagers: readonly UserRole[] = ["super_admin", "admin", "owner", "manager"];
const housekeepingRoles: readonly UserRole[] = ["hk_admin", "housekeeping_admin"];
const managementRoles: readonly UserRole[] = [...operationsManagers, "cleaner"];
const allRoles: readonly UserRole[] = [...managementRoles, ...housekeepingRoles];

const guides: Guide[] = [
  {
    category: "Setup & property configuration",
    title: "Set up facilities and named zones",
    description: "Create a property, configure its address and floors or sections, then manage rooms and units. Active room counts reflect non-archived rooms.",
    href: "/settings?tab=properties#properties-setup",
    icon: Building2,
    roles: tenantManagers,
  },
  {
    category: "Setup & property configuration",
    title: "Manage rooms and units",
    description: "Add rooms individually or in batches, assign floor or section names, and review room status and active room totals.",
    href: "/settings?tab=properties#room-units",
    icon: BedDouble,
    roles: tenantManagers,
  },
  {
    category: "Setup & property configuration",
    title: "Services and rate catalog",
    description: "Define property services with per-room, hourly, or fixed pricing, update rates, and deactivate services without removing historical work references.",
    href: "/settings?tab=properties#service-catalog",
    icon: Wrench,
    roles: tenantManagers,
  },
  {
    category: "Setup & property configuration",
    title: "Property assignment and management",
    description: "Assign property managers, manage staff-property assignments, suspend or activate properties, and archive properties from active operations.",
    href: "/settings?tab=properties#properties-setup",
    icon: UsersRound,
    roles: tenantManagers,
  },
  {
    category: "Operations & workforce",
    title: "Live shift dispatch",
    description: "Monitor active shifts and task statuses, dispatch work to assigned staff, and review operational exceptions.",
    href: "?tab=operations#operations-live",
    icon: Activity,
    roles: [...operationsManagers, ...housekeepingRoles],
  },
  {
    category: "Operations & workforce",
    title: "Assigned workforce",
    description: "Use User Management to find staff, review their roles and property assignments, and manage account status within your permissions.",
    href: "/settings?tab=users#managed-users",
    icon: UsersRound,
    roles: ["super_admin", "admin", "owner", "manager"],
  },
  {
    category: "Operations & workforce",
    title: "Room status and inspection",
    description: "Housekeeping teams can update room readiness, record inspection notes, and review assigned room status.",
    href: "/hk-admin?tab=rooms#hk-panel-rooms",
    icon: CheckCheck,
    roles: [...housekeepingRoles, ...operationsManagers],
  },
  {
    category: "Operations & workforce",
    title: "Task completion, approvals, and overrides",
    description: "Staff complete assigned work and managers review it in Work Logs. Authorized managers can force-end or cancel active operations with a recorded reason and audit trail.",
    href: "?tab=work-logs#work-logs-table",
    icon: ClipboardCheck,
    roles: [...operationsManagers, ...housekeepingRoles],
  },
  {
    category: "Operations & workforce",
    title: "Clock in, complete tasks, and add notes",
    description: "Start your master shift before work, follow assigned room checklists, add task notes or evidence, and finish the active task before clocking out.",
    href: "/dashboard#shift-controls",
    icon: Clock3,
    roles: ["cleaner"],
  },
  {
    category: "Operations & workforce",
    title: "Select a service and checklist",
    description: "Choose an assigned service, select the rooms or units you completed, record useful notes, and finish the task to submit it for review.",
    href: "/dashboard#task-selection",
    icon: ListChecks,
    roles: ["cleaner"],
  },
  {
    category: "Logs, auditing & compliance",
    title: "Work logs and history",
    description: "Filter work records by date presets or ISO date range, property, cleaner, tenant, service, and status; open a record for full details.",
    href: "?tab=work-logs#work-logs-table",
    icon: ClipboardList,
    roles: [...managementRoles, ...housekeepingRoles],
  },
  {
    category: "Logs, auditing & compliance",
    title: "Audit and compliance tracking",
    description: "Review responsibility snapshots, task override history, cancellation reasons, and the actor and role recorded for administrative actions.",
    href: "?tab=audit#audit-trail",
    icon: ScrollText,
    roles: operationsManagers,
  },
  {
    category: "Logs, auditing & compliance",
    title: "Review your work submissions",
    description: "Open Submissions & History to check task status, date ranges, approval progress, and details of your completed work.",
    href: "/dashboard#history-panel",
    icon: ClipboardList,
    roles: ["cleaner"],
  },
  {
    category: "Financials & settlements",
    title: "Property labor cost breakdown",
    description: "Review completed-room totals and recorded labor costs by property for the selected date, property, worker, or tenant filters.",
    href: "?tab=financials#property-labor-breakdown",
    icon: CircleDollarSign,
    roles: operationsManagers,
  },
  {
    category: "Financials & settlements",
    title: "Payroll periods and exports",
    description: "Inspect this month, last month, or a custom date range; narrow by property, worker, or tenant where available, then export the filtered records.",
    href: "?tab=financials#payroll-table",
    icon: Wallet,
    roles: operationsManagers,
  },
  {
    category: "Financials & settlements",
    title: "Tenant current-cycle settlements",
    description: "Super Admins can review tenant usage and outstanding current-cycle balances and record settlements. Invoice generation and adjustments are not available in the current data model.",
    href: "/admin/tenant-accounts",
    icon: CircleDollarSign,
    roles: ["super_admin"],
  },
  {
    category: "Financials & settlements",
    title: "Owner billing and balances",
    description: "Owners can review the billing information available for their own account from Settings.",
    href: "/settings?tab=profile#settings-panel-profile",
    icon: Wallet,
    roles: ["owner"],
  },
  {
    category: "System settings & access",
    title: "User management",
    description: "Add or update users, assign properties, review managed accounts, and change account status according to your role permissions.",
    href: "/settings?tab=users#managed-users",
    icon: UsersRound,
    roles: ["super_admin", "admin", "owner", "manager"],
  },
  {
    category: "System settings & access",
    title: "Admin system control: feature access",
    description: "Configure per-user view, create, edit, and delete permissions. Role and property scope remain enforced separately.",
    href: "/settings?tab=users#feature-access-settings",
    icon: ShieldCheck,
    roles: administrators,
  },
  {
    category: "System settings & access",
    title: "Profile and security settings",
    description: "Update your personal details, security preferences, and notification settings.",
    href: "/settings?tab=profile#settings-panel-profile",
    icon: Settings,
    roles: allRoles,
  },
];

const dashboardPath: Record<UserRole, string> = {
  super_admin: "/admin",
  admin: "/admin",
  owner: "/owner",
  manager: "/manager",
  housekeeping_admin: "/hk-admin",
  hk_admin: "/hk-admin",
  cleaner: "/dashboard",
};

function scrollToTarget(hash: string) {
  if (!hash) return;
  const id = decodeURIComponent(hash.slice(1));
  let attempts = 0;
  const findAndScroll = () => {
    const target = document.getElementById(id);
    if (target && target.getClientRects().length > 0) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      target.classList.add("ring-2", "ring-sky-400", "ring-offset-2");
      window.setTimeout(() => target.classList.remove("ring-2", "ring-sky-400", "ring-offset-2"), 1800);
    } else if (attempts++ < 10) {
      window.requestAnimationFrame(findAndScroll);
    }
  };
  window.requestAnimationFrame(findAndScroll);
}

export function HelpCenterButton({ role }: { role: UserRole }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const router = useRouter();
  const pathname = usePathname();
  const visibleGuides = useMemo(() => guides.filter((guide) =>
    guide.roles.includes(role) && `${guide.category} ${guide.title} ${guide.description}`.toLowerCase().includes(query.trim().toLowerCase())
  ), [query, role]);
  const groupedGuides = useMemo(() => visibleGuides.reduce<Record<string, Guide[]>>((groups, guide) => {
    (groups[guide.category] ??= []).push(guide);
    return groups;
  }, {}), [visibleGuides]);

  const navigateToGuide = (guide: Guide) => {
    let href = guide.href.startsWith("?") ? `${dashboardPath[role]}${guide.href}` : guide.href;
    if (role === "cleaner" && guide.title === "Work logs and history") href = "/dashboard#history-panel";
    if (housekeepingRoles.includes(role)) {
      if (guide.title === "Live shift dispatch") href = "/hk-admin?tab=operations#hk-panel-operations";
      if (guide.title === "Work logs and history") href = "/hk-admin?tab=history#hk-panel-history";
      if (guide.title === "Task completion, approvals, and overrides") href = "/hk-admin?tab=operations#hk-panel-operations";
    }
    const target = new URL(href, window.location.origin);
    setOpen(false);

    if (target.pathname === pathname) {
      window.history.pushState(window.history.state, "", `${target.pathname}${target.search}${target.hash}`);
      window.dispatchEvent(new Event("management-dashboard-tab-change"));
      window.dispatchEvent(new Event("help-center-navigate"));
      scrollToTarget(target.hash);
      return;
    }

    router.push(`${target.pathname}${target.search}${target.hash}`);
  };

  return <>
    <button type="button" onClick={() => setOpen(true)} aria-label="Open Operations Guide" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600">
      <HelpCircle className="h-5 w-5" />
    </button>
    {open && typeof document !== "undefined" && createPortal(<div className="fixed inset-0 z-[99] bg-black/40 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="help-center-title" className="fixed inset-y-0 right-0 z-[100] flex h-full max-h-screen w-full max-w-xl flex-col overflow-y-auto overscroll-contain bg-white shadow-2xl [touch-action:pan-y]">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 p-5 backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-sky-700">Operations guide</p><h2 id="help-center-title" className="mt-1 text-xl font-bold text-slate-950">Help & onboarding</h2><p className="mt-1 text-sm text-slate-600">Role-specific guidance for setup, operations, work history, and finance.</p></div>
            <button type="button" aria-label="Close Operations Guide" onClick={() => setOpen(false)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50"><X className="h-4 w-4" /></button>
          </div>
          <label className="relative mt-4 block"><Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search guides and topics" className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-sky-500" /></label>
        </header>
        <div className="flex-1 space-y-6 overflow-y-auto overscroll-contain p-5">
          {Object.entries(groupedGuides).map(([category, categoryGuides]) => <section key={category} aria-label={category}>
            <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{category}</h3>
            <div className="space-y-3">{categoryGuides.map((guide) => {
              const Icon = guide.icon;
              return <article key={guide.title} className="rounded-2xl border border-slate-200 p-4 transition hover:border-sky-200 hover:shadow-sm">
                <div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sky-50 text-sky-800"><Icon aria-hidden="true" className="h-4 w-4" /></span><div className="min-w-0"><h4 className="font-semibold text-slate-900">{guide.title}</h4><p className="mt-1 text-sm leading-5 text-slate-600">{guide.description}</p></div></div>
                <button type="button" onClick={() => navigateToGuide(guide)} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg bg-sky-50 px-3 text-xs font-bold text-sky-800 transition hover:bg-sky-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600">
                  Take me there <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
              </article>;
            })}</div>
          </section>)}
          {!visibleGuides.length && <p className="rounded-xl bg-slate-50 p-5 text-center text-sm text-slate-600">No guides match your search.</p>}
        </div>
      </section>
    </div>, document.body)}
  </>;
}
