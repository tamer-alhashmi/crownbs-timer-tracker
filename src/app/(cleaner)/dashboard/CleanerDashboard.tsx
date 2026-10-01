"use client";

import { FormEvent, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BriefcaseBusiness, CalendarDays, Clock3, MapPin } from "lucide-react";
import { clockIn, clockOut, endTask, startTask, switchHotel, updateTask } from "./actions";
import { UserProfileMenu } from "@/components/layout/UserProfileMenu";
import { OperationalBrief } from "@/components/dashboard/OperationalBrief";
import { ServiceCard } from "@/components/dashboard/ServiceCard";
import type { BriefTask, CleanerBrief } from "@/lib/operationalBrief";
import { calculateTaskCost, resolveBillingUnit, resolveServiceRate } from "@/lib/servicePricing";
import { useWorkLogRealtimeRefresh } from "@/lib/useWorkLogRealtimeRefresh";
import { RoomMediaCapture } from "./RoomMediaCapture";
import { getWorkLogRoomMedia, type RoomMediaGalleryItem, type RoomMediaItem } from "./roomMediaActions";

type HotelRecord = { id: string; name: string; location: string };
type ServiceRecord = { id: string; name: string; default_rate: number; unit: string; description: string };
type RoomRecord = { id: string; hotel_id: string; room_name: string; category: string };
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
  status: "active" | "completed";
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
  user: { fullName: string; email: string; hotelId: string | null };
  hotels: HotelRecord[];
  services: ServiceRecord[];
  rooms: RoomRecord[];
  shift: Shift;
  logs: WorkLog[];
  brief: CleanerBrief;
  roomMedia: RoomMediaItem[];
  roomMediaConfigured: boolean;
};

const PAGE_SIZE = 10;
const dateLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { timeZone: "Europe/London", dateStyle: "medium" });

