"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Activity, CalendarDays, Check, CircleDollarSign, ClipboardList, Gauge, History, Hotel, Pencil, UsersRound, X, BookOpen, Wallet, Columns3, Filter, Search } from "lucide-react";
import { OperationalBrief } from "@/components/dashboard/OperationalBrief";
import { ServiceCard } from "@/components/dashboard/ServiceCard";
import { SystemManual } from "@/components/dashboard/SystemManual";
import { UserProfileMenu } from "@/components/layout/UserProfileMenu";
import type { BriefTask, ManagementBrief } from "@/lib/operationalBrief";
import { calculateTaskCost, resolveBillingUnit, resolveServiceRate, type ServicePricing } from "@/lib/servicePricing";
import { approveWorkLog as approveWorkLogAction, finalizeWorkLogWithoutClockOut, rejectWorkLog, updateWorkLog } from "./actions";
import { importRoomsFromGoogleSheet } from "./roomImportActions";
import { FullEditPanel } from "./FullEditPanel";
import { AdminPayrollTable, type PayrollLog } from "./AdminPayrollTable";
import { ActiveOperations } from "./ActiveOperations";
import type { PropertyRecord } from "./propertyActions";
import { TaskDispatchClient } from "@/app/settings/TaskDispatchClient";
import type { getTaskDispatchData } from "@/app/settings/taskActions";
import type { ServiceRecord } from "./serviceActions";
import { useWorkLogRealtimeRefresh } from "@/lib/useWorkLogRealtimeRefresh";
import type { LucideIcon } from "lucide-react";
import { DashboardPagination } from "@/components/dashboard/DashboardPagination";
import { LiveStatusIndicator } from "@/components/ui/LiveStatusIndicator";
import { ActiveAssignedTaskCard } from "@/components/dashboard/ActiveAssignedTaskCard";
import { showActionToast } from "@/components/ui/ActionToast";
import type { UserRole } from "@/lib/roles";

const DASHBOARD_TABS = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "operations", label: "Live Operations", icon: Activity },
  { id: "work-logs", label: "Work Logs & History", icon: ClipboardList },
  { id: "financials", label: "Financials & Payroll", icon: Wallet },
  { id: "audit", label: "Audit & Compliance", icon: History },
  { id: "manual", label: "System Manual", icon: BookOpen },
] as const;
type DashboardTab = typeof DASHBOARD_TABS[number]["id"];
const DASHBOARD_TAB_CHANGE = "management-dashboard-tab-change";
const RECORDS_PER_PAGE = 30;

function readDashboardTab(): DashboardTab {
  const value = new URLSearchParams(window.location.search).get("tab");
  return DASHBOARD_TABS.some((tab) => tab.id === value) ? value as DashboardTab : "overview";
}

function subscribeDashboardTab(callback: () => void) {
  window.addEventListener("popstate", callback);
  window.addEventListener(DASHBOARD_TAB_CHANGE, callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener(DASHBOARD_TAB_CHANGE, callback);
  };
}

function useDashboardTab() {
  return useSyncExternalStore(subscribeDashboardTab, readDashboardTab, () => "overview");
}

type Log = { id: string; user_id: string; hotel_id: string; service_id: string | null; cleanerName: string; hotelName: string; assigneeRole: string; start_time: string; end_time: string | null; task_date: string; status: string; cancelled_at?: string | null; rooms_completed: number; room_number: string | null; room_numbers: string[]; roomDetails?: { name: string; floor: string }[]; service_name_snapshot: string | null; service_description_snapshot: string | null; notes: string | null; cost_override?: number | string | null; owner_id: string | null; owner_name: string | null; manager_id: string | null; manager_name: string | null; responsibility_recorded_at: string | null; manager_approved: boolean; owner_approved: boolean; manager_rejected: boolean; owner_rejected: boolean; is_locked: boolean; rejection_notes?: string | null; services_config?: { name: string; default_rate: number; unit?: string }[] };
type Room = { id: string; hotel_id: string; room_name: string; floor_section?: string | null; category: string; status?: string };
type DispatchData = Awaited<ReturnType<typeof getTaskDispatchData>>;
type Props = { data: { userRole: string; currentUserId: string; userName: string; userEmail: string; userAvatarUrl: string | null; canManagePayrollTasks: boolean; canManageActiveOperations: boolean; hotels: PropertyRecord[]; services: ServiceRecord[]; cleaners: { id: string; name: string; primary_hotel_id: string | null }[]; rooms: Room[]; workLogs: Log[]; auditLogs: Log[]; payroll: PayrollLog[]; activeShifts: { id: string; user_id: string; start_time: string; cleanerName: string; task: Log | null }[]; activeTasks: Log[]; overrideAudit: OverrideAuditRecord[]; brief: ManagementBrief }; dispatchData?: DispatchData };
type AuditDetail = { label: string; value: string };
type OverrideAuditRecord = { id: string; entity_type: "task" | "shift"; action: string; actor_name: string; target_label: string; override_reason: string; previous_details: AuditDetail[]; new_details: AuditDetail[]; created_at: string };
type Draft = { hotelId: string; serviceId: string; roomId: string; roomsCompleted: string; roomNumber: string; notes: string; startTime: string; endTime: string; status: "assigned" | "active" | "completed" };
type WorkLogSortColumn = "date" | "cleaner" | "hotel" | "service" | "status";
type ApprovalFeedback = { logId: string; kind: "pending" | "success" | "error"; text: string };

function inputTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function durationHours(startTime: string, endTime: string) {
  if (!startTime || !endTime) return 0;
  return Math.max(0, (new Date(endTime).getTime() - new Date(startTime).getTime()) / 3_600_000);
}

function getLogLaborCost(log: Log) {
  const hours = log.end_time ? durationHours(log.start_time, log.end_time) : 0;
  const service = log.services_config?.[0];
  const serviceName = log.service_name_snapshot ?? service?.name ?? "Service";
  const rate = resolveServiceRate({ name: serviceName, default_rate: service?.default_rate });
  const unit = resolveBillingUnit(service?.unit, serviceName);
  return calculateTaskCost(hours, log.rooms_completed, { name: serviceName, default_rate: rate, unit }, log.cost_override);
}

function toBriefTask(log: Log): BriefTask {
  const hours = log.end_time ? durationHours(log.start_time, log.end_time) : 0;
  const service = log.services_config?.[0];
  const serviceName = log.service_name_snapshot ?? service?.name ?? "Service";
  const rate = resolveServiceRate({ name: serviceName, default_rate: service?.default_rate });
  const unit = resolveBillingUnit(service?.unit, serviceName);
  return { id: log.id, cleaner: log.cleanerName, hotel: log.hotelName, service: serviceName, serviceDescription: log.service_description_snapshot ?? serviceName, taskDate: log.task_date,   status: log.cancelled_at ? "cancelled" : log.status, startTime: log.start_time, endTime: log.end_time, ownerId: log.owner_id, ownerName: log.owner_name ?? "Unassigned owner", managerId: log.manager_id, managerName: log.manager_name ?? "Unassigned manager", responsibilityRecordedAt: log.responsibility_recorded_at ?? log.start_time, room: log.room_numbers.join(", ") || log.room_number || "", rooms: log.rooms_completed, hours, rate, cost: calculateTaskCost(hours, log.rooms_completed, { name: serviceName, unit, default_rate: rate }, log.cost_override), notes: log.notes ?? "", managerApproved: log.manager_approved, ownerApproved: log.owner_approved, managerRejected: log.manager_rejected, ownerRejected: log.owner_rejected, isLocked: log.is_locked, rejectionNotes: log.rejection_notes ?? "" };
}

