"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Activity, Building2, Check, CircleDollarSign, ClipboardList, Clock, Gauge, History, Loader2, Pencil, UsersRound, X, Wallet, Columns3, Filter, Search, CreditCard, ShieldAlert } from "lucide-react";
import { OperationalBrief } from "@/components/dashboard/OperationalBrief";
import { AttendanceSummaryWidget } from "@/components/dashboard/AttendanceSummaryWidget";
import { ServiceCard } from "@/components/dashboard/ServiceCard";
import { OperationalAuditTable } from "@/components/dashboard/OperationalAuditTable";
import type { BriefTask, ManagementBrief } from "@/lib/operationalBrief";
import { calculateTaskCost, resolveBillingUnit, resolveServiceRate } from "@/lib/servicePricing";
import { approveWorkLog as approveWorkLogAction, forceEndAndApproveManagerTask, getManagementDashboardSummary, getManagementOverrideAuditPage, getManagementResponsibilityHistoryPage, getManagementWorkLogPage, rejectWorkLog, updateWorkLog } from "./actions";
import { importRoomsFromGoogleSheet } from "./roomImportActions";
import { FullEditPanel } from "./FullEditPanel";
import { AdminPayrollTable } from "./AdminPayrollTable";
import { ActiveOperations } from "./ActiveOperations";
import type { PropertyRecord } from "./propertyActions";
import { TaskDispatchClient } from "@/app/settings/TaskDispatchClient";
import type { getTaskDispatchData } from "@/app/settings/taskActions";
import type { ServiceRecord } from "./serviceActions";
import { useWorkLogRealtimeRefresh } from "@/lib/useWorkLogRealtimeRefresh";
import type { LucideIcon } from "lucide-react";
import { DashboardPagination, useUrlPage, useUrlPageSize } from "@/components/dashboard/DashboardPagination";
import { WorkspaceFilterBar, useWorkspaceFilters } from "@/components/dashboard/WorkspaceFilterBar";
import { LiveStatusIndicator } from "@/components/ui/LiveStatusIndicator";
import { ActiveAssignedTaskCard } from "@/components/dashboard/ActiveAssignedTaskCard";
import { ShiftDock } from "@/components/dashboard/ShiftDock";
import { showActionToast } from "@/components/ui/ActionToast";
import type { UserRole } from "@/lib/roles";
import { isPlatformAdmin } from "@/lib/roles";
import { formatUserMessage } from "@/lib/userMessages";
import { StatusBadge, type StatusKind } from "@/components/ui/StatusBadge";
import { SharedWorkspaceShell } from "@/components/layout/SharedWorkspaceShell";
import type { WorkspaceNavTab } from "@/components/layout/MobileWorkspaceNav";
import { WorkspaceHeader } from "@/components/layout/WorkspaceHeader";
import type { ManagementHistoryFilters, ManagementHistoryRecord } from "@/lib/managementAudit";

const DASHBOARD_TABS = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "operations", label: "Live Operations", icon: Activity },
  { id: "work-logs", label: "Work Logs & History", icon: ClipboardList },
  { id: "financials", label: "Financials & Payroll", icon: Wallet },
  { id: "audit", label: "Audit & Compliance", icon: History },
] as const;
type DashboardTab = typeof DASHBOARD_TABS[number]["id"];
const DASHBOARD_TAB_CHANGE = "management-dashboard-tab-change";
const RECORDS_PER_PAGE = 20;
const WORKSPACE_SHELL_TABS: readonly WorkspaceNavTab<DashboardTab>[] = DASHBOARD_TABS.map(({ id, label, icon: Icon }) => ({
  id,
  label: id === "operations" ? "Live" : id === "work-logs" ? "Logs" : id === "financials" ? "Financials" : id === "audit" ? "Audit" : label,
  Icon,
  tabButtonId: `tab-${id}`,
  panelId: `panel-${id}`,
}));

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

function useDashboardTab(): DashboardTab {
  return useSyncExternalStore<DashboardTab>(subscribeDashboardTab, readDashboardTab, () => "overview");
}

type Log = ManagementHistoryRecord;
type Room = { id: string; hotel_id: string; room_name: string; floor_section?: string | null; category: string; status?: string };
type DispatchData = Awaited<ReturnType<typeof getTaskDispatchData>>;
type Props = { data: { userRole: string; currentUserId: string; userName: string; userEmail: string; userAvatarUrl: string | null; canManagePayrollTasks: boolean; canManageActiveOperations: boolean; hotels: PropertyRecord[]; services: ServiceRecord[]; cleaners: { id: string; name: string; primary_hotel_id: string | null }[]; propertyAssignees: { id: string; name: string; role: string }[]; rooms: Room[]; workLogs: Log[]; activeShifts: { id: string; user_id: string; start_time: string; cleanerName: string; task: Log | null }[]; activeTasks: Log[]; attendance: { activeShifts: number; compliantClockIns: number; breachAttempts: number; compliancePercent: number | null }; summary: Awaited<ReturnType<typeof getManagementDashboardSummary>>; brief: ManagementBrief }; dispatchData?: DispatchData; tenantIntelligence?: ReactNode };
type Draft = { hotelId: string; serviceId: string; roomId: string; roomsCompleted: string; roomNumber: string; notes: string; startTime: string; endTime: string; status: "assigned" | "active" | "completed" };
type WorkLogSortColumn = "date" | "cleaner" | "hotel" | "service" | "status";
type ApprovalFeedback = { kind: "pending" | "success" | "error"; text: string };
type SnapshotFilterOptions = Record<string, string[]>;

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

function formatGBP(value: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
}

function getActionErrorMessage(error: unknown, fallback: string) {
  return formatUserMessage(error, fallback);
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
  const roomNumbers = Array.isArray(log.room_numbers) ? log.room_numbers.filter((room): room is string => typeof room === "string") : [];
  return { id: log.id, cleaner: log.cleanerName, hotel: log.hotelName, service: serviceName, serviceDescription: log.service_description_snapshot ?? serviceName, taskDate: log.task_date,   status: log.cancelled_at ? "cancelled" : log.status, startTime: log.start_time, endTime: log.end_time, ownerId: log.owner_id, ownerName: log.owner_name ?? "Unassigned owner", managerId: log.manager_id, managerName: log.manager_name ?? "Unassigned manager", responsibilityRecordedAt: log.responsibility_recorded_at ?? log.start_time, room: roomNumbers.join(", ") || log.room_number || "", rooms: log.rooms_completed, hours, rate, cost: calculateTaskCost(hours, log.rooms_completed, { name: serviceName, unit, default_rate: rate }, log.cost_override), notes: log.notes ?? "", managerApproved: log.manager_approved, ownerApproved: log.owner_approved, managerRejected: log.manager_rejected, ownerRejected: log.owner_rejected, isLocked: log.is_locked, rejectionNotes: log.rejection_notes ?? "" };
}

