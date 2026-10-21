"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Activity, Building2, CheckCheck, ClipboardList, Gauge, Images, Settings, UsersRound } from "lucide-react";
import { LiveStatusIndicator } from "@/components/ui/LiveStatusIndicator";
import { NotificationBell } from "@/components/chat/NotificationBell";
import { ActiveAssignedTaskCard } from "@/components/dashboard/ActiveAssignedTaskCard";
import { TaskDispatchClient } from "@/app/settings/TaskDispatchClient";
import type { getTaskDispatchData } from "@/app/settings/taskActions";
import { useWorkLogRealtimeRefresh } from "@/lib/useWorkLogRealtimeRefresh";
import {
  interveneHKActiveTask,
  updateHKRoomStatus,
  type HousekeepingDashboardData,
  type HousekeepingStatus,
} from "./actions";

type DashboardTab = "overview" | "operations" | "rooms" | "history";
type DispatchData = Awaited<ReturnType<typeof getTaskDispatchData>>;

const TABS: { id: DashboardTab; label: string; icon: typeof Gauge }[] = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "operations", label: "Live Operations", icon: Activity },
  { id: "rooms", label: "Room Status & Inspection", icon: Building2 },
  { id: "history", label: "Work Logs & History", icon: ClipboardList },
];

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
  dirty: "border-rose-200 bg-rose-50 text-rose-800",
  in_progress: "border-amber-200 bg-amber-50 text-amber-800",
  inspect_ready: "border-sky-200 bg-sky-50 text-sky-800",
  clean: "border-emerald-200 bg-emerald-50 text-emerald-800",
};