export default function ManagementDashboardClient({ data, dispatchData }: Props) {
  useWorkLogRealtimeRefresh();
  const router = useRouter();
  const activeTab = useDashboardTab();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Log | null>(null);
  const [selectedTask, setSelectedTask] = useState<BriefTask | null>(null);
  const [selectedTaskFromAudit, setSelectedTaskFromAudit] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [optimisticPayrollLogs, setOptimisticPayrollLogs] = useState<PayrollLog[]>([]);
  const [message, setMessage] = useState("");
  const [approvalFeedback, setApprovalFeedback] = useState<ApprovalFeedback | null>(null);
  const [rejectionNotes, setRejectionNotes] = useState("");
  const [approvalOverrides, setApprovalOverrides] = useState<Record<string, Partial<Log>>>({});
  const [workLogPage, setWorkLogPage] = useState(1);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [needsActionOnly, setNeedsActionOnly] = useState(false);
  const [cleanerFilter, setCleanerFilter] = useState("");
  const [hotelFilter, setHotelFilter] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortColumn, setSortColumn] = useState<WorkLogSortColumn>("date");
  const [sortAscending, setSortAscending] = useState(false);
  const canManager = data.userRole === "admin" || data.userRole === "manager";
  const canOwner = data.userRole === "admin" || data.userRole === "owner";
  const pageSize = RECORDS_PER_PAGE;
  const displayedWorkLogs = data.workLogs.map((log) => ({ ...log, ...approvalOverrides[log.id] }));
  const displayedPayrollLogs = [...data.payroll, ...optimisticPayrollLogs.filter((optimistic) => !data.payroll.some((log) => log.id === optimistic.id))];
  const payrollApprovalsPendingSync = optimisticPayrollLogs.filter((optimistic) => !data.payroll.some((log) => log.id === optimistic.id)).length;
  const filteredWorkLogs = displayedWorkLogs.filter((log) => {
    const status = log.status === "active" ? "Active" : log.is_locked ? "Approved" : log.manager_rejected || log.owner_rejected ? "Rejected" : "Pending approval";
    return (!fromDate || log.task_date >= fromDate)
      && (!toDate || log.task_date <= toDate)
      && (!needsActionOnly || (log.status === "completed" && !log.is_locked))
      && (!cleanerFilter || log.user_id === cleanerFilter)
      && (!hotelFilter || log.hotel_id === hotelFilter)
      && (!serviceFilter || log.service_id === serviceFilter)
      && (!statusFilter || status === statusFilter);
  }).sort((left, right) => {
    const value = (log: Log) => {
      if (sortColumn === "cleaner") return log.cleanerName;
      if (sortColumn === "hotel") return log.hotelName;
      if (sortColumn === "service") return log.service_name_snapshot ?? log.services_config?.[0]?.name ?? "Service";
      if (sortColumn === "status") return log.status === "active" ? "Active" : log.is_locked ? "Approved" : log.manager_rejected || log.owner_rejected ? "Rejected" : "Pending approval";
      return log.task_date;
    };
    const comparison = value(left).localeCompare(value(right), "en", { numeric: true });
    return comparison * (sortAscending ? 1 : -1);
  });
  const pageCount = Math.max(1, Math.ceil(filteredWorkLogs.length / pageSize));
  const currentPage = Math.min(workLogPage, pageCount);
  const visibleWorkLogs = filteredWorkLogs.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const filteredWorkLogTotals = filteredWorkLogs.reduce((totals, log) => ({
    rooms: totals.rooms + log.rooms_completed,
    hours: totals.hours + (log.end_time ? durationHours(log.start_time, log.end_time) : 0),
  }), { rooms: 0, hours: 0 });
  const activeCleanerCount = data.activeShifts.length;
  const periodServiceCost = data.brief.hotels.reduce((total, hotel) => total + hotel.cost, 0);
  const filteredHotelLogs = hotelFilter
    ? displayedWorkLogs.filter((log) => log.hotel_id === hotelFilter)
    : displayedWorkLogs;
  const cleanerOptions = data.cleaners.filter((cleaner) => (!hotelFilter || cleaner.primary_hotel_id === hotelFilter) || filteredHotelLogs.some((log) => log.user_id === cleaner.id));
  const serviceOptions = data.services.filter((service) => filteredHotelLogs.some((log) => log.service_id === service.id));
  const completedLogs = displayedWorkLogs.filter((log) => log.status === "completed");
  const totalLaborCost = completedLogs.reduce((total, log) => total + getLogLaborCost(log), 0);
  const completedRooms = completedLogs.reduce((total, log) => total + log.rooms_completed, 0);
  const lockedPayrollLiability = displayedPayrollLogs.reduce((total, log) => {
    const hours = log.end_time ? durationHours(log.start_time, log.end_time) : 0;
    const service = log.services_config?.[0] ?? {};
    return total + calculateTaskCost(hours, log.rooms_completed, service, log.cost_override);
  }, 0);
  const propertyFinancials = data.hotels.map((hotel) => {
    const logs = completedLogs.filter((log) => log.hotel_id === hotel.id);
    const rooms = logs.reduce((total, log) => total + log.rooms_completed, 0);
    const cost = logs.reduce((total, log) => total + getLogLaborCost(log), 0);
    return { id: hotel.id, name: hotel.name, rooms, cost, costPerRoom: rooms ? cost / rooms : 0 };
  }).sort((left, right) => right.cost - left.cost);

  useEffect(() => { const timer = window.setInterval(() => router.refresh(), 15_000); return () => window.clearInterval(timer); }, [router]);
  const selectTab = (tab: DashboardTab) => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.pushState(null, "", url);
    window.dispatchEvent(new Event(DASHBOARD_TAB_CHANGE));
  };
  const run = (operation: () => Promise<unknown>, success = "Saved.") => startTransition(async () => {
    try { setMessage(""); await operation(); setEditing(null); setDraft(null); setMessage(success); showActionToast("success", success); router.refresh(); }
    catch (error) { const text = error instanceof Error ? error.message : "Operation failed."; setMessage(text); showActionToast("error", text); }
  });

  const approveWorkLog = async (logId: string, role: "manager" | "owner") => {
    const log = displayedWorkLogs.find((item) => item.id === logId);
    if (!log) throw new Error("Work log was not found.");
    const previous = approvalOverrides[log.id];
    const managerApproved = role === "manager" ? true : log.manager_approved;
    const ownerApproved = role === "owner" ? true : log.owner_approved;
    const optimistic: Partial<Log> = role === "manager"
      ? { manager_approved: true, manager_rejected: false, rejection_notes: null, is_locked: managerApproved && ownerApproved }
      : { owner_approved: true, owner_rejected: false, rejection_notes: null, is_locked: managerApproved && ownerApproved };
    setApprovalOverrides((current) => ({ ...current, [log.id]: { ...current[log.id], ...optimistic } }));
    const willLock = managerApproved && ownerApproved;
    if (willLock) {
      const payrollServices: [ServicePricing] = [log.services_config?.[0] ?? { name: log.service_name_snapshot ?? "Service", default_rate: 0, unit: "hourly" }];
      const payrollLog: PayrollLog = {
        id: log.id,
        user_id: log.user_id,
        hotel_id: log.hotel_id,
        cleanerName: log.cleanerName,
        hotelName: log.hotelName,
        start_time: log.start_time,
        end_time: log.end_time,
        task_date: log.task_date,
        rooms_completed: log.rooms_completed,
        room_number: log.room_number,
        notes: log.notes,
        owner_id: log.owner_id,
        owner_name: log.owner_name,
        manager_id: log.manager_id,
        manager_name: log.manager_name,
        responsibility_recorded_at: log.responsibility_recorded_at,
        services_config: payrollServices,
      };
      setOptimisticPayrollLogs((current) => [payrollLog, ...current.filter((item) => item.id !== log.id)]);
    }
    try {
      await approveWorkLogAction(log.id, role);
    } catch (error) {
      setApprovalOverrides((current) => {
        const next = { ...current };
        if (previous) next[log.id] = previous;
        else delete next[log.id];
        return next;
      });
      if (willLock) setOptimisticPayrollLogs((current) => current.filter((item) => item.id !== log.id));
      throw error;
    }
  };

  const submitApproval = (logId: string, role: "manager" | "owner") => {
    const log = displayedWorkLogs.find((item) => item.id === logId);
    if (!log) return;
    const bothApproved = role === "manager" ? log.owner_approved : log.manager_approved;
    const waitingRole = role === "manager" ? "owner" : "manager";
    const success = bothApproved
      ? "Both approvals are complete. The work log is locked for payroll."
      : `${role === "manager" ? "Manager" : "Owner"} approval saved. Waiting for ${waitingRole} approval.`;
    startTransition(async () => {
      setMessage("");
      setApprovalFeedback({ logId, kind: "pending", text: `Saving ${role} approval...` });
      try {
        await approveWorkLog(logId, role);
        setApprovalFeedback({ logId, kind: "success", text: success });
        showActionToast("success", success);
        router.refresh();
      } catch (error) {
        const text = error instanceof Error ? error.message : "Unable to save approval.";
        setApprovalFeedback({ logId, kind: "error", text });
        setMessage(text);
        showActionToast("error", text);
      }
    });
  };

  const beginEdit = (log: Log) => {
    setEditing(log);
    setDraft({
      hotelId: log.hotel_id,
      serviceId: data.services.find((service) => service.name === log.services_config?.[0]?.name)?.id ?? "",
      roomId: data.rooms.find((room) => room.hotel_id === log.hotel_id && room.room_name === log.room_number)?.id ?? "",
      roomsCompleted: String(log.rooms_completed),
      roomNumber: log.room_number ?? "",
      notes: log.notes ?? "",
      startTime: inputTime(log.start_time),
      endTime: inputTime(log.end_time),
      status: log.status === "completed" ? "completed" : log.status === "active" ? "active" : "assigned",
    });
  };

  const saveEdit = () => {
    if (!editing || !draft) return;
    if (!draft.startTime || !draft.endTime) { setMessage("Start and end time are required."); return; }
    if (durationHours(draft.startTime, draft.endTime) <= 0) { setMessage("End time must be after start time."); return; }
    run(() => updateWorkLog(editing.id, { hotelId: draft.hotelId, serviceId: draft.serviceId, startTime: draft.startTime, endTime: draft.endTime, roomsCompleted: Number(draft.roomsCompleted), roomNumber: draft.roomNumber, notes: draft.notes, ...(data.userRole === "admin" ? { status: draft.status } : {}) }), "Work log updated across all dashboards.");
  };

  const syncRooms = () => run(async () => { const result = await importRoomsFromGoogleSheet(); return result; }, "Rooms synced.");

  return <div className="enterprise-dashboard min-h-screen min-w-0 bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3"><span className="hidden h-9 w-9 items-center justify-center rounded-xl bg-slate-950 text-white sm:flex"><Hotel className="h-5 w-5" /></span><div><p className="text-xs font-medium uppercase tracking-wide text-slate-500">{data.userRole} workspace</p><h1 className="text-lg font-semibold text-slate-950">Crown Operations</h1></div></div>
          <div className="flex items-center gap-2">{data.userRole === "admin" && <button type="button" onClick={syncRooms} disabled={isPending} className="hidden min-h-11 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 sm:inline-flex">Fetch rooms</button>}<UserProfileMenu name={data.userName} email={data.userEmail} avatarUrl={data.userAvatarUrl} role={data.userRole} settingsHref="/settings" /></div>
        </div>
        <nav aria-label="Dashboard tabs" role="tablist" className="dashboard-tab-scrollbar flex min-w-0 max-w-full gap-1 overflow-x-auto border-t border-slate-100 px-3 py-2 [-webkit-overflow-scrolling:touch] sm:px-6 lg:px-8">
          {DASHBOARD_TABS.map(({ id, label, icon: Icon }) => <button key={id} id={`tab-${id}`} type="button" role="tab" aria-selected={activeTab === id} aria-controls={`panel-${id}`} onClick={() => selectTab(id)} className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition sm:text-sm ${activeTab === id ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"}`}><Icon aria-hidden="true" className="h-4 w-4" />{label}</button>)}
        </nav>
      </header>
      <main className="mx-auto min-w-0 max-w-[1600px] space-y-4 p-4 sm:p-6 lg:p-8">
        {message && <p className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm" role="status">{message}</p>}
        <section id="panel-overview" role="tabpanel" aria-labelledby="tab-overview" hidden={activeTab !== "overview"} className="space-y-5">
          {data.userRole === "manager" && (() => {
            const task = data.activeTasks.find((item) => item.user_id === data.currentUserId && item.status === "active" && !item.end_time);
            return task ? <ActiveAssignedTaskCard task={{
              id: task.id,
              name: task.service_name_snapshot ?? task.services_config?.[0]?.name ?? "Active task",
              hotelName: task.hotelName,
              roomLabel: task.roomDetails?.length
                ? task.roomDetails.map((room) => `${room.name} (${room.floor})`).join(", ")
                : task.room_numbers.join(", ") || task.room_number || "",
              startTime: task.start_time,
            }} /> : null;
          })()}
          {dispatchData && <TaskDispatchClient role={data.userRole as UserRole} {...dispatchData} />}
          <DashboardHeading title="Executive overview" description="Portfolio performance, approvals, and operating costs at a glance." />
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Properties" value={data.hotels.length} icon={Hotel} />
            <Metric label="Completed work logs" value={completedLogs.length} icon={ClipboardList} />
            <Metric label="Awaiting approval" value={data.workLogs.filter((log) => !log.is_locked && log.status === "completed").length} icon={Activity} />
            <Metric label="Active cleaners" value={activeCleanerCount} icon={UsersRound} />
            <Metric label="Operational labor cost" value={`GBP ${totalLaborCost.toFixed(2)}`} icon={CircleDollarSign} />
            <Metric label="Cost per cleaned room" value={`GBP ${completedRooms ? (totalLaborCost / completedRooms).toFixed(2) : "0.00"}`} icon={CircleDollarSign} />
            <Metric label="Locked payroll liability*" value={`GBP ${lockedPayrollLiability.toFixed(2)}`} icon={Wallet} />
            <Metric label="Service costs · brief period" value={`GBP ${periodServiceCost.toFixed(2)}`} icon={CircleDollarSign} />
          </section>
          <section aria-label="Live staff activity" className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-900">Live staff activity</h2>
              {data.activeShifts.length === 0 ? (
                <span className="text-sm text-slate-500">No cleaners are currently on shift.</span>
              ) : (
                data.activeShifts.map((shift) => (
                  <span key={shift.id} className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-sm">
                    <span className="font-medium text-slate-800">{shift.cleanerName}</span>
                    <LiveStatusIndicator isClockedIn showLabel={false} />
                  </span>
                ))
              )}
            </div>
          </section>
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-950">*Payroll settlement status is not stored in the current data model. This figure is the value of locked payroll records, not a verified unpaid balance.</p>
          <section className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-200/70 sm:p-6">
            <DashboardHeading title="Operational brief" description={`Operating summary · ${data.brief.periodLabel}`} />
            <OperationalBrief brief={data.brief} />
          </section>
        </section>

        <section id="panel-operations" role="tabpanel" aria-labelledby="tab-operations" hidden={activeTab !== "operations"} className="space-y-5">
          <DashboardHeading title="Live operations & shifts" description="Monitor on-shift cleaners and resolve hanging work with audited interventions." />
          <ActiveOperations shifts={data.activeShifts} tasks={data.activeTasks} canManage={data.canManageActiveOperations} />
        </section>

        <section id="panel-work-logs" role="tabpanel" aria-labelledby="tab-work-logs" hidden={activeTab !== "work-logs"} className="space-y-5">
          <DashboardHeading title="Work logs & history" description={`${filteredWorkLogs.length} matching records · review approvals, task details, and shift history.`} />
    <WorkLogFilters
      hotels={data.hotels.map(({ id, name }) => ({ id, name }))}
      cleaners={cleanerOptions}
      services={serviceOptions.map((service) => ({ id: service.id, name: service.name }))}
      needsActionOnly={needsActionOnly}
      setNeedsActionOnly={(value) => { setNeedsActionOnly(value); setWorkLogPage(1); }}
      cleaner={cleanerFilter}
      setCleaner={(value) => { setCleanerFilter(value); setWorkLogPage(1); }}
      hotel={hotelFilter}
      setHotel={(value) => {
        setHotelFilter(value);
        setCleanerFilter("");
        setServiceFilter("");
        setWorkLogPage(1);
      }}
      service={serviceFilter}
      setService={(value) => { setServiceFilter(value); setWorkLogPage(1); }}
      status={statusFilter}
      setStatus={(value) => { setStatusFilter(value); setWorkLogPage(1); }}
      sortColumn={sortColumn}
      setSortColumn={setSortColumn}
      sortAscending={sortAscending}
      setSortAscending={setSortAscending}
      fromDate={fromDate}
      toDate={toDate}
      setFromDate={(value) => { setFromDate(value); setWorkLogPage(1); }}
      setToDate={(value) => { setToDate(value); setWorkLogPage(1); }}
    />
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="admin-config-scroll max-h-[65vh] overflow-auto rounded-lg border border-slate-200 [-webkit-overflow-scrolling:touch]">
        <table className="min-w-[760px] w-full text-left text-sm">
          <thead className="sticky top-0 z-10 bg-white/95 text-slate-600 shadow-sm backdrop-blur"><tr><th className="px-3 py-3">Cleaner</th><th className="px-3 py-3">Hotel / service</th><th className="px-3 py-3 text-right">Shift</th><th className="px-3 py-3">Approvals</th><th className="px-3 py-3">Actions</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{visibleWorkLogs.map((log) => <WorkLogRow key={log.id} log={log} canManager={canManager} canOwner={canOwner} canBypassClockOut={data.userRole === "admin" || data.userRole === "owner" || log.assigneeRole !== "cleaner"} isPending={isPending} rejectionNotes={rejectionNotes} setRejectionNotes={setRejectionNotes} feedback={approvalFeedback?.logId === log.id ? approvalFeedback : null} onEdit={() => { setSelectedTaskFromAudit(false); setSelectedTask(toBriefTask(log)); }} onFinalize={() => run(() => finalizeWorkLogWithoutClockOut(log.id), "Task finalized and submitted for management approval.")} onApprove={(role) => submitApproval(log.id, role)} onReject={(role) => run(() => rejectWorkLog(log.id, role, rejectionNotes), `${role === "manager" ? "Manager" : "Owner"} rejection saved.`)} />)}{filteredWorkLogs.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">No work logs match this date range.</td></tr>}</tbody>
          <tfoot><tr className="font-semibold text-slate-900"><td className="px-3 py-3">Filtered totals ({filteredWorkLogs.length})</td><td className="px-3 py-3 text-right tabular-nums">{filteredWorkLogTotals.rooms} rooms</td><td className="px-3 py-3 text-right tabular-nums">{filteredWorkLogTotals.hours.toFixed(2)} hrs</td><td className="px-3 py-3" colSpan={2}>All matching rows</td></tr></tfoot>
        </table>
        </div>
      <DashboardPagination currentPage={currentPage} pageCount={pageCount} total={filteredWorkLogs.length} pageSize={pageSize} label="work logs" onPageChange={setWorkLogPage} />
    </section>
        </section>

        <section id="panel-financials" role="tabpanel" aria-labelledby="tab-financials" hidden={activeTab !== "financials"} className="space-y-5">
          <DashboardHeading title="Financials & payroll" description="Approved payroll records, configurable task overrides, and cost reporting." />
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Metric label="Operational labor cost" value={`GBP ${totalLaborCost.toFixed(2)}`} icon={CircleDollarSign} />
            <Metric label="Cost per completed room" value={`GBP ${completedRooms ? (totalLaborCost / completedRooms).toFixed(2) : "0.00"}`} icon={Activity} />
            <Metric label="Locked payroll liability*" value={`GBP ${lockedPayrollLiability.toFixed(2)}`} icon={Wallet} />
          </section>
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-950">*This is the total value of locked payroll records. The current schema does not track payment/settlement, so it cannot confirm unpaid balances.</p>
          <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/70">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-2"><div><h3 className="font-semibold text-slate-950">Property labor cost breakdown</h3><p className="mt-1 text-sm text-slate-600">Completed work logs and task-level overrides across your visible properties.</p></div><span className="text-xs text-slate-500">Revenue is not tracked in the current model</span></div>
            <div className="admin-config-scroll max-h-72 overflow-y-auto rounded-xl border border-slate-200 p-2">
              {propertyFinancials.map((property) => <article key={property.id} className="grid gap-2 border-b border-slate-100 px-3 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center sm:gap-6">
                <p className="truncate font-medium text-slate-900">{property.name}</p>
                <p className="text-sm text-slate-600">{property.rooms} units</p>
                <p className="text-sm font-semibold tabular-nums text-slate-900">GBP {property.cost.toFixed(2)}</p>
                <p className="text-xs tabular-nums text-slate-500">GBP {property.costPerRoom.toFixed(2)} / unit</p>
              </article>)}
              {!propertyFinancials.length && <p className="p-6 text-center text-sm text-slate-500">No visible properties.</p>}
            </div>
          </section>
          {payrollApprovalsPendingSync > 0 && <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900"><Check className="h-4 w-4 shrink-0" />Latest approval is reflected in this payroll preview while the saved totals refresh.</p>}
          <AdminPayrollTable
      logs={displayedPayrollLogs}
      services={data.services}
      hotels={data.hotels.map(({ id, name }) => ({ id, name }))}
      cleaners={data.cleaners}
      canManageTasks={data.canManagePayrollTasks}
          />
        </section>

        <section id="panel-audit" role="tabpanel" aria-labelledby="tab-audit" hidden={activeTab !== "audit"} className="space-y-5">
          <DashboardHeading title="Audit & compliance" description="Historical responsibility snapshots for work logs in your role-scoped property set." />
          <div className="space-y-5">
            <SnapshotTransparency logs={data.auditLogs} onOpen={(log) => { setSelectedTaskFromAudit(true); setSelectedTask(toBriefTask(log)); }} />
            <OverrideAuditTable entries={data.overrideAudit} />
          </div>
        </section>

        <section id="panel-manual" role="tabpanel" aria-labelledby="tab-manual" hidden={activeTab !== "manual"} className="space-y-5">
          <DashboardHeading title={`${data.userRole[0]?.toUpperCase()}${data.userRole.slice(1)} system manual`} description="Role-specific workflow guidance for this operations workspace." />
          <SystemManual role={data.userRole} />
        </section>

    {selectedTask && <ServiceCard task={selectedTask} onClose={() => setSelectedTask(null)} editLabel={selectedTaskFromAudit ? "Edit Record" : "Edit"} onEdit={selectedTaskFromAudit && data.userRole !== "admin" ? undefined : () => { const logs = selectedTaskFromAudit ? data.auditLogs : data.workLogs; const log = logs.find((item) => item.id === selectedTask.id); if (log) { setSelectedTask(null); beginEdit(log); } }} />}
    {editing && draft && <FullEditPanel draft={draft} setDraft={setDraft} services={data.services} hotels={data.hotels} rooms={data.rooms} saving={isPending} canEditStatus={data.userRole === "admin"} statusDisabled={Boolean(editing.cancelled_at)} onCancel={() => { setEditing(null); setDraft(null); }} onSave={saveEdit}/>}
      </main>
  </div>;
}

function WorkLogFilters({ hotels, cleaners, services, needsActionOnly, setNeedsActionOnly, cleaner, setCleaner, hotel, setHotel, service, setService, status, setStatus, sortColumn, setSortColumn, sortAscending, setSortAscending, fromDate, toDate, setFromDate, setToDate }: {
  hotels: { id: string; name: string }[];
  cleaners: { id: string; name: string }[];
  services: { id: string; name: string }[];
  needsActionOnly: boolean;
  setNeedsActionOnly: (value: boolean) => void;
  cleaner: string;
  setCleaner: (value: string) => void;
  hotel: string;
  setHotel: (value: string) => void;
  service: string;
  setService: (value: string) => void;
  status: string;
  setStatus: (value: string) => void;
  sortColumn: WorkLogSortColumn;
  setSortColumn: (value: WorkLogSortColumn) => void;
  sortAscending: boolean;
  setSortAscending: (value: boolean) => void;
  fromDate: string;
  toDate: string;
  setFromDate: (value: string) => void;
  setToDate: (value: string) => void;
}) {
  const statuses = ["Active", "Approved", "Pending approval", "Rejected"];
  const selectClass = "mt-1 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-normal text-slate-800";
  return <section className="mb-4 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200" aria-label="Work log filters"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Work log filters</p><p className="mt-0.5 text-xs text-slate-500">Filter by column or sort the current results.</p></div><button type="button" aria-pressed={needsActionOnly} onClick={() => setNeedsActionOnly(!needsActionOnly)} className={`min-h-11 rounded-lg px-3 py-2 text-sm font-semibold ${needsActionOnly ? "bg-amber-700 text-white" : "border border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100"}`}>Needs Action / Pending Approval</button></div><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><label className="text-xs font-semibold text-slate-500">Cleaner<select value={cleaner} onChange={(event) => setCleaner(event.target.value)} className={selectClass}><option value="">All cleaners</option>{cleaners.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="text-xs font-semibold text-slate-500">Hotel<select value={hotel} onChange={(event) => setHotel(event.target.value)} className={selectClass}><option value="">All hotels</option>{hotels.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="text-xs font-semibold text-slate-500">Service<select value={service} onChange={(event) => setService(event.target.value)} className={selectClass}><option value="">All services</option>{services.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="text-xs font-semibold text-slate-500">Approval status<select value={status} onChange={(event) => setStatus(event.target.value)} className={selectClass}><option value="">All statuses</option>{statuses.map((value) => <option key={value}>{value}</option>)}</select></label><label className="text-xs font-semibold text-slate-500">From task date<input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => setFromDate(event.target.value)} className={selectClass} /></label><label className="text-xs font-semibold text-slate-500">To task date<input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => setToDate(event.target.value)} className={selectClass} /></label><label className="text-xs font-semibold text-slate-500">Sort column<select value={sortColumn} onChange={(event) => setSortColumn(event.target.value as WorkLogSortColumn)} className={selectClass}><option value="date">Task date</option><option value="cleaner">Cleaner (A-Z)</option><option value="hotel">Hotel (A-Z)</option><option value="service">Service (A-Z)</option><option value="status">Approval status</option></select></label><button type="button" onClick={() => setSortAscending(!sortAscending)} className="min-h-11 self-end rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">{sortAscending ? "Ascending A-Z" : "Descending Z-A"}</button></div><div className="mt-3 flex justify-end"><button type="button" onClick={() => { setFromDate(""); setToDate(""); }} className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Clear dates</button></div></section>;
}

function WorkLogRow({ log, canManager, canOwner, canBypassClockOut, isPending, rejectionNotes, setRejectionNotes, feedback, onEdit, onFinalize, onApprove, onReject }: { log: Log; canManager: boolean; canOwner: boolean; canBypassClockOut: boolean; isPending: boolean; rejectionNotes: string; setRejectionNotes: (value: string) => void; feedback: ApprovalFeedback | null; onEdit: () => void; onFinalize: () => void; onApprove: (role: "manager" | "owner") => void; onReject: (role: "manager" | "owner") => void }) {
  const hours = log.end_time ? durationHours(log.start_time, log.end_time) : 0;
  return <tr className="align-top">
    <td className="px-3 py-4 font-medium text-slate-900">{log.cleanerName}</td>
    <td className="px-3 py-4 text-slate-600">{log.hotelName}<br /><span className="text-xs">{log.services_config?.[0]?.name ?? "Service"} - {log.rooms_completed} rooms</span></td>
    <td className="px-3 py-4 text-slate-600">{new Date(log.start_time).toLocaleString("en-GB", { timeZone: "Africa/Cairo" })}<br /><span className="text-xs">{log.end_time ? `${hours.toFixed(2)} hours` : "Active"}</span></td>
    <td className="px-3 py-4 text-xs">
      <div className={log.manager_approved ? "font-semibold text-emerald-700" : "text-amber-700"}>Manager: {log.manager_approved ? "Approved" : log.manager_rejected ? "Rejected" : "Pending"}</div>
      <div className={log.owner_approved ? "font-semibold text-emerald-700" : "text-amber-700"}>Owner: {log.owner_approved ? "Approved" : log.owner_rejected ? "Rejected" : "Pending"}</div>
      {log.is_locked && <div className="mt-1 font-semibold text-slate-900">Locked for payroll</div>}
    </td>
    <td className="px-3 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onEdit} className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 text-slate-700" title="Open full work-log details"><Pencil className="h-4 w-4" /></button>
        {!log.is_locked && (log.status !== "completed" ? <><span className="rounded-lg bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">Clock out required</span>{canBypassClockOut && log.status === "active" && <button type="button" disabled={isPending} onClick={onFinalize} className="min-h-11 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-xs font-semibold text-sky-900 hover:bg-sky-100 disabled:cursor-wait disabled:opacity-60">Finalize / Bypass Clock-Out</button>}</> : <>
          {canManager && (log.manager_approved ? <ApprovalComplete label="Manager approved" /> : <ApprovalButtons label="Approve (Manager)" onApprove={() => onApprove("manager")} onReject={() => onReject("manager")} isPending={isPending} />)}
          {canOwner && (log.owner_approved ? <ApprovalComplete label="Owner approved" /> : <ApprovalButtons label="Approve (Owner)" onApprove={() => onApprove("owner")} onReject={() => onReject("owner")} isPending={isPending} />)}
        </>)}
      </div>
      {!log.is_locked && <input value={rejectionNotes} onChange={(event) => setRejectionNotes(event.target.value)} placeholder="Rejection note" className="mt-2 w-full rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-900" />}
      {feedback && <p role={feedback.kind === "error" ? "alert" : "status"} className={`mt-2 text-xs ${feedback.kind === "error" ? "font-medium text-rose-700" : feedback.kind === "success" ? "text-emerald-700" : "text-slate-500"}`}>{feedback.text}</p>}
    </td>
  </tr>;
}

function DashboardHeading({ title, description }: { title: string; description: string }) {
  return <header className="rounded-2xl bg-white px-5 py-4 shadow-sm ring-1 ring-slate-200/70">
    <h2 className="text-xl font-bold tracking-tight text-slate-950">{title}</h2>
    <p className="mt-1 text-sm text-slate-600">{description}</p>
  </header>;
}

function ApprovalComplete({ label }: { label: string }) {
  return <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800"><Check className="h-3.5 w-3.5" />{label}</span>;
}
function ApprovalButtons({ label, onApprove, onReject, isPending }: { label: string; onApprove: () => void; onReject: () => void; isPending: boolean }) { return <><button type="button" disabled={isPending} onClick={onApprove} className="min-h-11 rounded-lg bg-slate-900 px-2 py-1 text-xs font-semibold text-white disabled:cursor-wait disabled:opacity-60"><Check className="inline h-3 w-3"/> {isPending ? "Saving..." : label}</button><button type="button" disabled={isPending} onClick={onReject} className="min-h-11 rounded-lg bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 disabled:cursor-wait disabled:opacity-60"><X className="inline h-3 w-3"/> Reject</button></>; }
function PayrollFiltered({ logs }: { logs: PayrollLog[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const filteredLogs = logs.filter((log) => log.task_date >= from && log.task_date <= to).sort((left, right) => right.start_time.localeCompare(left.start_time));
  const total = filteredLogs.reduce((sum, log) => {
    const hours = log.end_time ? durationHours(log.start_time, log.end_time) : 0;
    return sum + calculateTaskCost(hours, log.rooms_completed, log.services_config?.[0] ?? {}, log.cost_override);
  }, 0);
  return <section className="mt-6 rounded-3xl bg-white p-4 text-slate-900 shadow-sm ring-1 ring-slate-200">
    <div className="flex flex-col gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-xl font-bold">Payroll</h2><p className="mt-1 text-sm text-slate-500">Configured service rates · newest records first</p></div><div className="grid grid-cols-2 items-end gap-3"><label className="text-xs font-semibold uppercase tracking-wide text-slate-500">From<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900" /></label><label className="text-xs font-semibold uppercase tracking-wide text-slate-500">To<input type="date" value={to} min={from} max={today} onChange={(event) => setTo(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900" /></label></div></div>
    <div className="my-4 grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-slate-900 p-4 text-white"><p className="text-xs uppercase tracking-wide text-slate-300">Gross service costs</p><p className="mt-1 text-2xl font-bold">GBP {total.toFixed(2)}</p></div><div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Payroll records</p><p className="mt-1 text-2xl font-bold text-slate-900">{filteredLogs.length}</p></div><div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Date range</p><p className="mt-1 text-sm font-semibold text-slate-900">{from} to {to}</p></div></div>
    <div className="admin-config-scroll overflow-x-auto [-webkit-overflow-scrolling:touch]"><table className="min-w-[680px] text-left text-sm"><thead className="border-b border-slate-200 text-slate-500"><tr><th className="px-3 py-3">Task date/time</th><th className="px-3 py-3">Cleaner</th><th className="px-3 py-3">Hotel / service</th><th className="px-3 py-3">Hours</th><th className="px-3 py-3">Rooms</th><th className="px-3 py-3">Calculated cost</th></tr></thead><tbody className="divide-y divide-slate-100">{filteredLogs.map((log) => {
      const hours = log.end_time ? durationHours(log.start_time, log.end_time) : 0;
      const service = log.services_config?.[0] ?? {};
      const rate = resolveServiceRate(service);
      const unit = resolveBillingUnit(service.unit, service.name ?? "");
      const cost = calculateTaskCost(hours, log.rooms_completed, { ...service, default_rate: rate, unit }, log.cost_override);
      const unitLabel = unit === "hourly" ? "/hr" : unit === "per_room" ? "/room" : "fixed";
      return <tr key={log.id}><td className="px-3 py-3 text-slate-700">{new Date(log.start_time).toLocaleString("en-GB", { timeZone: "Africa/Cairo" })}</td><td className="px-3 py-3 font-medium text-slate-900">{log.cleanerName}</td><td className="px-3 py-3 text-slate-700">{log.hotelName}<br /><span className="text-xs">{service.name ?? "Service"} · GBP {rate.toFixed(2)} {unitLabel}</span></td><td className="px-3 py-3 text-slate-700">{hours.toFixed(2)}</td><td className="px-3 py-3 text-slate-700">{log.rooms_completed}</td><td className="px-3 py-3 font-semibold text-slate-900">GBP {cost.toFixed(2)}</td></tr>;
    })}{filteredLogs.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">No locked payroll records in this date range.</td></tr>}</tbody></table></div>
  </section>;
}

function PayrollFilteredLegacy({ logs }: { logs: PayrollLog[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const filteredLogs = logs.filter((log) => log.task_date >= from && log.task_date <= to).sort((left, right) => right.start_time.localeCompare(left.start_time));
  const total = filteredLogs.reduce((sum, log) => { const hours = log.end_time ? durationHours(log.start_time, log.end_time) : 0; return sum + calculateTaskCost(hours, log.rooms_completed, log.services_config?.[0] ?? {}, log.cost_override); }, 0);
  const isMonthToDate = from === monthStart;
  return <section className="mt-6 rounded-3xl bg-white p-4 text-slate-900 shadow-sm ring-1 ring-slate-200"><div className="flex flex-col gap-4 border-b border-slate-100 pb-4 lg:flex-row lg:items-end lg:justify-between"><div><h2 className="text-xl font-bold">Payroll</h2><p className="mt-1 text-sm text-slate-500">{isMonthToDate ? "Month to date" : "Selected period"} · newest records first</p></div><div className="flex flex-wrap items-end gap-3"><label className="text-xs font-semibold uppercase tracking-wide text-slate-500">From<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900" /></label><label className="text-xs font-semibold uppercase tracking-wide text-slate-500">To<input type="date" value={to} min={from} max={today} onChange={(event) => setTo(event.target.value)} className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900" /></label><CalendarDays className="mb-2 h-5 w-5 text-sky-700" /></div></div><div className="my-4 grid gap-3 sm:grid-cols-3"><div className="rounded-2xl bg-slate-900 p-4 text-white"><p className="text-xs uppercase tracking-wide text-slate-300">Total {isMonthToDate ? "month to date" : "for period"}</p><p className="mt-1 text-2xl font-bold">GBP {total.toFixed(2)}</p></div><div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Payroll records</p><p className="mt-1 text-2xl font-bold text-slate-900">{filteredLogs.length}</p></div><div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Date range</p><p className="mt-1 text-sm font-semibold text-slate-900">{from} to {to}</p></div></div><div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="border-b border-slate-200 text-slate-500"><tr><th className="px-3 py-3">Task date/time</th><th className="px-3 py-3">Cleaner</th><th className="px-3 py-3">Hotel / service</th><th className="px-3 py-3">Hours</th><th className="px-3 py-3">Rooms</th><th className="px-3 py-3">Calculated wage</th></tr></thead><tbody className="divide-y divide-slate-100">{filteredLogs.map((log) => { const hours = log.end_time ? durationHours(log.start_time, log.end_time) : 0; const rate = Number(log.services_config?.[0]?.default_rate ?? 0); const wage = /per room/i.test(log.services_config?.[0]?.name ?? "") ? log.rooms_completed * rate : hours * rate; return <tr key={log.id}><td className="px-3 py-3 text-slate-700">{new Date(log.start_time).toLocaleString("en-GB", { timeZone: "Africa/Cairo" })}</td><td className="px-3 py-3 font-medium text-slate-900">{log.cleanerName}</td><td className="px-3 py-3 text-slate-700">{log.hotelName}<br /><span className="text-xs">{log.services_config?.[0]?.name ?? "Service"} · GBP {rate.toFixed(2)}</span></td><td className="px-3 py-3 text-slate-700">{hours.toFixed(2)}</td><td className="px-3 py-3 text-slate-700">{log.rooms_completed}</td><td className="px-3 py-3 font-semibold text-slate-900">GBP {wage.toFixed(2)}</td></tr>; })}{filteredLogs.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">No locked payroll records in this date range.</td></tr>}</tbody></table></div></section>;
  return <section className="mt-6 rounded-3xl bg-white p-4 text-slate-900 shadow-sm ring-1 ring-slate-200"><div className="flex flex-col gap-4 border-b border-slate-100 pb-4 lg:flex-row lg:items-end lg:justify-between"><div><h2 className="text-xl font-bold">Payroll</h2><p className="mt-1 text-sm text-slate-500">{isMonthToDate ? "Month to date" : "Selected period"} · newest records first</p></div><div className="grid grid-cols-2 items-end gap-3"><label className="text-xs font-semibold uppercase tracking-wide text-slate-500">From<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900" /></label><label className="text-xs font-semibold uppercase tracking-wide text-slate-500">To<input type="date" value={to} min={from} max={today} onChange={(event) => setTo(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900" /></label></div></div><div className="my-4 grid gap-3 sm:grid-cols-3"><div className="rounded-2xl bg-slate-900 p-4 text-white"><p className="text-xs uppercase tracking-wide text-slate-300">Gross service costs</p><p className="mt-1 text-2xl font-bold">GBP {total.toFixed(2)}</p></div><div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Payroll records</p><p className="mt-1 text-2xl font-bold text-slate-900">{filteredLogs.length}</p></div><div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Date range</p><p className="mt-1 text-sm font-semibold text-slate-900">{from} to {to}</p></div></div><div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="border-b border-slate-200 text-slate-500"><tr><th className="px-3 py-3">Task date/time</th><th className="px-3 py-3">Cleaner</th><th className="px-3 py-3">Hotel / service</th><th className="px-3 py-3">Hours</th><th className="px-3 py-3">Rooms</th><th className="px-3 py-3">Calculated cost</th></tr></thead><tbody className="divide-y divide-slate-100">{filteredLogs.map((log) => { const hours = log.end_time ? durationHours(log.start_time, log.end_time) : 0; const service = log.services_config?.[0] ?? {}; const rate = resolveServiceRate(service); const unit = resolveBillingUnit(service.unit, service.name ?? ""); const wage = calculateTaskCost(hours, log.rooms_completed, { ...service, default_rate: rate, unit }, log.cost_override); return <tr key={log.id}><td className="px-3 py-3 text-slate-700">{new Date(log.start_time).toLocaleString("en-GB", { timeZone: "Africa/Cairo" })}</td><td className="px-3 py-3 font-medium text-slate-900">{log.cleanerName}</td><td className="px-3 py-3 text-slate-700">{log.hotelName}<br /><span className="text-xs">{service.name ?? "Service"} · GBP {rate.toFixed(2)} {unit === "hourly" ? "/hr" : unit === "per_room" ? "/room" : "fixed"}</span></td><td className="px-3 py-3 text-slate-700">{hours.toFixed(2)}</td><td className="px-3 py-3 text-slate-700">{log.rooms_completed}</td><td className="px-3 py-3 font-semibold text-slate-900">GBP {wage.toFixed(2)}</td></tr>; })}{filteredLogs.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">No locked payroll records in this date range.</td></tr>}</tbody></table></div></section>;
}
function Payroll({ logs }: { logs: PayrollLog[] }) { return <section className="mt-6 rounded-3xl bg-white p-4 text-slate-900 shadow-sm ring-1 ring-slate-200"><div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-bold text-slate-900">Payroll</h2><span className="text-sm text-slate-500">Locked logs only</span></div><div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="border-b border-slate-200 text-slate-500"><tr><th className="px-3 py-3">Cleaner</th><th className="px-3 py-3">Hotel</th><th className="px-3 py-3">Service</th><th className="px-3 py-3">Hours</th><th className="px-3 py-3">Rooms</th><th className="px-3 py-3">Calculated wage</th></tr></thead><tbody className="divide-y divide-slate-100">{logs.map((log) => { const hours = log.end_time ? durationHours(log.start_time, log.end_time) : 0; const rate = Number(log.services_config?.[0]?.default_rate ?? 0); const wage = /per room/i.test(log.services_config?.[0]?.name ?? "") ? log.rooms_completed * rate : hours * rate; return <tr key={log.id}><td className="px-3 py-3 font-medium text-slate-900">{log.cleanerName}</td><td className="px-3 py-3 text-slate-700">{log.hotelName}</td><td className="px-3 py-3 text-slate-700">{log.services_config?.[0]?.name ?? "Service"} - GBP {rate.toFixed(2)}</td><td className="px-3 py-3 text-slate-700">{hours.toFixed(2)}</td><td className="px-3 py-3 text-slate-700">{log.rooms_completed}</td><td className="px-3 py-3 font-semibold text-slate-900">GBP {wage.toFixed(2)}</td></tr>; })}{logs.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">No locked logs are available for payroll.</td></tr>}</tbody></table></div></section>; }
function Metric({ label, value, icon: Icon }: { label: string; value: number | string; icon: LucideIcon }) {
  return <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-medium text-slate-500">{label}</p><p className="mt-2 truncate text-2xl font-semibold tabular-nums text-slate-950">{value}</p></div><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><Icon className="h-4 w-4" /></span></div>
  </article>;
}
type AuditColumnId = "date" | "workerFacility" | "owner" | "manager" | "snapshot" | "service" | "status" | "hours" | "value" | "approvals" | "room";
type AuditFilter = { selected?: string[]; from?: string; to?: string; min?: string; max?: string };
type AuditColumn = { id: AuditColumnId; label: string };

const AUDIT_COLUMNS: AuditColumn[] = [
  { id: "date", label: "Task date/time" },
  { id: "workerFacility", label: "Worker/Facility" },
  { id: "owner", label: "Responsible Owner" },
  { id: "manager", label: "Responsible Manager" },
  { id: "snapshot", label: "Snapshot recorded" },
  { id: "service", label: "Service/Task Name" },
  { id: "status", label: "Lifecycle Status" },
  { id: "hours", label: "Hours/Duration" },
  { id: "value", label: "Financial Value (GBP)" },
  { id: "approvals", label: "Approvals (Manager/Owner)" },
  { id: "room", label: "Room/Zone reference" },
];
const DEFAULT_AUDIT_COLUMNS: AuditColumnId[] = ["date", "workerFacility", "owner", "manager", "snapshot"];
const AUDIT_COLUMNS_STORAGE_KEY = "management-audit-visible-columns";
const AUDIT_COLUMNS_CHANGE_EVENT = "management-audit-columns-change";

function subscribeAuditColumns(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(AUDIT_COLUMNS_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(AUDIT_COLUMNS_CHANGE_EVENT, callback);
  };
}

function getAuditColumnsSnapshot() {
  try {
    return window.localStorage.getItem(AUDIT_COLUMNS_STORAGE_KEY) ?? "";
  } catch {
    return "__storage_unavailable__";
  }
}

function getAuditColumnsServerSnapshot() {
  return "";
}

function lifecycleStatus(log: Log) {
  if (log.cancelled_at || log.status === "cancelled") return "Cancelled";
  if (log.status === "active") return "Active";
  if (log.status === "completed") return "Completed";
  return "Pending";
}

function approvalSummary(log: Log) {
  const manager = log.manager_approved ? "Approved" : log.manager_rejected ? "Rejected" : "Pending";
  const owner = log.owner_approved ? "Approved" : log.owner_rejected ? "Rejected" : "Pending";
  return `Manager: ${manager} · Owner: ${owner}`;
}

function logRoomReference(log: Log) {
  const rooms = log.roomDetails?.map((room) => `${room.name}${room.floor ? ` · ${room.floor}` : ""}`) ?? [];
  return rooms.join(", ") || log.room_numbers.join(", ") || log.room_number || "No room or zone";
}

function AuditMultiSelect({ label, values, selected, onChange }: { label: string; values: string[]; selected: string[]; onChange: (values: string[]) => void }) {
  const [search, setSearch] = useState("");
  const visibleValues = values.filter((value) => value.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <fieldset className="mt-3">
    <legend className="text-xs font-semibold text-slate-700">{label}</legend>
    <label className="mt-2 flex items-center gap-2 rounded-md border border-slate-200 px-2">
      <Search className="h-3.5 w-3.5 text-slate-400" />
      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${label.toLowerCase()}`} className="min-h-9 w-full border-0 bg-transparent text-xs text-slate-800 outline-none" />
    </label>
    <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
      {visibleValues.map((value) => <label key={value} className="flex items-start gap-2 rounded px-1 py-1 text-xs text-slate-700 hover:bg-slate-50">
        <input type="checkbox" checked={selected.includes(value)} onChange={(event) => onChange(event.target.checked ? [...selected, value] : selected.filter((item) => item !== value))} className="mt-0.5" />
        <span className="break-words">{value || "Unavailable"}</span>
      </label>)}
      {!visibleValues.length && <p className="py-2 text-xs text-slate-500">No matching values.</p>}
    </div>
  </fieldset>;
}

function AuditFilterPopover({ label, active, onSelectAll, onClear, children }: { label: string; active: boolean; onSelectAll: () => void; onClear: () => void; children: ReactNode }) {
  return <details className="relative inline-block align-middle">
    <summary aria-label={`Filter ${label}`} title={`Filter ${label}`} className={`flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md hover:bg-slate-100 ${active ? "text-sky-700" : "text-slate-500"}`}>
      <Filter className="h-4 w-4" />
    </summary>
    <div className="absolute right-0 z-30 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-xl">
      <p className="text-xs font-semibold text-slate-800">Filter: {label}</p>
      <div className="mt-2 flex gap-2 border-b border-slate-100 pb-2">
        <button type="button" onClick={onSelectAll} className="text-xs font-semibold text-sky-700 hover:underline">Select All</button>
        <button type="button" onClick={onClear} className="text-xs font-semibold text-slate-600 hover:underline">Clear Filter</button>
      </div>
      {children}
    </div>
  </details>;
}

function SnapshotTransparency({ logs, onOpen }: { logs: Log[]; onOpen: (log: Log) => void }) {
  const [page, setPage] = useState(1);
  const [preferencesMessage, setPreferencesMessage] = useState("");
  const [filters, setFilters] = useState<Record<string, AuditFilter>>({});
  const storedColumns = useSyncExternalStore(subscribeAuditColumns, getAuditColumnsSnapshot, getAuditColumnsServerSnapshot);
  const storedPreference = useMemo(() => {
    if (!storedColumns) return { columns: DEFAULT_AUDIT_COLUMNS, message: "" };
    if (storedColumns === "__storage_unavailable__") return { columns: DEFAULT_AUDIT_COLUMNS, message: "Column preferences are unavailable in this browser." };
    try {
      const parsed: unknown = JSON.parse(storedColumns);
      if (!Array.isArray(parsed) || !parsed.every((id): id is AuditColumnId => typeof id === "string" && AUDIT_COLUMNS.some((column) => column.id === id))) {
        return { columns: DEFAULT_AUDIT_COLUMNS, message: "Saved column preferences have an invalid format." };
      }
      return { columns: parsed.length ? parsed : DEFAULT_AUDIT_COLUMNS, message: "" };
    } catch (error) {
      return { columns: DEFAULT_AUDIT_COLUMNS, message: error instanceof Error ? error.message : "Unable to load saved column preferences." };
    }
  }, [storedColumns]);
  const visibleColumnIds = storedPreference.columns;

  const uniqueValues = (getValue: (log: Log) => string) => [...new Set(logs.map(getValue))].sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
  const selectedFor = (key: string) => filters[key]?.selected ?? [];
  const updateFilter = (key: string, update: AuditFilter | null) => {
    setFilters((current) => {
      const next = { ...current };
      if (update) next[key] = { ...current[key], ...update };
      else delete next[key];
      return next;
    });
    setPage(1);
  };
  const matchesSelected = (key: string, value: string) => {
    const selected = selectedFor(key);
    return selected.length === 0 || selected.includes(value);
  };
  const hasFilter = (key: string) => {
    const filter = filters[key];
    return Boolean(filter && ((filter.selected?.length ?? 0) > 0 || filter.from || filter.to || filter.min || filter.max));
  };
  const allValues = (key: string) => {
    switch (key) {
      case "worker": return uniqueValues((log) => log.cleanerName);
      case "facility": return uniqueValues((log) => log.hotelName);
      case "owner": return uniqueValues((log) => log.owner_name ?? "Unassigned owner");
      case "manager": return uniqueValues((log) => log.manager_name ?? "Unassigned manager");
      case "snapshot": return uniqueValues((log) => log.responsibility_recorded_at?.slice(0, 10) ?? "");
      case "service": return uniqueValues((log) => log.service_name_snapshot ?? log.services_config?.[0]?.name ?? "Service");
      case "status": return uniqueValues(lifecycleStatus);
      case "approvals": return uniqueValues(approvalSummary);
      case "room": return uniqueValues(logRoomReference);
      default: return [];
    }
  };
  const numericMatches = (key: string, value: number) => {
    const filter = filters[key];
    return (!filter?.min || value >= Number(filter.min)) && (!filter?.max || value <= Number(filter.max));
  };
  const filteredLogs = logs.filter((log) => {
    const workerAndFacilityMatch = matchesSelected("worker", log.cleanerName) && matchesSelected("facility", log.hotelName);
    const date = log.task_date.slice(0, 10);
    const snapshotDate = log.responsibility_recorded_at?.slice(0, 10) ?? "";
    const service = log.service_name_snapshot ?? log.services_config?.[0]?.name ?? "Service";
    const hours = log.end_time ? durationHours(log.start_time, log.end_time) : 0;
    return workerAndFacilityMatch
      && matchesSelected("owner", log.owner_name ?? "Unassigned owner")
      && matchesSelected("manager", log.manager_name ?? "Unassigned manager")
      && matchesSelected("service", service)
      && matchesSelected("status", lifecycleStatus(log))
      && matchesSelected("approvals", approvalSummary(log))
      && matchesSelected("room", logRoomReference(log))
      && (!filters.date?.from || date >= filters.date.from)
      && (!filters.date?.to || date <= filters.date.to)
      && (!filters.snapshot?.from || snapshotDate >= filters.snapshot.from)
      && (!filters.snapshot?.to || snapshotDate <= filters.snapshot.to)
      && numericMatches("hours", hours)
      && numericMatches("value", getLogLaborCost(log));
  }).sort((left, right) => right.start_time.localeCompare(left.start_time));
  const pageCount = Math.max(1, Math.ceil(filteredLogs.length / RECORDS_PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const visibleLogs = filteredLogs.slice((currentPage - 1) * RECORDS_PER_PAGE, currentPage * RECORDS_PER_PAGE);
  const visibleColumns = AUDIT_COLUMNS.filter((column) => visibleColumnIds.includes(column.id));
  const setSelected = (key: string, values: string[]) => updateFilter(key, { selected: values });
  const setRange = (key: string, field: "from" | "to" | "min" | "max", value: string) => updateFilter(key, { [field]: value });
  const renderFilter = (column: AuditColumn) => {
    const clear = () => {
      updateFilter(column.id === "workerFacility" ? "worker" : column.id, null);
      if (column.id === "workerFacility") updateFilter("facility", null);
    };
    const selectAll = () => {
      if (column.id === "workerFacility") {
        setSelected("worker", allValues("worker"));
        setSelected("facility", allValues("facility"));
      } else if (column.id === "date" || column.id === "snapshot" || column.id === "hours" || column.id === "value") {
        updateFilter(column.id, {});
      } else {
        setSelected(column.id, allValues(column.id));
      }
    };
    const active = column.id === "workerFacility" ? hasFilter("worker") || hasFilter("facility") : hasFilter(column.id);
    return <AuditFilterPopover key={column.id} label={column.label} active={active} onSelectAll={selectAll} onClear={clear}>
      {column.id === "workerFacility" ? <>
        <AuditMultiSelect label="Worker" values={allValues("worker")} selected={selectedFor("worker")} onChange={(values) => setSelected("worker", values)} />
        <AuditMultiSelect label="Facility" values={allValues("facility")} selected={selectedFor("facility")} onChange={(values) => setSelected("facility", values)} />
      </> : ["owner", "manager", "service", "status", "approvals", "room"].includes(column.id) ? <AuditMultiSelect label={column.label} values={allValues(column.id)} selected={selectedFor(column.id)} onChange={(values) => setSelected(column.id, values)} />
        : column.id === "date" || column.id === "snapshot" ? <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="text-xs text-slate-600">From<input type="date" value={filters[column.id]?.from ?? ""} onChange={(event) => setRange(column.id, "from", event.target.value)} className="mt-1 w-full rounded border border-slate-200 p-1.5 text-xs" /></label>
          <label className="text-xs text-slate-600">To<input type="date" value={filters[column.id]?.to ?? ""} onChange={(event) => setRange(column.id, "to", event.target.value)} className="mt-1 w-full rounded border border-slate-200 p-1.5 text-xs" /></label>
        </div> : <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="text-xs text-slate-600">Min<input type="number" min="0" step="any" value={filters[column.id]?.min ?? ""} onChange={(event) => setRange(column.id, "min", event.target.value)} className="mt-1 w-full rounded border border-slate-200 p-1.5 text-xs" /></label>
          <label className="text-xs text-slate-600">Max<input type="number" min="0" step="any" value={filters[column.id]?.max ?? ""} onChange={(event) => setRange(column.id, "max", event.target.value)} className="mt-1 w-full rounded border border-slate-200 p-1.5 text-xs" /></label>
        </div>}
    </AuditFilterPopover>;
  };
  const toggleColumn = (id: AuditColumnId, checked: boolean) => {
    const next = checked
      ? AUDIT_COLUMNS.filter((column) => visibleColumnIds.includes(column.id) || column.id === id).map((column) => column.id)
      : visibleColumnIds.filter((columnId) => columnId !== id);
    if (!next.length) return;
    try {
      window.localStorage.setItem(AUDIT_COLUMNS_STORAGE_KEY, JSON.stringify(next));
      setPreferencesMessage("");
      window.dispatchEvent(new Event(AUDIT_COLUMNS_CHANGE_EVENT));
    } catch (error) {
      setPreferencesMessage(error instanceof Error ? error.message : "Unable to save column preferences.");
    }
  };

  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-200/50 sm:p-5">
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div><h3 className="text-base font-semibold text-slate-950">Responsibility history</h3><p className="mt-1 text-sm text-slate-500">Historical task, responsibility, approval, and financial details.</p></div>
      <details className="relative">
        <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Columns3 className="h-4 w-4" />Columns</summary>
        <div className="absolute right-0 z-30 mt-1 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
          <p className="mb-2 text-xs font-semibold text-slate-700">Visible columns</p>
          <div className="max-h-72 space-y-1 overflow-y-auto">{AUDIT_COLUMNS.map((column) => <label key={column.id} className="flex items-center gap-2 rounded px-1 py-1.5 text-xs text-slate-700 hover:bg-slate-50"><input type="checkbox" checked={visibleColumnIds.includes(column.id)} onChange={(event) => toggleColumn(column.id, event.target.checked)} />{column.label}</label>)}</div>
        </div>
      </details>
    </div>
    {(preferencesMessage || storedPreference.message) && <p role="status" className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{preferencesMessage || storedPreference.message}</p>}
    <div className="admin-config-scroll max-h-[65vh] overflow-auto rounded-lg border border-slate-200 [-webkit-overflow-scrolling:touch]">
      <table className="min-w-max w-full text-left text-sm">
        <thead className="sticky top-0 z-10 bg-white/95 text-slate-600 shadow-sm backdrop-blur"><tr>{visibleColumns.map((column) => <th key={column.id} className="whitespace-nowrap px-3 py-2"><div className="flex items-center gap-1"><span>{column.label}</span>{renderFilter(column)}</div></th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">{visibleLogs.map((log) => {
          const service = log.service_name_snapshot ?? log.services_config?.[0]?.name ?? "Service";
          const hours = log.end_time ? durationHours(log.start_time, log.end_time) : 0;
          const cells: Record<AuditColumnId, ReactNode> = {
            date: <button type="button" onClick={() => onOpen(log)} className="whitespace-nowrap text-left text-sky-800 underline decoration-transparent underline-offset-2 hover:text-sky-950 hover:decoration-current focus:decoration-current">{new Date(log.start_time).toLocaleString("en-GB", { timeZone: "Africa/Cairo" })}</button>,
            workerFacility: <>{log.cleanerName}<span className="block text-xs text-slate-500">{log.hotelName}</span></>,
            owner: log.owner_name ?? "Unassigned owner",
            manager: log.manager_name ?? "Unassigned manager",
            snapshot: log.responsibility_recorded_at ? new Date(log.responsibility_recorded_at).toLocaleString("en-GB", { timeZone: "Africa/Cairo" }) : "Unavailable",
            service,
            status: lifecycleStatus(log),
            hours: `${hours.toFixed(2)} hrs`,
            value: `GBP ${getLogLaborCost(log).toFixed(2)}`,
            approvals: approvalSummary(log),
            room: logRoomReference(log),
          };
          return <tr key={log.id} className="align-top hover:bg-slate-50">{visibleColumns.map((column) => <td key={column.id} className="max-w-64 whitespace-nowrap px-3 py-3 text-slate-700">{cells[column.id]}</td>)}</tr>;
        })}{filteredLogs.length === 0 && <tr><td colSpan={visibleColumns.length} className="px-3 py-8 text-center text-slate-500">No work-log snapshots match these filters.</td></tr>}</tbody>
        <tfoot><tr className="font-semibold text-slate-900"><td colSpan={visibleColumns.length} className="px-3 py-3">Filtered audit records <span className="float-right tabular-nums">{filteredLogs.length}</span></td></tr></tfoot>
      </table>
    </div>
    <DashboardPagination currentPage={currentPage} pageCount={pageCount} total={filteredLogs.length} pageSize={RECORDS_PER_PAGE} label="audit records" onPageChange={setPage} />
  </section>;
}

function getAuditChanges(entry: OverrideAuditRecord) {
  const before = new Map(entry.previous_details.map((detail) => [detail.label, detail.value]));
  const after = new Map(entry.new_details.map((detail) => [detail.label, detail.value]));
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((label) => before.get(label) !== after.get(label))
    .map((label) => ({ label, before: before.get(label) ?? "—", after: after.get(label) ?? "—" }));
}

function AuditDetailsPanel({ title, details }: { title: string; details: AuditDetail[] }) {
  return (
    <section className="min-w-0">
      <h4 className="mb-2 text-sm font-semibold text-slate-800">{title}</h4>
      {details.length ? (
        <dl className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          {details.map((detail) => <div key={detail.label} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 text-xs"><dt className="font-medium text-slate-500">{detail.label}</dt><dd className="break-words text-slate-800">{detail.value}</dd></div>)}
        </dl>
      ) : <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">No additional details.</p>}
    </section>
  );
}

function OverrideAuditTable({ entries }: { entries: OverrideAuditRecord[] }) {
  const [page, setPage] = useState(1);
  const [rawEntry, setRawEntry] = useState<OverrideAuditRecord | null>(null);
  const pageCount = Math.max(1, Math.ceil(entries.length / RECORDS_PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const visibleEntries = entries.slice((currentPage - 1) * RECORDS_PER_PAGE, currentPage * RECORDS_PER_PAGE);
  return <>
  <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-200/50 sm:p-5">
    <div className="mb-4"><h3 className="text-base font-semibold text-slate-950">Operational intervention audit</h3><p className="mt-1 text-sm text-slate-500">Force clock-outs and task overrides, including the actor, reason, and recorded change.</p></div>
    <div className="admin-config-scroll max-h-[65vh] overflow-auto rounded-lg border border-slate-200 [-webkit-overflow-scrolling:touch]">
      <table className="min-w-[900px] w-full text-left text-sm">
        <thead className="sticky top-0 z-10 bg-white/95 text-slate-600 shadow-sm backdrop-blur"><tr><th className="px-3 py-3">When</th><th className="px-3 py-3">Entity / action</th><th className="px-3 py-3">Actor</th><th className="px-3 py-3">Reason</th><th className="px-3 py-3">Recorded change</th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {visibleEntries.map((entry) => {
            const changes = getAuditChanges(entry);
            return <tr key={entry.id} className="align-top hover:bg-slate-50">
            <td className="whitespace-nowrap px-3 py-3 text-slate-600">{new Date(entry.created_at).toLocaleString("en-GB", { timeZone: "Africa/Cairo" })}</td>
            <td className="px-3 py-3"><span className="font-semibold capitalize text-slate-900">{entry.entity_type}</span><span className="block text-xs capitalize text-slate-500">{entry.action.replaceAll("_", " ")}</span><span className="mt-1 block max-w-48 text-xs text-slate-600">{entry.target_label}</span></td>
            <td className="max-w-40 px-3 py-3 text-slate-700"><span className="block truncate font-medium">{entry.actor_name}</span></td>
            <td className="max-w-sm whitespace-normal px-3 py-3 text-slate-700">{entry.override_reason}</td>
            <td className="px-3 py-3 text-xs text-slate-600">
              <div className="space-y-1.5">{changes.length ? changes.map((change) => <p key={change.label}><span className="font-semibold text-slate-800">{change.label}:</span> {change.label === "Cancelled" && change.after === "Yes" ? "Yes" : <>{change.before} <span aria-label="changed to" className="px-1 text-slate-400">→</span> {change.after}</>}</p>) : <span className="text-slate-500">No tracked fields changed</span>}</div>
              <button type="button" onClick={() => setRawEntry(entry)} className="mt-2 min-h-11 rounded-lg border border-slate-200 px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50">View details</button>
            </td>
          </tr>;
          })}
          {!entries.length && <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">No operational interventions have been recorded.</td></tr>}
        </tbody>
      </table>
    </div>
    <DashboardPagination currentPage={currentPage} pageCount={pageCount} total={entries.length} pageSize={RECORDS_PER_PAGE} label="interventions" onPageChange={setPage} />
  </section>
    {rawEntry && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="override-raw-details-title">
      <section className="max-h-[calc(100dvh-2rem)] w-full max-w-3xl overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-2xl">
        <div className="flex items-start justify-between gap-3"><div><h3 id="override-raw-details-title" className="text-lg font-semibold text-slate-950">Intervention details</h3><p className="mt-1 text-sm capitalize text-slate-600">{rawEntry.action.replaceAll("_", " ")} · {rawEntry.entity_type} · {rawEntry.actor_name}</p><p className="mt-1 text-sm font-medium text-slate-700">{rawEntry.target_label}</p></div><button type="button" onClick={() => setRawEntry(null)} aria-label="Close details" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700"><span className="font-semibold">Reason:</span> {rawEntry.override_reason}</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <AuditDetailsPanel title="Before" details={rawEntry.previous_details} />
          <AuditDetailsPanel title="After" details={rawEntry.new_details} />
        </div>
        <div className="mt-4 flex justify-end"><button type="button" onClick={() => setRawEntry(null)} className="min-h-11 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Close</button></div>
      </section>
    </div>}
  </>;
}

function EditPanel({ draft, setDraft, services, hotels, saving, onCancel, onSave }: { draft: Draft; setDraft: (draft: Draft) => void; services: { id: string; name: string }[]; hotels: { id: string; name: string }[]; saving: boolean; onCancel: () => void; onSave: () => void }) { const hours = durationHours(draft.startTime, draft.endTime); return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"><div className="w-full max-w-lg rounded-2xl bg-white p-5 text-slate-900 shadow-xl"><div className="flex items-center justify-between"><h2 className="text-xl font-bold">Edit work log</h2><button type="button" onClick={onCancel} className="rounded-lg p-2 text-slate-500"><X className="h-5 w-5"/></button></div><div className="mt-4 grid gap-3"><select value={draft.hotelId} onChange={(event) => setDraft({...draft, hotelId: event.target.value})} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-900">{hotels.map((hotel) => <option key={hotel.id} value={hotel.id}>{hotel.name}</option>)}</select><select value={draft.serviceId} onChange={(event) => setDraft({...draft, serviceId: event.target.value})} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-900">{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select><div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-slate-600">Start time<input type="datetime-local" value={draft.startTime} onChange={(event) => setDraft({...draft, startTime: event.target.value})} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-900"/></label><label className="text-xs font-semibold text-slate-600">End time<input type="datetime-local" value={draft.endTime} onChange={(event) => setDraft({...draft, endTime: event.target.value})} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-900"/></label></div><div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Calculated duration: <strong>{hours.toFixed(2)} hours</strong></div><label className="text-xs font-semibold text-slate-600">Rooms completed<input type="number" min="0" value={draft.roomsCompleted} onChange={(event) => setDraft({...draft, roomsCompleted: event.target.value})} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-slate-900"/></label><label className="text-xs font-semibold text-slate-600">Room number<input value={draft.roomNumber} onChange={(event) => setDraft({...draft, roomNumber: event.target.value})} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-slate-900"/></label><label className="text-xs font-semibold text-slate-600">Notes<textarea value={draft.notes} onChange={(event) => setDraft({...draft, notes: event.target.value})} rows={4} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-slate-900"/></label></div><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={onCancel} className="rounded-lg border px-4 py-2 text-sm text-slate-700">Cancel</button><button type="button" disabled={saving} onClick={onSave} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Save changes</button></div></div></div>; }
