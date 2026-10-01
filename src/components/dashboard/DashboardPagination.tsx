"use client";

import type { FormEvent } from "react";

export function DashboardPagination({
  currentPage,
  pageCount,
  total,
  pageSize,
  label,
  onPageChange,
}: {
  currentPage: number;
  pageCount: number;
  total: number;
  pageSize: number;
  label: string;
  onPageChange: (page: number) => void;
}) {
  const firstRecord = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastRecord = Math.min(currentPage * pageSize, total);

  const jumpToPage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const requested = Number(new FormData(event.currentTarget).get("page"));
    if (Number.isInteger(requested)) onPageChange(Math.min(pageCount, Math.max(1, requested)));
  };

  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-600">
        <p aria-live="polite">Showing {firstRecord}–{lastRecord} of {total.toLocaleString()} {label}</p>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{pageSize} per page</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={currentPage <= 1} onClick={() => onPageChange(currentPage - 1)} className="min-h-11 rounded-lg border border-slate-200 px-3 py-2 font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
        <span className="text-slate-600">Page {currentPage} of {pageCount}</span>
        <form onSubmit={jumpToPage} className="flex items-center gap-1.5">
          <label className="sr-only" htmlFor={`page-jump-${label.replaceAll(" ", "-")}`}>Go to page</label>
          <input key={currentPage} id={`page-jump-${label.replaceAll(" ", "-")}`} name="page" type="number" min={1} max={pageCount} defaultValue={currentPage} className="min-h-11 w-16 rounded-lg border border-slate-200 px-2 py-2 text-center text-sm text-slate-900" />
          <button type="submit" className="min-h-11 rounded-lg border border-slate-200 px-3 py-2 font-medium text-slate-700 hover:bg-slate-50">Go</button>
        </form>
        <button type="button" disabled={currentPage >= pageCount} onClick={() => onPageChange(currentPage + 1)} className="min-h-11 rounded-lg border border-slate-200 px-3 py-2 font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Next</button>
      </div>
    </div>
  );
}
