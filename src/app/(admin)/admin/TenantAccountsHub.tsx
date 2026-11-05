"use client";

import { useEffect, useState, useTransition } from "react";
import { Activity, Building2, CalendarDays, CheckCircle2, ClipboardList, Clock3, CreditCard, Gauge, History, Loader2, Search, ShieldAlert, Wallet } from "lucide-react";
import { DashboardPagination } from "@/components/dashboard/DashboardPagination";
import { SharedWorkspaceShell } from "@/components/layout/SharedWorkspaceShell";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import type { WorkspaceNavTab } from "@/components/layout/MobileWorkspaceNav";
import { showActionToast } from "@/components/ui/ActionToast";
import { TenantDetailsModal } from "./TenantDetailsModal";
import {
  getTenantAccountsPage,
  settleTenantCycle,
  type TenantAccount,
  type TenantAccountsPage,
} from "./tenantAccountsActions";

function money(amount: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

function dateLabel(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(value));
}

const SUPER_ADMIN_WORKSPACE_TABS: readonly WorkspaceNavTab<string>[] = [
  { id: "overview", label: "Overview", Icon: Gauge, href: "/admin?tab=overview" },
  { id: "operations", label: "Live", Icon: Activity, href: "/admin?tab=operations" },
  { id: "work-logs", label: "Logs", Icon: ClipboardList, href: "/admin?tab=work-logs" },
  { id: "financials", label: "Financials", Icon: Wallet, href: "/admin?tab=financials" },
  { id: "audit", label: "Audit", Icon: History, href: "/admin?tab=audit" },
];