function elapsed(startTime: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(startTime)) / 60_000));
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export default function HKAdminDashboardClient({
  data,
  dispatchData,
}: {
  data: HousekeepingDashboardData;
  dispatchData: DispatchData;
}) {
  useWorkLogRealtimeRefresh();
  const router = useRouter();
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
      router.refresh();
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : "Unable to update this room.", error: true });
    }
  });

  const submitIntervention = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!intervention) return;
    startTransition(async () => {
      try {
        await interveneHKActiveTask(intervention.taskId, intervention.action, reason);
        setFeedback({ text: `${intervention.label} recorded in the audit log.`, error: false });
        setIntervention(null);
        setReason("");
        router.refresh();
      } catch (error) {
        setFeedback({ text: error instanceof Error ? error.message : "Unable to intervene on this task.", error: true });
      }
    });
  };

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-700">Housekeeping workspace</p>
            <h1 className="text-lg font-bold">Operations · {data.userName}</h1>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <Link href="/settings" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <Settings className="h-4 w-4" /> <span className="hidden sm:inline">Profile & Settings</span>
            </Link>
          </div>
        </div>
        <nav aria-label="Housekeeping dashboard tabs" role="tablist" className="mx-auto flex max-w-[1600px] gap-1 overflow-x-auto border-t border-slate-100 px-3 py-2 sm:px-6">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} id={`hk-tab-${id}`} type="button" role="tab" aria-selected={activeTab === id} aria-controls={`hk-panel-${id}`} onClick={() => setActiveTab(id)} className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold sm:text-sm ${activeTab === id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
              <Icon className="h-4 w-4" />{label}
            </button>
          ))}
        </nav>
      </header>
      <div className="mx-auto max-w-[1600px] space-y-5 p-4 sm:p-6">
        {feedback && <p role={feedback.error ? "alert" : "status"} className={`rounded-xl border px-4 py-3 text-sm ${feedback.error ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{feedback.text}</p>}

        <section id="hk-panel-overview" role="tabpanel" aria-labelledby="hk-tab-overview" hidden={activeTab !== "overview"} className="space-y-5">
          {data.activeTask && <ActiveAssignedTaskCard task={data.activeTask} />}
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Total rooms" value={totalRooms} icon={Building2} />
            <Metric label="Clean / ready" value={readyRooms} icon={CheckCheck} />
            <Metric label="Dirty / pending" value={pendingRooms} icon={ClipboardList} />
            <Metric label="Cleaners on shift" value={data.shifts.length} icon={UsersRound} />
          </section>
          {dispatchData && <TaskDispatchClient role="hk_admin" {...dispatchData} />}
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <h2 className="text-lg font-bold">Property snapshot</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.hotels.map((hotel) => {
                const propertyRooms = hotel.rooms;
                const ready = propertyRooms.filter((room) => room.housekeepingStatus === "clean" || room.housekeepingStatus === "inspect_ready").length;
                return <article key={hotel.id} className="rounded-xl border border-slate-200 p-4">
                  <h3 className="font-semibold">{hotel.name}</h3>
                  <p className="mt-1 text-sm text-slate-600">{propertyRooms.length} rooms · {ready} clean or ready · {propertyRooms.length - ready} pending</p>
                  <button type="button" onClick={() => setActiveTab("rooms")} className="mt-3 text-sm font-semibold text-indigo-700 hover:underline">Inspect rooms</button>
                </article>;
              })}
              {!data.hotels.length && <p className="text-sm text-slate-600">No active assigned properties are available.</p>}
            </div>
          </section>
        </section>

        <section id="hk-panel-operations" role="tabpanel" aria-labelledby="hk-tab-operations" hidden={activeTab !== "operations"} className="space-y-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Live status</p><h2 className="mt-1 text-xl font-bold">Cleaner operations</h2><p className="mt-1 text-sm text-slate-600">{data.shifts.length} cleaner{data.shifts.length === 1 ? "" : "s"} clocked in across your assigned properties.</p></div>
              <Activity className="h-5 w-5 text-emerald-700" />
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.shifts.map((shift) => (
                <article key={shift.id} className="rounded-xl border border-emerald-100 bg-emerald-50/30 p-4">
                  <h3 className="font-semibold">{shift.cleanerName}</h3>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                    <LiveStatusIndicator isClockedIn />
                    <span className="text-slate-600">Shift · {elapsed(shift.start_time, now)}</span>
                  </div>
                  {shift.task ? (
                    <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Running task</p>
                      <p className="mt-1 text-sm font-semibold">{shift.task.hotelName} · {shift.task.service_name_snapshot ?? "Cleaning task"}</p>
                      <p className="mt-1 text-xs text-slate-600">
                        {shift.task.room_numbers?.length ? `Room ${shift.task.room_numbers.join(", ")}` : shift.task.room_number ? `Room ${shift.task.room_number}` : "No room assigned"} · {elapsed(shift.task.start_time, now)}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" disabled={isPending} onClick={() => { setReason(""); setFeedback(null); setIntervention({ taskId: shift.task!.id, action: "force_complete_task", label: "Complete task" }); }} className="min-h-10 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-800 disabled:opacity-50">Complete task</button>
                        <button type="button" disabled={isPending} onClick={() => { setReason(""); setFeedback(null); setIntervention({ taskId: shift.task!.id, action: "cancel_task", label: "Cancel task" }); }} className="min-h-10 rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 disabled:opacity-50">Cancel task</button>
                      </div>
                    </div>
                  ) : <p className="mt-3 rounded-lg bg-white px-3 py-2 text-sm text-slate-600">No active task.</p>}
                </article>
              ))}
              {!data.shifts.length && <p className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-slate-600 md:col-span-2 xl:col-span-3">No cleaners are currently clocked in.</p>}
            </div>
          </section>
          <EvidenceGallery items={data.evidence} />
        </section>

        <section id="hk-panel-rooms" role="tabpanel" aria-labelledby="hk-tab-rooms" hidden={activeTab !== "rooms"} className="space-y-5">
          <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-700">Floor inspection</p><h2 className="mt-1 text-xl font-bold">Room status & inspection</h2><p className="mt-1 text-sm text-slate-600">Progress each room through Dirty → In Progress → Inspect / Ready → Clean.</p></div>
          {data.hotels.map((hotel) => {
            const sections = [...new Set([...hotel.floors, ...hotel.rooms.map((room) => room.floor)])];
            return <section key={hotel.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <h3 className="text-lg font-bold">{hotel.name}</h3>
              {sections.map((section) => {
                const rooms = hotel.rooms.filter((room) => room.floor === section);
                if (!rooms.length) return null;
                return <div key={section} className="mt-5">
                  <h4 className="border-b border-slate-100 pb-2 text-sm font-semibold text-slate-700">{section}</h4>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {rooms.map((room) => <RoomStatusCard key={`${room.id}:${room.inspectionNotes}`} room={room} isPending={isPending} onSave={saveRoom} />)}
                  </div>
                </div>;
              })}
              {!hotel.rooms.length && <p className="mt-3 text-sm text-slate-600">No active rooms are configured for this property.</p>}
            </section>;
          })}
          <EvidenceGallery items={data.evidence} />
        </section>

        <section id="hk-panel-history" role="tabpanel" aria-labelledby="hk-tab-history" hidden={activeTab !== "history"} className="space-y-5">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 p-4 sm:p-5"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-700">Assigned properties</p><h2 className="mt-1 text-xl font-bold">Completed work logs</h2><p className="mt-1 text-sm text-slate-600">Recent task and shift history. Payroll and labor-rate details are not shown.</p></div>
            <div className="overflow-x-auto">
              <table className="min-w-[760px] w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Completed</th><th className="px-4 py-3">Cleaner</th><th className="px-4 py-3">Property</th><th className="px-4 py-3">Task</th><th className="px-4 py-3">Rooms</th><th className="px-4 py-3">Duration</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {data.logs.map((log) => <tr key={log.id}>
                    <td className="whitespace-nowrap px-4 py-3">{new Date(log.task_date + "T12:00:00").toLocaleDateString()}</td>
                    <td className="px-4 py-3">{log.cleanerName}</td><td className="px-4 py-3">{log.hotelName}</td><td className="px-4 py-3"><span className="mr-2 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-700">{log.activityType}</span>{log.serviceName}</td>
                    <td className="px-4 py-3">{log.room_numbers?.length ? log.room_numbers.join(", ") : log.room_number ?? "—"}</td>
                    <td className="px-4 py-3">{log.end_time ? elapsed(log.start_time, Date.parse(log.end_time)) : "—"}</td>
                  </tr>)}
                  {!data.logs.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">No completed work logs for assigned properties.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
          <EvidenceGallery items={data.evidence} />
        </section>
      </div>

      {intervention && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-labelledby="hk-intervention-title">
        <form onSubmit={submitIntervention} className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
          <h2 id="hk-intervention-title" className="text-lg font-bold">{intervention.label}?</h2>
          <p className="mt-1 text-sm text-slate-600">This action will end the active task and be recorded in the audit log.</p>
          <label className="mt-4 block text-sm font-medium text-slate-700">Audit reason
            <textarea required minLength={5} maxLength={1000} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2" placeholder="Explain why this intervention is needed" />
          </label>
          {feedback?.error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{feedback.text}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" disabled={isPending} onClick={() => { setIntervention(null); setFeedback(null); }} className="min-h-11 rounded-lg border border-slate-200 px-4 text-sm font-semibold">Cancel</button>
            <button type="submit" disabled={isPending || reason.trim().length < 5} className="min-h-11 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-50">{isPending ? "Saving…" : "Confirm"}</button>
          </div>
        </form>
      </div>}
    </main>
  );
}

function Metric({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Gauge }) {
  return <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex items-center justify-between"><span className="text-sm font-medium text-slate-600">{label}</span><Icon className="h-5 w-5 text-indigo-700" /></div>
    <p className="mt-2 text-3xl font-bold text-slate-950">{value}</p>
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

  return <article className="rounded-xl border border-slate-200 p-3">
    <div className="flex items-start justify-between gap-2">
      <div><h5 className="font-bold">{room.name}</h5><p className="text-xs text-slate-500">{room.floor} · {room.category || "Room"} · {room.availabilityStatus.replace("_", " ")}</p></div>
      <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${STATUS_STYLES[room.housekeepingStatus]}`}>{STATUS_LABELS[room.housekeepingStatus]}</span>
    </div>
    <label className="mt-3 block text-xs font-medium text-slate-600">Inspection notes
      <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} rows={2} className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-900" placeholder="Add inspection notes" />
    </label>
    <div className="mt-2 flex gap-2">
      <button type="button" disabled={isPending} onClick={() => onSave(room.id, NEXT_STATUS[room.housekeepingStatus], notes)} className="min-h-9 flex-1 rounded-lg bg-slate-900 px-2 text-xs font-semibold text-white disabled:opacity-50">Mark {STATUS_LABELS[NEXT_STATUS[room.housekeepingStatus]]}</button>
      {notes !== room.inspectionNotes && <button type="button" disabled={isPending} onClick={() => onSave(room.id, room.housekeepingStatus, notes)} className="min-h-9 rounded-lg border border-slate-200 px-2 text-xs font-semibold disabled:opacity-50">Save notes</button>}
    </div>
  </article>;
}

function EvidenceGallery({ items }: { items: HousekeepingDashboardData["evidence"] }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
    <div className="flex items-center gap-2"><Images className="h-5 w-5 text-indigo-700" /><div><h2 className="font-bold">Task photo review</h2><p className="text-xs text-slate-500">Evidence attached to recent work logs.</p></div></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((item) => <a key={item.id} href={item.signedUrl} target="_blank" rel="noreferrer" className="overflow-hidden rounded-xl border border-slate-200 hover:border-indigo-300">
        {item.mediaType === "image"
          ? <Image src={item.signedUrl} alt={`${item.roomName} inspection attachment`} width={480} height={320} unoptimized className="h-40 w-full object-cover" />
          : <video src={item.signedUrl} controls className="h-40 w-full bg-slate-950 object-contain" />}
        <span className="block p-3"><span className="block truncate text-sm font-semibold">{item.roomName} · {item.originalName}</span><span className="mt-1 block text-xs text-slate-500">{item.cleanerName} · {new Date(item.createdAt).toLocaleString()}</span></span>
      </a>)}
      {!items.length && <p className="text-sm text-slate-500">No task photo attachments are available yet.</p>}
    </div>
  </section>;
}
