"use client";

import { useState } from "react";
import { Banknote, BedDouble, Building2, ChevronDown, ChevronUp, ClipboardList, Clock3, ExternalLink, MapPin, Route, UsersRound } from "lucide-react";
import type { BriefTask, CleanerBrief, ManagementBrief } from "@/lib/operationalBrief";
import { ServiceCard } from "./ServiceCard";

type Props = { brief: CleanerBrief | ManagementBrief; canEdit?: boolean; onEditTask?: (task: BriefTask) => void };

export function OperationalBrief({ brief, canEdit = false, onEditTask }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [selectedTask, setSelectedTask] = useState<BriefTask | null>(null);
  const isCleaner = brief.kind === "cleaner";
  const totalCost = isCleaner
    ? brief.tasks.reduce((total, task) => total + task.cost, 0)
    : brief.hotels.reduce((total, hotel) => total + hotel.cost, 0);

  return (
    <section className="mb-5 overflow-hidden rounded-2xl border border-sky-500/25 bg-surface shadow-sm ring-1 ring-line">
      <div className="flex items-center justify-between gap-4 p-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="rounded-xl bg-sky-500/10 p-2 text-sky-700 dark:text-sky-300"><ClipboardList className="h-5 w-5" /></div>
          <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700 dark:text-sky-300">Operational brief</p><p className="truncate text-sm text-ink-secondary">{brief.periodLabel}</p></div>
        </div>
        <button type="button" onClick={() => setExpanded((value) => !value)} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line px-3 py-2 text-xs font-semibold text-ink-secondary hover:bg-surface-secondary">
          {expanded ? "Collapse" : "View full brief"}{expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2.5 border-t border-line px-4 py-3">
        {isCleaner ? <><BriefMetric icon={Clock3} label="Hours" value={brief.hours.toFixed(2)} /><BriefMetric icon={BedDouble} label="Rooms" value={String(brief.rooms)} /><BriefMetric icon={Banknote} label="Total cost" value={`GBP ${totalCost.toFixed(2)}`} /></> : <><BriefMetric icon={Building2} label="Hotels" value={String(brief.hotels.length)} /><BriefMetric icon={UsersRound} label="Active cleaners" value={String(brief.hotels.reduce((total, hotel) => total + hotel.activeCleanerCount, 0))} /><BriefMetric icon={Banknote} label="Total cost" value={`GBP ${totalCost.toFixed(2)}`} /></>}
      </div>
      {expanded && <div className="border-t border-line bg-surface-secondary/60 p-4 text-sm text-ink-secondary">{isCleaner ? <CleanerDetails brief={brief} onSelect={setSelectedTask} /> : <ManagementDetails brief={brief} onSelect={setSelectedTask} />}</div>}
      {selectedTask && <ServiceCard task={selectedTask} onClose={() => setSelectedTask(null)} onEdit={canEdit && onEditTask ? () => { const task = selectedTask; setSelectedTask(null); onEditTask(task); } : undefined} />}
    </section>
  );
}

function CleanerDetails({ brief, onSelect }: { brief: CleanerBrief; onSelect: (task: BriefTask) => void }) {
  return <div className="space-y-4"><div><p className="font-semibold text-ink">Services performed</p><div className="mt-2 flex flex-wrap gap-2">{brief.services.map((service) => <span key={service.name} className="rounded-full bg-surface px-3 py-1 text-xs ring-1 ring-line">{service.name} · {service.count}</span>)}</div></div><TaskList tasks={brief.tasks} onSelect={onSelect} /></div>;
}

function ManagementDetails({ brief, onSelect }: { brief: ManagementBrief; onSelect: (task: BriefTask) => void }) {
  return <div className="space-y-4"><MovementTimeline brief={brief} onSelect={onSelect} />{brief.hotels.map((hotel) => <article key={hotel.hotelId} className="rounded-2xl bg-surface p-4 shadow-sm ring-1 ring-line"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold text-ink">{hotel.hotelName}</h3><p className="mt-1 text-xs text-ink-secondary">{hotel.activeCleaners.length ? `Active: ${hotel.activeCleaners.join(", ")}` : "No active cleaners"} · {hotel.hours.toFixed(2)} hours · {hotel.rooms} rooms</p></div><div className="text-right"><p className="text-xs text-ink-muted">{hotel.activeCleanerCount} active cleaner{hotel.activeCleanerCount === 1 ? "" : "s"}</p><p className="mt-1 text-lg font-bold text-ink">GBP {hotel.cost.toFixed(2)}</p></div></div><div className="mt-3 flex flex-wrap gap-2">{hotel.services.map((service) => <span key={service.name} className="rounded-full bg-surface-secondary px-2.5 py-1 text-xs ring-1 ring-line">{service.name} · {service.count}</span>)}</div><TaskList tasks={hotel.tasks} onSelect={onSelect} /></article>)}{brief.hotels.length === 0 && <p className="text-ink-muted">No active hotel work was recorded for this period.</p>}</div>;
}

function MovementTimeline({ brief, onSelect }: { brief: ManagementBrief; onSelect: (task: BriefTask) => void }) {
  const [expanded, setExpanded] = useState(false);
  const events = brief.hotels.flatMap((hotel) => hotel.tasks.filter((task) => task.status === "active").map((task) => ({ ...task, hotel: hotel.hotelName }))).sort((left, right) => new Date(right.startTime).getTime() - new Date(left.startTime).getTime());
  if (!events.length) return null;
  const visibleEvents = expanded ? events : events.slice(0, 6);

  return <section className="rounded-2xl border border-emerald-500/25 bg-surface shadow-sm ring-1 ring-line"><button type="button" onClick={() => setExpanded((value) => !value)} className="flex w-full items-center justify-between gap-3 p-4 text-left"><span className="flex items-center gap-3"><span className="rounded-xl bg-emerald-500/10 p-2 text-emerald-700 dark:text-emerald-300"><Route className="h-5 w-5" /></span><span><span className="block font-bold text-ink">Active cleaner movement</span><span className="mt-0.5 block text-xs text-ink-muted">{events.length} timeline event{events.length === 1 ? "" : "s"}</span></span></span><span className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300">{expanded ? "Show fewer events" : "Show all events"}{expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span></button><div className="border-t border-line p-4"><div className="space-y-3">{visibleEvents.map((event) => <button type="button" key={event.id} onClick={() => onSelect(event)} className="relative flex w-full gap-3 text-left"><span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500 ring-4 ring-emerald-500/15" /><span className="min-w-0 flex-1 border-b border-line pb-3"><span className="flex flex-wrap items-center gap-x-2"><span className="font-semibold text-ink">{event.cleaner}</span><span className="text-ink-muted">·</span><span className="font-medium text-sky-700 dark:text-sky-300">{event.service}</span><span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">Current</span></span><span className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-ink-muted"><span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{event.hotel}</span><span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{new Date(event.startTime).toLocaleString("en-GB", { timeZone: "Africa/Cairo" })}</span></span></span><ExternalLink className="mt-1 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-300" /></button>)}</div></div></section>;
}

function TaskList({ tasks, onSelect }: { tasks: BriefTask[]; onSelect: (task: BriefTask) => void }) {
  const pageSize = 10;
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const filtered = tasks.filter((task) => (!fromDate || task.taskDate >= fromDate) && (!toDate || task.taskDate <= toDate));
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  return <div className="mt-3"><div className="mb-3 grid gap-2 rounded-xl bg-surface p-3 ring-1 ring-line sm:grid-cols-[1fr_1fr_auto]"><label className="text-xs font-semibold text-ink-secondary">From<input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => { setFromDate(event.target.value); setPage(1); }} className="mt-1 block w-full rounded-lg border border-line px-2 py-1.5 text-sm font-normal text-ink" /></label><label className="text-xs font-semibold text-ink-secondary">To<input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => { setToDate(event.target.value); setPage(1); }} className="mt-1 block w-full rounded-lg border border-line px-2 py-1.5 text-sm font-normal text-ink" /></label><button type="button" onClick={() => { setFromDate(""); setToDate(""); setPage(1); }} className="self-end rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-secondary">Clear</button></div><div className="space-y-2">{visible.map((task) => <button type="button" key={task.id} onClick={() => onSelect(task)} className="group block w-full rounded-xl border-l-2 border-sky-300 bg-surface-secondary px-3 py-2 text-left transition hover:bg-sky-50"><div className="flex items-start justify-between gap-3"><p className="min-w-0 font-medium text-ink-secondary">{task.cleaner} · {task.service}{task.room ? ` · ${task.room}` : ""}</p><ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-600 opacity-60 group-hover:opacity-100" /></div><p className="mt-1 text-xs text-ink-muted">{task.taskDate} · Manager: {task.managerName} · {task.status} · {task.hours.toFixed(2)} hours · GBP {task.rate.toFixed(2)} rate · <span className="font-semibold text-ink-secondary">GBP {task.cost.toFixed(2)} value</span></p></button>)}{filtered.length === 0 && <p className="rounded-xl bg-surface p-3 text-sm text-ink-muted">No tasks match this date range.</p>}</div><div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-ink-muted"><span>{filtered.length} tasks · Page {currentPage} of {pageCount}</span><div className="flex gap-1"><button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} className="rounded-lg border border-line px-2.5 py-1.5 font-semibold text-ink-secondary disabled:opacity-40">Previous</button>{Array.from({ length: pageCount }, (_, index) => index + 1).map((number) => <button key={number} type="button" aria-current={number === currentPage ? "page" : undefined} onClick={() => setPage(number)} className={`min-w-7 rounded-lg px-2 py-1.5 font-semibold ${number === currentPage ? "bg-slate-900 text-white" : "border border-line text-ink-secondary"}`}>{number}</button>)}<button type="button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)} className="rounded-lg border border-line px-2.5 py-1.5 font-semibold text-ink-secondary disabled:opacity-40">Next</button></div></div></div>;
}

function BriefMetric({ icon: Icon, label, value }: { icon: typeof Clock3; label: string; value: string }) { return <div className="min-w-0 rounded-xl bg-surface-secondary px-2 py-2 sm:px-3"><p className="flex min-w-0 items-center gap-1 text-[11px] text-ink-muted sm:text-xs"><Icon className="h-4 w-4 shrink-0 text-ink-muted" /><span className="truncate">{label}</span></p><p className="mt-1 break-words text-sm font-bold text-ink-secondary sm:text-lg">{value}</p></div>; }
