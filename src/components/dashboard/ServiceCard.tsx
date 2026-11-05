"use client";

import { Clock3, FileText, Hotel, UserRound, X } from "lucide-react";
import type { BriefTask } from "@/lib/operationalBrief";
import { WorkLogMediaGallery } from "./WorkLogMediaGallery";
import { StatusBadge, type StatusKind } from "@/components/ui/StatusBadge";

type Props = { task: BriefTask; onClose: () => void; onEdit?: () => void; editLabel?: string };

const timeOptions = { timeZone: "Europe/London" } as const;

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString("en-GB", timeOptions) : "In progress";
}

function formatDate(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("en-GB", { ...timeOptions, dateStyle: "full" });
}

export function ServiceCard({ task, onClose, onEdit, editLabel = "Edit" }: Props) {
  const workflow = task.isLocked ? "Locked for payroll" : task.status === "active" ? "Work in progress" : task.status === "completed" ? "Completed - pending management review" : task.status === "cancelled" ? "Cancelled" : "Pending";
  const status: StatusKind = task.status === "cancelled" ? "cancelled" : task.isLocked ? "approved" : task.status === "active" ? "in_progress" : task.managerRejected || task.ownerRejected ? "rejected" : task.status === "completed" ? "needs_action" : "pending";
  const reviewState = task.status === "active"
    ? "Not submitted"
    : task.isLocked
      ? "Approved by manager and owner"
      : task.managerRejected || task.ownerRejected
        ? "Rejected and awaiting correction"
        : `Manager: ${task.managerApproved ? "approved" : "pending"} · Owner: ${task.ownerApproved ? "approved" : "pending"}`;
    return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="Work log details">
    <article className="theme-workspace max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-3xl border border-line bg-surface-elevated p-5 text-ink shadow-2xl sm:p-6">
      <div className="flex items-start justify-between gap-4 border-b border-line pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">Work log details</p>
          <h2 className="mt-1 text-2xl font-bold">{task.service}</h2>
          <div className="mt-2"><StatusBadge status={status} label={workflow} /></div>
        </div>
        <div className="flex items-center gap-2">
          {onEdit && <button type="button" onClick={onEdit} className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800">{editLabel}</button>}
          <button type="button" onClick={onClose} aria-label="Close work log details" title="Close" className="rounded-xl border border-line p-2 text-ink-muted hover:bg-surface-secondary"><X className="h-5 w-5" /></button>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-line bg-surface-secondary p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-secondary">Task date</p>
        <p className="mt-1 font-semibold text-ink">{formatDate(task.taskDate)}</p>
        <p className="mt-1 text-sm text-ink-secondary">Record ID: <span className="font-mono text-xs">{task.id}</span></p>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Detail icon={UserRound} label="Cleaner" value={task.cleaner} />
        <Detail icon={Hotel} label="Hotel" value={task.hotel} />
        <Detail icon={UserRound} label="Responsible owner" value={task.ownerName} />
        <Detail icon={UserRound} label="Manager at task time" value={task.managerName} />
        <Detail icon={Clock3} label="Started" value={formatTime(task.startTime)} />
        <Detail icon={Clock3} label="Finished" value={formatTime(task.endTime)} />
        <Detail icon={Clock3} label="Responsibility recorded" value={formatTime(task.responsibilityRecordedAt)} />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Summary label="Hours" value={task.hours.toFixed(2)} />
        <Summary label="Rooms" value={String(task.rooms)} />
        <Summary label="Rate" value={`GBP ${task.rate.toFixed(2)}`} />
        <Summary label="Work value" value={`GBP ${task.cost.toFixed(2)}`} />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Info label="Service description" value={task.serviceDescription || task.service} />
        <Info label="Room / work reference" value={task.room || "No room specified"} />
        <Info label="Review state" value={reviewState} />
      </div>
      <div className="mt-3 rounded-2xl bg-surface-secondary p-4">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted"><FileText className="h-4 w-4" /> Notes</p>
        <p className="mt-2 whitespace-pre-wrap text-sm text-ink-secondary">{task.notes || "No notes provided"}</p>
      </div>
      <WorkLogMediaGallery workLogId={task.id} />
      <div className="mt-3 rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-900"><p className="font-semibold">Payroll approval explanation</p><p className="mt-1">{task.isLocked ? "Both management approvals are complete, so this record is locked for payroll." : task.rejectionNotes ? `Correction requested: ${task.rejectionNotes}` : "Payroll remains pending until both the responsible manager and owner approve the completed work."}</p></div>
      <p className="mt-4 text-xs text-ink-muted">Work value is calculated from the service rate and recorded hours or rooms.</p>
    </article>
  </div>;
}

function Detail({ icon: Icon, label, value }: { icon: typeof UserRound; label: string; value: string }) { return <div className="rounded-2xl border border-line bg-surface-secondary p-3"><p className="flex items-center gap-2 text-xs text-ink-muted"><Icon className="h-4 w-4" />{label}</p><p className="mt-1 text-sm font-semibold text-ink">{value}</p></div>; }
function Summary({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl bg-slate-900 p-3 text-white"><p className="text-xs text-ink-muted">{label}</p><p className="mt-1 text-lg font-bold">{value}</p></div>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl border border-line bg-surface-secondary p-4"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted">{label}</p><p className="mt-2 text-sm font-semibold text-ink">{value}</p></div>; }
