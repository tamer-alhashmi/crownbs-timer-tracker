"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { calculateTaskCost, resolveBillingUnit, resolveServiceRate, type ServicePricing } from "@/lib/servicePricing";
import { useWorkLogRealtimeRefresh } from "@/lib/useWorkLogRealtimeRefresh";

type ServiceConfig = { name: string; default_rate: number; unit?: string };
type PayrollLog = { id: string; start_time: string; end_time: string | null; task_date: string; rooms_completed: number; is_locked: boolean; cost_override?: number | string | null; services_config?: ServiceConfig | ServiceConfig[] | null };

function durationHours(start: string, end: string | null) {
  return end ? Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000) : 0;
}

function serviceFor(log: PayrollLog) {
  return Array.isArray(log.services_config) ? log.services_config[0] : log.services_config;
}

export function PayrollSummary({ logs }: { logs: PayrollLog[] }) {
  useWorkLogRealtimeRefresh();
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const filtered = logs.filter((log) => log.task_date >= from && log.task_date <= to).sort((left, right) => right.start_time.localeCompare(left.start_time));
  const locked = filtered.filter((log) => log.is_locked);
  const unlocked = filtered.filter((log) => !log.is_locked);
  const lockedHours = locked.reduce((sum, log) => sum + durationHours(log.start_time, log.end_time), 0);
  const unlockedHours = unlocked.reduce((sum, log) => sum + durationHours(log.start_time, log.end_time), 0);
  const earnings = (log: PayrollLog) => calculateTaskCost(durationHours(log.start_time, log.end_time), log.rooms_completed, serviceFor(log) ?? {}, log.cost_override);
  const lockedEarnings = locked.reduce((sum, log) => sum + earnings(log), 0);
  const unlockedEarnings = unlocked.reduce((sum, log) => sum + earnings(log), 0);
  const totalEarnings = lockedEarnings + unlockedEarnings;

  return <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
    <div className="flex flex-col gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">Payroll &amp; history</p><h2 className="mt-1 text-xl font-bold text-slate-900">{from === monthStart ? "Month to date" : "Selected period"}</h2></div>
      <div className="grid grid-cols-2 items-end gap-3">
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">From<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal text-slate-900" /></label>
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">To<input type="date" value={to} min={from} max={today} onChange={(event) => setTo(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal text-slate-900" /></label>
      </div>
    </div>
    <div className="my-4 grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl bg-slate-900 p-4 text-white"><p className="text-xs uppercase tracking-wide text-slate-300">Total earnings</p><p className="mt-1 text-2xl font-bold">GBP {totalEarnings.toFixed(2)}</p><p className="mt-1 text-xs text-slate-300">{from} to {to}</p></div>
      <div className="rounded-xl bg-emerald-50 p-4"><p className="text-xs text-emerald-800">Locked · payout ready</p><p className="mt-1 text-2xl font-bold text-slate-900">GBP {lockedEarnings.toFixed(2)}</p><p className="mt-1 text-xs text-slate-600">{lockedHours.toFixed(2)} hours · {locked.length} records</p></div>
      <div className="rounded-xl bg-amber-50 p-4"><p className="text-xs text-amber-800">Unlocked · pending</p><p className="mt-1 text-2xl font-bold text-slate-900">GBP {unlockedEarnings.toFixed(2)}</p><p className="mt-1 text-xs text-slate-600">{unlockedHours.toFixed(2)} hours · {unlocked.length} records</p></div>
    </div>
    <div className="mb-3 flex items-center gap-2 text-xs text-slate-500"><CalendarDays className="h-4 w-4 text-sky-700" />Completed work within the selected date range</div>
    <div className="space-y-2">
      {filtered.map((log) => {
        const hours = durationHours(log.start_time, log.end_time);
        const service: ServicePricing = serviceFor(log) ?? {};
        const rate = resolveServiceRate(service);
        const unit = resolveBillingUnit(service.unit, service.name ?? "");
        return <div key={log.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-3 text-sm">
          <div className="min-w-0"><p className="font-semibold text-slate-900">{new Date(log.start_time).toLocaleString("en-GB", { timeZone: "Africa/Cairo" })}</p><p className="text-xs text-slate-500">{service.name ?? "Service"} · {log.rooms_completed} rooms · {hours.toFixed(2)} hours · GBP {rate.toFixed(2)} {unit === "hourly" ? "/hr" : unit === "per_room" ? "/room" : "fixed"}</p></div>
          <div className="flex items-center gap-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${log.is_locked ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{log.is_locked ? "Locked" : "Pending"}</span><p className="font-bold text-slate-900">GBP {earnings(log).toFixed(2)}</p></div>
        </div>;
      })}
      {filtered.length === 0 && <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No completed payroll records in this date range.</p>}
    </div>
  </section>;
}
