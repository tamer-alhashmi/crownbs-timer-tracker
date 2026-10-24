"use client";

import { useEffect, useState } from "react";
import { CalendarDays, CheckCircle2, Clock3, Receipt, X } from "lucide-react";
import type { OwnerBillingUsage } from "@/lib/ownerBilling";

export function OwnerBillingTrigger({ usage }: { usage: OwnerBillingUsage }) {
  const [isOpen, setIsOpen] = useState(false);
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: usage.currency }).format(usage.amountDue);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isOpen]);

  return (
    <>
      <button
        type="button"
        aria-label={`Usage billing, ${amount} this cycle`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(true)}
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sky-200 bg-white text-sm font-semibold text-sky-900 shadow-sm transition hover:bg-sky-50 sm:w-auto sm:gap-2 sm:px-3"
      >
        <span className="relative grid h-7 w-7 place-items-center rounded-lg bg-sky-100 text-sky-800">
          <Receipt aria-hidden="true" className="h-4 w-4" />
          <span aria-hidden="true" className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-white" />
        </span>
        <span className="hidden sm:inline">{amount}</span>
      </button>
      {isOpen && (
        <div
          data-back-button-overlay="true"
          className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/40 p-3 backdrop-blur-sm sm:items-center"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="owner-billing-title"
            className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6"
          >
            <header className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">Usage billing</p>
                <h2 id="owner-billing-title" className="mt-1 text-xl font-bold text-slate-950">{usage.monthLabel} cycle</h2>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-600">
                  <CalendarDays aria-hidden="true" className="h-4 w-4" />
                  Current cycle active
                </p>
              </div>
              <button
                type="button"
                aria-label="Close usage billing"
                onClick={() => setIsOpen(false)}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </header>
            <div className="mt-5 space-y-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-sm text-slate-600">Completed tasks</p>
                <p className="mt-1 font-semibold text-slate-950">
                  {usage.completedTasks.toLocaleString()}
                  <span className="ml-1 text-xs font-normal text-slate-500">· $0.08 per task</span>
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-sm text-slate-600">Active shifts this month</p>
                <p className="mt-1 inline-flex items-center gap-2 font-semibold text-slate-950">
                  <Clock3 aria-hidden="true" className="h-4 w-4 text-slate-400" />
                  {usage.activeShifts.toLocaleString()}
                </p>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-950 px-4 py-3 text-white">
                <p className="inline-flex items-center gap-2 text-sm text-slate-200">
                  <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-emerald-300" />
                  Accrued total
                </p>
                <p className="text-xl font-bold tracking-tight">{amount}</p>
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
