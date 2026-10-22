"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BedDouble, BriefcaseBusiness, CalendarDays, Clock3, FileText, MapPin, Pencil, Wrench, ClipboardList } from "lucide-react";
import { clockIn, clockOut, endTask, startTask, switchHotel, updateTask } from "./actions";
import { UserProfileMenu } from "@/components/layout/UserProfileMenu";
import { LiveStatusIndicator } from "@/components/ui/LiveStatusIndicator";
import { OperationalBrief } from "@/components/dashboard/OperationalBrief";
import { DashboardPagination } from "@/components/dashboard/DashboardPagination";
import { ServiceCard } from "@/components/dashboard/ServiceCard";
import type { BriefTask, CleanerBrief } from "@/lib/operationalBrief";
import { calculateTaskCost, resolveBillingUnit, resolveServiceRate } from "@/lib/servicePricing";
import { useWorkLogRealtimeRefresh } from "@/lib/useWorkLogRealtimeRefresh";
import { showActionToast } from "@/components/ui/ActionToast";
import { RoomMediaCapture } from "./RoomMediaCapture";
import { getWorkLogRoomMedia, type RoomMediaGalleryItem, type RoomMediaItem } from "./roomMediaActions";

type HotelRecord = { id: string; name: string; location: string };
type ServiceRecord = { id: string; name: string; default_rate: number; unit: string; description: string };
type RoomRecord = { id: string; hotel_id: string; room_name: string; category: string; floor_section: string | null };
type Shift = { id: string; start_time: string; end_time: string | null; status: "active" | "completed" } | null;
type WorkLog = {
  id: string;
  shift_id: string | null;
  hotel_id: string;
  service_id: string;
  start_time: string;
  end_time: string | null;
  task_date: string;
  room_ids: string[];
  status: "assigned" | "active" | "completed";
  rooms_completed: number;
  room_number: string | null;
  room_numbers: string[];
  notes: string | null;
  cost_override?: number | string | null;
  manager_id: string | null;
  manager_name: string | null;
  owner_id: string | null;
  owner_name: string | null;
  responsibility_recorded_at: string | null;
  manager_approved: boolean;
  owner_approved: boolean;
  is_locked: boolean;
  hotelName: string;
  serviceName: string;
  serviceDescription: string;
  serviceRate: number;
  serviceUnit: string;
};
type Props = {
  user: { fullName: string; email: string; hotelId: string | null; avatarUrl: string | null };
  hotels: HotelRecord[];
  services: ServiceRecord[];
  rooms: RoomRecord[];
  shift: Shift;
  logs: WorkLog[];
  brief: CleanerBrief;
  roomMedia: RoomMediaItem[];
  roomMediaConfigured: boolean;
};

const PAGE_SIZE = 30;
const dateLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { timeZone: "Europe/London", dateStyle: "medium" });

function submissionIcon(serviceName: string) {
  if (/maintenance|repair/i.test(serviceName)) return Wrench;
  if (/room|housekeep|clean/i.test(serviceName)) return BedDouble;
  return ClipboardList;
}

