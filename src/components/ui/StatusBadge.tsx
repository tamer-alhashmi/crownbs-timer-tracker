import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  PlayCircle,
  ShieldAlert,
  XCircle,
  type LucideIcon,
} from "lucide-react";

export type StatusKind =
  | "pending"
  | "in_progress"
  | "needs_action"
  | "completed"
  | "approved"
  | "cancelled"
  | "overridden"
  | "rejected"
  | "locked";

const statusPresentation: Record<StatusKind, { label: string; Icon: LucideIcon; style: string; dot: string }> = {
  pending: { label: "Pending", Icon: Clock3, style: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400", dot: "bg-amber-500" },
  in_progress: { label: "In progress", Icon: PlayCircle, style: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-400", dot: "bg-sky-500" },
  needs_action: { label: "Needs action", Icon: AlertTriangle, style: "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-400", dot: "bg-rose-500" },
  completed: { label: "Completed", Icon: CheckCircle2, style: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-500" },
  approved: { label: "Approved", Icon: CheckCircle2, style: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-500" },
  cancelled: { label: "Cancelled", Icon: XCircle, style: "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-400", dot: "bg-rose-500" },
  overridden: { label: "Overridden", Icon: ShieldAlert, style: "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-400", dot: "bg-rose-500" },
  rejected: { label: "Rejected", Icon: ShieldAlert, style: "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-400", dot: "bg-rose-500" },
  locked: { label: "Locked for payroll", Icon: CheckCircle2, style: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-500" },
};

export function StatusBadge({
  status,
  label,
  className = "",
}: {
  status: StatusKind;
  label?: string;
  className?: string;
}) {
  const { Icon, style, dot, label: defaultLabel } = statusPresentation[status];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold leading-none ${style} ${className}`}>
      <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
      {label ?? defaultLabel}
    </span>
  );
}
