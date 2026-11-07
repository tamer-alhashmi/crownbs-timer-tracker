"use client";

import { FormEvent, useEffect, useState, useTransition, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { BedDouble, BriefcaseBusiness, CalendarDays, Clock3, FileText, MapPin, Pencil, Wrench, ClipboardList } from "lucide-react";
import { endTask, startTask, switchHotel, updateTask } from "./actions";
import type { WorkspaceNavTab } from "@/components/layout/MobileWorkspaceNav";
import { SharedWorkspaceShell } from "@/components/layout/SharedWorkspaceShell";
import { WorkspaceHeader } from "@/components/layout/WorkspaceHeader";
import { LiveStatusIndicator } from "@/components/ui/LiveStatusIndicator";
import { OperationalBrief } from "@/components/dashboard/OperationalBrief";
import { DashboardPagination, useUrlPage } from "@/components/dashboard/DashboardPagination";
import { ShiftDock } from "@/components/dashboard/ShiftDock";
import { ServiceCard } from "@/components/dashboard/ServiceCard";
import type { BriefTask, CleanerBrief } from "@/lib/operationalBrief";
import { calculateWorkLogCost, resolveBillingUnit, resolveServiceRate } from "@/lib/servicePricing";
import { resolveServiceBlueprint, resolveTaskChecklist } from "@/lib/serviceBlueprint";
import { calculateWorkforceEfficiency } from "@/lib/workforceEfficiency";
import { useWorkLogRealtimeRefresh } from "@/lib/useWorkLogRealtimeRefresh";
import { showActionToast } from "@/components/ui/ActionToast";
import { ActionErrorMessage } from "@/components/ui/ActionErrorMessage";
import { formatUserMessage } from "@/lib/userMessages";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { RoomMediaCapture } from "./RoomMediaCapture";
import { getWorkLogRoomMedia, type RoomMediaGalleryItem, type RoomMediaItem } from "./roomMediaActions";

type HotelRecord = { id: string; name: string; location: string; latitude: number | null; longitude: number | null };
type ServiceRecord = { id: string; name: string; default_rate: number; unit: string; description: string; service_category: string | null; billing_model: string | null; billing_unit_label: string | null; benchmark_quantity: number | string | null; spatial_mode: string | null; requires_asset_reference: boolean; checklist_blueprint: unknown };
type RoomRecord = { id: string; hotel_id: string; room_name: string; category: string; floor_section: string | null; level_id: string | null };
type PropertyLevel = { id: string; hotel_id: string; name: string; sort_order: number };
type Shift = { id: string; hotel_id: string | null; role_at_shift?: string | null; start_time: string; end_time: string | null; status: "active" | "completed" } | null;
type WorkLog = {
  id: string;
  shift_id: string | null;
  hotel_id: string;
  service_id: string;
  start_time: string;
  end_time: string | null;
  task_date: string;
  room_ids: string[];
  status: "assigned" | "active" | "paused" | "completed";
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
  dispatch_metadata: Record<string, unknown> | null;
  service_blueprint_snapshot: unknown;
  billable_quantity: number | null;
  execution_checklist: boolean[];
};
type Props = {
  user: { fullName: string; email: string; hotelId: string | null; avatarUrl: string | null };
  hotels: HotelRecord[];
  services: ServiceRecord[];
  rooms: RoomRecord[];
  levels: PropertyLevel[];
  shift: Shift;
  logs: WorkLog[];
  brief: CleanerBrief;
  roomMedia: RoomMediaItem[];
  roomMediaConfigured: boolean;
};

const PAGE_SIZE = 20;
const UNASSIGNED_LEVEL_ID = "__unassigned__";
const CLEANER_TABS: readonly WorkspaceNavTab<"operations" | "history">[] = [
  { id: "operations", label: "My shifts", Icon: BriefcaseBusiness, tabButtonId: "operations-tab", panelId: "operations-panel" },
  { id: "history", label: "History", Icon: ClipboardList, tabButtonId: "history-tab", panelId: "history-panel" },
];
const dateLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { timeZone: "Europe/London", dateStyle: "medium" });

function submissionIcon(serviceName: string) {
  if (/maintenance|repair/i.test(serviceName)) return Wrench;
  if (/room|housekeep|clean/i.test(serviceName)) return BedDouble;
  return ClipboardList;
}