export default function ManagementDashboardClient({ data, dispatchData, tenantIntelligence }: Props) {
  useWorkLogRealtimeRefresh();
  const activeTab = useDashboardTab();
  useEffect(() => {
    const hash = window.location.hash;
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
  }, [activeTab]);
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Log | null>(null);
  const [selectedTask, setSelectedTask] = useState<BriefTask | null>(null);
  const [selectedAuditLog, setSelectedAuditLog] = useState<Log | null>(null);
  const [selectedTaskFromAudit, setSelectedTaskFromAudit] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState("");
  const [approvalFeedback, setApprovalFeedback] = useState<Record<string, ApprovalFeedback>>({});
  const [approvalOverrides, setApprovalOverrides] = useState<Record<string, Partial<Log>>>({});
  const [workLogPage, setWorkLogPage] = useUrlPage(RECORDS_PER_PAGE);
  const [serverWorkLogResult, setServerWorkLogResult] = useState<{ key: string; result: Awaited<ReturnType<typeof getManagementWorkLogPage>> } | null>(null);
  const [serverWorkLogFailure, setServerWorkLogFailure] = useState<{ key: string; message: string } | null>(null);
  const [propertySearch, setPropertySearch] = useState("");
  const { filters: workFilters, updateFilters: updateWorkFilters, clearFilters: clearWorkFilters } = useWorkspaceFilters("work");
  const today = new Date().toISOString().slice(0, 10);
  const { filters: payrollFilters } = useWorkspaceFilters("payroll", { from: `${today.slice(0, 7)}-01`, to: today });
  const summaryRequest = useMemo(() => ({
    from: payrollFilters.from || undefined,
    to: payrollFilters.to || undefined,
    property: payrollFilters.property || undefined,
    worker: data.userRole === "owner" ? undefined : payrollFilters.worker || undefined,
    tenant: data.userRole === "super_admin" ? payrollFilters.tenant || undefined : undefined,
  }), [payrollFilters.from, payrollFilters.to, payrollFilters.property, payrollFilters.worker, payrollFilters.tenant, data.userRole]);
  const summaryRequestKey = JSON.stringify(summaryRequest);
  const [serverSummary, setServerSummary] = useState<{ key: string; result: Props["data"]["summary"] } | null>(null);
  const dashboardSummary = serverSummary?.key === summaryRequestKey ? serverSummary.result : data.summary;
  useEffect(() => {
    let active = true;
    getManagementDashboardSummary(summaryRequest).then((result) => {
      if (active) setServerSummary({ key: summaryRequestKey, result });
    }).catch((error: unknown) => {
      if (active) showActionToast("error", getActionErrorMessage(error, "Unable to load dashboard summary."));
    });
    return () => { active = false; };
  }, [summaryRequest, summaryRequestKey]);
  const cleanerFilter = data.userRole === "owner" ? "" : workFilters.worker;
  const hotelFilter = workFilters.property;
  const serviceFilter = workFilters.service;
  const statusFilter = workFilters.status;
  const fromDate = workFilters.from;
  const toDate = workFilters.to;
  const needsActionOnly = workFilters.needsAction === "true";
  const sortColumn: WorkLogSortColumn = ["date", "cleaner", "hotel", "service", "status"].includes(workFilters.sort)
    ? workFilters.sort as WorkLogSortColumn
    : "date";
  const sortAscending = workFilters.ascending === "true";
  const changeWorkFilters = (changes: Partial<typeof workFilters>) => {
    updateWorkFilters(changes);
  };
  const canManager = isPlatformAdmin(data.userRole) || data.userRole === "manager";
  const canOwner = isPlatformAdmin(data.userRole) || data.userRole === "owner";
  const pageSize = useUrlPageSize(RECORDS_PER_PAGE);
  const displayedWorkLogs = useMemo(
    () => (Array.isArray(data.workLogs) ? data.workLogs : []).map((log) => approvalOverrides[log.id] ? { ...log, ...approvalOverrides[log.id] } : log),
    [data.workLogs, approvalOverrides],
  );
  const displayedWorkLogsRef = useRef(displayedWorkLogs);
  const approvalOverridesRef = useRef(approvalOverrides);
  useEffect(() => {
    displayedWorkLogsRef.current = displayedWorkLogs;
    approvalOverridesRef.current = approvalOverrides;
  }, [approvalOverrides, displayedWorkLogs]);
  const workLogPageRequest = useMemo(() => ({
    page: workLogPage,
    pageSize,
    from: fromDate || undefined,
    to: toDate || undefined,
    worker: cleanerFilter || undefined,
    property: hotelFilter || undefined,
    service: serviceFilter || undefined,
    status: statusFilter || undefined,
    tenant: data.userRole === "super_admin" ? workFilters.tenant || undefined : undefined,
    needsAction: needsActionOnly,
    sort: sortColumn,
    ascending: sortAscending,
  }), [workLogPage, pageSize, fromDate, toDate, cleanerFilter, hotelFilter, serviceFilter, statusFilter, data.userRole, workFilters.tenant, needsActionOnly, sortColumn, sortAscending]);
  const workLogPageRequestKey = JSON.stringify(workLogPageRequest);
  const serverWorkLogPage = serverWorkLogResult?.key === workLogPageRequestKey ? serverWorkLogResult.result : null;
  const serverWorkLogError = serverWorkLogFailure?.key === workLogPageRequestKey ? serverWorkLogFailure.message : "";
  useEffect(() => {
    let active = true;
    getManagementWorkLogPage(workLogPageRequest).then((result) => {
      if (!active) return;
      setServerWorkLogResult({ key: workLogPageRequestKey, result });
      if (result.page !== workLogPage) setWorkLogPage(result.page);
    }).catch((error: unknown) => {
      if (!active) return;
      const text = getActionErrorMessage(error, "Unable to load this work-log page.");
      setServerWorkLogFailure({ key: workLogPageRequestKey, message: text });
      showActionToast("error", text);
    });
    return () => { active = false; };
  }, [workLogPageRequest, workLogPageRequestKey, workLogPage, setWorkLogPage]);
  useEffect(() => {
    if (!serverWorkLogPage) return;
    const recordsById = new Map([...displayedWorkLogs, ...serverWorkLogPage.records].map((log) => [log.id, log]));
    displayedWorkLogsRef.current = [...recordsById.values()];
  }, [displayedWorkLogs, serverWorkLogPage]);
  const pageCount = serverWorkLogPage?.pageCount ?? 1;
  const currentPage = serverWorkLogPage?.page ?? Math.max(1, Math.min(Math.floor(workLogPage), pageCount));
  const visibleWorkLogs = serverWorkLogPage?.records ?? [];
  const filteredWorkLogTotals = visibleWorkLogs.reduce((totals, log) => ({
    rooms: totals.rooms + log.rooms_completed,
    hours: totals.hours + (log.end_time ? durationHours(log.start_time, log.end_time) : 0),
  }), { rooms: 0, hours: 0 });
  const activeCleanerCount = dashboardSummary.activeStaff;
  const periodServiceCost = data.brief.hotels.reduce((total, hotel) => total + hotel.cost, 0);
  const totalLaborCost = dashboardSummary.laborCost;
  const completedRooms = dashboardSummary.completedRooms;
  const lockedPayrollLiability = dashboardSummary.lockedPayrollLiability;
  const propertySummary = new Map(dashboardSummary.properties.map((property) => [property.id, property]));
  const propertyFinancials = data.hotels.map((hotel) => {
    const summary = propertySummary.get(hotel.id);
    const rooms = summary?.rooms ?? 0;
    const cost = summary?.cost ?? 0;
    return { id: hotel.id, name: hotel.name, rooms, cost, costPerRoom: rooms ? cost / rooms : 0 };
  }).sort((left, right) => right.cost - left.cost);
  const cleanerOptions = data.cleaners;
  const serviceOptions = data.services;
  const auditFilterOptions: SnapshotFilterOptions = {
    worker: data.cleaners.map((cleaner) => cleaner.name),
    facility: data.hotels.map((hotel) => hotel.name),
    owner: [...data.propertyAssignees.filter((assignee) => assignee.role === "owner").map((assignee) => assignee.name), "Unassigned owner"],
    manager: [...data.propertyAssignees.filter((assignee) => assignee.role === "manager").map((assignee) => assignee.name), "Unassigned manager"],
    service: data.services.map((service) => service.name),
    status: ["Cancelled", "Active", "Completed", "Pending"],
    approvals: ["Approved", "Pending", "Rejected"].flatMap((manager) => ["Approved", "Pending", "Rejected"].map((owner) => `Manager: ${manager} · Owner: ${owner}`)),
    room: data.rooms.map((room) => `${room.room_name}${room.floor_section ? ` · ${room.floor_section}` : ""}`),
  };
  const filteredPropertyFinancials = propertyFinancials.filter((property) =>
    property.name.toLowerCase().includes(propertySearch.trim().toLowerCase())
  );

  const selectTab = (tab: DashboardTab) => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState(window.history.state, "", url);
    window.dispatchEvent(new Event(DASHBOARD_TAB_CHANGE));
  };
  const run = (operation: () => Promise<unknown>, success = "Saved.") => startTransition(async () => {
    try { setMessage(""); await operation(); setEditing(null); setDraft(null); setMessage(success); showActionToast("success", success); }
    catch (error) { const text = getActionErrorMessage(error, "Operation failed."); setMessage(text); showActionToast("error", text); }
  });

  const approveWorkLog = useCallback(async (logId: string, role: "manager" | "owner") => {
    const log = displayedWorkLogsRef.current.find((item) => item.id === logId);
    if (!log) throw new Error("Work log was not found.");
    const previous = approvalOverridesRef.current[log.id];
    const managerApproved = role === "manager" ? true : log.manager_approved;
    const ownerApproved = role === "owner" ? true : log.owner_approved;
    const optimistic: Partial<Log> = role === "manager"
      ? { manager_approved: true, manager_rejected: false, rejection_notes: null, is_locked: managerApproved && ownerApproved }
      : { owner_approved: true, owner_rejected: false, rejection_notes: null, is_locked: managerApproved && ownerApproved };
    setApprovalOverrides((current) => ({ ...current, [log.id]: { ...current[log.id], ...optimistic } }));
    try {
      await approveWorkLogAction(log.id, role);
    } catch (error) {
      setApprovalOverrides((current) => {
        const next = { ...current };
        if (previous) next[log.id] = previous;
        else delete next[log.id];
        return next;
      });
      throw error;
    }
  }, []);

  const submitApproval = useCallback((logId: string, role: "manager" | "owner") => {
    const log = displayedWorkLogsRef.current.find((item) => item.id === logId);
    if (!log) return;
    const bothApproved = role === "manager" ? log.owner_approved : log.manager_approved;
    const waitingRole = role === "manager" ? "owner" : "manager";
    const success = bothApproved
      ? "Both approvals are complete. The work log is locked for payroll."
      : `${role === "manager" ? "Manager" : "Owner"} approval saved. Waiting for ${waitingRole} approval.`;
    startTransition(async () => {
      setMessage("");
      setApprovalFeedback((current) => ({ ...current, [logId]: { kind: "pending", text: `Saving ${role} approval...` } }));
      try {
        await approveWorkLog(logId, role);
        setApprovalFeedback((current) => ({ ...current, [logId]: { kind: "success", text: success } }));
        showActionToast("success", success);
      } catch (error) {
        const text = getActionErrorMessage(error, "Unable to save approval.");
        setApprovalFeedback((current) => ({ ...current, [logId]: { kind: "error", text } }));
        setMessage(text);
        showActionToast("error", text);
      }
    });
  }, [approveWorkLog]);

  const submitForceEndAndApprove = useCallback((logId: string) => startTransition(async () => {
    setMessage("");
    setApprovalFeedback((current) => ({ ...current, [logId]: { kind: "pending", text: "Force-ending and approving Manager task..." } }));
    try {
      await forceEndAndApproveManagerTask(logId);
      const success = "Task force-ended and approved.";
      setApprovalFeedback((current) => ({ ...current, [logId]: { kind: "success", text: success } }));
      showActionToast("success", success);
    } catch (error) {
      const text = getActionErrorMessage(error, "Unable to force-end and approve the Manager task.");
      setApprovalFeedback((current) => ({ ...current, [logId]: { kind: "error", text } }));
      setMessage(text);
      showActionToast("error", text);
    }
  }), [startTransition]);

  const rejectWorkLogRow = useCallback((logId: string, role: "manager" | "owner", note: string) => startTransition(async () => {
    setApprovalFeedback((current) => ({ ...current, [logId]: { kind: "pending", text: `Saving ${role === "manager" ? "Manager" : "Owner"} rejection...` } }));
    try {
      await rejectWorkLog(logId, role, note);
      const success = `${role === "manager" ? "Manager" : "Owner"} rejection saved.`;
      setApprovalFeedback((current) => ({ ...current, [logId]: { kind: "success", text: success } }));
      showActionToast("success", success);
    } catch (error) {
      const text = getActionErrorMessage(error, "Unable to save rejection.");
      setApprovalFeedback((current) => ({ ...current, [logId]: { kind: "error", text } }));
      setMessage(text);
      showActionToast("error", text);
    }
  }), [startTransition]);

  const openWorkLogDetails = useCallback((logId: string) => {
    const log = displayedWorkLogsRef.current.find((item) => item.id === logId);
    if (!log) return;
    setSelectedTaskFromAudit(false);
    setSelectedTask(toBriefTask(log));
  }, []);

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
    run(() => updateWorkLog(editing.id, { hotelId: draft.hotelId, serviceId: draft.serviceId, startTime: draft.startTime, endTime: draft.endTime, roomsCompleted: Number(draft.roomsCompleted), roomNumber: draft.roomNumber, notes: draft.notes, ...(isPlatformAdmin(data.userRole) ? { status: draft.status } : {}) }), "Work log updated across all dashboards.");
  };

  const syncRooms = () => run(async () => { const result = await importRoomsFromGoogleSheet(); return result; }, "Rooms synced.");
  const workLogRowProps = (log: Log): WorkLogRowProps => {
    const isOwnLog = log.user_id === data.currentUserId;
    return {
      log,
      isOwnLog,
      canManager: canManager && !isOwnLog
        && (data.userRole !== "manager" || ["hk_admin", "cleaner"].includes(log.assigneeRole)),
      canOwner: canOwner && !isOwnLog,
      canForceEndAndApprove: !isOwnLog && (isPlatformAdmin(data.userRole) || data.userRole === "owner") && log.assigneeRole === "manager" && ["assigned", "active"].includes(log.status) && !log.is_locked,
      feedback: approvalFeedback[log.id] ?? null,
      onEdit: openWorkLogDetails,
      onForceEndAndApprove: submitForceEndAndApprove,
      onApprove: submitApproval,
      onReject: rejectWorkLogRow,
    };
  };

  return <div className="enterprise-dashboard theme-workspace min-h-screen min-w-0 bg-canvas text-ink">
      <WorkspaceHeader
        name={data.userName}
        email={data.userEmail}
        avatarUrl={data.userAvatarUrl}
        role={data.userRole}
        actions={<>
          {isPlatformAdmin(data.userRole) && <button type="button" onClick={syncRooms} disabled={isPending} className="hidden min-h-10 rounded-lg border border-line bg-surface-secondary px-3 text-sm font-medium text-ink-secondary hover:bg-surface-elevated sm:inline-flex">Fetch rooms</button>}
          {data.userRole === "super_admin" && <Link href="/admin/tenant-accounts" aria-label="Billing" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-secondary text-ink hover:bg-surface-elevated md:w-auto md:gap-2 md:px-3"><CreditCard className="h-4 w-4" /><span className="hidden text-sm font-medium md:inline">Billing</span></Link>}
        </>}
      />
      <SharedWorkspaceShell role={data.userRole} activeTab={activeTab} onSelect={selectTab} tabs={WORKSPACE_SHELL_TABS} user={{ name: data.userName, email: data.userEmail, avatarUrl: data.userAvatarUrl, role: data.userRole }} />
      <main className="mx-auto min-w-0 max-w-[1600px] space-y-4 px-gutter pb-[calc(env(safe-area-inset-bottom,0px)+5rem)] pt-4 sm:p-6 md:ml-64 md:pb-6 lg:p-8">
        {message && <p className="rounded-lg border border-line bg-surface px-4 py-3 text-sm text-ink-secondary shadow-sm" role="status">{message}</p>}
        <section id="panel-overview" role="tabpanel" aria-labelledby="tab-overview" hidden={activeTab !== "overview"} className="space-y-5">
          {["owner", "manager"].includes(data.userRole) && <AttendanceSummaryWidget {...data.attendance} />}
          {data.userRole === "manager" && (() => {
            const task = data.activeTasks.find((item) => item.user_id === data.currentUserId && item.status === "active" && !item.end_time);
            return task ? <ActiveAssignedTaskCard task={{
              id: task.id,
              name: task.service_name_snapshot ?? task.services_config?.[0]?.name ?? "Active task",
              hotelName: task.hotelName,
              roomLabel: Array.isArray(task.roomDetails) && task.roomDetails.length
                ? task.roomDetails.map((room) => `${room.name} (${room.floor})`).join(", ")
                : (Array.isArray(task.room_numbers) ? task.room_numbers.filter((room): room is string => typeof room === "string") : []).join(", ") || task.room_number || "",
              startTime: task.start_time,
            }} /> : null;
          })()}
          {dispatchData && <TaskDispatchClient role={data.userRole as UserRole} {...dispatchData} />}
          {tenantIntelligence}
          <DashboardHeading title="Executive overview" description="Portfolio performance, approvals, and operating costs at a glance." />
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Properties" value={data.hotels.length} icon={Building2} tone="sky" />
            <Metric label="Total work logs" value={dashboardSummary.totalLogs} icon={ClipboardList} tone="violet" />
            <Metric label="Completed work logs" value={dashboardSummary.completedLogs} icon={ClipboardList} tone="emerald" />
            <Metric label="Awaiting approval" value={dashboardSummary.awaitingApprovalLogs} icon={ShieldAlert} tone="amber" />
            <Metric label="Active cleaners" value={activeCleanerCount} icon={UsersRound} tone="violet" />
            <Metric label="Operational labor cost" value={formatGBP(totalLaborCost)} icon={CircleDollarSign} tone="violet" />
            <Metric label="Cost per cleaned room" value={formatGBP(completedRooms ? totalLaborCost / completedRooms : 0)} icon={CircleDollarSign} tone="sky" />
            <Metric label="Locked payroll liability*" value={formatGBP(lockedPayrollLiability)} icon={Wallet} tone="amber" />
            <Metric label="Service costs · brief period" value={formatGBP(periodServiceCost)} icon={CircleDollarSign} tone="emerald" />
          </section>
          <section aria-label="Live staff activity" className="rounded-2xl border border-emerald-100 bg-surface p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-ink">Live staff activity</h2>
              {data.activeShifts.length === 0 ? (
                <span className="text-sm text-ink-muted">No cleaners are currently on shift.</span>
              ) : (
                data.activeShifts.map((shift) => (
                  <span key={shift.id} className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-sm">
                    <span className="font-medium text-ink-secondary">{shift.cleanerName}</span>
                    <LiveStatusIndicator isClockedIn showLabel={false} />
                  </span>
                ))
              )}
            </div>
          </section>
          <p className="payroll-disclaimer text-xs leading-5">*Payroll settlement status is not stored in the current data model. This figure is the value of locked payroll records, not a verified unpaid balance.</p>
          <section className="rounded-3xl bg-surface p-4 shadow-sm ring-1 ring-line sm:p-6">
            <DashboardHeading title="Operational brief" description={`Operating summary · ${data.brief.periodLabel}`} />
            <OperationalBrief brief={data.brief} />
          </section>
        </section>

        <section id="panel-operations" role="tabpanel" aria-labelledby="tab-operations" hidden={activeTab !== "operations"} className="space-y-5">
          {data.userRole === "manager" && <ShiftDock
            role="manager"
            properties={data.hotels.map((hotel) => ({ id: hotel.id, name: hotel.name, latitude: hotel.latitude, longitude: hotel.longitude }))}
            hasActiveTask={data.activeTasks.some((task) => task.user_id === data.currentUserId && task.status === "active" && !task.end_time)}
            visible={activeTab === "operations"}
          />}
          <div id="operations-live" className="scroll-mt-24">
          <DashboardHeading title="Live operations & shifts" description="Monitor on-shift cleaners and resolve hanging work with audited interventions." />
          <ActiveOperations shifts={data.activeShifts} tasks={data.activeTasks} canManage={data.canManageActiveOperations} />
          </div>
        </section>

        <section id="panel-work-logs" role="tabpanel" aria-labelledby="tab-work-logs" hidden={activeTab !== "work-logs"} className="space-y-5">
          <DashboardHeading title="Work logs & history" description={`${serverWorkLogPage?.totalCount ?? 0} matching records · review approvals, task details, and shift history.`} />
          {serverWorkLogError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{serverWorkLogError}</p>}
          {!serverWorkLogPage && !serverWorkLogError && <p role="status" className="text-sm text-ink-secondary">Loading this page of work logs…</p>}
          <WorkspaceFilterBar
            filters={workFilters}
            onChange={(changes) => {
              if (changes.property !== undefined) changeWorkFilters({ ...changes, worker: "" });
              else changeWorkFilters(changes);
            }}
            onReset={clearWorkFilters}
            properties={data.hotels.map(({ id, name }) => ({ id, name }))}
            services={data.services.map(({ id, name }) => ({ id, name }))}
            tenants={data.propertyAssignees.filter((assignee) => assignee.role === "owner").map(({ id, name }) => ({ id, name }))}
            workers={cleanerOptions}
            statuses={["Active", "Approved", "Pending approval", "Rejected", "Cancelled"]}
            showTenants={data.userRole === "super_admin"}
            showWorkers={data.userRole !== "owner"}
            label="Work log filters"
          >
            <label className="text-xs font-semibold text-ink-secondary">Service<select value={serviceFilter} onChange={(event) => changeWorkFilters({ service: event.target.value })} className="mt-1 min-h-10 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-secondary"><option value="">All services</option>{serviceOptions.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
            <label className="flex min-h-10 items-center gap-2 self-end rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-900"><input type="checkbox" checked={needsActionOnly} onChange={(event) => changeWorkFilters({ needsAction: event.target.checked ? "true" : "" })} className="h-4 w-4 accent-amber-700" />Needs action</label>
            <label className="text-xs font-semibold text-ink-secondary">Sort by<select value={sortColumn} onChange={(event) => changeWorkFilters({ sort: event.target.value })} className="mt-1 min-h-10 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-secondary"><option value="date">Date</option><option value="cleaner">Cleaner</option><option value="hotel">Property</option><option value="service">Service</option><option value="status">Status</option></select></label>
            <label className="flex min-h-10 items-center gap-2 self-end rounded-lg border border-line px-3 text-xs font-semibold text-ink-secondary"><input type="checkbox" checked={sortAscending} onChange={(event) => changeWorkFilters({ ascending: event.target.checked ? "true" : "" })} className="h-4 w-4 accent-sky-700" />Ascending</label>
          </WorkspaceFilterBar>
    <section className="rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5">
      <div id="work-logs-mobile-list" className="work-logs-mobile-list space-y-3">
        {visibleWorkLogs.length > 0
          ? visibleWorkLogs.map((log) => <WorkLogMobileCard key={log.id} {...workLogRowProps(log)} />)
          : <p className="rounded-xl border border-line bg-surface-secondary p-4 text-center text-sm text-ink-muted">No logs match your filter criteria.</p>}
      </div>
      <div id="work-logs-table" className="workspace-table-scroll mobile-card-table-wrapper scroll-mt-24 rounded-lg border border-line [-webkit-overflow-scrolling:touch]">
        <table aria-label="Work logs" aria-rowcount={(serverWorkLogPage?.totalCount ?? 0) + 1} className="mobile-card-table min-w-[1360px] w-full table-fixed text-left text-sm">
          <colgroup><col style={{ width: "180px" }} /><col style={{ width: "155px" }} /><col style={{ width: "170px" }} /><col style={{ width: "180px" }} /><col style={{ width: "110px" }} /><col style={{ width: "75px" }} /><col style={{ width: "190px" }} /><col style={{ width: "300px" }} /></colgroup>
          <thead className="sticky top-0 z-10 bg-surface/95 text-ink-secondary shadow-sm backdrop-blur">
            <tr>
              <th className="sticky-column-start px-3 py-3 font-semibold">Cleaner</th>
              <th className="px-3 py-3 font-semibold">Date / time</th>
              <th className="px-3 py-3 font-semibold">Property</th>
              <th className="px-3 py-3 font-semibold">Service / task</th>
              <th className="px-3 py-3 text-right font-semibold">Duration</th>
              <th className="px-3 py-3 text-right font-semibold">Rooms</th>
              <th className="px-3 py-3 font-semibold">Status</th>
              <th className="sticky-column-end px-3 py-3 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {visibleWorkLogs.length > 0
              ? visibleWorkLogs.map((log) => <WorkLogRow key={log.id} {...workLogRowProps(log)} />)
              : <tr><td colSpan={8} className="px-3 py-8 text-center text-ink-muted">No logs match your filter criteria.</td></tr>}
          </tbody>
          {visibleWorkLogs.length > 0 && <tfoot className="sticky bottom-0 z-10 bg-surface font-semibold text-ink shadow-[0_-1px_0_#e2e8f0]">
            <tr>
              <td colSpan={4} className="px-3 py-3">Current page totals ({visibleWorkLogs.length})</td>
              <td className="px-3 py-3 text-right tabular-nums">{filteredWorkLogTotals.hours.toFixed(2)} hrs</td>
              <td className="px-3 py-3 text-right tabular-nums">{filteredWorkLogTotals.rooms}</td>
              <td colSpan={2} className="px-3 py-3">Page subtotal</td>
            </tr>
          </tfoot>}
        </table>
      </div>
      <DashboardPagination currentPage={currentPage} pageCount={pageCount} total={serverWorkLogPage?.totalCount ?? 0} pageSize={pageSize} label="work logs" onPageChange={setWorkLogPage} />
    </section>
        </section>

        <section id="panel-financials" role="tabpanel" aria-labelledby="tab-financials" hidden={activeTab !== "financials"} className="space-y-5">
          <DashboardHeading title="Financials & payroll" description="Approved payroll records, configurable task overrides, and cost reporting." />
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Metric label="Operational labor cost" value={formatGBP(totalLaborCost)} icon={CircleDollarSign} tone="violet" />
            <Metric label="Cost per completed room" value={formatGBP(completedRooms ? totalLaborCost / completedRooms : 0)} icon={Activity} tone="sky" />
            <Metric label="Locked payroll liability*" value={formatGBP(lockedPayrollLiability)} icon={Wallet} tone="amber" />
          </section>
          <p className="payroll-disclaimer text-xs leading-5">*This is the total value of locked payroll records. The current schema does not track payment/settlement, so it cannot confirm unpaid balances.</p>
          <section id="property-labor-breakdown" className="scroll-mt-24 rounded-2xl bg-surface p-5 shadow-sm ring-1 ring-line">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-2"><div><h3 className="font-semibold text-ink">Property labor cost breakdown</h3><p className="mt-1 text-sm text-ink-secondary">Completed work logs and task-level overrides across your visible properties.</p></div><span className="text-xs text-ink-muted">Revenue is not tracked in the current model</span></div>
            <label className="relative mb-2 block">
              <span className="sr-only">Filter properties</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
              <input value={propertySearch} onChange={(event) => setPropertySearch(event.target.value)} placeholder="Filter properties..." className="min-h-11 w-full rounded-lg border border-line bg-surface py-2 pl-9 pr-3 text-sm text-ink" />
            </label>
            <div className="admin-config-scroll max-h-72 overflow-y-auto rounded-xl border border-line p-2">
              {filteredPropertyFinancials.map((property) => <article key={property.id} className="grid gap-2 border-b border-line px-3 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center sm:gap-6">
                <p className="truncate font-medium text-ink">{property.name}</p>
                <p className="text-sm text-ink-secondary">{property.rooms} units</p>
                <p className="text-sm font-semibold tabular-nums text-ink">GBP {property.cost.toFixed(2)}</p>
                <p className="text-xs tabular-nums text-ink-muted">GBP {property.costPerRoom.toFixed(2)} / unit</p>
              </article>)}
              {!filteredPropertyFinancials.length && <p className="p-6 text-center text-sm text-ink-muted">No properties match your filter</p>}
            </div>
          </section>
          <AdminPayrollTable
      services={data.services}
      hotels={data.hotels.map(({ id, name }) => ({ id, name }))}
      cleaners={data.cleaners}
      tenants={data.propertyAssignees.filter((assignee) => assignee.role === "owner").map(({ id, name }) => ({ id, name }))}
      showTenants={data.userRole === "super_admin"}
      showWorkers={data.userRole !== "owner"}
      canManageTasks={data.canManagePayrollTasks}
          />
        </section>

        <section id="panel-audit" role="tabpanel" aria-labelledby="tab-audit" hidden={activeTab !== "audit"} className="space-y-5">
          <DashboardHeading title="Audit & compliance" description="Historical responsibility snapshots for work logs in your role-scoped property set." />
          <div id="audit-trail" className="scroll-mt-24 space-y-5">
            <SnapshotTransparency filterOptions={auditFilterOptions} onOpen={(log) => { setSelectedTaskFromAudit(true); setSelectedAuditLog(log); setSelectedTask(toBriefTask(log)); }} />
            <OperationalAuditTable loadPage={getManagementOverrideAuditPage} />
          </div>
        </section>

    {selectedTask && <ServiceCard task={selectedTask} onClose={() => { setSelectedTask(null); setSelectedAuditLog(null); }} editLabel={selectedTaskFromAudit ? "Edit Record" : "Edit"} onEdit={selectedTaskFromAudit && !isPlatformAdmin(data.userRole) ? undefined : () => { const log = selectedTaskFromAudit ? selectedAuditLog : displayedWorkLogsRef.current.find((item) => item.id === selectedTask.id); if (log) { setSelectedTask(null); setSelectedAuditLog(null); beginEdit(log); } }} />}
    {editing && draft && <FullEditPanel draft={draft} setDraft={setDraft} services={data.services} hotels={data.hotels} rooms={data.rooms} saving={isPending} canEditStatus={isPlatformAdmin(data.userRole)} statusDisabled={Boolean(editing.cancelled_at)} onCancel={() => { setEditing(null); setDraft(null); }} onSave={saveEdit}/>}
      </main>
  </div>;
}

