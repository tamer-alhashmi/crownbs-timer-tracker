import { Suspense } from "react";
import { Activity, Building2, CircleHelp, UsersRound } from "lucide-react";
import { getSessionUser } from "@/lib/auth";
import { getRoleScopedIntelligenceData, type IntelligenceViewer } from "@/lib/roleIntelligence";
import type { UserRole } from "@/lib/roles";
import { isHousekeepingAdmin, isPlatformAdmin } from "@/lib/roles";

function isIntelligenceRole(role: UserRole): role is IntelligenceViewer["role"] {
  return isPlatformAdmin(role) || role === "owner" || role === "manager" || isHousekeepingAdmin(role);
}

function IntelligenceSkeleton() {
  return (
    <section aria-label="Loading intelligence" className="min-h-[430px] space-y-4 rounded-3xl border border-line bg-surface-secondary p-4 sm:p-6">
      <div className="h-7 w-64 animate-pulse rounded-lg bg-surface" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-32 animate-pulse rounded-2xl bg-surface ring-1 ring-line" />)}
      </div>
      <div className="h-52 animate-pulse rounded-2xl bg-surface ring-1 ring-line" />
    </section>
  );
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "—";
}

function timeAgo(timestamp: string | null) {
  if (!timestamp) return "No recent activity";
  const days = Math.floor((Date.now() - new Date(timestamp).getTime()) / 86_400_000);
  if (days <= 0) return "Active today";
  if (days === 1) return "Active yesterday";
  return `Active ${days} days ago`;
}

