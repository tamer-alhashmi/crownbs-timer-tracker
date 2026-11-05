import { Activity, MapPin, ShieldCheck, ShieldAlert } from "lucide-react";

type Props = {
  activeShifts: number;
  compliantClockIns: number;
  breachAttempts: number;
  compliancePercent: number | null;
};

export function AttendanceSummaryWidget({ activeShifts, compliantClockIns, breachAttempts, compliancePercent }: Props) {
  return (
    <section aria-label="On-site workforce and attendance" className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Attendance intelligence</p>
          <h2 className="mt-1 text-base font-bold text-ink">On-Site Workforce &amp; Attendance</h2>
        </div>
        <Activity className="h-5 w-5 text-accent" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric icon={MapPin} label="Active shifts" value={activeShifts.toLocaleString()} />
        <Metric icon={ShieldCheck} label="Verified clock-ins" value={compliantClockIns.toLocaleString()} />
        <Metric icon={ShieldAlert} label="Geofence flags" value={breachAttempts.toLocaleString()} warning={breachAttempts > 0} />
        <Metric icon={Activity} label="Compliance score" value={compliancePercent === null ? "—" : `${compliancePercent}%`} />
      </div>
      {compliancePercent === null && <p className="mt-3 text-xs text-ink-muted">Compliance metrics appear after the first clock-in attempt.</p>}
    </section>
  );
}

function Metric({ icon: Icon, label, value, warning = false }: { icon: typeof Activity; label: string; value: string; warning?: boolean }) {
  return (
    <div className={`min-w-0 rounded-xl border p-3 ${warning ? "border-rose-500/25 bg-rose-500/5" : "border-line bg-surface-secondary"}`}>
      <div className="flex items-center gap-2 text-xs text-ink-secondary"><Icon className={`h-4 w-4 shrink-0 ${warning ? "text-rose-600 dark:text-rose-400" : "text-accent"}`} /><span className="truncate">{label}</span></div>
      <p className="mt-2 text-xl font-bold tabular-nums text-ink">{value}</p>
    </div>
  );
}
