"use client";

import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Activity, CalendarDays, Check, CircleDollarSign, ClipboardList, Gauge, History, Hotel, Pencil, UsersRound, X, BookOpen, Building2, Wallet } from "lucide-react";
import { OperationalBrief } from "@/components/dashboard/OperationalBrief";
import { ServiceCard } from "@/components/dashboard/ServiceCard";
import { SystemManual } from "@/components/dashboard/SystemManual";
import { UserProfileMenu } from "@/components/layout/UserProfileMenu";
import type { BriefTask, ManagementBrief } from "@/lib/operationalBrief";
import { calculateTaskCost, resolveBillingUnit, resolveServiceRate, type ServicePricing } from "@/lib/servicePricing";
import { approveWorkLog as approveWorkLogAction, rejectWorkLog, updateWorkLog } from "./actions";
import { importRoomsFromGoogleSheet } from "./roomImportActions";
import { FullEditPanel } from "./FullEditPanel";
import { AdminPayrollTable, type PayrollLog } from "./AdminPayrollTable";
import { ActiveOperations } from "./ActiveOperations";
import { ServicePricingManager } from "./ServicePricingManager";
import type { ServiceRecord } from "./serviceActions";
import type { PropertyRecord } from "./propertyActions";
import { useWorkLogRealtimeRefresh } from "@/lib/useWorkLogRealtimeRefresh";
import type { LucideIcon } from "lucide-react";
import { DashboardPagination } from "@/components/dashboard/DashboardPagination";

const DASHBOARD_TABS = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "operations", label: "Live Operations", icon: Activity },
  { id: "properties", label: "Properties & Services", icon: Building2 },
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

type Log = { id: string; user_id: string; hotel_id: string; service_id: string | null; cleanerName: string; hotelName: string; start_time: string; end_time: string | null; task_date: string; status: string; rooms_completed: number; room_number: string | null; room_numbers: string[]; service_name_snapshot: string | null; service_description_snapshot: string | null; notes: string | null; cost_override?: number | string | null; owner_id: string | null; owner_name: string | null; manager_id: string | null; manager_name: string | null; responsibility_recorded_at: string | null; manager_approved: boolean; owner_approved: boolean; manager_rejected: boolean; owner_rejected: boolean; is_locked: boolean; rejection_notes?: string | null; services_config?: { name: string; default_rate: number; unit?: string }[] };
type Room = { id: string; hotel_id: string; room_name: string; category: string; status?: string };
type Props = { data: { userRole: string; userName: string; userEmail: string; canViewServices: boolean; canManageServices: boolean; canManagePayrollTasks: boolean; canManageActiveOperations: boolean; hotels: PropertyRecord[]; propertyAssignees: { id: string; name: string; role: "owner" | "manager" }[]; cleaners: { id: string; name: string; primary_hotel_id: string | null }[]; services: ServiceRecord[]; rooms: Room[]; workLogs: Log[]; payroll: PayrollLog[]; activeShifts: { id: string; user_id: string; start_time: string; cleanerName: string; task: Log | null }[]; activeTasks: Log[]; overrideAudit: OverrideAuditRecord[]; brief: ManagementBrief } };
type OverrideAuditRecord = { id: string; entity_type: "task" | "shift"; entity_id: string; action: string; actor_id: string; override_reason: string; previous_values: Record<string, unknown>; new_values: Record<string, unknown>; created_at: string };
type Draft = { hotelId: string; serviceId: string; roomId: string; roomsCompleted: string; roomNumber: string; notes: string; startTime: string; endTime: string };
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
  return { id: log.id, cleaner: log.cleanerName, hotel: log.hotelName, service: serviceName, serviceDescription: log.service_description_snapshot ?? serviceName, taskDate: log.task_date, status: log.status, startTime: log.start_time, endTime: log.end_time, ownerId: log.owner_id, ownerName: log.owner_name ?? "Unassigned owner", managerId: log.manager_id, managerName: log.manager_name ?? "Unassigned manager", responsibilityRecordedAt: log.responsibility_recorded_at ?? log.start_time, room: log.room_numbers.join(", ") || log.room_number || "", rooms: log.rooms_completed, hours, rate, cost: calculateTaskCost(hours, log.rooms_completed, { name: serviceName, unit, default_rate: rate }, log.cost_override), notes: log.notes ?? "", managerApproved: log.manager_approved, ownerApproved: log.owner_approved, managerRejected: log.manager_rejected, ownerRejected: log.owner_rejected, isLocked: log.is_locked, rejectionNotes: log.rejection_notes ?? "" };
}