async function IntelligenceContent() {
  const session = await getSessionUser();
  if (!session || !isIntelligenceRole(session.role)) return null;

  const viewer: IntelligenceViewer = {
    userId: session.userId,
    role: session.role,
    assignedHotelIds: [],
  };
  const data = await getRoleScopedIntelligenceData(viewer);
  const isAdmin = isPlatformAdmin(session.role);
  const maximumActivity = Math.max(
    1,
    ...(isAdmin
      ? (data.tenants ?? []).map((tenant) => tenant.completedTasks)
      : data.performers.map((performer) => performer.completedTasks))
  );
  const icons = [Building2, UsersRound, Activity, CircleHelp];

  return (
    <section aria-labelledby="role-intelligence-heading" className="space-y-4 rounded-3xl border border-line bg-surface p-4 text-ink shadow-sm sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-ink-secondary">Intelligence &amp; performance</p>
          <h2 id="role-intelligence-heading" className="mt-1 text-xl font-bold tracking-tight text-ink sm:text-2xl">{data.title}</h2>
          <p className="mt-1 text-sm text-ink-secondary">{data.subtitle}</p>
        </div>
        <span className="rounded-full border border-line bg-surface-secondary px-3 py-1.5 text-xs font-semibold text-ink-secondary">{data.periodLabel}</span>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.kpis.map((kpi, index) => {
          const Icon = icons[index % icons.length];
          return (
            <article key={kpi.label} title={kpi.detail} className="min-h-32 rounded-2xl border border-line bg-surface p-4 text-ink shadow-sm transition hover:-translate-y-0.5 hover:border-accent hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">{kpi.label}</p>
                  <p className="mt-2 text-2xl font-bold tracking-tight text-ink">{kpi.value}</p>
                </div>
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-surface-secondary text-accent"><Icon className="h-5 w-5" /></span>
              </div>
              <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-ink-secondary">
                <CircleHelp aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />{kpi.detail}
              </p>
            </article>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-surface text-ink shadow-sm">
        {isAdmin ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
              <div>
                <h3 className="font-semibold text-ink">Tenant / Owner consumption</h3>
                <p className="mt-0.5 text-xs text-ink-secondary">Portfolio scale, assigned workforce, and completed work logs over the last 30 days.</p>
              </div>
              <span className="text-xs font-medium text-ink-muted">{(data.tenants ?? []).length} tenants</span>
            </div>
            {!data.tenants?.length ? (
              <div className="px-6 py-10 text-center">
                <Building2 className="mx-auto h-9 w-9 text-ink-muted" />
                <h4 className="mt-3 font-semibold text-ink">No owner accounts yet</h4>
                <p className="mt-1 text-sm text-ink-secondary">Owner portfolios and usage will appear here as tenants are added.</p>
              </div>
            ) : (
              <div className="divide-y divide-line">
                {data.tenants.map((tenant) => {
                  const score = Math.round((tenant.completedTasks / maximumActivity) * 100);
                  return (
                    <article key={tenant.id} className="grid gap-3 p-4 transition hover:bg-surface-secondary sm:grid-cols-[minmax(220px,1.2fr)_minmax(170px,.9fr)_minmax(180px,1fr)_minmax(120px,.7fr)] sm:items-center sm:px-5">
                      <div className="flex min-w-0 items-center gap-3">
                        <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-bold text-white">{initials(tenant.name)}</span>
                        <div className="min-w-0">
                          <h4 className="truncate font-semibold text-ink">{tenant.name}</h4>
                          <p className="truncate text-xs text-ink-secondary">{tenant.email ?? "No email on file"}</p>
                          <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${tenant.isActive ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
                            {tenant.isActive ? "Active" : "Idle / Setup Needed"}
                          </span>
                        </div>
                      </div>
                      <div className="text-xs">
                        <p className="font-semibold text-ink">Portfolio</p>
                        <p className="mt-1 text-ink-secondary">{tenant.propertyCount} {tenant.propertyCount === 1 ? "property" : "properties"} · {tenant.roomCount.toLocaleString()} rooms</p>
                      </div>
                      <div className="text-xs">
                        <p className="font-semibold text-ink">Assigned workforce</p>
                        <p className="mt-1 text-ink-secondary">{tenant.managerCount} {tenant.managerCount === 1 ? "manager" : "managers"} · {tenant.cleanerCount} {tenant.cleanerCount === 1 ? "cleaner" : "cleaners"}</p>
                      </div>
                      <div>
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-semibold text-ink">{tenant.completedTasks} completed</span>
                          <span className="text-ink-muted">{score}%</span>
                        </div>
                        <div role="progressbar" aria-label={`${tenant.name} relative 30-day work log consumption`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={score} className="mt-2 h-2 overflow-hidden rounded-full bg-surface-secondary">
                          <div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-500 transition-all" style={{ width: `${score}%` }} />
                        </div>
                        <p className="mt-1.5 text-xs font-medium text-ink-secondary">{timeAgo(tenant.lastActiveAt)}</p>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
              <div>
                <h3 className="font-semibold text-ink">Ranked team performance</h3>
                <p className="mt-0.5 text-xs text-ink-secondary">Team members ranked by completed work logs, then shifts, in the last 30 days.</p>
              </div>
              <span className="text-xs font-medium text-ink-muted">Top {data.performers.length}</span>
            </div>
            {!data.performers.length ? (
              <div className="px-6 py-10 text-center">
                <UsersRound className="mx-auto h-9 w-9 text-ink-muted" />
                <h4 className="mt-3 font-semibold text-ink">No recent team activity</h4>
                <p className="mt-1 text-sm text-ink-secondary">Assigned team performance will appear here as work logs and shifts are recorded.</p>
              </div>
            ) : (
              <div className="divide-y divide-line">
                {data.performers.map((performer, index) => {
                  const score = Math.round((performer.completedTasks / maximumActivity) * 100);
                  return (
                    <article key={performer.id} className="grid gap-3 p-4 transition hover:bg-surface-secondary sm:grid-cols-[minmax(220px,1.2fr)_minmax(180px,1fr)_minmax(160px,.8fr)] sm:items-center sm:px-5">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-secondary text-xs font-bold text-ink-secondary">{index + 1}</span>
                        <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-bold text-white">{initials(performer.name)}</span>
                        <div className="min-w-0">
                          <h4 className="truncate font-semibold text-ink">{performer.name}</h4>
                          <p className="text-xs capitalize text-ink-secondary">{performer.role.replaceAll("_", " ")}</p>
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span className="font-semibold text-ink">{performer.completedTasks} completed tasks</span>
                          <span className="text-ink-muted">{performer.shifts} shifts</span>
                        </div>
                        <div role="progressbar" aria-label={`${performer.name} relative completed task activity`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={score} className="mt-2 h-2 overflow-hidden rounded-full bg-surface-secondary">
                          <div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-500 transition-all" style={{ width: `${score}%` }} />
                        </div>
                      </div>
                      <p className="text-xs font-medium text-ink-secondary sm:text-right">{timeAgo(performer.lastActiveAt)}</p>
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export function RoleIntelligenceSection() {
  return (
    <Suspense fallback={<IntelligenceSkeleton />}>
      <IntelligenceContent />
    </Suspense>
  );
}