export default function CleanerDashboard({ user, hotels, services, rooms, levels, shift, logs, brief, roomMedia, roomMediaConfigured }: Props) {
  useWorkLogRealtimeRefresh();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [now, setNow] = useState(0);
  const [activeTab, setActiveTab] = useState<"operations" | "history">("operations");
  const [currentShift, setCurrentShift] = useState<Shift>(shift);
  useEffect(() => {
    if (!currentShift) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [currentShift]);
  useEffect(() => {
    const syncFromUrl = () => {
      const hash = window.location.hash;
      const nextTab = hash === "#history-panel" ? "history" : "operations";
      setActiveTab(nextTab);
      if (!hash) return;
      let attempts = 0;
      const scrollToAnchor = () => {
        const target = document.getElementById(decodeURIComponent(hash.slice(1)));
        if (target && target.getClientRects().length > 0) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
          target.classList.add("ring-2", "ring-sky-400", "ring-offset-2");
          window.setTimeout(() => target.classList.remove("ring-2", "ring-sky-400", "ring-offset-2"), 1800);
        } else if (attempts++ < 10) window.requestAnimationFrame(scrollToAnchor);
      };
      window.requestAnimationFrame(scrollToAnchor);
    };
    syncFromUrl();
    window.addEventListener("help-center-navigate", syncFromUrl);
    window.addEventListener("popstate", syncFromUrl);
    return () => {
      window.removeEventListener("help-center-navigate", syncFromUrl);
      window.removeEventListener("popstate", syncFromUrl);
    };
  }, []);
  const activeTask = logs.find((log) => log.status === "active");
  const pausedTasks = logs.filter((log) => log.status === "paused");
  const selectCleanerTab = (tab: "operations" | "history") => {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    if (tab === "history") url.hash = "history-panel";
    else url.hash = "operations-panel";
    window.history.replaceState(window.history.state, "", url);
  };
  const [hotelId, setHotelId] = useState(currentShift?.hotel_id ?? activeTask?.hotel_id ?? user.hotelId ?? hotels[0]?.id ?? "");
  const [serviceId, setServiceId] = useState(activeTask?.service_id ?? services[0]?.id ?? "");
  const [roomIds, setRoomIds] = useState<string[]>(() => activeTask?.room_ids?.length ? activeTask.room_ids : activeTask ? rooms.filter((room) => room.hotel_id === activeTask.hotel_id && activeTask.room_numbers.includes(room.room_name)).map((room) => room.id) : []);
  const [levelId, setLevelId] = useState(() => {
    if (typeof activeTask?.dispatch_metadata?.levelId === "string" && activeTask.dispatch_metadata.levelId) return activeTask.dispatch_metadata.levelId;
    const activeRoom = rooms.find((room) => activeTask?.room_ids.includes(room.id));
    return activeRoom ? activeRoom.level_id ?? UNASSIGNED_LEVEL_ID : "";
  });
  const [quantityValue, setQuantityValue] = useState(activeTask?.billable_quantity?.toString() ?? "");
  const [zoneContext, setZoneContext] = useState(typeof activeTask?.dispatch_metadata?.zoneContext === "string"
    ? activeTask.dispatch_metadata.zoneContext
    : typeof activeTask?.dispatch_metadata?.floorSection === "string" ? activeTask.dispatch_metadata.floorSection : "");
  const [assetId, setAssetId] = useState(typeof activeTask?.dispatch_metadata?.assetId === "string" ? activeTask.dispatch_metadata.assetId : "");
  const [checklistState, setChecklistState] = useState<{ taskId: string; items: boolean[] }>({
    taskId: activeTask?.id ?? "",
    items: activeTask?.execution_checklist ?? [],
  });
  const checklistProgress = checklistState.taskId === activeTask?.id
    ? checklistState.items
    : activeTask?.execution_checklist ?? [];
  const setChecklistProgress = (update: SetStateAction<boolean[]>) => {
    const items = checklistState.taskId === activeTask?.id
      ? checklistState.items
      : activeTask?.execution_checklist ?? [];
    setChecklistState({ taskId: activeTask?.id ?? "", items: typeof update === "function" ? update(items) : update });
  };
  const [evidenceState, setEvidenceState] = useState<{ key: string; count: number }>({
    key: `${activeTask?.id ?? ""}:${roomMedia.length}`,
    count: roomMedia.length,
  });
  const evidenceKey = `${activeTask?.id ?? ""}:${roomMedia.length}`;
  const evidenceCount = evidenceState.key === evidenceKey ? evidenceState.count : roomMedia.length;
  const updateEvidenceCount = (count: number) => setEvidenceState({ key: evidenceKey, count });
  const [roomSearch, setRoomSearch] = useState("");
  const [notes, setNotes] = useState(activeTask?.notes ?? "");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [persistedEditingRoomIds, setPersistedEditingRoomIds] = useState<string[]>([]);
  const [editingMedia, setEditingMedia] = useState<RoomMediaGalleryItem[]>([]);
  const [editingMediaLoading, setEditingMediaLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useUrlPage(PAGE_SIZE);
  const [selectedTask, setSelectedTask] = useState<BriefTask | null>(null);
  const effectiveServiceId = services.some((service) => service.id === serviceId) ? serviceId : services[0]?.id ?? "";
  const selectedService = services.find((service) => service.id === effectiveServiceId);
  const selectedBlueprint = resolveServiceBlueprint(selectedService ?? {});
  const activeChecklist = resolveTaskChecklist(activeTask?.service_blueprint_snapshot);
  const availableLevels = levels.filter((level) => level.hotel_id === hotelId);
  const editRoomSelectionSaved = !editingId || persistedEditingRoomIds.length === roomIds.length && persistedEditingRoomIds.every((id) => roomIds.includes(id));
  const hotelRooms = rooms.filter((room) => room.hotel_id === hotelId);
  const selectedRooms = hotelRooms.filter((room) => roomIds.includes(room.id));
  const hasUnassignedLevelRooms = hotelRooms.some((room) => !room.level_id);
  const serviceRooms = selectedBlueprint.spatialMode === "units"
    ? hotelRooms.filter((room) => levelId === UNASSIGNED_LEVEL_ID ? !room.level_id : levelId ? room.level_id === levelId : availableLevels.length === 0 && !room.level_id)
    : [];
  const visibleHotelRooms = serviceRooms.filter((room) => `${room.room_name} ${room.category} ${room.floor_section ?? ""}`.toLowerCase().includes(roomSearch.trim().toLowerCase()));
  const requiresRooms = selectedBlueprint.spatialMode === "units";
  const requiresNotes = /maintenance|linen|delivery/i.test(selectedService?.name ?? "");
  const completedLogs = logs.filter((log) => log.status === "completed");
  const efficiency = calculateWorkforceEfficiency(logs
    .filter((log) => log.status === "completed")
    .map((log) => ({
      status: log.status,
      start_time: log.start_time,
      end_time: log.end_time,
      rooms_completed: log.rooms_completed,
      service_name_snapshot: log.serviceName,
      service_unit: log.serviceUnit,
      dispatch_metadata: log.dispatch_metadata,
    })), 0);
  const filteredLogs = completedLogs.filter((log) => (!fromDate || log.task_date >= fromDate) && (!toDate || log.task_date <= toDate));
  const pageCount = Math.max(1, Math.ceil(filteredLogs.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleLogs = filteredLogs.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const shiftStart = currentShift ? new Date(currentShift.start_time).getTime() : Number.NaN;
  const elapsedSeconds = Number.isFinite(shiftStart) ? Math.max(0, Math.floor((now - shiftStart) / 1000)) : 0;
  const shiftDuration = [Math.floor(elapsedSeconds / 3600), Math.floor((elapsedSeconds % 3600) / 60), elapsedSeconds % 60]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");

  const run = (operation: () => Promise<unknown>, success: string, refreshAfter = false) => startTransition(async () => {
    try {
      setMessage("");
      setMessageIsError(false);
      await operation();
      setMessage(success);
      showActionToast("success", success);
      if (refreshAfter) router.refresh();
    } catch (error) {
      const message = formatUserMessage(error, "Unable to update the operation.");
      setMessage(message);
      setMessageIsError(true);
      showActionToast("error", message);
    }
  });

  const submitTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentShift) return;
    if (requiresRooms && selectedRooms.length === 0) {
      setMessage("Select at least one room for this service.");
      setMessageIsError(true);
      return;
    }
    const payload = {
      hotelId,
      serviceId: effectiveServiceId,
      roomIds: requiresRooms ? selectedRooms.map((room) => room.id) : [],
      levelId: requiresRooms && levelId !== UNASSIGNED_LEVEL_ID ? levelId || null : null,
      quantityValue: selectedBlueprint.billingModel === "quantity" && !requiresRooms ? Number(quantityValue) : null,
      zoneContext: selectedBlueprint.spatialMode === "open_zone" ? zoneContext : "",
      assetId,
      notes,
    };
    if (editingId) {
      startTransition(async () => {
        try {
          setMessage("");
          setMessageIsError(false);
          await updateTask(editingId, payload);
          setPersistedEditingRoomIds(payload.roomIds);
          setMessage("Changes saved. You can now add evidence to the selected rooms.");
          setMessageIsError(false);
          showActionToast("success", "Work log changes saved.");
        } catch (error) {
          const message = formatUserMessage(error, "Unable to save task changes.");
          setMessage(message);
          setMessageIsError(true);
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
    setLevelId("");
    setQuantityValue("");
    setZoneContext("");
    setAssetId("");
    run(() => switchHotel(nextHotelId), "Hotel selection updated.", true);
  };

  const beginEdit = async (log: WorkLog) => {
    setActiveTab("operations");
    setEditingId(log.id);
    setPersistedEditingRoomIds(log.room_ids?.length ? log.room_ids : rooms.filter((room) => room.hotel_id === log.hotel_id && log.room_numbers.includes(room.room_name)).map((room) => room.id));
    setHotelId(log.hotel_id);
    setServiceId(log.service_id);
    setRoomIds(log.room_ids?.length ? log.room_ids : rooms.filter((room) => room.hotel_id === log.hotel_id && log.room_numbers.includes(room.room_name)).map((room) => room.id));
    const selectedRoom = rooms.find((room) => log.room_ids.includes(room.id));
    setLevelId(typeof log.dispatch_metadata?.levelId === "string" && log.dispatch_metadata.levelId
      ? log.dispatch_metadata.levelId
      : selectedRoom ? selectedRoom.level_id ?? UNASSIGNED_LEVEL_ID : "");
    setQuantityValue(log.billable_quantity?.toString() ?? "");
    setZoneContext(typeof log.dispatch_metadata?.zoneContext === "string"
      ? log.dispatch_metadata.zoneContext
      : typeof log.dispatch_metadata?.floorSection === "string" ? log.dispatch_metadata.floorSection : "");
    setAssetId(typeof log.dispatch_metadata?.assetId === "string" ? log.dispatch_metadata.assetId : "");
    setNotes(log.notes ?? "");
    setEditingMedia([]);
    setEditingMediaLoading(true);
    try {
      setEditingMedia(await getWorkLogRoomMedia(log.id));
    } catch (error) {
      setMessage(formatUserMessage(error, "Unable to load existing room media."));
      setMessageIsError(true);
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
      cost: calculateWorkLogCost(hours, log.rooms_completed, { name: log.serviceName, unit, default_rate: rate }, log, log.cost_override),
      notes: log.notes ?? "",
      managerApproved: log.manager_approved,
      ownerApproved: log.owner_approved,
      isLocked: log.is_locked,
    };
  };

  return <main className="cleaner-dashboard theme-workspace min-h-dvh overscroll-y-none bg-canvas pb-[calc(env(safe-area-inset-bottom,0px)+5rem)] text-ink md:ml-64 md:pb-8">
    <WorkspaceHeader name={user.fullName} email={user.email} role="cleaner" avatarUrl={user.avatarUrl} offsetSidebar={false} />
    <div className="mx-auto max-w-2xl px-4 pb-8 pt-6 md:mx-0 md:max-w-[1600px] md:px-8">
    <section className="mb-5 rounded-3xl border border-line bg-surface p-5 text-ink shadow-lg"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="text-xs uppercase tracking-[0.25em] text-ink-secondary">Shift status</p><div className="mt-2 flex items-center gap-2 text-sm"><Clock3 className="h-4 w-4 text-ink-secondary" /><span className="text-ink-secondary">Master shift</span><LiveStatusIndicator isClockedIn={Boolean(currentShift)} className={currentShift ? "font-semibold text-emerald-700" : "font-semibold text-ink-secondary"} /></div></div></div><div className="mt-4 rounded-2xl bg-surface-secondary px-4 py-3"><p className="text-xs font-medium uppercase tracking-wide text-ink-secondary">Shift duration</p><p role="timer" aria-label={`Shift duration ${shiftDuration}`} className="mt-1 text-3xl font-semibold tracking-tight text-ink tnum">{shiftDuration}</p></div></section>
    <SharedWorkspaceShell role="cleaner" activeTab={activeTab} onSelect={selectCleanerTab} tabs={CLEANER_TABS} user={{ name: user.fullName, email: user.email, avatarUrl: user.avatarUrl, role: "cleaner" }} />
    <section id="operations-panel" role="tabpanel" aria-labelledby="operations-tab" hidden={activeTab !== "operations"}>
    {activeTask && <section className="mb-5 rounded-3xl border border-emerald-200 bg-emerald-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Active task</p>
      <h2 className="mt-1 text-lg font-bold text-emerald-950">{activeTask.serviceName}</h2>
      <p className="text-sm text-emerald-800">{activeTask.hotelName}{activeTask.room_numbers.length ? ` · ${activeTask.room_numbers.join(", ")}` : ""}</p>
      {activeChecklist.items.length > 0 && <fieldset className="mt-3 space-y-2 rounded-xl border border-emerald-200 bg-white/70 p-3">
        <legend className="px-1 text-xs font-semibold text-emerald-900">Required inspection</legend>
        {activeChecklist.items.map((item, index) => <label key={`${index}-${item}`} className="flex items-start gap-2 text-sm text-emerald-950">
          <input type="checkbox" checked={checklistProgress[index] === true} onChange={(event) => setChecklistProgress((current) => activeChecklist.items.map((_, itemIndex) => itemIndex === index ? event.target.checked : current[itemIndex] === true))} className="mt-0.5 h-4 w-4 rounded border-emerald-300 text-emerald-700 focus:ring-emerald-600" />
          <span>{item}</span>
        </label>)}
      </fieldset>}
      {(activeTask.room_ids.length > 0 || activeChecklist.requirePhoto) && <RoomMediaCapture workLogId={activeTask.id} rooms={rooms.filter((room) => room.hotel_id === activeTask.hotel_id && activeTask.room_ids.includes(room.id))} initialMedia={roomMedia} storageConfigured={roomMediaConfigured} taskEvidenceRequired={activeChecklist.requirePhoto} onEvidenceChange={updateEvidenceCount} />}
      {activeChecklist.requirePhoto && evidenceCount === 0 && <p className="mt-2 text-xs font-medium text-amber-800">Add at least one photo before ending this task.</p>}
      <button type="button" disabled={isPending || checklistProgress.length !== activeChecklist.items.length || checklistProgress.some((checked) => checked !== true) || activeChecklist.requirePhoto && evidenceCount === 0} onClick={() => run(() => endTask(activeTask.id, { notes, checklist: checklistProgress }), "Task completed. Start another task when ready.")} className="mt-3 w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50">End task</button>
    </section>}
    {pausedTasks.length > 0 && <section className="mb-5 space-y-2" aria-label="Suspended tasks"><h2 className="text-sm font-semibold text-ink">Suspended tasks</h2>{pausedTasks.map((task) => <article key={task.id} className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950"><p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Paused for dispatched work</p><h3 className="mt-1 font-semibold">{task.serviceName}</h3><p className="text-sm text-amber-900">{task.hotelName}{task.room_numbers.length ? ` · ${task.room_numbers.join(", ")}` : ""}</p><p className="mt-2 text-xs text-amber-800">This task will resume automatically when the active task is completed.</p></article>)}</section>}
    <OperationalBrief brief={brief} />
    <section className="rounded-3xl bg-surface p-4 shadow-sm ring-1 ring-line"><div className="flex items-center justify-between"><div><p className="text-xs uppercase tracking-[0.2em] text-ink-muted">Hotel switch</p><h2 className="mt-1 text-lg font-bold text-ink">Current property</h2></div><MapPin className="h-5 w-5 text-sky-700" /></div><select value={hotelId} onChange={(event) => chooseHotel(event.target.value)} disabled={isPending || Boolean(currentShift || activeTask || pausedTasks.length)} className="mt-4 w-full rounded-xl border border-line bg-surface-secondary px-3 py-3 text-sm text-ink"><option value="">Select an active hotel</option>{hotels.map((hotel) => <option key={hotel.id} value={hotel.id}>{hotel.name}</option>)}</select>{Boolean(currentShift || activeTask || pausedTasks.length) && <p className="mt-2 text-xs text-ink-muted">Clock out and complete any paused work before switching properties.</p>}</section>
    <div id="shift-controls" className="scroll-mt-24 mt-5"><ShiftDock role="cleaner" properties={hotels} initialShift={currentShift ? { id: currentShift.id, hotel_id: currentShift.hotel_id, start_time: currentShift.start_time } : null} hasActiveTask={Boolean(activeTask || pausedTasks.length)} visible={activeTab === "operations"} onShiftChange={(next) => setCurrentShift(next ? { ...next, end_time: null, status: "active" } : null)} /></div>
    <section id="task-selection" className="scroll-mt-24 mt-5 rounded-3xl bg-surface p-4 shadow-sm ring-1 ring-line"><div className="flex items-center justify-between"><div><p className="text-xs uppercase tracking-[0.2em] text-ink-muted">Task selection</p><h2 className="mt-1 text-lg font-bold text-ink">{editingId ? "Modify task" : "Start a task"}</h2></div><BriefcaseBusiness className="h-5 w-5 text-violet-700" /></div><form onSubmit={submitTask} className="mt-4 space-y-3"><label className="block text-xs font-semibold text-ink-secondary">Service<select value={effectiveServiceId} onChange={(event) => { setServiceId(event.target.value); setRoomIds([]); setLevelId(""); setQuantityValue(""); setZoneContext(""); setAssetId(""); }} disabled={isPending || Boolean(activeTask && !editingId)} className="mt-1 w-full rounded-xl border border-line bg-surface-secondary px-3 py-3 text-sm font-normal text-ink"><option value="">Select a service</option>{services.map((service) => <option key={service.id} value={service.id}>{service.name} - GBP {Number(service.default_rate).toFixed(2)}</option>)}</select></label>
      {requiresRooms && <fieldset className="rounded-xl border border-line p-2.5"><legend className="px-1 text-xs font-semibold text-ink-secondary">Target units or spaces</legend>
        {(availableLevels.length > 0 || hasUnassignedLevelRooms) && <label className="mb-2 block text-xs font-semibold text-ink-secondary">Floor or level<select value={levelId} onChange={(event) => { setLevelId(event.target.value); setRoomIds([]); }} disabled={isPending || Boolean(activeTask && !editingId)} required className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-normal text-ink"><option value="">Choose a floor or level</option>{availableLevels.map((level) => <option key={level.id} value={level.id}>{level.name}</option>)}{hasUnassignedLevelRooms && <option value={UNASSIGNED_LEVEL_ID}>Unassigned level</option>}</select></label>}
        <div className="mb-2 flex items-center justify-between gap-3"><span className="text-xs text-ink-muted">Select spaces for this task</span><span className="shrink-0 rounded-md bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-800">{selectedRooms.length} selected</span></div><label className="block"><span className="sr-only">Search property spaces</span><input type="search" value={roomSearch} onChange={(event) => setRoomSearch(event.target.value)} placeholder="Find a space" disabled={isPending || Boolean(activeTask && !editingId)} className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted" /></label><div style={{ maxHeight: "11rem" }} className="mt-2 divide-y divide-line overflow-y-auto overscroll-contain rounded-lg border border-line bg-surface-secondary">{visibleHotelRooms.map((room) => <label key={room.id} className="flex min-h-12 cursor-pointer items-center gap-x-3 px-3 py-2 text-sm text-ink-secondary hover:bg-sky-50"><input type="checkbox" checked={roomIds.includes(room.id)} onChange={(event) => setRoomIds((current) => event.target.checked ? [...current, room.id] : current.filter((id) => id !== room.id))} disabled={isPending || Boolean(activeTask && !editingId)} className="ml-0.5 h-5 w-5 shrink-0 rounded border-line text-sky-700 focus:ring-sky-600" /><span className="min-w-0 flex-1"><span className="block truncate font-medium">{room.room_name}</span>{[room.floor_section, room.category].filter(Boolean).join(" · ") && <span className="mt-0.5 block truncate text-xs text-ink-muted">{[room.floor_section, room.category].filter(Boolean).join(" · ")}</span>}</span></label>)}{visibleHotelRooms.length === 0 && <p className="px-3 py-3 text-sm text-ink-muted">{hotelRooms.length ? "No units are available at this level." : "No active spaces are synced for this property."}</p>}</div></fieldset>}
      {requiresRooms && <div className="flex items-center justify-between rounded-lg bg-surface-secondary px-3 py-2 text-sm"><span className="text-ink-secondary">Selected units</span><span className="font-semibold tabular-nums text-ink">{selectedRooms.length}</span></div>}
      {selectedBlueprint.billingModel === "quantity" && !requiresRooms && <label className="block text-xs font-semibold text-ink-secondary">Target quantity{selectedBlueprint.unitLabel ? ` (${selectedBlueprint.unitLabel})` : ""}<input type="number" min="0.001" step="0.001" value={quantityValue} onChange={(event) => setQuantityValue(event.target.value)} required disabled={isPending || Boolean(activeTask && !editingId)} placeholder={selectedBlueprint.benchmarkQuantity === null ? "Enter target quantity" : `Benchmark: ${selectedBlueprint.benchmarkQuantity}`} className="mt-1 w-full rounded-xl border border-line bg-surface-secondary px-3 py-2.5 text-sm font-normal text-ink" /></label>}
      {selectedBlueprint.spatialMode !== "units" && <label className="block text-xs font-semibold text-ink-secondary">{selectedBlueprint.spatialMode === "open_zone" ? "Zone or section context" : "Operational context (optional)"}<input type="text" value={zoneContext} onChange={(event) => setZoneContext(event.target.value)} required={selectedBlueprint.spatialMode === "open_zone"} maxLength={120} disabled={isPending || Boolean(activeTask && !editingId)} placeholder="For example: loading area, east wing, or distribution route" className="mt-1 w-full rounded-xl border border-line bg-surface-secondary px-3 py-2.5 text-sm font-normal text-ink" /></label>}
      {selectedBlueprint.requiresAssetReference && <label className="block text-xs font-semibold text-ink-secondary">Asset identifier<input type="text" value={assetId} onChange={(event) => setAssetId(event.target.value)} required maxLength={120} disabled={isPending || Boolean(activeTask && !editingId)} placeholder="Enter the required asset ID" className="mt-1 w-full rounded-xl border border-line bg-surface-secondary px-3 py-2.5 text-sm font-normal text-ink" /></label>}
      <label className="block text-xs font-semibold text-ink-secondary">Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} required={requiresNotes} rows={3} className="mt-1 w-full rounded-xl border border-line bg-surface-secondary px-3 py-2.5 text-sm font-normal text-ink" placeholder="Add task notes" /></label>
      {editingId && (editingMediaLoading ? <p className="rounded-lg bg-surface-secondary px-3 py-2 text-sm text-ink-muted">Loading saved room media...</p> : <RoomMediaCapture workLogId={editingId} rooms={selectedRooms} initialMedia={editingMedia} storageConfigured={roomMediaConfigured} uploadsEnabled={editRoomSelectionSaved} />)}
      <div className="flex gap-2"><button type="submit" disabled={isPending || (!editingId && (!currentShift || Boolean(activeTask))) || !hotelId || !effectiveServiceId} className="flex-1 rounded-xl bg-sky-700 px-4 py-3 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-ink-muted">{isPending ? "Saving..." : editingId ? "Save Changes" : "Start task"}</button>{editingId && <button type="button" onClick={() => { setEditingId(null); setEditingMedia([]); setPersistedEditingRoomIds([]); setRoomIds([]); setNotes(""); }} className="rounded-xl border border-line px-4 py-3 text-sm font-semibold text-ink-secondary">Done</button>}</div></form></section>
    {message && (messageIsError
      ? <ActionErrorMessage error={message} className="mt-4" />
      : <p className="mt-4 rounded-xl bg-slate-900 px-3 py-2 text-sm text-white" role="status">{message}</p>)}
    </section>
    <section id="history-panel" role="tabpanel" aria-labelledby="history-tab" hidden={activeTab !== "history"}>
    <section className="mt-5">
      <div className="mb-4 rounded-2xl border border-line bg-surface p-4 text-ink shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">Overall efficiency</p>
        <p className="mt-1 text-2xl font-bold">{efficiency.score === null ? "Not enough data" : `${efficiency.score}%`}</p>
        <p className="mt-1 text-xs text-ink-secondary">
          {efficiency.scoredTasks
            ? `Based on ${efficiency.scoredTasks} timed tasks; room work target is 2 rooms/hour.`
            : "Room tasks need room counts; other tasks need a scheduled duration to be scored."}
        </p>
      </div>
      <div className="mb-3 flex items-center gap-2"><CalendarDays className="h-5 w-5 text-sky-700" /><h2 className="text-lg font-bold text-ink">Recent submissions</h2></div>
      <div className="mb-3 rounded-xl bg-surface p-3 shadow-sm ring-1 ring-line">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs font-semibold text-ink-secondary">From<span className="relative mt-1 block"><CalendarDays className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" /><input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => { setFromDate(event.target.value); setPage(1); }} className="block w-full rounded-lg border border-line py-2 pl-8 pr-2 text-sm font-normal text-ink" /></span></label>
          <label className="text-xs font-semibold text-ink-secondary">To<span className="relative mt-1 block"><CalendarDays className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" /><input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => { setToDate(event.target.value); setPage(1); }} className="block w-full rounded-lg border border-line py-2 pl-8 pr-2 text-sm font-normal text-ink" /></span></label>
          <button type="button" onClick={() => { setFromDate(""); setToDate(""); setPage(1); }} className="col-span-2 min-h-8 justify-self-end rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-ink-secondary">Clear dates</button>
        </div>
      </div>
      <div className="space-y-3">
        {visibleLogs.map((log) => {
          const ServiceIcon = submissionIcon(log.serviceName);
          return <article key={log.id} className="rounded-2xl bg-surface p-4 shadow-sm ring-1 ring-line">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sky-50 text-sky-700"><ServiceIcon className="h-4 w-4" /></span>
                <h3 className="min-w-0 font-semibold text-ink">{log.serviceName}</h3>
              </div>
              <StatusBadge status={log.is_locked ? "locked" : "pending"} label={log.is_locked ? "Locked for payroll" : "Pending approval"} className="shrink-0 text-[11px]" />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="min-w-0 rounded-lg bg-surface-secondary px-3 py-2"><p className="text-[11px] font-medium text-ink-muted">Property</p><p className="mt-0.5 flex items-center gap-1.5 text-sm text-ink-secondary"><MapPin className="h-3.5 w-3.5 shrink-0 text-ink-muted" /><span className="truncate">{log.hotelName}</span></p></div>
              <div className="min-w-0 rounded-lg bg-surface-secondary px-3 py-2"><p className="text-[11px] font-medium text-ink-muted">Rooms</p><p className="mt-0.5 flex items-center gap-1.5 text-sm text-ink-secondary"><BedDouble className="h-3.5 w-3.5 shrink-0 text-ink-muted" /><span className="truncate">{log.room_numbers.length ? log.room_numbers.join(", ") : `${log.rooms_completed} completed`}</span></p></div>
              <div className="min-w-0 rounded-lg bg-surface-secondary px-3 py-2"><p className="text-[11px] font-medium text-ink-muted">Manager</p><p className="mt-0.5 truncate text-sm text-ink-secondary">{log.manager_name ?? "Unassigned manager"}</p></div>
              <div className="min-w-0 rounded-lg bg-surface-secondary px-3 py-2"><p className="text-[11px] font-medium text-ink-muted">Completed</p><p className="mt-0.5 flex items-center gap-1.5 text-sm text-ink-secondary"><Clock3 className="h-3.5 w-3.5 shrink-0 text-ink-muted" /><span className="truncate">{log.end_time ? new Date(log.end_time).toLocaleString("en-GB", { timeZone: "Africa/Cairo", dateStyle: "medium", timeStyle: "short" }) : dateLabel(log.task_date)}</span></p></div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              {log.notes ? <p className="min-w-0 flex-1 rounded-lg border border-line bg-surface-secondary px-3 py-2 text-sm text-ink-secondary">{log.notes}</p> : <span className="flex-1" />}
              <div className="flex shrink-0 gap-2">
                <button type="button" onClick={() => setSelectedTask(toBriefTask(log))} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-secondary"><FileText className="h-3.5 w-3.5" />Details</button>
                {!log.is_locked && <button type="button" onClick={() => beginEdit(log)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-secondary"><Pencil className="h-3.5 w-3.5" />Modify</button>}
              </div>
            </div>
          </article>;
        })}
        {filteredLogs.length === 0 && <p className="rounded-2xl bg-surface p-4 text-sm text-ink-muted ring-1 ring-line">No completed tasks match this date range.</p>}
      </div>
      <DashboardPagination currentPage={currentPage} pageCount={pageCount} total={filteredLogs.length} pageSize={PAGE_SIZE} label="completed tasks" onPageChange={setPage} />
    </section>
    {selectedTask && <ServiceCard task={selectedTask} onClose={() => setSelectedTask(null)} onEdit={() => { const log = logs.find((item) => item.id === selectedTask.id); if (log && !log.is_locked) { setSelectedTask(null); beginEdit(log); } }} />}
     </section>
     </div>
  </main>;
}