export default function CleanerDashboard({ user, hotels, services, rooms, shift, logs, brief, roomMedia, roomMediaConfigured }: Props) {
  useWorkLogRealtimeRefresh();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
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
  const selectedService = services.find((service) => service.id === serviceId);
  const editRoomSelectionSaved = !editingId || persistedEditingRoomIds.length === roomIds.length && persistedEditingRoomIds.every((id) => roomIds.includes(id));
  const hotelRooms = rooms.filter((room) => room.hotel_id === hotelId);
  const selectedRooms = hotelRooms.filter((room) => roomIds.includes(room.id));
  const visibleHotelRooms = hotelRooms.filter((room) => `${room.room_name} ${room.category}`.toLowerCase().includes(roomSearch.trim().toLowerCase()));
  const requiresRooms = selectedService?.unit === "per_room" || /maintenance|cleaning\s*\(hourly\)/i.test(selectedService?.name ?? "");
  const requiresNotes = /maintenance|linen|delivery/i.test(selectedService?.name ?? "");
  const completedLogs = logs.filter((log) => log.status === "completed");
  const filteredLogs = completedLogs.filter((log) => (!fromDate || log.task_date >= fromDate) && (!toDate || log.task_date <= toDate));
  const pageCount = Math.max(1, Math.ceil(filteredLogs.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleLogs = filteredLogs.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [router]);

  const run = (operation: () => Promise<unknown>, success: string) => startTransition(async () => {
    try {
      setMessage("");
      await operation();
      setMessage(success);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update the operation.");
    }
  });

  const submitTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!shift) return;
    if (requiresRooms && selectedRooms.length === 0) {
      setMessage("Select at least one room for this service.");
      return;
    }
    const payload = { hotelId, serviceId, roomIds: selectedRooms.map((room) => room.id), notes };
    if (editingId) {
      startTransition(async () => {
        try {
          setMessage("");
          await updateTask(editingId, payload);
          setPersistedEditingRoomIds(payload.roomIds);
          setMessage("Changes saved. You can now add evidence to the selected rooms.");
          router.refresh();
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Unable to save task changes.");
        }
      });
      return;
    }
    run(() => startTask(payload), "Task started.");
  };

  const chooseHotel = (nextHotelId: string) => {
    setHotelId(nextHotelId);
    setRoomIds([]);
    if (shift) run(() => switchHotel(nextHotelId), "Hotel selection updated.");
  };

  const beginEdit = async (log: WorkLog) => {
    setEditingId(log.id);
    setPersistedEditingRoomIds(log.room_ids?.length ? log.room_ids : rooms.filter((room) => room.hotel_id === log.hotel_id && log.room_numbers.includes(room.room_name)).map((room) => room.id));
    setHotelId(log.hotel_id);
    setServiceId(log.service_id);
    setRoomIds(log.room_ids?.length ? log.room_ids : rooms.filter((room) => room.hotel_id === log.hotel_id && log.room_numbers.includes(room.room_name)).map((room) => room.id));
    setNotes(log.notes ?? "");
    setEditingMedia([]);
    setEditingMediaLoading(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
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

  return <main className="min-h-screen bg-slate-100 pb-24"><div className="mx-auto max-w-2xl px-4 pb-8 pt-6">
    <header className="mb-5 rounded-3xl bg-slate-900 p-5 text-white shadow-lg"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="text-xs uppercase tracking-[0.25em] text-slate-400">Shift overview</p><h1 className="mt-1 text-2xl font-bold">{user.fullName}</h1><p className="mt-1 text-sm text-slate-400">{user.email}</p></div><UserProfileMenu name={user.fullName} email={user.email} role="cleaner" settingsHref="/settings" /></div><div className="mt-4 flex items-center justify-between rounded-2xl bg-slate-800/70 p-3 text-sm"><span className="flex items-center gap-2 text-slate-300"><Clock3 className="h-4 w-4" /> Master shift</span><span className="font-semibold text-white">{shift ? "Clocked in" : "Not clocked in"}</span></div></header>
    <OperationalBrief brief={brief} />
    <section className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200"><div className="flex items-center justify-between"><div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Hotel switch</p><h2 className="mt-1 text-lg font-bold text-slate-900">Current property</h2></div><MapPin className="h-5 w-5 text-sky-700" /></div><select value={hotelId} onChange={(event) => chooseHotel(event.target.value)} disabled={isPending || Boolean(activeTask)} className="mt-4 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900"><option value="">Select an active hotel</option>{hotels.map((hotel) => <option key={hotel.id} value={hotel.id}>{hotel.name}</option>)}</select></section>
    <section className="mt-5 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200"><div className="flex items-center justify-between"><div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Master shift control</p><h2 className="mt-1 text-lg font-bold text-slate-900">Workday attendance</h2></div><Clock3 className="h-5 w-5 text-amber-700" /></div><div className="mt-4 flex gap-2"><button type="button" disabled={isPending || Boolean(shift)} onClick={() => run(() => clockIn(), "Master shift started.")} className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500">Clock in</button><button type="button" disabled={isPending || !shift || Boolean(activeTask)} onClick={() => run(() => clockOut(), "Master shift completed.")} className="flex-1 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500">Clock out</button></div>{activeTask && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">End the active task before clocking out.</p>}</section>
    <section className="mt-5 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200"><div className="flex items-center justify-between"><div><p className="text-xs uppercase tracking-[0.2em] text-slate-500">Task selection</p><h2 className="mt-1 text-lg font-bold text-slate-900">{editingId ? "Modify task" : "Start a task"}</h2></div><BriefcaseBusiness className="h-5 w-5 text-violet-700" /></div><form onSubmit={submitTask} className="mt-4 space-y-3"><label className="block text-xs font-semibold text-slate-600">Service<select value={serviceId} onChange={(event) => { setServiceId(event.target.value); setRoomIds([]); }} disabled={isPending || Boolean(activeTask && !editingId)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-normal text-slate-900"><option value="">Select a service</option>{services.map((service) => <option key={service.id} value={service.id}>{service.name} - GBP {Number(service.default_rate).toFixed(2)}</option>)}</select></label>
      {requiresRooms && <fieldset className="rounded-xl border border-slate-200 p-2.5"><legend className="px-1 text-xs font-semibold text-slate-600">Rooms at this hotel</legend><div className="mb-2 flex items-center justify-between gap-3"><span className="text-xs text-slate-500">Select rooms for this task</span><span className="shrink-0 rounded-md bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-800">{selectedRooms.length} selected</span></div><label className="block"><span className="sr-only">Search hotel rooms</span><input type="search" value={roomSearch} onChange={(event) => setRoomSearch(event.target.value)} placeholder="Find a room" disabled={isPending} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400" /></label><div style={{ maxHeight: "11rem" }} className="mt-2 divide-y divide-slate-100 overflow-y-auto overscroll-contain rounded-lg border border-slate-100 bg-slate-50">{visibleHotelRooms.map((room) => <label key={room.id} className="flex cursor-pointer items-start gap-x-3 px-3 py-2 text-sm text-slate-800 hover:bg-sky-50"><input type="checkbox" checked={roomIds.includes(room.id)} onChange={(event) => setRoomIds((current) => event.target.checked ? [...current, room.id] : current.filter((id) => id !== room.id))} disabled={isPending || Boolean(activeTask && !editingId)} className="ml-0.5 mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-sky-700 focus:ring-sky-600" /><span className="min-w-0 flex-1"><span className="block truncate font-medium">{room.room_name}</span>{room.category && <span className="mt-0.5 block truncate text-xs text-slate-500">{room.category}</span>}</span></label>)}{visibleHotelRooms.length === 0 && <p className="px-3 py-3 text-sm text-slate-500">{hotelRooms.length ? "No rooms match your search." : "No active rooms are synced for this hotel."}</p>}</div></fieldset>}
      {requiresRooms && <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm"><span className="text-slate-600">Rooms completed</span><span className="font-semibold tabular-nums text-slate-900">{selectedRooms.length}</span></div>}
      <label className="block text-xs font-semibold text-slate-600">Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} required={requiresNotes} rows={3} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-normal text-slate-900" placeholder="Add task notes" /></label>
      {editingId && (editingMediaLoading ? <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">Loading saved room media...</p> : <RoomMediaCapture workLogId={editingId} rooms={selectedRooms} initialMedia={editingMedia} storageConfigured={roomMediaConfigured} uploadsEnabled={editRoomSelectionSaved} />)}
      <div className="flex gap-2"><button type="submit" disabled={isPending || (!editingId && !shift) || !hotelId || !serviceId} className="flex-1 rounded-xl bg-sky-700 px-4 py-3 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500">{isPending ? "Saving..." : editingId ? "Save Changes" : "Start task"}</button>{editingId && <button type="button" onClick={() => { setEditingId(null); setEditingMedia([]); setPersistedEditingRoomIds([]); setRoomIds([]); setNotes(""); }} className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">Done</button>}</div></form></section>
      {activeTask && <section className="mt-5 rounded-3xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Active task</p><h2 className="mt-1 text-lg font-bold text-emerald-950">{activeTask.serviceName}</h2><p className="text-sm text-emerald-800">{activeTask.hotelName}{activeTask.room_numbers.length ? ` · ${activeTask.room_numbers.join(", ")}` : ""}</p>{activeTask.room_ids.length > 0 && <RoomMediaCapture workLogId={activeTask.id} rooms={rooms.filter((room) => room.hotel_id === activeTask.hotel_id && activeTask.room_ids.includes(room.id))} initialMedia={roomMedia} storageConfigured={roomMediaConfigured} />}<button type="button" disabled={isPending} onClick={() => run(() => endTask(activeTask.id, { notes }), "Task completed. Start another task when ready.")} className="mt-3 w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white">End task</button></section>}
    {message && <p className="mt-4 rounded-xl bg-slate-900 px-3 py-2 text-sm text-white" role="status">{message}</p>}
    <section className="mt-5"><div className="mb-3 flex items-center gap-2"><CalendarDays className="h-5 w-5 text-sky-700" /><h2 className="text-lg font-bold text-slate-900">Recent submissions</h2></div><div className="mb-3 grid gap-3 rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200 sm:grid-cols-[1fr_1fr_auto]"><label className="text-xs font-semibold text-slate-600">From<input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => { setFromDate(event.target.value); setPage(1); }} className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900" /></label><label className="text-xs font-semibold text-slate-600">To<input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => { setToDate(event.target.value); setPage(1); }} className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900" /></label><button type="button" onClick={() => { setFromDate(""); setToDate(""); setPage(1); }} className="self-end rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">Clear</button></div>
      <div className="space-y-3">{visibleLogs.map((log) => <article key={log.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-semibold text-slate-900">{log.serviceName}</p><p className="text-sm text-slate-600">{log.hotelName} · {log.rooms_completed} rooms</p><p className="mt-1 text-xs text-slate-500">Task date: {dateLabel(log.task_date)} · Manager: {log.manager_name ?? "Unassigned manager"}</p></div><span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">{log.is_locked ? "Locked for payroll" : "Pending approval"}</span></div>{log.room_numbers.length > 0 && <p className="mt-2 text-sm text-slate-700">Rooms: {log.room_numbers.join(", ")}</p>}<p className="mt-2 text-sm text-slate-700">{log.notes || "No notes provided"}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => setSelectedTask(toBriefTask(log))} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700">Details</button>{!log.is_locked && <button type="button" onClick={() => beginEdit(log)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700">Modify</button>}</div></article>)}{filteredLogs.length === 0 && <p className="rounded-2xl bg-white p-4 text-sm text-slate-500 ring-1 ring-slate-200">No completed tasks match this date range.</p>}</div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4"><p className="text-sm text-slate-500">{filteredLogs.length} records · Page {currentPage} of {pageCount}</p><div className="flex flex-wrap items-center gap-1"><button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 disabled:opacity-40">Previous</button>{Array.from({ length: pageCount }, (_, index) => index + 1).map((number) => <button key={number} type="button" aria-current={number === currentPage ? "page" : undefined} onClick={() => setPage(number)} className={`min-w-8 rounded-lg px-2.5 py-1.5 text-sm font-semibold ${number === currentPage ? "bg-slate-900 text-white" : "border border-slate-200 text-slate-700"}`}>{number}</button>)}<button type="button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 disabled:opacity-40">Next</button></div></div>
    </section>
    {selectedTask && <ServiceCard task={selectedTask} onClose={() => setSelectedTask(null)} onEdit={() => { const log = logs.find((item) => item.id === selectedTask.id); if (log && !log.is_locked) { setSelectedTask(null); beginEdit(log); } }} />}
  </div></main>;
}