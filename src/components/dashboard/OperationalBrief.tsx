"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, ClipboardList, Clock3, ExternalLink, MapPin, Route } from "lucide-react";
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
    <section className="mb-5 overflow-hidden rounded-2xl border border-sky-100 bg-white shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center justify-between gap-4 p-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="rounded-xl bg-sky-100 p-2 text-sky-700"><ClipboardList className="h-5 w-5" /></div>
          <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Operational brief</p><p className="truncate text-sm text-slate-600">{brief.periodLabel}</p></div>
        </div>
        <button type="button" onClick={() => setExpanded((value) => !value)} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
          {expanded ? "Collapse" : "View full brief"}{expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>
      <div className="grid gap-3 border-t border-slate-100 px-4 py-3 sm:grid-cols-3">
        {isCleaner ? <><BriefMetric label="Hours" value={brief.hours.toFixed(2)} /><BriefMetric label="Rooms" value={String(brief.rooms)} /><BriefMetric label="Total cost" value={`GBP ${totalCost.toFixed(2)}`} /></> : <><BriefMetric label="Hotels" value={String(brief.hotels.length)} /><BriefMetric label="Active cleaners" value={String(brief.hotels.reduce((total, hotel) => total + hotel.activeCleanerCount, 0))} /><BriefMetric label="Total cost" value={`GBP ${totalCost.toFixed(2)}`} /></>}
      </div>
      {expanded && <div className="border-t border-slate-100 bg-slate-50/60 p-4 text-sm text-slate-700">{isCleaner ? <CleanerDetails brief={brief} onSelect={setSelectedTask} /> : <ManagementDetails brief={brief} onSelect={setSelectedTask} />}</div>}
      {selectedTask && <ServiceCard task={selectedTask} onClose={() => setSelectedTask(null)} onEdit={canEdit && onEditTask ? () => { const task = selectedTask; setSelectedTask(null); onEditTask(task); } : undefined} />}
    </section>
  );
}

function CleanerDetails({ brief, onSelect }: { brief: CleanerBrief; onSelect: (task: BriefTask) => void }) {
  return <div className="space-y-4"><div><p className="font-semibold text-slate-900">Services performed</p><div className="mt-2 flex flex-wrap gap-2">{brief.services.map((service) => <span key={service.name} className="rounded-full bg-white px-3 py-1 text-xs ring-1 ring-slate-200">{service.name} · {service.count}</span>)}</div></div><TaskList tasks={brief.tasks} onSelect={onSelect} /></div>;
}

