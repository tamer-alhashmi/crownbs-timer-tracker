"use client";

import { useEffect, useState, useTransition } from "react";
import { Building2, CalendarDays, CheckCircle2, Clock3, CreditCard, Loader2, Search, ShieldAlert, X } from "lucide-react";
import { DashboardPagination } from "@/components/dashboard/DashboardPagination";
import { showActionToast } from "@/components/ui/ActionToast";
import {
  getTenantAccountsPage,
  settleTenantCycle,
  toggleTenantPropertyStatus,
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

  const toggleProperty = (tenant: TenantAccount, propertyId: string, propertyName: string, isActive: boolean) => {
    startTransition(async () => {
      try {
        await toggleTenantPropertyStatus(propertyId);
        showActionToast("success", `${propertyName} ${isActive ? "suspended" : "reactivated"}.`);
        setRefreshKey((key) => key + 1);
        setSelectedTenant((selected) => selected?.id === tenant.id ? {
          ...selected,
          properties: selected.properties.map((property) => property.id === propertyId ? { ...property, isActive: !isActive } : property),
        } : selected);
      } catch (actionError) {
        const message = actionError instanceof Error ? actionError.message : "Unable to update property status.";
        showActionToast("error", message);
      }
    });
  };

  const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <main className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8">
      <header className="mb-5 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-sky-800"><CreditCard className="h-4 w-4" /> Platform settlement hub</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">Tenant Accounts & Billing</h1>
          <p className="mt-1 text-sm text-slate-600">Review usage, property status, and settlements for {data.monthLabel}.</p>
        </div>
        <label className="relative block w-full sm:max-w-sm">
          <span className="sr-only">Search by owner or hotel</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(1); }}
            placeholder="Search owner, email, or hotel"
            className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm text-slate-900 outline-none transition focus:border-sky-600 focus:bg-white"
          />
        </label>
      </header>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="Tenant accounts" aria-busy={isLoading || isPending}>
        <div className="flex min-h-14 items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Building2 className="h-4 w-4 text-sky-700" />{data.total.toLocaleString()} tenant accounts</div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" aria-label="Refreshing tenant accounts" />}
            <span>Rate: $0.08 per completed task</span>
          </div>
        </div>
        {error && <p role="alert" className="m-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] border-collapse text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-4 py-3">Tenant / Owner</th>
                <th scope="col" className="px-4 py-3">Properties overview</th>
                <th scope="col" className="px-4 py-3">Current month usage</th>
                <th scope="col" className="px-4 py-3">Accrued amount</th>
                <th scope="col" className="px-4 py-3">Settlement</th>
                <th scope="col" className="px-4 py-3">Quick actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.tenants.map((tenant) => {
                const pendingAmount = Math.max(0, tenant.amountDue - tenant.settledAmount);
                const settled = tenant.settledAt !== null && pendingAmount < 0.005;
                const totalRooms = tenant.properties.reduce((sum, property) => sum + property.totalRooms, 0);
                return (
                  <tr key={tenant.id} className="align-top hover:bg-slate-50/70">
                    <td className="px-4 py-4">
                      <p className="font-semibold text-slate-950">{tenant.name}</p>
                      <p className="mt-0.5 text-xs text-slate-600">{tenant.email}</p>
                      <p className="mt-1 inline-flex items-center gap-1 text-xs text-slate-500"><CalendarDays className="h-3 w-3" />Joined {dateLabel(tenant.joinedAt)}</p>
                    </td>
                    <td className="max-w-72 px-4 py-4">
                      <p className="mb-1 text-xs font-medium text-slate-600">{tenant.properties.length} hotels · {totalRooms.toLocaleString()} rooms</p>
                      <div className="flex flex-wrap gap-1.5">
                        {tenant.properties.slice(0, 3).map((property) => (
                          <span key={property.id} title={property.name} className={`max-w-40 truncate rounded-full px-2 py-1 text-[11px] font-semibold ${property.isActive ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
                            {property.name} · {property.isActive ? "Active" : "Suspended"}
                          </span>
                        ))}
                        {tenant.properties.length > 3 && <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">+{tenant.properties.length - 3} more</span>}
                        {!tenant.properties.length && <span className="text-xs text-slate-400">No properties</span>}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-semibold tabular-nums text-slate-900">{tenant.completedTasks.toLocaleString()} completed tasks</p>
                      <p className="mt-1 inline-flex items-center gap-1 text-xs text-slate-500"><Clock3 className="h-3 w-3" />{tenant.activeShifts.toLocaleString()} active shifts</p>
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-semibold tabular-nums text-slate-950">{money(pendingAmount)}</p>
                      <p className="mt-1 text-xs text-slate-500">of {money(tenant.amountDue)} accrued</p>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-semibold ${settled ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
                        {settled ? <CheckCircle2 className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
                        {settled ? "Settled / Paid" : "Pending Payment"}
                      </span>
                      {settled && <p className="mt-1.5 text-xs text-slate-500">Paid {dateLabel(tenant.settledAt)}</p>}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex min-w-44 flex-col items-start gap-1.5">
                        <button type="button" onClick={() => markSettled(tenant)} disabled={isPending || !tenant.completedTasks || settled} className="min-h-9 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-45">
                          {settled ? "Settled this cycle" : isPending ? "Saving…" : "Mark as Settled / Paid"}
                        </button>
                        <button type="button" onClick={() => setSelectedTenant(tenant)} className="min-h-8 rounded-lg px-2 text-xs font-semibold text-sky-800 hover:bg-sky-50">View Owner Breakdown</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!data.tenants.length && <tr><td colSpan={6} className="h-28 px-4 text-center text-sm text-slate-500">{search ? "No owners or hotels matched your search." : "No tenant accounts found."}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="px-4 pb-4 sm:px-5">
          <DashboardPagination currentPage={data.page} pageCount={pageCount} total={data.total} pageSize={data.pageSize} label="tenants" onPageChange={setPage} />
        </div>
      </section>

      {selectedTenant && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedTenant(null); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="tenant-breakdown-title" className="max-h-[min(85dvh,720px)] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-6">
            <header className="flex items-start justify-between gap-4">
              <div><p className="text-xs font-bold uppercase tracking-[0.15em] text-sky-800">Owner breakdown</p><h2 id="tenant-breakdown-title" className="mt-1 text-xl font-bold text-slate-950">{selectedTenant.name}</h2><p className="mt-1 text-sm text-slate-600">{selectedTenant.email} · {data.monthLabel}</p></div>
              <button type="button" onClick={() => setSelectedTenant(null)} aria-label="Close owner breakdown" className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </header>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <Metric label="Completed tasks" value={selectedTenant.completedTasks.toLocaleString()} />
              <Metric label="Active shifts" value={selectedTenant.activeShifts.toLocaleString()} />
              <Metric label="Accrued amount" value={money(selectedTenant.amountDue)} />
            </div>
            <h3 className="mt-6 text-sm font-bold text-slate-900">Hotel-by-hotel consumption</h3>
            <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
              {selectedTenant.properties.map((property) => (
                <li key={property.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{property.name}</p>
                    <p className="mt-0.5 text-xs text-slate-600">{property.totalRooms.toLocaleString()} rooms · {property.completedTasks.toLocaleString()} billable tasks · {money(property.completedTasks * 0.08)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${property.isActive ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>{property.isActive ? "Active" : "Suspended"}</span>
                    <button type="button" disabled={isPending} onClick={() => toggleProperty(selectedTenant, property.id, property.name, property.isActive)} className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{property.isActive ? "Suspend" : "Reactivate"}</button>
                  </div>
                </li>
              ))}
              {!selectedTenant.properties.length && <li className="p-4 text-sm text-slate-500">No properties are assigned to this tenant.</li>}
            </ul>
          </section>
        </div>
      )}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 font-bold tabular-nums text-slate-950">{value}</p></div>;
}
