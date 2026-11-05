"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { Activity, Building2, CheckCheck, ClipboardList, Gauge, History, Images, Loader2, Settings, UsersRound } from "lucide-react";
import { LiveStatusIndicator } from "@/components/ui/LiveStatusIndicator";
import { ActiveAssignedTaskCard } from "@/components/dashboard/ActiveAssignedTaskCard";
import { AttendanceSummaryWidget } from "@/components/dashboard/AttendanceSummaryWidget";
import { ShiftDock } from "@/components/dashboard/ShiftDock";
import { OperationalAuditTable } from "@/components/dashboard/OperationalAuditTable";
import type { WorkspaceNavTab } from "@/components/layout/MobileWorkspaceNav";
import { SharedWorkspaceShell } from "@/components/layout/SharedWorkspaceShell";
import { WorkspaceHeader } from "@/components/layout/WorkspaceHeader";
import { TaskDispatchClient } from "@/app/settings/TaskDispatchClient";
import { showActionToast } from "@/components/ui/ActionToast";
import type { getTaskDispatchData } from "@/app/settings/taskActions";
import { useWorkLogRealtimeRefresh } from "@/lib/useWorkLogRealtimeRefresh";
import {
  interveneHKActiveTask,
  getHKAdminAuditPage,
  updateHKRoomStatus,
  type HousekeepingDashboardData,
  type HousekeepingStatus,
} from "./actions";

type DashboardTab = "overview" | "operations" | "rooms" | "history" | "audit";
type DispatchData = Awaited<ReturnType<typeof getTaskDispatchData>>;

const TABS: { id: DashboardTab; label: string; icon: typeof Gauge }[] = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "operations", label: "Live Operations", icon: Activity },
  { id: "rooms", label: "Room Status & Inspection", icon: Building2 },
  { id: "history", label: "Work Logs & History", icon: ClipboardList },
  { id: "audit", label: "Audit", icon: History },
];
const WORKSPACE_TABS: readonly WorkspaceNavTab<DashboardTab>[] = TABS.map(({ id, label, icon: Icon }) => ({
  id,
  label: label === "Live Operations" ? "Live" : label === "Room Status & Inspection" ? "Rooms/Floors" : label === "Work Logs & History" ? "Logs" : label,
  Icon,
  tabButtonId: `hk-tab-${id}`,
  panelId: `hk-panel-${id}`,
}));

const STATUS_LABELS: Record<HousekeepingStatus, string> = {
  dirty: "Dirty",
  in_progress: "In Progress",
  inspect_ready: "Inspect / Ready",
  clean: "Clean",
};

const NEXT_STATUS: Record<HousekeepingStatus, HousekeepingStatus> = {
  dirty: "in_progress",
  in_progress: "inspect_ready",
  inspect_ready: "clean",
  clean: "dirty",
};

const STATUS_STYLES: Record<HousekeepingStatus, string> = {
  dirty: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200",
  in_progress: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200",
  inspect_ready: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-200",
  clean: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200",
};

