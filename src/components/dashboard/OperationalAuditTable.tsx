"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DashboardPagination, useUrlPage, useUrlPageSize } from "@/components/dashboard/DashboardPagination";
import type { ManagementAuditPage, ManagementAuditPageRequest, ManagementAuditRecord } from "@/lib/managementAudit";

const DEFAULT_PAGE_SIZE = 20;

type AuditPageLoader = (request: ManagementAuditPageRequest) => Promise<ManagementAuditPage>;

function getChanges(entry: ManagementAuditRecord) {
  const before = new Map(entry.previous_details.map((detail) => [detail.label, detail.value]));
  const after = new Map(entry.new_details.map((detail) => [detail.label, detail.value]));
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((label) => before.get(label) !== after.get(label))
    .map((label) => ({ label, before: before.get(label) ?? "—", after: after.get(label) ?? "—" }));
}

export function OperationalAuditTable({ loadPage }: { loadPage: AuditPageLoader }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [page, setPage] = useUrlPage(DEFAULT_PAGE_SIZE);
  const pageSize = useUrlPageSize(DEFAULT_PAGE_SIZE);
  const action = searchParams.get("action") ?? "";
  const actor = searchParams.get("actor") ?? "";
  const startDate = searchParams.get("startDate") ?? "";
  const endDate = searchParams.get("endDate") ?? "";
  const [result, setResult] = useState<{ key: string; page: ManagementAuditPage } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [rawEntry, setRawEntry] = useState<ManagementAuditRecord | null>(null);

  const request = useMemo(() => ({
    page,
    pageSize,
    action: action || undefined,
    actor: actor || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  }), [page, pageSize, action, actor, startDate, endDate]);
  const requestKey = JSON.stringify(request);
  const loadedPage = result?.key === requestKey ? result.page : null;
  const errorMessage = failure?.key === requestKey ? failure.message : "";

  useEffect(() => {
    let active = true;
    loadPage(request).then((response) => {
      if (!active) return;
      setResult({ key: requestKey, page: response });
      if (response.page !== page) setPage(response.page);
    }).catch((error: unknown) => {
      if (!active) return;
      setFailure({
        key: requestKey,
        message: error instanceof Error ? error.message : "Unable to load operational audit history.",
      });
    });
    return () => { active = false; };
  }, [loadPage, page, request, requestKey, setPage]);

  const updateQuery = (updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "audit");
    params.set("page", "1");
    params.set("pageSize", String(pageSize));
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    router.push(`${pathname}?${params.toString()}${window.location.hash}`, { scroll: false });
  };

  const applyTextFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    updateQuery({
      actor: String(form.get("actor") ?? "").trim(),
      startDate: String(form.get("startDate") ?? ""),
      endDate: String(form.get("endDate") ?? ""),
    });
  };

  const currentPage = loadedPage?.page ?? page;
  const pageCount = loadedPage?.pageCount ?? 1;
  const records = loadedPage?.records ?? [];
  const totalCount = loadedPage?.totalCount ?? 0;

  return <>
    <section className="rounded-2xl border border-line bg-surface p-4 text-ink shadow-sm sm:p-5">
      <header className="mb-4">
        <h2 className="text-base font-semibold">Operational intervention audit</h2>
        <p className="mt-1 text-sm text-ink-secondary">Review clock-outs and task overrides, including the actor, reason, and recorded changes.</p>
      </header>
      <form onSubmit={applyTextFilters} className="mb-4 grid gap-3 rounded-xl border border-line bg-surface-secondary p-3 md:grid-cols-[minmax(10rem,1fr)_minmax(10rem,1fr)_minmax(10rem,1fr)_minmax(10rem,1fr)_auto] md:items-end">
        <label className="text-xs font-semibold text-ink-secondary">Action
          <select value={action} onChange={(event) => updateQuery({ action: event.target.value })} className="mt-1 min-h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent">
            <option value="">All actions</option>
            <option value="force_clock_out">Force clock out</option>
            <option value="force_complete_task">Force complete task</option>
            <option value="cancel_task">Cancel task</option>
          </select>
        </label>
        <label className="text-xs font-semibold text-ink-secondary">Actor
          <input key={actor} name="actor" defaultValue={actor} maxLength={100} placeholder="Search actor" className="mt-1 min-h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-muted focus:border-accent focus:ring-1 focus:ring-accent" />
        </label>
        <label className="text-xs font-semibold text-ink-secondary">From
          <input key={`start-${startDate}`} type="date" name="startDate" defaultValue={startDate} className="mt-1 min-h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent" />
        </label>
        <label className="text-xs font-semibold text-ink-secondary">To
          <input key={`end-${endDate}`} type="date" name="endDate" defaultValue={endDate} className="mt-1 min-h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent" />
        </label>
        <button type="submit" className="min-h-10 rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-hover">Apply</button>
      </form>

      {errorMessage && <p role="alert" className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-200">{errorMessage}</p>}
      {!loadedPage && !errorMessage && <p role="status" className="mb-3 text-sm text-ink-secondary">Loading this audit page…</p>}
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="min-w-[900px] w-full text-left text-sm">
          <thead className="bg-surface-secondary text-ink-secondary"><tr><th className="px-3 py-3">When</th><th className="px-3 py-3">Entity / action</th><th className="px-3 py-3">Actor</th><th className="px-3 py-3">Reason</th><th className="px-3 py-3">Recorded change</th></tr></thead>
          <tbody className="divide-y divide-line">
            {records.map((entry) => {
              const changes = getChanges(entry);
              return <tr key={entry.id} className="align-top text-ink transition-colors hover:bg-surface-secondary">
                <td className="whitespace-nowrap px-3 py-3 text-ink-secondary">{new Date(entry.created_at).toLocaleString("en-GB", { timeZone: "Africa/Cairo" })}</td>
                <td className="px-3 py-3"><span className="font-semibold capitalize">{entry.entity_type}</span><span className="block text-xs text-ink-secondary">{entry.action.replaceAll("_", " ")}</span><span className="mt-1 block max-w-48 text-xs text-ink-secondary">{entry.target_label}</span></td>
                <td className="max-w-40 px-3 py-3"><span className="block truncate font-medium">{entry.actor_name}</span></td>
                <td className="max-w-sm whitespace-normal px-3 py-3 text-ink-secondary">{entry.override_reason}</td>
                <td className="px-3 py-3 text-xs text-ink-secondary">
                  <div className="space-y-1.5">{changes.length ? changes.map((change) => <p key={change.label}><span className="font-semibold text-ink">{change.label}:</span> {change.before} <span aria-label="changed to" className="px-1 text-ink-muted">→</span> {change.after}</p>) : <span>No tracked fields changed</span>}</div>
                  <button type="button" onClick={() => setRawEntry(entry)} className="mt-2 min-h-9 rounded-lg border border-line bg-surface-secondary px-2.5 py-1.5 font-medium text-ink-secondary hover:border-accent hover:text-ink">View details</button>
                </td>
              </tr>;
            })}
            {loadedPage && !records.length && <tr><td colSpan={5} className="px-3 py-8 text-center text-ink-secondary">No operational interventions match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
      <DashboardPagination currentPage={currentPage} pageCount={pageCount} total={totalCount} pageSize={pageSize} label="interventions" onPageChange={setPage} />
    </section>

    {rawEntry && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="operational-audit-details-title">
      <section className="max-h-[calc(100dvh-2rem)] w-full max-w-3xl overflow-y-auto overscroll-contain rounded-2xl border border-line bg-surface-elevated p-5 text-ink shadow-2xl">
        <div className="flex items-start justify-between gap-3"><div><h3 id="operational-audit-details-title" className="text-lg font-semibold">Intervention details</h3><p className="mt-1 text-sm capitalize text-ink-secondary">{rawEntry.action.replaceAll("_", " ")} · {rawEntry.entity_type} · {rawEntry.actor_name}</p><p className="mt-1 text-sm font-medium text-ink-secondary">{rawEntry.target_label}</p></div><button type="button" onClick={() => setRawEntry(null)} aria-label="Close details" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink-secondary hover:bg-surface-secondary"><span aria-hidden="true">×</span></button></div>
        <p className="mt-3 rounded-lg border border-line bg-surface-secondary px-3 py-2 text-sm text-ink-secondary"><span className="font-semibold text-ink">Reason:</span> {rawEntry.override_reason}</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {(["Before", "After"] as const).map((title, index) => {
            const details = index === 0 ? rawEntry.previous_details : rawEntry.new_details;
            return <section key={title} className="min-w-0">
              <h4 className="mb-2 text-sm font-semibold">{title}</h4>
              {details.length ? <dl className="space-y-2 rounded-xl border border-line bg-surface-secondary p-3">
                {details.map((detail) => <div key={detail.label} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 text-xs"><dt className="font-medium text-ink-secondary">{detail.label}</dt><dd className="break-words text-ink">{detail.value}</dd></div>)}
              </dl> : <p className="rounded-xl border border-line bg-surface-secondary p-3 text-xs text-ink-muted">No additional details.</p>}
            </section>;
          })}
        </div>
        <div className="mt-4 flex justify-end"><button type="button" onClick={() => setRawEntry(null)} className="min-h-11 rounded-lg border border-line bg-surface-secondary px-4 py-2 text-sm font-semibold text-ink-secondary hover:text-ink">Close</button></div>
      </section>
    </div>}
  </>;
}
