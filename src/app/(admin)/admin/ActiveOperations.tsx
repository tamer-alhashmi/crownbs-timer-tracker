"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { Clock3, LoaderCircle, ShieldAlert } from "lucide-react";
import { overrideActiveOperation, type ManagementOverrideInput } from "./actions";

type ActiveTask = {
  id: string;
  user_id: string;
  cleanerName: string;
  hotelName: string;
  service_name_snapshot: string | null;
  room_number: string | null;
  room_numbers: string[] | null;
  start_time: string;
};

type ActiveShift = {
  id: string;
  user_id: string;
  start_time: string;
  cleanerName: string;
  task: ActiveTask | null;
};

type OverrideDraft = {
  entityType: "shift" | "task";
  entityId: string;
  action: ManagementOverrideInput["action"];
  label: string;
  startedAt: string;
};

function elapsed(startTime: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(startTime)) / 60_000));
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function localDateTimeValue() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

export function ActiveOperations({ shifts, tasks, canManage }: { shifts: ActiveShift[]; tasks: ActiveTask[]; canManage: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  const [draft, setDraft] = useState<OverrideDraft | null>(null);
  const [reason, setReason] = useState("");
  const [endTime, setEndTime] = useState("");
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const beginOverride = (next: OverrideDraft) => {
    setDraft(next);
    setReason("");
    setEndTime("");
    setFeedback(null);
  };

  const taskActions = (task: ActiveTask) => canManage && <div className="flex flex-wrap gap-2">
    <button type="button" onClick={() => beginOverride({ entityType: "task", entityId: task.id, action: "force_complete_task", label: "Force complete task", startedAt: task.start_time })} className="rounded-lg border border-emerald-300/30 px-3 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-300/10">Force complete</button>
    <button type="button" onClick={() => beginOverride({ entityType: "task", entityId: task.id, action: "cancel_task", label: "Cancel task", startedAt: task.start_time })} className="rounded-lg border border-rose-300/30 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-300/10">Cancel task</button>
  </div>;

  const submitOverride = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft) return;
    startTransition(async () => {
      try {
        await overrideActiveOperation({
          entityType: draft.entityType,
          entityId: draft.entityId,
          action: draft.action,
          reason,
          ...(endTime ? { endTime: new Date(endTime).toISOString() } : {}),
        });
        setDraft(null);
        setFeedback({ text: `${draft.label} recorded and audited.`, error: false });
      } catch (error) {
        setFeedback({ text: error instanceof Error ? error.message : "Unable to update the active operation.", error: true });
      }
    });
  };

  return <section className="rounded-3xl bg-slate-900 p-4 text-white shadow-sm sm:p-5" aria-label="Active cleaner operations">
    <div className="flex items-start justify-between gap-3">
      <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">Live status</p><h3 className="mt-1 text-lg font-bold">Active cleaners</h3><p className="mt-1 text-sm text-slate-300">{shifts.length} clocked in · {tasks.length} active tasks</p></div>
      <Clock3 className="mt-1 h-5 w-5 text-emerald-300" />
    </div>
    {feedback && <p role={feedback.error ? "alert" : "status"} className={`mt-3 rounded-lg border px-3 py-2 text-sm ${feedback.error ? "border-rose-400/40 bg-rose-950/50 text-rose-200" : "border-emerald-400/30 bg-emerald-950/40 text-emerald-200"}`}>{feedback.text}</p>}
    <div className="mt-4 grid gap-3 xl:grid-cols-2">
      {shifts.map((shift) => <article key={`shift-${shift.id}`} className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold text-white">{shift.cleanerName}</p><p className="mt-1 text-sm text-emerald-200">Clocked in · {elapsed(shift.start_time, now)}</p><p className="mt-1 text-xs text-slate-400">Started {new Date(shift.start_time).toLocaleString()}</p></div>{canManage && <button type="button" onClick={() => beginOverride({ entityType: "shift", entityId: shift.id, action: "force_clock_out", label: "Force clock out", startedAt: shift.start_time })} className="rounded-lg border border-amber-300/30 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-300/10">Force clock out</button>}</div>
        {shift.task && <div className="mt-3 rounded-lg bg-black/20 px-3 py-2"><p className="text-sm text-slate-200">Task: {shift.task.hotelName} · {shift.task.service_name_snapshot ?? "Service"}{shift.task.room_numbers?.length ? ` · Room ${shift.task.room_numbers.join(", ")}` : shift.task.room_number ? ` · Room ${shift.task.room_number}` : ""} · {elapsed(shift.task.start_time, now)}</p><div className="mt-2">{taskActions(shift.task)}</div></div>}
      </article>)}
      {tasks.filter((task) => !shifts.some((shift) => shift.user_id === task.user_id)).map((task) => <article key={`task-${task.id}`} className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold text-white">{task.cleanerName}</p><p className="mt-1 text-sm text-cyan-100">{task.hotelName} · {task.service_name_snapshot ?? "Task in progress"}</p><p className="mt-1 text-sm text-slate-300">{task.room_numbers?.length ? `Room ${task.room_numbers.join(", ")}` : task.room_number ? `Room ${task.room_number}` : "No room assigned"} · {elapsed(task.start_time, now)}</p><p className="mt-1 text-xs text-slate-400">Started {new Date(task.start_time).toLocaleString()}</p></div>{taskActions(task)}</div>
      </article>)}
      {!shifts.length && !tasks.length && <p className="rounded-2xl bg-white/5 p-4 text-sm text-slate-300 xl:col-span-2">No cleaners are currently clocked in and no tasks are active.</p>}
    </div>
    {draft && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 p-4" role="dialog" aria-modal="true" aria-labelledby="active-operation-dialog-title">
      <form onSubmit={submitOverride} className="w-full max-w-lg rounded-2xl bg-white p-5 text-slate-900 shadow-2xl">
        <div className="flex items-start gap-3"><ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" /><div><h2 id="active-operation-dialog-title" className="text-lg font-bold">{draft.label}?</h2><p className="mt-1 text-sm text-slate-600">This change is immediate and recorded in the operational audit log.</p></div></div>
        {draft.entityType === "shift" && <label className="mt-4 block text-sm font-medium text-slate-700">Custom end time (optional)<input type="datetime-local" value={endTime} max={localDateTimeValue()} onChange={(event) => setEndTime(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900" /><span className="mt-1 block text-xs font-normal text-slate-500">Leave blank to use the current time. Shift started {new Date(draft.startedAt).toLocaleString()}.</span></label>}
        <label className="mt-4 block text-sm font-medium text-slate-700">Audit reason<textarea required minLength={5} maxLength={1000} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explain why this override is needed" className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900" /></label>
        {feedback?.error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{feedback.text}</p>}
        <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setDraft(null)} disabled={isPending} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button><button type="submit" disabled={isPending || reason.trim().length < 5} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{isPending && <LoaderCircle className="h-4 w-4 animate-spin" />}{isPending ? "Saving..." : "Confirm override"}</button></div>
      </form>
    </div>}
  </section>;
}