type WorkLogRowProps = {
  log: Log;
  isOwnLog: boolean;
  canManager: boolean;
  canOwner: boolean;
  canForceEndAndApprove: boolean;
  feedback: ApprovalFeedback | null;
  onEdit: (logId: string) => void;
  onForceEndAndApprove: (logId: string) => void;
  onApprove: (logId: string, role: "manager" | "owner") => void;
  onReject: (logId: string, role: "manager" | "owner", note: string) => void;
};

function canEditWorkLog(log: Log) {
  return !log.is_locked && !(log.manager_approved && log.owner_approved);
}

function formatWorkLogDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString("en-GB", { timeZone: "Africa/Cairo" });
}

const WorkLogRow = memo(function WorkLogRow({ log, isOwnLog, canManager, canOwner, canForceEndAndApprove, feedback, onEdit, onForceEndAndApprove, onApprove, onReject }: WorkLogRowProps) {
  const isPending = feedback?.kind === "pending";
  const hours = log.end_time ? durationHours(log.start_time, log.end_time) : null;
  const status: StatusKind = log.cancelled_at ? "cancelled" : log.is_locked ? "approved" : log.status === "active" ? "in_progress" : log.manager_rejected || log.owner_rejected ? "rejected" : log.status === "completed" ? "needs_action" : "pending";
  const statusLabel = status === "needs_action" ? "Pending approval" : undefined;
  const hotelName = typeof log.hotelName === "string" && log.hotelName.trim() ? log.hotelName : "Unknown property";
  const cleanerName = typeof log.cleanerName === "string" && log.cleanerName.trim() ? log.cleanerName : "Unknown worker";
  const serviceName = log.service_name_snapshot ?? log.services_config?.[0]?.name ?? "Service";
  return <tr className="align-top transition-colors hover:bg-surface-secondary">
    <td data-label="Cleaner" className="sticky-column-start break-words px-3 py-4 font-medium text-ink">{cleanerName}</td>
    <td data-label="Date / time" className="whitespace-nowrap px-3 py-4 text-ink-secondary">{formatWorkLogDate(log.start_time)}</td>
    <td data-label="Property" className="break-words px-3 py-4 font-medium text-ink-secondary">{hotelName}</td>
    <td data-label="Service / task" className="break-words px-3 py-4 text-ink-secondary">{serviceName}</td>
    <td data-label="Duration" className="whitespace-nowrap px-3 py-4 text-right tnum text-ink-secondary">{hours === null || !Number.isFinite(hours) ? "In progress" : `${hours.toFixed(2)} hrs`}</td>
    <td data-label="Rooms" className="whitespace-nowrap px-3 py-4 text-right tnum text-ink-secondary">{Number.isFinite(log.rooms_completed) ? log.rooms_completed : 0}</td>
    <td data-label="Status" className="px-3 py-4"><StatusBadge status={status} label={statusLabel} /><div className="mt-1 text-[11px] text-ink-muted">Manager: {log.manager_approved ? "Approved" : log.manager_rejected ? "Rejected" : "Pending"} · Owner: {log.owner_approved ? "Approved" : log.owner_rejected ? "Rejected" : "Pending"}</div></td>
    <td data-label="Actions" className="sticky-column-end px-3 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => onEdit(log.id)} className="min-h-9 rounded-lg border border-line bg-surface-secondary px-3 text-xs font-semibold text-ink hover:border-accent">View details</button>
        {isOwnLog ? <span className="rounded-lg border border-line bg-surface-secondary px-2.5 py-1.5 text-xs font-semibold text-ink-secondary">
          {log.assigneeRole === "manager" && log.status === "completed"
            ? log.manager_approved ? "Approved (Completed)" : "Pending Manager Approval"
            : "Your work log · read only"}
        </span> : !log.is_locked && (log.status !== "completed" ? <span className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-xs font-semibold text-amber-700 dark:text-amber-300">Clock out required</span> : <>
          {canManager && (log.manager_approved ? <ApprovalComplete label="Manager approved" /> : <ApprovalButtons label="Approve (Manager)" onApprove={() => onApprove(log.id, "manager")} onReject={(note) => onReject(log.id, "manager", note)} isPending={isPending} />)}
          {canOwner && (log.owner_approved ? <ApprovalComplete label="Owner approved" /> : <ApprovalButtons label="Approve (Owner)" onApprove={() => onApprove(log.id, "owner")} onReject={(note) => onReject(log.id, "owner", note)} isPending={isPending} />)}
        </>)}
        {canForceEndAndApprove && <button type="button" disabled={isPending} onClick={() => onForceEndAndApprove(log.id)} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-900 hover:bg-rose-100 disabled:cursor-wait disabled:opacity-60">{isPending && <Loader2 className="h-4 w-4 animate-spin" />}{isPending ? "Finalizing…" : "Force End & Approve"}</button>}
      </div>
      {feedback && <p role={feedback.kind === "error" ? "alert" : "status"} className={`mt-2 text-xs ${feedback.kind === "error" ? "font-medium text-rose-700" : feedback.kind === "success" ? "text-emerald-700" : "text-ink-muted"}`}>{feedback.text}</p>}
    </td>
  </tr>;
});

export function WorkLogMobileCard(props: WorkLogRowProps) {
  const { log, isOwnLog, canManager, canOwner, canForceEndAndApprove, feedback, onEdit, onForceEndAndApprove, onApprove, onReject } = props;
  const isPending = feedback?.kind === "pending";
  const hours = log.end_time ? durationHours(log.start_time, log.end_time) : null;
  const dateLabel = formatWorkLogDate(log.start_time);
  const cleanerName = typeof log.cleanerName === "string" && log.cleanerName.trim() ? log.cleanerName : "Unknown worker";
  const hotelName = typeof log.hotelName === "string" && log.hotelName.trim() ? log.hotelName : "Unknown property";
  const serviceName = log.service_name_snapshot ?? log.services_config?.[0]?.name ?? "Service";
  const roomCount = Number.isFinite(log.rooms_completed) ? log.rooms_completed : 0;
  const bothApproved = log.manager_approved && log.owner_approved;
  const managerStatus = log.manager_approved ? "approved" : log.manager_rejected ? "rejected" : "pending";
  const ownerStatus = log.owner_approved ? "approved" : log.owner_rejected ? "rejected" : "pending";
  const status: StatusKind = log.cancelled_at ? "cancelled" : log.is_locked ? "locked" : log.status === "active" ? "in_progress" : log.manager_rejected || log.owner_rejected ? "rejected" : log.status !== "completed" ? "pending" : "needs_action";

  return <article className="space-y-3 rounded-2xl border border-line bg-surface p-4 shadow-sm transition-all hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
    <header className="flex items-center justify-between gap-3 border-b border-line pb-2 dark:border-slate-800">
      <div className="flex min-w-0 items-center gap-2.5">
        <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sky-100 text-xs font-bold text-sky-800">{cleanerName.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span>
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-ink dark:text-slate-100">{cleanerName}</p>
          <p className="truncate text-xs capitalize text-ink-muted">{typeof log.assigneeRole === "string" ? log.assigneeRole.replaceAll("_", " ") : "Unknown role"}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <StatusBadge status={status} label={status === "pending" && log.status !== "completed" ? "Clock-out required" : undefined} className="text-[11px]" />
        {canEditWorkLog(log) && <button type="button" aria-label={`Edit ${cleanerName} work log`} onClick={() => onEdit(log.id)} className="grid h-9 w-9 place-items-center rounded-lg text-ink-muted transition hover:bg-surface-secondary hover:text-ink dark:hover:bg-slate-800 dark:hover:text-white"><Pencil className="h-4 w-4" /></button>}
      </div>
    </header>

    <div className="space-y-2.5">
      <div className="flex items-center gap-2 text-sm text-ink-secondary dark:text-ink-muted">
        <Building2 className="h-4 w-4 shrink-0 text-ink-muted" />
        <span className="min-w-0 flex-1 truncate font-medium">{hotelName} <span className="font-normal text-ink-muted">· {serviceName}</span></span>
        <span className="shrink-0 rounded-full bg-surface-secondary px-2 py-0.5 text-[11px] font-medium text-ink-secondary dark:bg-slate-800 dark:text-ink-muted">{roomCount} {roomCount === 1 ? "room" : "rooms"}</span>
      </div>
      <div className="flex items-start gap-2 text-sm text-ink-secondary dark:text-ink-muted">
        <Clock className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
        <span className="min-w-0 flex-1">{dateLabel}</span>
        <span className="shrink-0 rounded-lg bg-surface-secondary px-2 py-1 text-xs font-bold tabular-nums text-ink-secondary dark:bg-slate-800 dark:text-slate-200">{hours === null || !Number.isFinite(hours) ? "In progress" : `${hours.toFixed(2)} hrs`}</span>
      </div>
    </div>

    <div className="grid grid-cols-2 gap-2">
      <ApprovalStatusPill label="Manager" status={managerStatus} />
      <ApprovalStatusPill label="Owner" status={ownerStatus} />
    </div>

    <footer className="space-y-2 border-t border-line pt-3 dark:border-slate-800">
      {log.is_locked || bothApproved
        ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-center text-xs font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">Fully Approved</div>
        : log.status !== "completed"
          ? <div className="space-y-2">
            <p className="text-center text-xs font-medium text-amber-700 dark:text-amber-300">Clock-out required before approval.</p>
          </div>
          : isOwnLog
            ? <p className="rounded-lg bg-surface-secondary px-3 py-2 text-center text-xs font-medium text-ink-secondary dark:bg-slate-800 dark:text-ink-muted">Your work log · read only</p>
            : <div className="space-y-2">
              {canManager && !log.manager_approved && <ApprovalButtons label="Approve (Manager)" onApprove={() => onApprove(log.id, "manager")} onReject={(note) => onReject(log.id, "manager", note)} isPending={isPending} />}
              {canOwner && !log.owner_approved && <ApprovalButtons label="Approve (Owner)" onApprove={() => onApprove(log.id, "owner")} onReject={(note) => onReject(log.id, "owner", note)} isPending={isPending} />}
              {canForceEndAndApprove && <button type="button" disabled={isPending} onClick={() => onForceEndAndApprove(log.id)} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 text-sm font-semibold text-rose-900 disabled:opacity-60">{isPending && <Loader2 className="h-4 w-4 animate-spin" />}{isPending ? "Finalizing..." : "Force End & Approve"}</button>}
              {!canManager && !canOwner && !canForceEndAndApprove && <p className="rounded-lg bg-surface-secondary px-3 py-2 text-center text-xs font-medium text-ink-secondary dark:bg-slate-800 dark:text-ink-muted">Awaiting approval.</p>}
            </div>}
      {feedback && <p role={feedback.kind === "error" ? "alert" : "status"} className={`text-xs ${feedback.kind === "error" ? "font-medium text-rose-700" : feedback.kind === "success" ? "text-emerald-700" : "text-ink-muted"}`}>{feedback.text}</p>}
    </footer>
  </article>;
}

function ApprovalStatusPill({ label, status }: { label: string; status: "approved" | "pending" | "rejected" }) {
  return <StatusBadge
    status={status}
    label={`${label} ${status}`}
    className="min-w-0 justify-center whitespace-normal text-center"
  />;
}

function DashboardHeading({ title, description }: { title: string; description: string }) {
  return <header className="rounded-2xl bg-surface px-5 py-4 shadow-sm ring-1 ring-line">
    <h2 className="text-xl font-bold tracking-tight text-ink">{title}</h2>
    <p className="mt-1 text-sm text-ink-secondary">{description}</p>
  </header>;
}

function ApprovalComplete({ label }: { label: string }) {
  return <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800"><Check className="h-3.5 w-3.5" />{label}</span>;
}
function ApprovalButtons({ label, onApprove, onReject, isPending }: { label: string; onApprove: () => void; onReject: (note: string) => void; isPending: boolean }) {
  const [isRejecting, setIsRejecting] = useState(false);
  const [note, setNote] = useState("");
  return <div className="space-y-2">
    <div className="grid grid-cols-2 gap-2">
      <button type="button" disabled={isPending} onClick={onApprove} className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-500/20 disabled:cursor-wait disabled:opacity-60 dark:text-emerald-400"><Check className="h-3.5 w-3.5" />{isPending ? "Saving..." : label}</button>
      <button type="button" disabled={isPending} onClick={() => setIsRejecting((open) => !open)} className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-500/20 disabled:cursor-wait disabled:opacity-60 dark:text-rose-400"><X className="h-3.5 w-3.5" />Reject</button>
    </div>
    {isRejecting && <div className="space-y-2 overflow-hidden rounded-xl border border-rose-100 bg-rose-50/60 p-3 transition-all">
      <label className="block text-xs font-semibold text-ink-secondary">Reason for rejection
        <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} placeholder="Reason for rejection..." className="mt-1 w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm font-normal text-ink outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-100" />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" disabled={isPending} onClick={() => { setIsRejecting(false); setNote(""); }} className="min-h-9 rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-ink-secondary disabled:opacity-50">Cancel</button>
        <button type="button" disabled={isPending} onClick={() => { onReject(note); setIsRejecting(false); setNote(""); }} className="min-h-9 rounded-lg bg-rose-700 px-3 text-xs font-semibold text-white disabled:opacity-50">{isPending ? "Submitting..." : "Confirm Rejection"}</button>
      </div>
    </div>}
  </div>;
}
function Metric({ label, value, icon: Icon, tone }: { label: string; value: number | string; icon: LucideIcon; tone: "sky" | "emerald" | "amber" | "violet" }) {
  const iconTone = {
    sky: "bg-sky-50 text-sky-700",
    emerald: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    violet: "bg-violet-50 text-violet-700",
  }[tone];
  return <article className="min-w-0 rounded-xl border border-line bg-surface p-3 shadow-sm sm:p-5">
    <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-xs font-medium text-ink-muted sm:text-sm">{label}</p><p className="mt-2 truncate text-lg font-semibold tabular-nums text-ink sm:text-2xl">{value}</p></div><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg sm:h-9 sm:w-9 ${iconTone}`}><Icon className="h-4 w-4" /></span></div>
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

function lifecycleStatusKind(log: Log): StatusKind {
  if (log.cancelled_at || log.status === "cancelled") return "cancelled";
  if (log.status === "active") return "in_progress";
  if (log.status === "completed") return "completed";
  return "pending";
}

function approvalSummary(log: Log) {
  const manager = log.manager_approved ? "Approved" : log.manager_rejected ? "Rejected" : "Pending";
  const owner = log.owner_approved ? "Approved" : log.owner_rejected ? "Rejected" : "Pending";
  return `Manager: ${manager} · Owner: ${owner}`;
}

function logRoomReference(log: Log) {
  const rooms = Array.isArray(log.roomDetails) ? log.roomDetails.map((room) => `${room.name}${room.floor ? ` · ${room.floor}` : ""}`) : [];
  const roomNumbers = Array.isArray(log.room_numbers) ? log.room_numbers.filter((room): room is string => typeof room === "string") : [];
  return rooms.join(", ") || roomNumbers.join(", ") || log.room_number || "No room or zone";
}

function AuditMultiSelect({ label, values, selected, onChange }: { label: string; values: string[]; selected: string[]; onChange: (values: string[]) => void }) {
  const [search, setSearch] = useState("");
  const visibleValues = values.filter((value) => value.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <fieldset className="mt-3">
    <legend className="text-xs font-semibold text-ink-secondary">{label}</legend>
    <label className="mt-2 flex items-center gap-2 rounded-md border border-line px-2">
      <Search className="h-3.5 w-3.5 text-ink-muted" />
      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${label.toLowerCase()}`} className="min-h-9 w-full border-0 bg-transparent text-xs text-ink-secondary outline-none" />
    </label>
    <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
      {visibleValues.map((value) => <label key={value} className="flex items-start gap-2 rounded px-1 py-1 text-xs text-ink-secondary hover:bg-surface-secondary">
        <input type="checkbox" checked={selected.includes(value)} onChange={(event) => onChange(event.target.checked ? [...selected, value] : selected.filter((item) => item !== value))} className="mt-0.5" />
        <span className="break-words">{value || "Unavailable"}</span>
      </label>)}
      {!visibleValues.length && <p className="py-2 text-xs text-ink-muted">No matching values.</p>}
    </div>
  </fieldset>;
}

function AuditFilterPopover({ label, active, onSelectAll, onClear, children }: { label: string; active: boolean; onSelectAll: () => void; onClear: () => void; children: ReactNode }) {
  return <details className="relative inline-block align-middle">
    <summary aria-label={`Filter ${label}`} title={`Filter ${label}`} className={`flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-md hover:bg-surface-secondary ${active ? "text-sky-700" : "text-ink-muted"}`}>
      <Filter className="h-4 w-4" />
    </summary>
    <div className="absolute right-0 z-30 mt-1 w-72 rounded-xl border border-line bg-surface p-3 text-left shadow-xl">
      <p className="text-xs font-semibold text-ink-secondary">Filter: {label}</p>
      <div className="mt-2 flex gap-2 border-b border-line pb-2">
        <button type="button" onClick={onSelectAll} className="text-xs font-semibold text-sky-700 hover:underline">Select All</button>
        <button type="button" onClick={onClear} className="text-xs font-semibold text-ink-secondary hover:underline">Clear Filter</button>
      </div>
      {children}
    </div>
  </details>;
}

function SnapshotTransparency({ filterOptions, onOpen }: { filterOptions: SnapshotFilterOptions; onOpen: (log: Log) => void }) {
  const [page, setPage] = useUrlPage(RECORDS_PER_PAGE);
  const pageSize = useUrlPageSize(RECORDS_PER_PAGE);
  const [preferencesMessage, setPreferencesMessage] = useState("");
  const [historyResult, setHistoryResult] = useState<{ key: string; page: Awaited<ReturnType<typeof getManagementResponsibilityHistoryPage>> } | null>(null);
  const [historyFailure, setHistoryFailure] = useState<{ key: string; message: string } | null>(null);
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const filters = useMemo<ManagementHistoryFilters>(() => {
    const parsed: ManagementHistoryFilters = {};
    for (const key of ["worker", "facility", "owner", "manager", "snapshot", "service", "status", "approvals", "room", "date", "hours", "value"]) {
      const selected = searchParams.get(`audit_${key}`);
      if (selected) {
        try {
          const value: unknown = JSON.parse(selected);
          if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
            parsed[key] = { selected: value };
          }
        } catch {
          parsed[key] = {};
        }
      }
      const from = searchParams.get(`audit_${key}_from`);
      const to = searchParams.get(`audit_${key}_to`);
      const min = searchParams.get(`audit_${key}_min`);
      const max = searchParams.get(`audit_${key}_max`);
      if (from || to || min || max) {
        parsed[key] = { ...parsed[key], ...(from ? { from } : {}), ...(to ? { to } : {}), ...(min ? { min } : {}), ...(max ? { max } : {}) };
      }
    }
    return parsed;
  }, [searchParams]);
  const historyRequest = useMemo(() => ({ page, pageSize, filters }), [page, pageSize, filters]);
  const historyRequestKey = JSON.stringify(historyRequest);
  const loadedHistory = historyResult?.key === historyRequestKey ? historyResult.page : null;
  const historyError = historyFailure?.key === historyRequestKey ? historyFailure.message : "";
  useEffect(() => {
    let active = true;
    getManagementResponsibilityHistoryPage(historyRequest).then((result) => {
      if (!active) return;
      setHistoryResult({ key: historyRequestKey, page: result });
      if (result.page !== page) setPage(result.page);
    }).catch((error: unknown) => {
      if (!active) return;
      setHistoryFailure({
        key: historyRequestKey,
        message: getActionErrorMessage(error, "Unable to load responsibility history."),
      });
    });
    return () => { active = false; };
  }, [historyRequest, historyRequestKey, page, setPage]);
  const [filtersOpen, setFiltersOpen] = useState(false);
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
      return { columns: DEFAULT_AUDIT_COLUMNS, message: formatUserMessage(error, "Unable to load saved column preferences.") };
    }
  }, [storedColumns]);
  const visibleColumnIds = storedPreference.columns;

  const selectedFor = (key: string) => filters[key]?.selected ?? [];
  const updateFilters = (updates: Record<string, AuditFilter | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, update] of Object.entries(updates)) {
      const selectedKey = `audit_${key}`;
      const rangeKeys = [`${selectedKey}_from`, `${selectedKey}_to`, `${selectedKey}_min`, `${selectedKey}_max`];
      if (!update) {
        params.delete(selectedKey);
        rangeKeys.forEach((rangeKey) => params.delete(rangeKey));
        continue;
      }
      if (update.selected?.length) params.set(selectedKey, JSON.stringify(update.selected));
      else params.delete(selectedKey);
      for (const field of ["from", "to", "min", "max"] as const) {
        const value = update[field];
        const param = `${selectedKey}_${field}`;
        if (value) params.set(param, value);
        else params.delete(param);
      }
    }
    params.set("tab", "audit");
    params.set("page", "1");
    params.set("pageSize", String(pageSize));
    router.push(`${pathname}?${params.toString()}${window.location.hash}`, { scroll: false });
  };
  const updateFilter = (key: string, update: AuditFilter | null) => updateFilters({
    [key]: update ? { ...filters[key], ...update } : null,
  });
  const hasFilter = (key: string) => {
    const filter = filters[key];
    return Boolean(filter && ((filter.selected?.length ?? 0) > 0 || filter.from || filter.to || filter.min || filter.max));
  };
  const activeFilterCount = Object.keys(filters).filter(hasFilter).length;
  const allValues = (key: string) => filterOptions[key] ?? [];
  const currentPage = loadedHistory?.page ?? page;
  const pageCount = loadedHistory?.pageCount ?? 1;
  const totalCount = loadedHistory?.totalCount ?? 0;
  const visibleLogs = loadedHistory?.records ?? [];
  const visibleColumns = AUDIT_COLUMNS.filter((column) => visibleColumnIds.includes(column.id));
  const setSelected = (key: string, values: string[]) => updateFilter(key, { selected: values });
  const setRange = (key: string, field: "from" | "to" | "min" | "max", value: string) => updateFilter(key, { [field]: value });
  const renderFilter = (column: AuditColumn) => {
    const clear = () => {
      if (column.id === "workerFacility") updateFilters({ worker: null, facility: null });
      else updateFilter(column.id, null);
    };
    const selectAll = () => {
      if (column.id === "workerFacility") {
        updateFilters({ worker: null, facility: null });
      } else {
        updateFilter(column.id, null);
      }
    };
    const active = column.id === "workerFacility" ? hasFilter("worker") || hasFilter("facility") : hasFilter(column.id);
    return <AuditFilterPopover key={column.id} label={column.label} active={active} onSelectAll={selectAll} onClear={clear}>
      {column.id === "workerFacility" ? <>
        <AuditMultiSelect label="Worker" values={allValues("worker")} selected={selectedFor("worker")} onChange={(values) => setSelected("worker", values)} />
        <AuditMultiSelect label="Facility" values={allValues("facility")} selected={selectedFor("facility")} onChange={(values) => setSelected("facility", values)} />
      </> : ["owner", "manager", "service", "status", "approvals", "room"].includes(column.id) ? <AuditMultiSelect label={column.label} values={allValues(column.id)} selected={selectedFor(column.id)} onChange={(values) => setSelected(column.id, values)} />
        : column.id === "date" || column.id === "snapshot" ? <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="text-xs text-ink-secondary">From<input type="date" value={filters[column.id]?.from ?? ""} onChange={(event) => setRange(column.id, "from", event.target.value)} className="mt-1 w-full rounded border border-line p-1.5 text-xs" /></label>
          <label className="text-xs text-ink-secondary">To<input type="date" value={filters[column.id]?.to ?? ""} onChange={(event) => setRange(column.id, "to", event.target.value)} className="mt-1 w-full rounded border border-line p-1.5 text-xs" /></label>
        </div> : <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="text-xs text-ink-secondary">Min<input type="number" min="0" step="any" value={filters[column.id]?.min ?? ""} onChange={(event) => setRange(column.id, "min", event.target.value)} className="mt-1 w-full rounded border border-line p-1.5 text-xs" /></label>
          <label className="text-xs text-ink-secondary">Max<input type="number" min="0" step="any" value={filters[column.id]?.max ?? ""} onChange={(event) => setRange(column.id, "max", event.target.value)} className="mt-1 w-full rounded border border-line p-1.5 text-xs" /></label>
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
      setPreferencesMessage(formatUserMessage(error, "Unable to save column preferences."));
    }
  };

  return <section className="rounded-2xl border border-line bg-surface p-4 shadow-sm ring-1 ring-line sm:p-5">
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div><h3 className="text-base font-semibold text-ink">Responsibility history</h3><p className="mt-1 text-sm text-ink-muted">Historical task, responsibility, approval, and financial details.</p></div>
      <button type="button" onClick={() => setFiltersOpen(true)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-semibold text-ink-secondary md:hidden"><Filter className="h-4 w-4" />Filter & Search (Active: {activeFilterCount})</button>
      <details className="relative">
        <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink-secondary hover:bg-surface-secondary"><Columns3 className="h-4 w-4" />Columns</summary>
        <div className="absolute right-0 z-30 mt-1 w-64 rounded-xl border border-line bg-surface p-3 shadow-xl">
          <p className="mb-2 text-xs font-semibold text-ink-secondary">Visible columns</p>
          <div className="max-h-72 space-y-1 overflow-y-auto">{AUDIT_COLUMNS.map((column) => <label key={column.id} className="flex items-center gap-2 rounded px-1 py-1.5 text-xs text-ink-secondary hover:bg-surface-secondary"><input type="checkbox" checked={visibleColumnIds.includes(column.id)} onChange={(event) => toggleColumn(column.id, event.target.checked)} />{column.label}</label>)}</div>
        </div>
        {filtersOpen && <div
          role="dialog"
          aria-modal="true"
          aria-label="Filter audit records"
          data-back-button-overlay="true"
          className="fixed inset-0 z-[80] flex items-end bg-slate-950/40 md:hidden"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setFiltersOpen(false);
          }}
        >
          <section className="max-h-[85dvh] w-full overflow-y-auto rounded-t-3xl bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl">
            <header className="sticky top-0 mb-3 flex items-center justify-between bg-surface pb-3">
              <h4 className="text-base font-bold text-ink">Filter audit records</h4>
              <button type="button" aria-label="Close filters" onClick={() => setFiltersOpen(false)} className="grid h-9 w-9 place-items-center rounded-lg text-ink-muted hover:bg-surface-secondary"><X className="h-4 w-4" /></button>
            </header>
            <div className="space-y-2">
              {visibleColumns.map((column) => <div key={column.id} className="mobile-audit-filter flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
                <span className="text-sm font-medium text-ink-secondary">{column.label}{hasFilter(column.id === "workerFacility" ? "worker" : column.id) || (column.id === "workerFacility" && hasFilter("facility")) ? " · Active" : ""}</span>
                {renderFilter(column)}
              </div>)}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => updateFilters(Object.fromEntries(["worker", "facility", "owner", "manager", "snapshot", "service", "status", "approvals", "room", "date", "hours", "value"].map((key) => [key, null])))} className="min-h-11 rounded-lg border border-line px-4 text-sm font-semibold text-ink-secondary">Clear All</button>
              <button type="button" onClick={() => setFiltersOpen(false)} className="min-h-11 rounded-lg bg-slate-900 px-5 text-sm font-semibold text-white">Apply</button>
            </div>
          </section>
        </div>}
      </details>
    </div>
    {(preferencesMessage || storedPreference.message) && <p role="status" className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{preferencesMessage || storedPreference.message}</p>}
    {historyError && <p role="alert" className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-200">{historyError}</p>}
    {!loadedHistory && !historyError && <p role="status" className="mb-3 text-sm text-ink-secondary">Loading this responsibility-history page…</p>}
    <div className="admin-config-scroll mobile-card-table-wrapper max-h-[65vh] overflow-auto rounded-lg border border-line [-webkit-overflow-scrolling:touch]">
      <table className="mobile-card-table min-w-max w-full text-left text-sm">
        <thead className="sticky top-0 z-10 bg-surface/95 text-ink-secondary shadow-sm backdrop-blur"><tr>{visibleColumns.map((column) => <th key={column.id} className="whitespace-nowrap px-3 py-2"><div className="flex items-center gap-1"><span>{column.label}</span>{renderFilter(column)}</div></th>)}</tr></thead>
        <tbody className="divide-y divide-line">{visibleLogs.map((log) => {
          const service = log.service_name_snapshot ?? log.services_config?.[0]?.name ?? "Service";
          const hours = log.end_time ? durationHours(log.start_time, log.end_time) : 0;
          const cells: Record<AuditColumnId, ReactNode> = {
            date: <button type="button" onClick={() => onOpen(log)} className="whitespace-nowrap text-left text-sky-800 underline decoration-transparent underline-offset-2 hover:text-sky-950 hover:decoration-current focus:decoration-current">{new Date(log.start_time).toLocaleString("en-GB", { timeZone: "Africa/Cairo" })}</button>,
            workerFacility: <>{log.cleanerName}<span className="block text-xs text-ink-muted">{log.hotelName}</span></>,
            owner: log.owner_name ?? "Unassigned owner",
            manager: log.manager_name ?? "Unassigned manager",
            snapshot: log.responsibility_recorded_at ? new Date(log.responsibility_recorded_at).toLocaleString("en-GB", { timeZone: "Africa/Cairo" }) : "Unavailable",
            service,
            status: <StatusBadge status={lifecycleStatusKind(log)} />,
            hours: `${hours.toFixed(2)} hrs`,
            value: `GBP ${getLogLaborCost(log).toFixed(2)}`,
            approvals: approvalSummary(log),
            room: logRoomReference(log),
          };
          return <tr key={log.id} className="align-top hover:bg-surface-secondary">{visibleColumns.map((column) => <td key={column.id} data-label={column.label} className="max-w-64 whitespace-nowrap px-3 py-3 text-ink-secondary">{cells[column.id]}</td>)}</tr>;
        })}{loadedHistory && visibleLogs.length === 0 && <tr><td colSpan={visibleColumns.length} className="px-3 py-8 text-center text-ink-muted">No work-log snapshots match these filters.</td></tr>}</tbody>
        <tfoot><tr className="font-semibold text-ink"><td colSpan={visibleColumns.length} className="px-3 py-3">Filtered audit records <span className="float-right tabular-nums">{totalCount}</span></td></tr></tfoot>
      </table>
    </div>
    <DashboardPagination currentPage={currentPage} pageCount={pageCount} total={totalCount} pageSize={pageSize} label="audit records" onPageChange={setPage} />
  </section>;
}
