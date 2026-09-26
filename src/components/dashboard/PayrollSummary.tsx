"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";

type PayrollLog = { id: string; start_time: string; end_time: string | null; task_date: string; rooms_completed: number; services_config?: { name: string; default_rate: number }[] };

function durationHours(start: string, end: string | null) {
  return end ? Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000) : 0;
}

export function PayrollSummary({ logs }: { logs: PayrollLog[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const filtered = logs.filter((log) => log.task_date >= from && log.task_date <= to).sort((left, right) => right.start_time.localeCompare(left.start_time));
  const total = filtered.reduce((sum, log) => { const service = log.services_config?.[0]; const rate = Number(service?.default_rate ?? 0); const hours = durationHours(log.start_time, log.end_time); return sum + (/per room/i.test(service?.name ?? "") ? log.rooms_completed * rate : hours * rate); }, 0);
  return <section className="mt-5 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200"><div className="flex flex-col gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">Payroll</p><h2 className="mt-1 text-xl font-bold text-slate-900">{from === monthStart ? "Month to date" : "Selected period"}</h2></div><div className="flex items-end gap-3"><label className="text-xs font-semibold uppercase tracking-wide text-slate-500">From<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="mt-1 block rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal text-slate-900" /></label><label className="text-xs font-semibold uppercase tracking-wide text-slate-500">To<input type="date" value={to} min={from} max={today} onChange={(event) => setTo(event.target.value)} className="mt-1 block rounded-lg border border-slate-200 px-2 py-2 text-sm font-normal text-slate-900" /></label><CalendarDays className="mb-2 h-5 w-5 text-sky-700" /></div></div><div className="my-4 grid gap-3 sm:grid-cols-3"><div className="rounded-2xl bg-slate-900 p-4 text-white"><p className="text-xs uppercase tracking-wide text-slate-300">Total payroll</p><p className="mt-1 text-2xl font-bold">GBP {total.toFixed(2)}</p></div><div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Locked records</p><p className="mt-1 text-2xl font-bold text-slate-900">{filtered.length}</p></div><div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Range</p><p className="mt-1 text-sm font-semibold text-slate-900">{from} to {to}</p></div></div><div className="space-y-2">{filtered.map((log) => { const service = log.services_config?.[0]; const rate = Number(service?.default_rate ?? 0); const hours = durationHours(log.start_time, log.end_time); const value = /per room/i.test(service?.name ?? "") ? log.rooms_completed * rate : hours * rate; return <div key={log.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-3 text-sm"><div><p className="font-semibold text-slate-900">{new Date(log.start_time).toLocaleString("en-GB", { timeZone: "Africa/Cairo" })}</p><p className="text-xs text-slate-500">{service?.name ?? "Service"} · {log.rooms_completed} rooms · {hours.toFixed(2)} hours</p></div><p className="font-bold text-slate-900">GBP {value.toFixed(2)}</p></div>; })}{filtered.length === 0 && <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No locked payroll records in this date range.</p>}</div></section>;
}