function elapsed(startTime: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(startTime)) / 60_000));
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export default function HKAdminDashboardClient({
  data,
  dispatchData,
  intelligence,
  profile,
}: {
  data: HousekeepingDashboardData;
  dispatchData: DispatchData;
  intelligence: ReactNode;
  profile: { email: string; role: string };
}) {
  useWorkLogRealtimeRefresh();
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview");
  const [now, setNow] = useState(0);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null);
  const [intervention, setIntervention] = useState<{
    taskId: string;
    action: "force_complete_task" | "cancel_task";
    label: string;
  } | null>(null);
  const [reason, setReason] = useState("");
  const selectHKTab = (tab: DashboardTab) => {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState(window.history.state, "", url);
  };

  useEffect(() => {
    const syncFromUrl = () => {
      const url = new URL(window.location.href);
      const requestedTab = url.searchParams.get("tab");
      if (requestedTab && TABS.some((tab) => tab.id === requestedTab)) setActiveTab(requestedTab as DashboardTab);
      if (url.hash) {
        let attempts = 0;
        const scrollToAnchor = () => {
          const target = document.getElementById(decodeURIComponent(url.hash.slice(1)));
          if (target && target.getClientRects().length > 0) {
            target.scrollIntoView({ behavior: "smooth", block: "start" });
            target.classList.add("ring-2", "ring-sky-400", "ring-offset-2");
            window.setTimeout(() => target.classList.remove("ring-2", "ring-sky-400", "ring-offset-2"), 1800);
          } else if (attempts++ < 10) window.requestAnimationFrame(scrollToAnchor);
        };
        window.requestAnimationFrame(scrollToAnchor);
      }
    };
    syncFromUrl();
    window.addEventListener("help-center-navigate", syncFromUrl);
    window.addEventListener("popstate", syncFromUrl);
    return () => {
      window.removeEventListener("help-center-navigate", syncFromUrl);
      window.removeEventListener("popstate", syncFromUrl);
    };
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, []);

  const allRooms = data.hotels.flatMap((hotel) => hotel.rooms);
  const totalRooms = allRooms.length;
  const readyRooms = allRooms.filter((room) => room.housekeepingStatus === "clean" || room.housekeepingStatus === "inspect_ready").length;
  const pendingRooms = allRooms.filter((room) => room.housekeepingStatus === "dirty" || room.housekeepingStatus === "in_progress").length;

  const saveRoom = (roomId: string, status: HousekeepingStatus, notes: string) => startTransition(async () => {
    try {
      setFeedback(null);
      await updateHKRoomStatus(roomId, status, notes);
      setFeedback({ text: "Room status and inspection notes saved.", error: false });
      showActionToast("success", "Room status and inspection notes saved.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update this room.";
      setFeedback({ text: message, error: true });
      showActionToast("error", message);
    }
  });

  const submitIntervention = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!intervention) return;
    startTransition(async () => {
      try {
        await interveneHKActiveTask(intervention.taskId, intervention.action, reason);
        setFeedback({ text: `${intervention.label} recorded in the audit log.`, error: false });
        showActionToast("success", `${intervention.label} recorded in the audit log.`);
        setIntervention(null);
        setReason("");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to intervene on this task.";
        setFeedback({ text: message, error: true });
        showActionToast("error", message);
      }
    });
  };

  return (
    <main className="enterprise-dashboard theme-workspace min-h-screen bg-canvas pb-20 text-ink md:pb-0">
      <WorkspaceHeader
        name={data.userName}
        email={profile.email}
        role={profile.role}
        actions={<Link href="/settings" className="hidden min-h-10 items-center gap-2 rounded-xl border border-line bg-surface-secondary px-3 text-sm font-semibold text-ink-secondary transition-colors hover:border-accent hover:text-ink sm:inline-flex"><Settings className="h-4 w-4" /><span>Settings</span></Link>}
      />
      <SharedWorkspaceShell role="hk_admin" activeTab={activeTab} onSelect={selectHKTab} tabs={WORKSPACE_TABS} user={{ name: data.userName, email: profile.email, avatarUrl: null, role: profile.role }} />
      <div className="mx-auto max-w-[1600px] space-y-5 p-4 pb-[calc(env(safe-area-inset-bottom,0px)+5rem)] sm:p-6 md:ml-64 md:pb-6">
        {feedback && <p role={feedback.error ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-sm ${feedback.error ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"}`}>{feedback.text}</p>}

        <section id="hk-panel-overview" role="tabpanel" aria-labelledby="hk-tab-overview" hidden={activeTab !== "overview"} className="space-y-5">
          <AttendanceSummaryWidget {...data.attendance} />
          {data.activeTask && <ActiveAssignedTaskCard task={data.activeTask} />}
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Total rooms" value={totalRooms} icon={Building2} />
            <Metric label="Clean / ready" value={readyRooms} icon={CheckCheck} />
            <Metric label="Dirty / pending" value={pendingRooms} icon={ClipboardList} />
            <Metric label="Cleaners on shift" value={data.shifts.length} icon={UsersRound} />
          </section>
          {dispatchData && <TaskDispatchClient role="hk_admin" {...dispatchData} />}
          {intelligence}
          <section className="rounded-2xl border border-line bg-surface p-4 text-ink shadow-sm sm:p-5">
            <h2 className="text-lg font-bold">Property snapshot</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.hotels.map((hotel) => {
                const propertyRooms = hotel.rooms;
                const ready = propertyRooms.filter((room) => room.housekeepingStatus === "clean" || room.housekeepingStatus === "inspect_ready").length;
                return <article key={hotel.id} className="rounded-xl border border-line bg-surface-secondary p-4 text-ink">
                  <h3 className="font-semibold">{hotel.name}</h3>
                  <p className="mt-1 text-sm text-ink-secondary">{propertyRooms.length} rooms · {ready} clean or ready · {propertyRooms.length - ready} pending</p>
                  <button type="button" onClick={() => selectHKTab("rooms")} className="mt-3 text-sm font-semibold text-accent hover:underline">Inspect rooms</button>
                </article>;
              })}
              {!data.hotels.length && <p className="text-sm text-ink-secondary">No active assigned properties are available.</p>}
            </div>
          </section>
        </section>

        <section id="hk-panel-operations" role="tabpanel" aria-labelledby="hk-tab-operations" hidden={activeTab !== "operations"} className="space-y-5">
          <ShiftDock role="hk_admin" properties={data.hotels} hasActiveTask={Boolean(data.activeTask)} visible={activeTab === "operations"} />
          <section id="operations-live" className="scroll-mt-24 rounded-2xl border border-line bg-surface p-4 text-ink shadow-sm sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">Live status</p><h2 className="mt-1 text-xl font-bold">Cleaner operations</h2><p className="mt-1 text-sm text-ink-secondary">{data.shifts.length} cleaner{data.shifts.length === 1 ? "" : "s"} clocked in across your assigned properties.</p></div>
              <Activity className="h-5 w-5 text-emerald-700" />
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.shifts.map((shift) => (
                <article key={shift.id} className="rounded-xl border border-emerald-100 bg-emerald-50/30 p-4">
                  <h3 className="font-semibold">{shift.cleanerName}</h3>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                    <LiveStatusIndicator isClockedIn />
                    <span className="text-ink-secondary">Shift · {elapsed(shift.start_time, now)}</span>
                  </div>
                  {shift.task ? (
                    <div className="mt-3 rounded-lg border border-line bg-surface-secondary p-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-ink-secondary">Running task</p>
                      <p className="mt-1 text-sm font-semibold">{shift.task.hotelName} · {shift.task.service_name_snapshot ?? "Cleaning task"}</p>
                      <p className="mt-1 text-xs text-ink-secondary">
                        {shift.task.room_numbers?.length ? `Room ${shift.task.room_numbers.join(", ")}` : shift.task.room_number ? `Room ${shift.task.room_number}` : "No room assigned"} · {elapsed(shift.task.start_time, now)}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" disabled={isPending} onClick={() => { setReason(""); setFeedback(null); setIntervention({ taskId: shift.task!.id, action: "force_complete_task", label: "Complete task" }); }} className="min-h-10 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-700 dark:text-emerald-200 disabled:opacity-50">Complete task</button>
                        <button type="button" disabled={isPending} onClick={() => { setReason(""); setFeedback(null); setIntervention({ taskId: shift.task!.id, action: "cancel_task", label: "Cancel task" }); }} className="min-h-10 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 text-xs font-semibold text-rose-700 dark:text-rose-200 disabled:opacity-50">Cancel task</button>
                      </div>
                    </div>
                  ) : <p className="mt-3 rounded-lg border border-line bg-surface-secondary px-3 py-2 text-sm text-ink-secondary">No active task.</p>}
                </article>
              ))}
              {!data.shifts.length && <p className="rounded-xl border border-dashed border-line p-6 text-sm text-ink-secondary md:col-span-2 xl:col-span-3">No cleaners are currently clocked in.</p>}
            </div>
          </section>
          <EvidenceGallery items={data.evidence} />
        </section>

        <section id="hk-panel-rooms" role="tabpanel" aria-labelledby="hk-tab-rooms" hidden={activeTab !== "rooms"} className="space-y-5">
          <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Floor inspection</p><h2 className="mt-1 text-xl font-bold">Room status & inspection</h2><p className="mt-1 text-sm text-ink-secondary">Progress each room through Dirty → In Progress → Inspect / Ready → Clean.</p></div>
          {data.hotels.map((hotel) => {
            const sections = [...new Set([...hotel.floors, ...hotel.rooms.map((room) => room.floor)])];
            return <section key={hotel.id} className="rounded-2xl border border-line bg-surface p-4 text-ink shadow-sm sm:p-5">
              <h3 className="text-lg font-bold">{hotel.name}</h3>
              {sections.map((section) => {
                const rooms = hotel.rooms.filter((room) => room.floor === section);
                if (!rooms.length) return null;
                return <div key={section} className="mt-5">
                  <h4 className="border-b border-line pb-2 text-sm font-semibold text-ink-secondary">{section}</h4>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {rooms.map((room) => <RoomStatusCard key={`${room.id}:${room.inspectionNotes}`} room={room} isPending={isPending} onSave={saveRoom} />)}
                  </div>
                </div>;
              })}
              {!hotel.rooms.length && <p className="mt-3 text-sm text-ink-secondary">No active rooms are configured for this property.</p>}
            </section>;
          })}
          <EvidenceGallery items={data.evidence} />
        </section>

        <section id="hk-panel-history" role="tabpanel" aria-labelledby="hk-tab-history" hidden={activeTab !== "history"} className="space-y-5">
          <section className="overflow-hidden rounded-2xl border border-line bg-surface text-ink shadow-sm">
            <div className="border-b border-line p-4 sm:p-5"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Assigned properties</p><h2 className="mt-1 text-xl font-bold">Completed work logs</h2><p className="mt-1 text-sm text-ink-secondary">Recent task and shift history. Payroll and labor-rate details are not shown.</p></div>
            <div className="overflow-x-auto">
              <table className="min-w-[760px] w-full text-left text-sm">
                <thead className="bg-surface-secondary text-xs uppercase tracking-wide text-ink-secondary"><tr><th className="px-4 py-3">Completed</th><th className="px-4 py-3">Cleaner</th><th className="px-4 py-3">Property</th><th className="px-4 py-3">Task</th><th className="px-4 py-3">Rooms</th><th className="px-4 py-3">Duration</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {data.logs.map((log) => <tr key={log.id}>
                    <td className="whitespace-nowrap px-4 py-3">{new Date(log.task_date + "T12:00:00").toLocaleDateString()}</td>
                    <td className="px-4 py-3">{log.cleanerName}</td><td className="px-4 py-3">{log.hotelName}</td><td className="px-4 py-3"><span className="mr-2 rounded-full bg-surface-secondary px-2 py-1 text-[10px] font-semibold text-ink-secondary">{log.activityType}</span>{log.serviceName}</td>
                    <td className="px-4 py-3">{log.room_numbers?.length ? log.room_numbers.join(", ") : log.room_number ?? "—"}</td>
                    <td className="px-4 py-3">{log.end_time ? elapsed(log.start_time, Date.parse(log.end_time)) : "—"}</td>
                  </tr>)}
                  {!data.logs.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-ink-secondary">No completed work logs for assigned properties.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
          <EvidenceGallery items={data.evidence} />
        </section>
      </div>

      {activeTab === "audit" && <div className="mx-auto max-w-[1600px] px-4 sm:px-6"><OperationalAuditTable loadPage={getHKAdminAuditPage} /></div>}

      {intervention && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="hk-intervention-title">
        <form onSubmit={submitIntervention} className="w-full max-w-lg rounded-2xl border border-line bg-surface-elevated p-5 text-ink shadow-2xl">
          <h2 id="hk-intervention-title" className="text-lg font-bold">{intervention.label}?</h2>
          <p className="mt-1 text-sm text-ink-secondary">This action will end the active task and be recorded in the audit log.</p>
          <label className="mt-4 block text-sm font-medium text-ink-secondary">Audit reason
            <textarea required minLength={5} maxLength={1000} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1.5 w-full rounded-lg border border-line bg-surface-secondary px-3 py-2 text-ink placeholder:text-ink-muted focus:border-accent focus:ring-1 focus:ring-accent" placeholder="Explain why this intervention is needed" />
          </label>
          {feedback?.error && <p role="alert" className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-200">{feedback.text}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" disabled={isPending} onClick={() => { setIntervention(null); setFeedback(null); }} className="min-h-11 rounded-lg border border-line bg-surface-secondary px-4 text-sm font-semibold text-ink-secondary">Cancel</button>
            <button type="submit" disabled={isPending || reason.trim().length < 5} className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-white disabled:opacity-50">{isPending ? "Saving…" : "Confirm"}</button>
          </div>
        </form>
      </div>}
    </main>
  );
}

function Metric({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Gauge }) {
  return <article className="rounded-2xl border border-line bg-surface p-4 text-ink shadow-sm">
    <div className="flex items-center justify-between"><span className="text-sm font-medium text-ink-secondary">{label}</span><Icon className="h-5 w-5 text-accent" /></div>
    <p className="mt-2 text-3xl font-bold text-ink">{value}</p>
  </article>;
}

function RoomStatusCard({
  room,
  isPending,
  onSave,
}: {
  room: HousekeepingDashboardData["hotels"][number]["rooms"][number];
  isPending: boolean;
  onSave: (roomId: string, status: HousekeepingStatus, notes: string) => void;
}) {
  const [notes, setNotes] = useState(room.inspectionNotes);

  return <article className="rounded-xl border border-line bg-surface p-3 text-ink">
    <div className="flex items-start justify-between gap-2">
      <div><h5 className="font-bold text-ink">{room.name}</h5><p className="text-xs text-ink-secondary">{room.floor} · {room.category || "Room"} · {room.availabilityStatus.replace("_", " ")}</p></div>
      <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${STATUS_STYLES[room.housekeepingStatus]}`}>{STATUS_LABELS[room.housekeepingStatus]}</span>
    </div>
    <label className="mt-3 block text-xs font-medium text-ink-secondary">Inspection notes
      <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} rows={2} className="mt-1 w-full rounded-lg border border-line bg-surface-secondary px-2 py-1.5 text-sm text-ink placeholder:text-ink-muted focus:border-accent focus:ring-1 focus:ring-accent" placeholder="Add inspection notes" />
    </label>
    <div className="mt-2 flex gap-2">
      <button type="button" disabled={isPending} onClick={() => onSave(room.id, NEXT_STATUS[room.housekeepingStatus], notes)} className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-2 text-xs font-semibold text-white disabled:opacity-50">{isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Mark {STATUS_LABELS[NEXT_STATUS[room.housekeepingStatus]]}</button>
      {notes !== room.inspectionNotes && <button type="button" disabled={isPending} onClick={() => onSave(room.id, room.housekeepingStatus, notes)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-surface-secondary px-2 text-xs font-semibold text-ink-secondary disabled:opacity-50">{isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Save notes</button>}
    </div>
  </article>;
}

function EvidenceGallery({ items }: { items: HousekeepingDashboardData["evidence"] }) {
  return <section className="rounded-2xl border border-line bg-surface p-4 text-ink shadow-sm sm:p-5">
    <div className="flex items-center gap-2"><Images className="h-5 w-5 text-accent" /><div><h2 className="font-bold">Task photo review</h2><p className="text-xs text-ink-secondary">Evidence attached to recent work logs.</p></div></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((item) => <a key={item.id} href={item.signedUrl} target="_blank" rel="noreferrer" className="overflow-hidden rounded-xl border border-line bg-surface-secondary hover:border-accent">
        {item.mediaType === "image"
          ? <Image src={item.signedUrl} alt={`${item.roomName} inspection attachment`} width={480} height={320} unoptimized className="h-40 w-full object-cover" />
          : <video src={item.signedUrl} controls className="h-40 w-full bg-slate-950 object-contain" />}
        <span className="block p-3"><span className="block truncate text-sm font-semibold text-ink">{item.roomName} · {item.originalName}</span><span className="mt-1 block text-xs text-ink-secondary">{item.cleanerName} · {new Date(item.createdAt).toLocaleString()}</span></span>
      </a>)}
      {!items.length && <p className="text-sm text-ink-secondary">No task photo attachments are available yet.</p>}
    </div>
  </section>;
}