function ManagementDetails({ brief, onSelect }: { brief: ManagementBrief; onSelect: (task: BriefTask) => void }) {
  return <div className="space-y-4"><MovementTimeline brief={brief} onSelect={onSelect} />{brief.hotels.map((hotel) => <article key={hotel.hotelId} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold text-slate-900">{hotel.hotelName}</h3><p className="mt-1 text-xs text-slate-600">{hotel.activeCleaners.length ? `Active: ${hotel.activeCleaners.join(", ")}` : "No active cleaners"} · {hotel.hours.toFixed(2)} hours · {hotel.rooms} rooms</p></div><div className="text-right"><p className="text-xs text-slate-500">{hotel.activeCleanerCount} active cleaner{hotel.activeCleanerCount === 1 ? "" : "s"}</p><p className="mt-1 text-lg font-bold text-slate-900">GBP {hotel.cost.toFixed(2)}</p></div></div><div className="mt-3 flex flex-wrap gap-2">{hotel.services.map((service) => <span key={service.name} className="rounded-full bg-slate-50 px-2.5 py-1 text-xs ring-1 ring-slate-200">{service.name} · {service.count}</span>)}</div><TaskList tasks={hotel.tasks} onSelect={onSelect} /></article>)}{brief.hotels.length === 0 && <p className="text-slate-500">No active hotel work was recorded for this period.</p>}</div>;
}

function MovementTimeline({ brief, onSelect }: { brief: ManagementBrief; onSelect: (task: BriefTask) => void }) {
  const [expanded, setExpanded] = useState(false);
  const events = brief.hotels.flatMap((hotel) => hotel.tasks.filter((task) => task.status === "active").map((task) => ({ ...task, hotel: hotel.hotelName }))).sort((left, right) => new Date(right.startTime).getTime() - new Date(left.startTime).getTime());
  if (!events.length) return null;
  const visibleEvents = expanded ? events : events.slice(0, 6);

  return <section className="rounded-2xl border border-emerald-100 bg-white shadow-sm ring-1 ring-slate-200"><button type="button" onClick={() => setExpanded((value) => !value)} className="flex w-full items-center justify-between gap-3 p-4 text-left"><span className="flex items-center gap-3"><span className="rounded-xl bg-emerald-50 p-2 text-emerald-700"><Route className="h-5 w-5" /></span><span><span className="block font-bold text-slate-900">Active cleaner movement</span><span className="mt-0.5 block text-xs text-slate-500">{events.length} timeline event{events.length === 1 ? "" : "s"}</span></span></span><span className="flex items-center gap-2 text-xs font-semibold text-emerald-700">{expanded ? "Show fewer events" : "Show all events"}{expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span></button><div className="border-t border-slate-100 p-4"><div className="space-y-3">{visibleEvents.map((event) => <button type="button" key={event.id} onClick={() => onSelect(event)} className="relative flex w-full gap-3 text-left"><span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500 ring-4 ring-emerald-100" /><span className="min-w-0 flex-1 border-b border-slate-100 pb-3"><span className="flex flex-wrap items-center gap-x-2"><span className="font-semibold text-slate-900">{event.cleaner}</span><span className="text-slate-400">·</span><span className="font-medium text-sky-700">{event.service}</span><span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Current</span></span><span className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-slate-500"><span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{event.hotel}</span><span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />{new Date(event.startTime).toLocaleString("en-GB", { timeZone: "Africa/Cairo" })}</span></span></span><ExternalLink className="mt-1 h-4 w-4 shrink-0 text-sky-600" /></button>)}</div></div></section>;
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
  return <div className="mt-3"><div className="mb-3 grid gap-2 rounded-xl bg-white p-3 ring-1 ring-slate-200 sm:grid-cols-[1fr_1fr_auto]"><label className="text-xs font-semibold text-slate-600">From<input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => { setFromDate(event.target.value); setPage(1); }} className="mt-1 block w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-normal text-slate-900" /></label><label className="text-xs font-semibold text-slate-600">To<input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => { setToDate(event.target.value); setPage(1); }} className="mt-1 block w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-normal text-slate-900" /></label><button type="button" onClick={() => { setFromDate(""); setToDate(""); setPage(1); }} className="self-end rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700">Clear</button></div><div className="space-y-2">{visible.map((task) => <button type="button" key={task.id} onClick={() => onSelect(task)} className="group block w-full rounded-xl border-l-2 border-sky-300 bg-slate-50 px-3 py-2 text-left transition hover:bg-sky-50"><div className="flex items-start justify-between gap-3"><p className="min-w-0 font-medium text-slate-800">{task.cleaner} · {task.service}{task.room ? ` · ${task.room}` : ""}</p><ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-600 opacity-60 group-hover:opacity-100" /></div><p className="mt-1 text-xs text-slate-500">{task.taskDate} · Manager: {task.managerName} · {task.status} · {task.hours.toFixed(2)} hours · GBP {task.rate.toFixed(2)} rate · <span className="font-semibold text-slate-700">GBP {task.cost.toFixed(2)} value</span></p></button>)}{filtered.length === 0 && <p className="rounded-xl bg-white p-3 text-sm text-slate-500">No tasks match this date range.</p>}</div><div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500"><span>{filtered.length} tasks · Page {currentPage} of {pageCount}</span><div className="flex gap-1"><button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 font-semibold text-slate-700 disabled:opacity-40">Previous</button>{Array.from({ length: pageCount }, (_, index) => index + 1).map((number) => <button key={number} type="button" aria-current={number === currentPage ? "page" : undefined} onClick={() => setPage(number)} className={`min-w-7 rounded-lg px-2 py-1.5 font-semibold ${number === currentPage ? "bg-slate-900 text-white" : "border border-slate-200 text-slate-700"}`}>{number}</button>)}<button type="button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 font-semibold text-slate-700 disabled:opacity-40">Next</button></div></div></div>;
}

function BriefMetric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-lg font-semibold text-slate-900">{value}</p></div>; }
