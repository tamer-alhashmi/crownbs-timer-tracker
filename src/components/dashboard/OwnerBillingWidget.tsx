import { CalendarDays, CheckCircle2, Clock3, Receipt } from "lucide-react";
import { getOwnerBillingUsage } from "@/lib/ownerBilling";

export function OwnerBillingSkeleton() {
  return (
    <section aria-label="Loading current month billing" className="min-h-28 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="h-4 w-44 animate-pulse rounded bg-slate-200" />
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="h-10 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-10 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-10 animate-pulse rounded-lg bg-slate-100" />
      </div>
    </section>
  );
}

export async function OwnerBillingWidget({ ownerId }: { ownerId: string }) {
  const usage = await getOwnerBillingUsage(ownerId);
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: usage.currency }).format(usage.amountDue);

  return (
    <section aria-labelledby="owner-billing-title" className="rounded-2xl border border-sky-100 bg-gradient-to-r from-white via-sky-50/70 to-emerald-50/60 p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-sky-100 text-sky-800"><Receipt className="h-5 w-5" /></span>
          <div>
            <h2 id="owner-billing-title" className="font-bold text-slate-950">Usage billing</h2>
            <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs font-medium text-sky-800"><CalendarDays className="h-3.5 w-3.5" />{usage.monthLabel} Usage</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800">
          <CheckCircle2 className="h-3.5 w-3.5" />Current Cycle Active
        </span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
        <div className="rounded-xl border border-white/80 bg-white/80 px-3 py-2.5">
          <p className="text-xs text-slate-500">Completed tasks</p>
          <p className="mt-0.5 font-semibold text-slate-900">{usage.completedTasks.toLocaleString()} <span className="text-xs font-normal text-slate-500">· $0.08 per task</span></p>
        </div>
        <div className="rounded-xl border border-white/80 bg-white/80 px-3 py-2.5">
          <p className="text-xs text-slate-500">Active shifts this month</p>
          <p className="mt-0.5 inline-flex items-center gap-1.5 font-semibold text-slate-900"><Clock3 className="h-3.5 w-3.5 text-slate-400" />{usage.activeShifts.toLocaleString()}</p>
        </div>
        <div className="rounded-xl bg-slate-950 px-4 py-2.5 text-white sm:min-w-36 sm:text-right">
          <p className="text-xs text-slate-300">Accrued this cycle</p>
          <p className="mt-0.5 text-xl font-bold tracking-tight">{amount}</p>
        </div>
      </div>
    </section>
  );
}
