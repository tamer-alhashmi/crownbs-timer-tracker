"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export function ManagementDashboardError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("Management dashboard boundary caught an error.", {
      digest: error.digest,
      error,
    });
  }, [error]);

  return (
    <main className="flex min-h-[60vh] items-center justify-center bg-slate-50 px-4 py-12">
      <section
        role="alert"
        className="w-full max-w-lg rounded-2xl border border-rose-200 bg-white p-6 text-center shadow-sm sm:p-8"
      >
        <AlertTriangle aria-hidden="true" className="mx-auto h-9 w-9 text-rose-600" />
        <h1 className="mt-4 text-xl font-bold text-slate-900">Dashboard couldn’t load</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          There was a problem loading dashboard data. Your account and saved data are unchanged.
          Please try again.
        </p>
        {error.digest && <p className="mt-3 text-xs text-slate-500">Reference: {error.digest}</p>}
        <button
          type="button"
          onClick={retry}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
          Retry
        </button>
      </section>
    </main>
  );
}