export default function TenantAccountsHub({ initialData }: { initialData: TenantAccountsPage }) {
  const [data, setData] = useState(initialData);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedTenant, setSelectedTenant] = useState<TenantAccount | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      setIsLoading(true);
      void getTenantAccountsPage(page, search).then((nextData) => {
        if (current) {
          setData(nextData);
          setError("");
        }
      }).catch((loadError: unknown) => {
        if (current) {
          const message = loadError instanceof Error ? loadError.message : "Unable to load tenant accounts.";
          setError(message);
          showActionToast("error", message);
        }
      }).finally(() => {
        if (current) setIsLoading(false);
      });
    }, 250);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [page, search, refreshKey]);

  const markSettled = (tenant: TenantAccount) => {
    startTransition(async () => {
      try {
        await settleTenantCycle(tenant.id);
        showActionToast("success", `${tenant.name}'s current cycle was marked as settled.`);
        setRefreshKey((key) => key + 1);
      } catch (actionError) {
        const message = actionError instanceof Error ? actionError.message : "Unable to record settlement.";
        showActionToast("error", message);
      }
    });
  };

  const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <main className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8">
      <header className="mb-5 flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-sky-800"><CreditCard className="h-4 w-4" /> Platform settlement hub</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink">Tenant Accounts & Billing</h1>
          <p className="mt-1 text-sm text-ink-secondary">Review usage, property status, and settlements for {data.monthLabel}.</p>
        </div>
        <div className="flex items-center gap-3">
        <ThemeToggle />
        <label className="relative block w-full sm:max-w-sm">
          <span className="sr-only">Search by owner or hotel</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input
            value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(1); }}
            placeholder="Search owner, email, or hotel"
            className="min-h-11 w-full rounded-xl border border-line bg-surface-secondary pl-10 pr-3 text-sm text-ink outline-none transition focus:border-sky-600 focus:bg-surface"
          />
        </label>
        </div>
      </header>
      <SharedWorkspaceShell role="super_admin" activeTab={null} tabs={SUPER_ADMIN_WORKSPACE_TABS} />

      <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm" aria-label="Tenant accounts" aria-busy={isLoading || isPending}>
        <div className="flex min-h-14 items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink-secondary"><Building2 className="h-4 w-4 text-sky-700" />{data.total.toLocaleString()} tenant accounts</div>
          <div className="flex items-center gap-2 text-xs text-ink-muted">
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" aria-label="Refreshing tenant accounts" />}
            <span>Rate: $0.08 per completed task</span>
          </div>
        </div>
        {error && <p role="alert" className="m-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] border-collapse text-left text-sm">
            <thead className="bg-surface-secondary text-xs font-semibold uppercase tracking-wide text-ink-muted">
              <tr>
                <th scope="col" className="px-4 py-3">Tenant / Owner</th>
                <th scope="col" className="px-4 py-3">Properties overview</th>
                <th scope="col" className="px-4 py-3">Current month usage</th>
                <th scope="col" className="px-4 py-3">Accrued amount</th>
                <th scope="col" className="px-4 py-3">Settlement</th>
                <th scope="col" className="px-4 py-3">Quick actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.tenants.map((tenant) => {
                const pendingAmount = Math.max(0, tenant.amountDue - tenant.settledAmount);
                const settled = tenant.settledAt !== null && pendingAmount < 0.005;
                const totalRooms = tenant.properties.reduce((sum, property) => sum + property.totalRooms, 0);
                return (
                  <tr
                    key={tenant.id}
                    tabIndex={0}
                    aria-label={`View details for ${tenant.name}`}
                    onClick={() => setSelectedTenant(tenant)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedTenant(tenant);
                      }
                    }}
                    className="cursor-pointer align-top hover:bg-sky-50/60 focus:outline-none focus-visible:bg-sky-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-600"
                  >
                    <td className="px-4 py-4">
                      <p className="font-semibold text-ink">{tenant.name}</p>
                      <p className="mt-0.5 text-xs text-ink-secondary">{tenant.email}</p>
                      <p className="mt-1 inline-flex items-center gap-1 text-xs text-ink-muted"><CalendarDays className="h-3 w-3" />Joined {dateLabel(tenant.joinedAt)}</p>
                    </td>
                    <td className="max-w-72 px-4 py-4">
                      <p className="mb-1 text-xs font-medium text-ink-secondary">{tenant.properties.length} hotels · {totalRooms.toLocaleString()} rooms</p>
                      <div className="flex flex-wrap gap-1.5">
                        {tenant.properties.slice(0, 3).map((property) => (
                          <span key={property.id} title={property.name} className={`max-w-40 truncate rounded-full px-2 py-1 text-[11px] font-semibold ${property.isActive ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
                            {property.name} · {property.isActive ? "Active" : "Suspended"}
                          </span>
                        ))}
                        {tenant.properties.length > 3 && <span className="rounded-full bg-surface-secondary px-2 py-1 text-[11px] font-semibold text-ink-secondary">+{tenant.properties.length - 3} more</span>}
                        {!tenant.properties.length && <span className="text-xs text-ink-muted">No properties</span>}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-semibold tabular-nums text-ink">{tenant.completedTasks.toLocaleString()} completed tasks</p>
                      <p className="mt-1 inline-flex items-center gap-1 text-xs text-ink-muted"><Clock3 className="h-3 w-3" />{tenant.activeShifts.toLocaleString()} active shifts</p>
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-semibold tabular-nums text-ink">{money(pendingAmount)}</p>
                      <p className="mt-1 text-xs text-ink-muted">of {money(tenant.amountDue)} accrued</p>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-semibold ${settled ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
                        {settled ? <CheckCircle2 className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
                        {settled ? "Settled / Paid" : "Pending Payment"}
                      </span>
                      {settled && <p className="mt-1.5 text-xs text-ink-muted">Paid {dateLabel(tenant.settledAt)}</p>}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex min-w-44 flex-col items-start gap-1.5">
                        <button type="button" onClick={(event) => { event.stopPropagation(); markSettled(tenant); }} disabled={isPending || !tenant.completedTasks || settled} className="min-h-9 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-45">
                          {settled ? "Settled this cycle" : isPending ? "Saving…" : "Mark as Settled / Paid"}
                        </button>
                        <button type="button" onClick={(event) => { event.stopPropagation(); setSelectedTenant(tenant); }} className="min-h-8 rounded-lg px-2 text-xs font-semibold text-sky-800 hover:bg-sky-50">View tenant details</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!data.tenants.length && <tr><td colSpan={6} className="h-28 px-4 text-center text-sm text-ink-muted">{search ? "No owners or hotels matched your search." : "No tenant accounts found."}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="px-4 pb-4 sm:px-5">
          <DashboardPagination currentPage={data.page} pageCount={pageCount} total={data.total} pageSize={data.pageSize} label="tenants" onPageChange={setPage} />
        </div>
      </section>

      {selectedTenant && <TenantDetailsModal key={selectedTenant.id} tenant={selectedTenant} onClose={() => setSelectedTenant(null)} onUpdated={() => setRefreshKey((key) => key + 1)} />}
    </main>
  );
}