export default function ManagementDashboardClient({ data }: Props) {
  useWorkLogRealtimeRefresh();
  const router = useRouter();
  const activeTab = useDashboardTab();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Log | null>(null);
  const [selectedTask, setSelectedTask] = useState<BriefTask | null>(null);
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
    window.history.pushState(window.history.state, "", url);
    window.dispatchEvent(new Event(DASHBOARD_TAB_CHANGE));
  };
  const run = (operation: () => Promise<unknown>, success = "Saved.") => startTransition(async () => {
    try { setMessage(""); await operation(); setEditing(null); setDraft(null); setMessage(success); router.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Operation failed."); }
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
        router.refresh();
      } catch (error) {
        const text = error instanceof Error ? error.message : "Unable to save approval.";
        setApprovalFeedback({ logId, kind: "error", text });
        setMessage(text);
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
    });
  };

  const saveEdit = () => {
    if (!editing || !draft) return;
    if (!draft.startTime || !draft.endTime) { setMessage("Start and end time are required."); return; }
    if (durationHours(draft.startTime, draft.endTime) <= 0) { setMessage("End time must be after start time."); return; }
    run(() => updateWorkLog(editing.id, { hotelId: draft.hotelId, serviceId: draft.serviceId, startTime: draft.startTime, endTime: draft.endTime, roomsCompleted: Number(draft.roomsCompleted), roomNumber: draft.roomNumber, notes: draft.notes }), "Work log updated across all dashboards.");
  };

  const syncRooms = () => run(async () => { const result = await importRoomsFromGoogleSheet(); return result; }, "Rooms synced.");

  return <div className="enterprise-dashboard min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3"><span className="hidden h-9 w-9 items-center justify-center rounded-xl bg-slate-950 text-white sm:flex"><Hotel className="h-5 w-5" /></span><div><p className="text-xs font-medium uppercase tracking-wide text-slate-500">{data.userRole} workspace</p><h1 className="text-lg font-semibold text-slate-950">Crown Operations</h1></div></div>
          <div className="flex items-center gap-2">{data.userRole === "admin" && <button type="button" onClick={syncRooms} disabled={isPending} className="hidden rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 sm:inline-flex">Fetch rooms</button>}<UserProfileMenu name={data.userName} email={data.userEmail} role={data.userRole} settingsHref="/settings" /></div>
        </div>
        <nav aria-label="Dashboard tabs" role="tablist" className="flex gap-1 overflow-x-auto border-t border-slate-100 px-3 py-2 sm:px-6 lg:px-8">
          {DASHBOARD_TABS.map(({ id, label, icon: Icon }) => <button key={id} id={`tab-${id}`} type="button" role="tab" aria-selected={activeTab === id} aria-controls={`panel-${id}`} onClick={() => selectTab(id)} className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition sm:text-sm ${activeTab === id ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"}`}><Icon aria-hidden="true" className="h-4 w-4" />{label}</button>)}
        </nav>
      </header>
      <main className="mx-auto max-w-[1600px] space-y-4 p-4 sm:p-6 lg:p-8">
        {message && <p className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm" role="status">{message}</p>}
        <section id="panel-overview" role="tabpanel" aria-labelledby="tab-overview" hidden={activeTab !== "overview"} className="space-y-5">
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

        <section id="panel-properties" role="tabpanel" aria-labelledby="tab-properties" hidden={activeTab !== "properties"} className="space-y-5">
          <DashboardHeading title="Properties & services" description="Property assignments and the shared service catalog." />
          {data.canViewServices ? <ServicePricingManager
            key={JSON.stringify([data.services, data.hotels])}
            initialServices={data.services}
            initialProperties={data.hotels}
            propertyAssignees={data.propertyAssignees}
            canManageServices={data.canManageServices}
            canManageProperties={data.userRole === "admin"}
          /> : <p className="rounded-2xl bg-white p-6 text-sm text-slate-600 ring-1 ring-slate-200">Your account does not have permission to view service configuration.</p>}
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
      <div className="max-h-[65vh] overflow-auto rounded-lg border border-slate-200">
        <table className="min-w-[760px] w-full text-left text-sm">
          <thead className="sticky top-0 z-10 bg-white/95 text-slate-600 shadow-sm backdrop-blur"><tr><th className="px-3 py-3">Cleaner</th><th className="px-3 py-3">Hotel / service</th><th className="px-3 py-3 text-right">Shift</th><th className="px-3 py-3">Approvals</th><th className="px-3 py-3">Actions</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{visibleWorkLogs.map((log) => <WorkLogRow key={log.id} log={log} canManager={canManager} canOwner={canOwner} isPending={isPending} rejectionNotes={rejectionNotes} setRejectionNotes={setRejectionNotes} feedback={approvalFeedback?.logId === log.id ? approvalFeedback : null} onEdit={() => setSelectedTask(toBriefTask(log))} onApprove={(role) => submitApproval(log.id, role)} onReject={(role) => run(() => rejectWorkLog(log.id, role, rejectionNotes), `${role === "manager" ? "Manager" : "Owner"} rejection saved.`)} />)}{filteredWorkLogs.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">No work logs match this date range.</td></tr>}</tbody>
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
            <SnapshotTransparency logs={data.workLogs} />
            <OverrideAuditTable entries={data.overrideAudit} />
          </div>
        </section>

        <section id="panel-manual" role="tabpanel" aria-labelledby="tab-manual" hidden={activeTab !== "manual"} className="space-y-5">
          <DashboardHeading title={`${data.userRole[0]?.toUpperCase()}${data.userRole.slice(1)} system manual`} description="Role-specific workflow guidance for this operations workspace." />
          <SystemManual role={data.userRole} />
        </section>

    {selectedTask && <ServiceCard task={selectedTask} onClose={() => setSelectedTask(null)} onEdit={() => { const log = data.workLogs.find((item) => item.id === selectedTask.id); if (log) { setSelectedTask(null); beginEdit(log); } }} />}
    {editing && draft && <FullEditPanel draft={draft} setDraft={setDraft} services={data.services} hotels={data.hotels} rooms={data.rooms} saving={isPending} onCancel={() => { setEditing(null); setDraft(null); }} onSave={saveEdit}/>} 
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
  const selectClass = "mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-normal text-slate-800";
  return <section className="mb-4 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-200" aria-label="Work log filters"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Work log filters</p><p className="mt-0.5 text-xs text-slate-500">Filter by column or sort the current results.</p></div><button type="button" aria-pressed={needsActionOnly} onClick={() => setNeedsActionOnly(!needsActionOnly)} className={`rounded-lg px-3 py-2 text-sm font-semibold ${needsActionOnly ? "bg-amber-700 text-white" : "border border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100"}`}>Needs Action / Pending Approval</button></div><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><label className="text-xs font-semibold text-slate-500">Cleaner<select value={cleaner} onChange={(event) => setCleaner(event.target.value)} className={selectClass}><option value="">All cleaners</option>{cleaners.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="text-xs font-semibold text-slate-500">Hotel<select value={hotel} onChange={(event) => setHotel(event.target.value)} className={selectClass}><option value="">All hotels</option>{hotels.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="text-xs font-semibold text-slate-500">Service<select value={service} onChange={(event) => setService(event.target.value)} className={selectClass}><option value="">All services</option>{services.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="text-xs font-semibold text-slate-500">Approval status<select value={status} onChange={(event) => setStatus(event.target.value)} className={selectClass}><option value="">All statuses</option>{statuses.map((value) => <option key={value}>{value}</option>)}</select></label><label className="text-xs font-semibold text-slate-500">From task date<input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => setFromDate(event.target.value)} className={selectClass} /></label><label className="text-xs font-semibold text-slate-500">To task date<input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => setToDate(event.target.value)} className={selectClass} /></label><label className="text-xs font-semibold text-slate-500">Sort column<select value={sortColumn} onChange={(event) => setSortColumn(event.target.value as WorkLogSortColumn)} className={selectClass}><option value="date">Task date</option><option value="cleaner">Cleaner (A-Z)</option><option value="hotel">Hotel (A-Z)</option><option value="service">Service (A-Z)</option><option value="status">Approval status</option></select></label><button type="button" onClick={() => setSortAscending(!sortAscending)} className="self-end rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">{sortAscending ? "Ascending A-Z" : "Descending Z-A"}</button></div><div className="mt-3 flex justify-end"><button type="button" onClick={() => { setFromDate(""); setToDate(""); }} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Clear dates</button></div></section>;
}

function WorkLogRow({ log, canManager, canOwner, isPending, rejectionNotes, setRejectionNotes, feedback, onEdit, onApprove, onReject }: { log: Log; canManager: boolean; canOwner: boolean; isPending: boolean; rejectionNotes: string; setRejectionNotes: (value: string) => void; feedback: ApprovalFeedback | null; onEdit: () => void; onApprove: (role: "manager" | "owner") => void; onReject: (role: "manager" | "owner") => void }) {
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
        <button type="button" onClick={onEdit} className="rounded-lg border border-slate-200 p-2 text-slate-700" title="Open full work-log details"><Pencil className="h-4 w-4" /></button>
        {!log.is_locked && (log.status !== "completed" ? <span className="rounded-lg bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">Clock out required</span> : <>
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
function ApprovalButtons({ label, onApprove, onReject, isPending }: { label: string; onApprove: () => void; onReject: () => void; isPending: boolean }) { return <><button type="button" disabled={isPending} onClick={onApprove} className="rounded-lg bg-slate-900 px-2 py-1 text-xs font-semibold text-white disabled:cursor-wait disabled:opacity-60"><Check className="inline h-3 w-3"/> {isPending ? "Saving..." : label}</button><button type="button" disabled={isPending} onClick={onReject} className="rounded-lg bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 disabled:cursor-wait disabled:opacity-60"><X className="inline h-3 w-3"/> Reject</button></>; }
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
    <div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="border-b border-slate-200 text-slate-500"><tr><th className="px-3 py-3">Task date/time</th><th className="px-3 py-3">Cleaner</th><th className="px-3 py-3">Hotel / service</th><th className="px-3 py-3">Hours</th><th className="px-3 py-3">Rooms</th><th className="px-3 py-3">Calculated cost</th></tr></thead><tbody className="divide-y divide-slate-100">{filteredLogs.map((log) => {
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
function SnapshotTransparency({ logs }: { logs: Log[] }) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(logs.length / RECORDS_PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const visibleLogs = logs.slice((currentPage - 1) * RECORDS_PER_PAGE, currentPage * RECORDS_PER_PAGE);
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-200/50 sm:p-5">
    <div className="mb-4"><h3 className="text-base font-semibold text-slate-950">Responsibility history</h3><p className="mt-1 text-sm text-slate-500">Owner and manager assignments preserved when each task was recorded.</p></div>
    <div className="max-h-[65vh] overflow-auto rounded-lg border border-slate-200">
      <table className="min-w-[760px] w-full text-left text-sm">
        <thead className="sticky top-0 z-10 bg-white/95 text-slate-600 shadow-sm backdrop-blur"><tr><th className="px-3 py-3">Task date/time</th><th className="px-3 py-3">Cleaner / hotel</th><th className="px-3 py-3">Owner at task time</th><th className="px-3 py-3">Manager at task time</th><th className="px-3 py-3">Snapshot recorded</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{visibleLogs.map((log) => <tr key={log.id} className="hover:bg-slate-50"><td className="whitespace-nowrap px-3 py-3 text-slate-600">{new Date(log.start_time).toLocaleString("en-GB", { timeZone: "Africa/Cairo" })}</td><td className="px-3 py-3 text-slate-700">{log.cleanerName}<span className="block text-xs text-slate-500">{log.hotelName}</span></td><td className="px-3 py-3 text-slate-700">{log.owner_name ?? "Unassigned owner"}</td><td className="px-3 py-3 text-slate-700">{log.manager_name ?? "Unassigned manager"}</td><td className="whitespace-nowrap px-3 py-3 text-slate-600">{log.responsibility_recorded_at ? new Date(log.responsibility_recorded_at).toLocaleString("en-GB", { timeZone: "Africa/Cairo" }) : "Unavailable"}</td></tr>)}{logs.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">No work-log snapshots found.</td></tr>}</tbody>
        <tfoot><tr className="font-semibold text-slate-900"><td colSpan={5} className="px-3 py-3">Total snapshots <span className="float-right tabular-nums">{logs.length}</span></td></tr></tfoot>
      </table>
    </div>
    <DashboardPagination currentPage={currentPage} pageCount={pageCount} total={logs.length} pageSize={RECORDS_PER_PAGE} label="audit records" onPageChange={setPage} />
  </section>;
}

function OverrideAuditTable({ entries }: { entries: OverrideAuditRecord[] }) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(entries.length / RECORDS_PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const visibleEntries = entries.slice((currentPage - 1) * RECORDS_PER_PAGE, currentPage * RECORDS_PER_PAGE);
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-200/50 sm:p-5">
    <div className="mb-4"><h3 className="text-base font-semibold text-slate-950">Operational intervention audit</h3><p className="mt-1 text-sm text-slate-500">Force clock-outs and task overrides, including the actor, reason, and recorded change.</p></div>
    <div className="max-h-[65vh] overflow-auto rounded-lg border border-slate-200">
      <table className="min-w-[900px] w-full text-left text-sm">
        <thead className="sticky top-0 z-10 bg-white/95 text-slate-600 shadow-sm backdrop-blur"><tr><th className="px-3 py-3">When</th><th className="px-3 py-3">Entity / action</th><th className="px-3 py-3">Actor</th><th className="px-3 py-3">Reason</th><th className="px-3 py-3">Recorded change</th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {visibleEntries.map((entry) => <tr key={entry.id} className="align-top hover:bg-slate-50">
            <td className="whitespace-nowrap px-3 py-3 text-slate-600">{new Date(entry.created_at).toLocaleString("en-GB", { timeZone: "Africa/Cairo" })}</td>
            <td className="px-3 py-3"><span className="font-semibold capitalize text-slate-900">{entry.entity_type}</span><span className="block text-xs text-slate-500">{entry.action.replaceAll("_", " ")}</span><span className="block max-w-40 truncate font-mono text-[10px] text-slate-400">{entry.entity_id}</span></td>
            <td className="max-w-36 truncate px-3 py-3 font-mono text-xs text-slate-600" title={entry.actor_id}>{entry.actor_id}</td>
            <td className="max-w-sm whitespace-normal px-3 py-3 text-slate-700">{entry.override_reason}</td>
            <td className="max-w-sm whitespace-normal px-3 py-3 text-xs text-slate-600"><span className="block"><strong className="text-slate-700">Before:</strong> {JSON.stringify(entry.previous_values)}</span><span className="mt-1 block"><strong className="text-slate-700">After:</strong> {JSON.stringify(entry.new_values)}</span></td>
          </tr>)}
          {!entries.length && <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">No operational interventions have been recorded.</td></tr>}
        </tbody>
      </table>
    </div>
    <DashboardPagination currentPage={currentPage} pageCount={pageCount} total={entries.length} pageSize={RECORDS_PER_PAGE} label="interventions" onPageChange={setPage} />
  </section>;
}

function EditPanel({ draft, setDraft, services, hotels, saving, onCancel, onSave }: { draft: Draft; setDraft: (draft: Draft) => void; services: { id: string; name: string }[]; hotels: { id: string; name: string }[]; saving: boolean; onCancel: () => void; onSave: () => void }) { const hours = durationHours(draft.startTime, draft.endTime); return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"><div className="w-full max-w-lg rounded-2xl bg-white p-5 text-slate-900 shadow-xl"><div className="flex items-center justify-between"><h2 className="text-xl font-bold">Edit work log</h2><button type="button" onClick={onCancel} className="rounded-lg p-2 text-slate-500"><X className="h-5 w-5"/></button></div><div className="mt-4 grid gap-3"><select value={draft.hotelId} onChange={(event) => setDraft({...draft, hotelId: event.target.value})} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-900">{hotels.map((hotel) => <option key={hotel.id} value={hotel.id}>{hotel.name}</option>)}</select><select value={draft.serviceId} onChange={(event) => setDraft({...draft, serviceId: event.target.value})} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-900">{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select><div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-slate-600">Start time<input type="datetime-local" value={draft.startTime} onChange={(event) => setDraft({...draft, startTime: event.target.value})} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-900"/></label><label className="text-xs font-semibold text-slate-600">End time<input type="datetime-local" value={draft.endTime} onChange={(event) => setDraft({...draft, endTime: event.target.value})} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-900"/></label></div><div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Calculated duration: <strong>{hours.toFixed(2)} hours</strong></div><label className="text-xs font-semibold text-slate-600">Rooms completed<input type="number" min="0" value={draft.roomsCompleted} onChange={(event) => setDraft({...draft, roomsCompleted: event.target.value})} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-slate-900"/></label><label className="text-xs font-semibold text-slate-600">Room number<input value={draft.roomNumber} onChange={(event) => setDraft({...draft, roomNumber: event.target.value})} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-slate-900"/></label><label className="text-xs font-semibold text-slate-600">Notes<textarea value={draft.notes} onChange={(event) => setDraft({...draft, notes: event.target.value})} rows={4} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-slate-900"/></label></div><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={onCancel} className="rounded-lg border px-4 py-2 text-sm text-slate-700">Cancel</button><button type="button" disabled={saving} onClick={onSave} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Save changes</button></div></div></div>; }
