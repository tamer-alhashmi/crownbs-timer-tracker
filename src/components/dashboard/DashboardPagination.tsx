"use client";

import { useCallback, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function useUrlPage(defaultPageSize: number) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedPage = Number(searchParams.get("page"));
  const requestedSize = Number(searchParams.get("pageSize"));
  const pageSize = Number.isInteger(requestedSize) && requestedSize > 0
    ? Math.min(50, requestedSize)
    : defaultPageSize;
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const setPage = useCallback((nextPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(Number.isInteger(nextPage) && nextPage > 0 ? nextPage : 1));
    params.set("pageSize", String(pageSize));
    const query = params.toString();
    router.push(`${pathname}${query ? `?${query}` : ""}${window.location.hash}`, { scroll: false });
  }, [pageSize, pathname, router, searchParams]);
  return [page, setPage] as const;
}

export function useUrlPageSize(defaultPageSize: number) {
  const searchParams = useSearchParams();
  const requestedSize = Number(searchParams.get("pageSize"));
  return Number.isInteger(requestedSize) && requestedSize > 0
    ? Math.min(50, requestedSize)
    : defaultPageSize;
}

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
    <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-secondary">
        <p aria-live="polite">Showing {firstRecord}–{lastRecord} of {total.toLocaleString()} {label}</p>
        <span className="rounded-full bg-surface-secondary px-2.5 py-1 text-xs font-semibold text-ink-secondary">{pageSize} per page</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={currentPage <= 1} onClick={() => onPageChange(currentPage - 1)} className="min-h-11 rounded-lg border border-line bg-surface text-ink-secondary px-3 py-2 font-medium hover:bg-surface-secondary hover:text-ink disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
        <span className="text-ink-secondary">Page {currentPage} of {pageCount}</span>
        <form onSubmit={jumpToPage} className="flex items-center gap-1.5">
          <label className="sr-only" htmlFor={`page-jump-${label.replaceAll(" ", "-")}`}>Go to page</label>
          <input key={currentPage} id={`page-jump-${label.replaceAll(" ", "-")}`} name="page" type="number" min={1} max={pageCount} defaultValue={currentPage} className="min-h-11 w-16 rounded-lg border border-line bg-surface-secondary px-2 py-2 text-center text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent" />
          <button type="submit" className="min-h-11 rounded-lg border border-line px-3 py-2 font-medium text-ink-secondary hover:bg-surface-secondary">Go</button>
        </form>
        <button type="button" disabled={currentPage >= pageCount} onClick={() => onPageChange(currentPage + 1)} className="min-h-11 rounded-lg border border-line bg-surface text-ink-secondary px-3 py-2 font-medium hover:bg-surface-secondary hover:text-ink disabled:cursor-not-allowed disabled:opacity-40">Next</button>
      </div>
    </div>
  );
}
