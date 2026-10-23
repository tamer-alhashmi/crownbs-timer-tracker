import { Suspense } from "react";
import { Activity, Building2, CircleHelp, UsersRound } from "lucide-react";
import { getSessionUser } from "@/lib/auth";
import { getRoleScopedIntelligenceData, type IntelligenceViewer } from "@/lib/roleIntelligence";
import type { UserRole } from "@/lib/roles";

function isIntelligenceRole(role: UserRole): role is IntelligenceViewer["role"] {
  return role === "admin" || role === "owner" || role === "manager" || role === "hk_admin";
}

function IntelligenceSkeleton() {
  return (
    <section aria-label="Loading intelligence" className="min-h-[430px] space-y-4 rounded-3xl border border-slate-200 bg-slate-50 p-4 sm:p-6">
      <div className="h-7 w-64 animate-pulse rounded-lg bg-slate-200" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-32 animate-pulse rounded-2xl bg-white ring-1 ring-slate-200" />)}
      </div>
      <div className="h-52 animate-pulse rounded-2xl bg-white ring-1 ring-slate-200" />
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
  const isAdmin = session.role === "admin";
  const maximumActivity = Math.max(
    1,
    ...(isAdmin
      ? (data.tenants ?? []).map((tenant) => tenant.completedTasks)
      : data.performers.map((performer) => performer.completedTasks))
  );
  const icons = [Building2, UsersRound, Activity, CircleHelp];

  return (
    <section aria-labelledby="role-intelligence-heading" className="space-y-4 rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-sky-50/50 p-4 shadow-sm sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-sky-700">Intelligence &amp; performance</p>
          <h2 id="role-intelligence-heading" className="mt-1 text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">{data.title}</h2>
          <p className="mt-1 text-sm text-slate-600">{data.subtitle}</p>
        </div>
        <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600">{data.periodLabel}</span>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.kpis.map((kpi, index) => {
          const Icon = icons[index % icons.length];
          return (
            <article key={kpi.label} title={kpi.detail} className="min-h-32 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{kpi.label}</p>
                  <p className="mt-2 text-2xl font-bold tracking-tight text-slate-950">{kpi.value}</p>
                </div>
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-sky-50 text-sky-700"><Icon className="h-5 w-5" /></span>
              </div>
              <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-slate-500">
                <CircleHelp aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />{kpi.detail}
              </p>
            </article>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {isAdmin ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 sm:px-5">
              <div>
                <h3 className="font-semibold text-slate-950">Tenant / Owner consumption</h3>
                <p className="mt-0.5 text-xs text-slate-500">Portfolio scale, assigned workforce, and completed work logs over the last 30 days.</p>
              </div>
              <span className="text-xs font-medium text-slate-500">{(data.tenants ?? []).length} tenants</span>
            </div>
            {!data.tenants?.length ? (
              <div className="px-6 py-10 text-center">
                <Building2 className="mx-auto h-9 w-9 text-slate-300" />
                <h4 className="mt-3 font-semibold text-slate-800">No owner accounts yet</h4>
                <p className="mt-1 text-sm text-slate-500">Owner portfolios and usage will appear here as tenants are added.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {data.tenants.map((tenant) => {
                  const score = Math.round((tenant.completedTasks / maximumActivity) * 100);
                  return (
                    <article key={tenant.id} className="grid gap-3 p-4 transition hover:bg-slate-50/80 sm:grid-cols-[minmax(220px,1.2fr)_minmax(170px,.9fr)_minmax(180px,1fr)_minmax(120px,.7fr)] sm:items-center sm:px-5">
                      <div className="flex min-w-0 items-center gap-3">
                        <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-bold text-white">{initials(tenant.name)}</span>
                        <div className="min-w-0">
                          <h4 className="truncate font-semibold text-slate-950">{tenant.name}</h4>
                          <p className="truncate text-xs text-slate-500">{tenant.email ?? "No email on file"}</p>
                          <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${tenant.isActive ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
                            {tenant.isActive ? "Active" : "Idle / Setup Needed"}
                          </span>
                        </div>
                      </div>
                      <div className="text-xs">
                        <p className="font-semibold text-slate-800">Portfolio</p>
                        <p className="mt-1 text-slate-600">{tenant.propertyCount} {tenant.propertyCount === 1 ? "property" : "properties"} · {tenant.roomCount.toLocaleString()} rooms</p>
                      </div>
                      <div className="text-xs">
                        <p className="font-semibold text-slate-800">Assigned workforce</p>
                        <p className="mt-1 text-slate-600">{tenant.managerCount} {tenant.managerCount === 1 ? "manager" : "managers"} · {tenant.cleanerCount} {tenant.cleanerCount === 1 ? "cleaner" : "cleaners"}</p>
                      </div>
                      <div>
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-semibold text-slate-700">{tenant.completedTasks} completed</span>
                          <span className="text-slate-500">{score}%</span>
                        </div>
                        <div role="progressbar" aria-label={`${tenant.name} relative 30-day work log consumption`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={score} className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-500 transition-all" style={{ width: `${score}%` }} />
                        </div>
                        <p className="mt-1.5 text-xs font-medium text-slate-600">{timeAgo(tenant.lastActiveAt)}</p>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 sm:px-5">
              <div>
                <h3 className="font-semibold text-slate-950">Ranked team performance</h3>
                <p className="mt-0.5 text-xs text-slate-500">Team members ranked by completed work logs, then shifts, in the last 30 days.</p>
              </div>
              <span className="text-xs font-medium text-slate-500">Top {data.performers.length}</span>
            </div>
            {!data.performers.length ? (
              <div className="px-6 py-10 text-center">
                <UsersRound className="mx-auto h-9 w-9 text-slate-300" />
                <h4 className="mt-3 font-semibold text-slate-800">No recent team activity</h4>
                <p className="mt-1 text-sm text-slate-500">Assigned team performance will appear here as work logs and shifts are recorded.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {data.performers.map((performer, index) => {
                  const score = Math.round((performer.completedTasks / maximumActivity) * 100);
                  return (
                    <article key={performer.id} className="grid gap-3 p-4 transition hover:bg-slate-50/80 sm:grid-cols-[minmax(220px,1.2fr)_minmax(180px,1fr)_minmax(160px,.8fr)] sm:items-center sm:px-5">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs font-bold text-slate-500">{index + 1}</span>
                        <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-bold text-white">{initials(performer.name)}</span>
                        <div className="min-w-0">
                          <h4 className="truncate font-semibold text-slate-950">{performer.name}</h4>
                          <p className="text-xs capitalize text-slate-500">{performer.role.replaceAll("_", " ")}</p>
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span className="font-semibold text-slate-700">{performer.completedTasks} completed tasks</span>
                          <span className="text-slate-500">{performer.shifts} shifts</span>
                        </div>
                        <div role="progressbar" aria-label={`${performer.name} relative completed task activity`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={score} className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-500 transition-all" style={{ width: `${score}%` }} />
                        </div>
                      </div>
                      <p className="text-xs font-medium text-slate-600 sm:text-right">{timeAgo(performer.lastActiveAt)}</p>
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