export default function CleanerDashboard({ user, hotels, services, rooms, shift, logs, brief, roomMedia, roomMediaConfigured }: Props) {
  useWorkLogRealtimeRefresh();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<"operations" | "history">("operations");
  const activeTask = logs.find((log) => log.status === "active");
  const [hotelId, setHotelId] = useState(activeTask?.hotel_id ?? user.hotelId ?? hotels[0]?.id ?? "");
  const [serviceId, setServiceId] = useState(activeTask?.service_id ?? services[0]?.id ?? "");
  const [roomIds, setRoomIds] = useState<string[]>(() => activeTask?.room_ids?.length ? activeTask.room_ids : activeTask ? rooms.filter((room) => room.hotel_id === activeTask.hotel_id && activeTask.room_numbers.includes(room.room_name)).map((room) => room.id) : []);
  const [roomSearch, setRoomSearch] = useState("");
  const [notes, setNotes] = useState(activeTask?.notes ?? "");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [persistedEditingRoomIds, setPersistedEditingRoomIds] = useState<string[]>([]);
  const [editingMedia, setEditingMedia] = useState<RoomMediaGalleryItem[]>([]);
  const [editingMediaLoading, setEditingMediaLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const [selectedTask, setSelectedTask] = useState<BriefTask | null>(null);
  const effectiveServiceId = services.some((service) => service.id === serviceId) ? serviceId : services[0]?.id ?? "";
  const selectedService = services.find((service) => service.id === effectiveServiceId);
  const editRoomSelectionSaved = !editingId || persistedEditingRoomIds.length === roomIds.length && persistedEditingRoomIds.every((id) => roomIds.includes(id));
  const hotelRooms = rooms.filter((room) => room.hotel_id === hotelId);
  const selectedRooms = hotelRooms.filter((room) => roomIds.includes(room.id));
  const visibleHotelRooms = hotelRooms.filter((room) => `${room.room_name} ${room.category} ${room.floor_section ?? ""}`.toLowerCase().includes(roomSearch.trim().toLowerCase()));
  const requiresRooms = selectedService?.unit === "per_room" || /maintenance|cleaning\s*\(hourly\)/i.test(selectedService?.name ?? "");
  const requiresNotes = /maintenance|linen|delivery/i.test(selectedService?.name ?? "");
  const completedLogs = logs.filter((log) => log.status === "completed");
  const filteredLogs = completedLogs.filter((log) => (!fromDate || log.task_date >= fromDate) && (!toDate || log.task_date <= toDate));
  const pageCount = Math.max(1, Math.ceil(filteredLogs.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleLogs = filteredLogs.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const run = (operation: () => Promise<unknown>, success: string, refreshAfter = false) => startTransition(async () => {
    try {
      setMessage("");
      await operation();
      setMessage(success);
      showActionToast("success", success);
      if (refreshAfter) router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update the operation.";
      setMessage(message);
      showActionToast("error", message);
    }
  });

  const submitTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!shift) return;
    if (requiresRooms && selectedRooms.length === 0) {
      setMessage("Select at least one room for this service.");
      return;
    }
    const payload = { hotelId, serviceId: effectiveServiceId, roomIds: selectedRooms.map((room) => room.id), notes };
    if (editingId) {
      startTransition(async () => {
        try {
          setMessage("");
          await updateTask(editingId, payload);
          setPersistedEditingRoomIds(payload.roomIds);
          setMessage("Changes saved. You can now add evidence to the selected rooms.");
          showActionToast("success", "Work log changes saved.");
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unable to save task changes.";
          setMessage(message);
          showActionToast("error", message);
        }
      });
      return;
    }
    run(() => startTask(payload), "Task started.");
  };

  const chooseHotel = (nextHotelId: string) => {
    setHotelId(nextHotelId);
    setServiceId("");
    setRoomIds([]);
    run(() => switchHotel(nextHotelId), "Hotel selection updated.", true);
  };

  const beginEdit = async (log: WorkLog) => {
    setActiveTab("operations");
    setEditingId(log.id);
    setPersistedEditingRoomIds(log.room_ids?.length ? log.room_ids : rooms.filter((room) => room.hotel_id === log.hotel_id && log.room_numbers.includes(room.room_name)).map((room) => room.id));
    setHotelId(log.hotel_id);
    setServiceId(log.service_id);
    setRoomIds(log.room_ids?.length ? log.room_ids : rooms.filter((room) => room.hotel_id === log.hotel_id && log.room_numbers.includes(room.room_name)).map((room) => room.id));
    setNotes(log.notes ?? "");
    setEditingMedia([]);
    setEditingMediaLoading(true);
    try {
      setEditingMedia(await getWorkLogRoomMedia(log.id));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load existing room media.");
    } finally {
      setEditingMediaLoading(false);
    }
  };

  const toBriefTask = (log: WorkLog): BriefTask => {
    const hours = log.end_time ? Math.max(0, (Date.parse(log.end_time) - Date.parse(log.start_time)) / 3_600_000) : 0;
    const rate = resolveServiceRate({ name: log.serviceName, unit: log.serviceUnit, default_rate: log.serviceRate });
    const unit = resolveBillingUnit(log.serviceUnit, log.serviceName);
    return {
      id: log.id,
      cleaner: user.fullName,
      hotel: log.hotelName,
      service: log.serviceName,
      serviceDescription: log.serviceDescription,
      taskDate: log.task_date,
      status: log.status,
      startTime: log.start_time,
      endTime: log.end_time,
      ownerId: log.owner_id,
      ownerName: log.owner_name ?? "Unassigned owner",
      managerId: log.manager_id,
      managerName: log.manager_name ?? "Unassigned manager",
      responsibilityRecordedAt: log.responsibility_recorded_at ?? log.start_time,
      room: log.room_numbers.join(", ") || log.room_number || "",
      rooms: log.rooms_completed,
      hours,
      rate,
      cost: calculateTaskCost(hours, log.rooms_completed, { name: log.serviceName, unit, default_rate: rate }, log.cost_override),
      notes: log.notes ?? "",
      managerApproved: log.manager_approved,
      ownerApproved: log.owner_approved,
      isLocked: log.is_locked,
    };
  };

  return <main className="min-h-dvh bg-slate-100 pb-24"><div className="mx-auto max-w-2xl px-4 pb-8 pt-6">
    <header className="mb-5 rounded-3xl bg-slate-900 p-5 text-white shadow-lg"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="text-xs uppercase tracking-[0.25em] text-slate-400">Shift overview</p><h1 className="mt-1 text-2xl font-bold">{user.fullName}</h1><p className="mt-1 text-sm text-slate-400">{user.email}</p></div><div className="flex items-center gap-2"><UserProfileMenu name={user.fullName} email={user.email} avatarUrl={user.avatarUrl} role="cleaner" settingsHref="/settings" /></div></div><div className="mt-4 flex items-center justify-between rounded-2xl bg-slate-800/70 p-3 text-sm"><span className="flex items-center gap-2 text-slate-300"><Clock3 className="h-4 w-4" /> Master shift</span><LiveStatusIndicator isClockedIn={Boolean(shift)} className={shift ? "font-semibold text-emerald-300" : "font-semibold text-slate-300"} /></div></header>
    <nav aria-label="Cleaner dashboard sections" role="tablist" className="mb-5 grid grid-cols-2 gap-2 rounded-2xl bg-white p-1.5 shadow-sm ring-1 ring-slate-200">
      <button type="button" id="operations-tab" role="tab" aria-selected={activeTab === "operations"} aria-controls="operations-panel" onClick={() => setActiveTab("operations")} className={`min-h-11 rounded-xl px-3 py-2 text-sm font-semibold transition ${activeTab === "operations" ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}>Daily Operations</button>
      <button type="button" id="history-tab" role="tab" aria-selected={activeTab === "history"} aria-controls="history-panel" onClick={() => setActiveTab("history")} className={`min-h-11 rounded-xl px-3 py-2 text-sm font-semibold transition ${activeTab === "history" ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}>Submissions &amp; History</button>
    </nav>
    <section id="operations-panel" role="tabpanel" aria-labelledby="operations-tab" hidden={activeTab !== "operations"}>
    {activeTask && <section className="mb-5 rounded-3xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Active task</p><h2 className="mt-1 text-lg font-bold text-emerald-950">{activeTask.serviceName}</h2><p className="text-sm text-emerald-800">{activeTask.hotelName}{activeTask.room_numbers.length ? ` · ${activeTask.room_numbers.join(", ")}` : ""}</p>{activeTask.room_ids.length > 0 && <RoomMediaCapture workLogId={activeTask.id} rooms={rooms.filter((room) => room.hotel_id === activeTask.hotel_id && activeTask.room_ids.includes(room.id))} initialMedia={roomMedia} storageConfigured={roomMediaConfigured} />}<button type="button" disabled={isPending} onClick={() => run(() => endTask(activeTask.id, { notes }), "Task completed. Start another task when ready.")} className="mt-3 w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white">End task</button></section>}
    <OperationalBrief brief={brief} />
    <section className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200"><div className="flex items-center justify-between"><div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Hotel switch</p><h2 className="mt-1 text-lg font-bold text-slate-900">Current property</h2></div><MapPin className="h-5 w-5 text-sky-700" /></div><select value={hotelId} onChange={(event) => chooseHotel(event.target.value)} disabled={isPending || Boolean(activeTask)} className="mt-4 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900"><option value="">Select an active hotel</option>{hotels.map((hotel) => <option key={hotel.id} value={hotel.id}>{hotel.name}</option>)}</select></section>
    <section className="mt-5 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200"><div className="flex items-center justify-between"><div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Master shift control</p><h2 className="mt-1 text-lg font-bold text-slate-900">Workday attendance</h2></div><Clock3 className="h-5 w-5 text-amber-700" /></div><div className="mt-4 flex gap-2"><button type="button" disabled={isPending || Boolean(shift)} onClick={() => run(() => clockIn(), "Master shift started.")} className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500">Clock in</button><button type="button" disabled={isPending || !shift || Boolean(activeTask)} onClick={() => run(() => clockOut(), "Master shift completed.")} className="flex-1 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500">Clock out</button></div>{activeTask && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">End the active task before clocking out.</p>}</section>
    <section className="mt-5 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200"><div className="flex items-center justify-between"><div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Task selection</p><h2 className="mt-1 text-lg font-bold text-slate-900">{editingId ? "Modify task" : "Start a task"}</h2></div><BriefcaseBusiness className="h-5 w-5 text-violet-700" /></div><form onSubmit={submitTask} className="mt-4 space-y-3"><label className="block text-xs font-semibold text-slate-600">Service<select value={effectiveServiceId} onChange={(event) => { setServiceId(event.target.value); setRoomIds([]); }} disabled={isPending || Boolean(activeTask && !editingId)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-normal text-slate-900"><option value="">Select a service</option>{services.map((service) => <option key={service.id} value={service.id}>{service.name} - GBP {Number(service.default_rate).toFixed(2)}</option>)}</select></label>
      {requiresRooms && <fieldset className="rounded-xl border border-slate-200 p-2.5"><legend className="px-1 text-xs font-semibold text-slate-600">Rooms at this hotel</legend><div className="mb-2 flex items-center justify-between gap-3"><span className="text-xs text-slate-500">Select rooms for this task</span><span className="shrink-0 rounded-md bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-800">{selectedRooms.length} selected</span></div><label className="block"><span className="sr-only">Search hotel rooms</span><input type="search" value={roomSearch} onChange={(event) => setRoomSearch(event.target.value)} placeholder="Find a room" disabled={isPending} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400" /></label><div style={{ maxHeight: "11rem" }} className="mt-2 divide-y divide-slate-100 overflow-y-auto overscroll-contain rounded-lg border border-slate-100 bg-slate-50">{visibleHotelRooms.map((room) => <label key={room.id} className="flex cursor-pointer items-start gap-x-3 px-3 py-2 text-sm text-slate-800 hover:bg-sky-50"><input type="checkbox" checked={roomIds.includes(room.id)} onChange={(event) => setRoomIds((current) => event.target.checked ? [...current, room.id] : current.filter((id) => id !== room.id))} disabled={isPending || Boolean(activeTask && !editingId)} className="ml-0.5 mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-sky-700 focus:ring-sky-600" /><span className="min-w-0 flex-1"><span className="block truncate font-medium">{room.room_name}</span>{[room.floor_section, room.category].filter(Boolean).join(" · ") && <span className="mt-0.5 block truncate text-xs text-slate-500">{[room.floor_section, room.category].filter(Boolean).join(" · ")}</span>}</span></label>)}{visibleHotelRooms.length === 0 && <p className="px-3 py-3 text-sm text-slate-500">{hotelRooms.length ? "No rooms match your search." : "No active rooms are synced for this hotel."}</p>}</div></fieldset>}
      {requiresRooms && <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm"><span className="text-slate-600">Rooms completed</span><span className="font-semibold tabular-nums text-slate-900">{selectedRooms.length}</span></div>}
      <label className="block text-xs font-semibold text-slate-600">Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} required={requiresNotes} rows={3} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-normal text-slate-900" placeholder="Add task notes" /></label>
      {editingId && (editingMediaLoading ? <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">Loading saved room media...</p> : <RoomMediaCapture workLogId={editingId} rooms={selectedRooms} initialMedia={editingMedia} storageConfigured={roomMediaConfigured} uploadsEnabled={editRoomSelectionSaved} />)}
      <div className="flex gap-2"><button type="submit" disabled={isPending || (!editingId && !shift) || !hotelId || !effectiveServiceId} className="flex-1 rounded-xl bg-sky-700 px-4 py-3 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500">{isPending ? "Saving..." : editingId ? "Save Changes" : "Start task"}</button>{editingId && <button type="button" onClick={() => { setEditingId(null); setEditingMedia([]); setPersistedEditingRoomIds([]); setRoomIds([]); setNotes(""); }} className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">Done</button>}</div></form></section>
    {message && <p className="mt-4 rounded-xl bg-slate-900 px-3 py-2 text-sm text-white" role="status">{message}</p>}
    </section>
    <section id="history-panel" role="tabpanel" aria-labelledby="history-tab" hidden={activeTab !== "history"}>
    <section className="mt-5">
      <div className="mb-3 flex items-center gap-2"><CalendarDays className="h-5 w-5 text-sky-700" /><h2 className="text-lg font-bold text-slate-900">Recent submissions</h2></div>
      <div className="mb-3 rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs font-semibold text-slate-600">From<span className="relative mt-1 block"><CalendarDays className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => { setFromDate(event.target.value); setPage(1); }} className="block w-full rounded-lg border border-slate-200 py-2 pl-8 pr-2 text-sm font-normal text-slate-900" /></span></label>
          <label className="text-xs font-semibold text-slate-600">To<span className="relative mt-1 block"><CalendarDays className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => { setToDate(event.target.value); setPage(1); }} className="block w-full rounded-lg border border-slate-200 py-2 pl-8 pr-2 text-sm font-normal text-slate-900" /></span></label>
          <button type="button" onClick={() => { setFromDate(""); setToDate(""); setPage(1); }} className="col-span-2 min-h-8 justify-self-end rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700">Clear dates</button>
        </div>
      </div>
      <div className="space-y-3">
        {visibleLogs.map((log) => {
          const ServiceIcon = submissionIcon(log.serviceName);
          return <article key={log.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sky-50 text-sky-700"><ServiceIcon className="h-4 w-4" /></span>
                <h3 className="min-w-0 font-semibold text-slate-900">{log.serviceName}</h3>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${log.is_locked ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{log.is_locked ? "Locked for payroll" : "Pending approval"}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="min-w-0 rounded-lg bg-slate-50 px-3 py-2"><p className="text-[11px] font-medium text-slate-500">Property</p><p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-800"><MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="truncate">{log.hotelName}</span></p></div>
              <div className="min-w-0 rounded-lg bg-slate-50 px-3 py-2"><p className="text-[11px] font-medium text-slate-500">Rooms</p><p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-800"><BedDouble className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="truncate">{log.room_numbers.length ? log.room_numbers.join(", ") : `${log.rooms_completed} completed`}</span></p></div>
              <div className="min-w-0 rounded-lg bg-slate-50 px-3 py-2"><p className="text-[11px] font-medium text-slate-500">Manager</p><p className="mt-0.5 truncate text-sm text-slate-800">{log.manager_name ?? "Unassigned manager"}</p></div>
              <div className="min-w-0 rounded-lg bg-slate-50 px-3 py-2"><p className="text-[11px] font-medium text-slate-500">Completed</p><p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-800"><Clock3 className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="truncate">{log.end_time ? new Date(log.end_time).toLocaleString("en-GB", { timeZone: "Africa/Cairo", dateStyle: "medium", timeStyle: "short" }) : dateLabel(log.task_date)}</span></p></div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              {log.notes ? <p className="min-w-0 flex-1 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-700">{log.notes}</p> : <span className="flex-1" />}
              <div className="flex shrink-0 gap-2">
                <button type="button" onClick={() => setSelectedTask(toBriefTask(log))} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"><FileText className="h-3.5 w-3.5" />Details</button>
                {!log.is_locked && <button type="button" onClick={() => beginEdit(log)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"><Pencil className="h-3.5 w-3.5" />Modify</button>}
              </div>
            </div>
          </article>;
        })}
        {filteredLogs.length === 0 && <p className="rounded-2xl bg-white p-4 text-sm text-slate-500 ring-1 ring-slate-200">No completed tasks match this date range.</p>}
      </div>
      <DashboardPagination currentPage={currentPage} pageCount={pageCount} total={filteredLogs.length} pageSize={PAGE_SIZE} label="completed tasks" onPageChange={setPage} />
    </section>
    {selectedTask && <ServiceCard task={selectedTask} onClose={() => setSelectedTask(null)} onEdit={() => { const log = logs.find((item) => item.id === selectedTask.id); if (log && !log.is_locked) { setSelectedTask(null); beginEdit(log); } }} />}
     </section>
  </div></main>;
}