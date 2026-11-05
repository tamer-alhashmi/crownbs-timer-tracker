"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";
import { getManagementOperationalBrief } from "@/lib/operationalBrief";
import { requireFeatureAccess } from "@/lib/featureAccess";
import { isPlatformAdmin } from "@/lib/roles";
import {
  fetchManagementAuditPage,
  fetchManagementHistoryPage,
  type ManagementAuditPage,
  type ManagementAuditPageRequest,
  type ManagementHistoryFilters,
  type ManagementHistoryPage,
} from "@/lib/managementAudit";

type ApprovalRole = "manager" | "owner";
type WorkLogUpdate = {
  hotelId?: string;
  serviceId?: string;
  startTime?: string;
  endTime?: string;
  roomsCompleted?: number;
  roomNumber?: string;
  notes?: string;
  status?: "assigned" | "active" | "completed";
};
export type ManagementWorkLogPageRequest = {
  page: number;
  pageSize: number;
  from?: string;
  to?: string;
  worker?: string;
  property?: string;
  service?: string;
  status?: string;
  tenant?: string;
  needsAction?: boolean;
  sort?: "date" | "cleaner" | "hotel" | "service" | "status";
  ascending?: boolean;
};
export type ManagementPayrollPageRequest = {
  page: number;
  pageSize: number;
  from?: string;
  to?: string;
  worker?: string;
  property?: string;
  tenant?: string;
};

type PageResult<T> = { data: T[] | null; error: { message: string } | null };
export type ManagementDashboardSummary = {
  totalLogs: number;
  completedLogs: number;
  awaitingApprovalLogs: number;
  activeStaff: number;
  laborCost: number;
  completedRooms: number;
  lockedPayrollLiability: number;
  properties: { id: string; name: string; rooms: number; cost: number }[];
};
export type ManagementDashboardSummaryRequest = {
  from?: string;
  to?: string;
  worker?: string;
  property?: string;
  tenant?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDashboardSummary(value: unknown): ManagementDashboardSummary {
  if (!isRecord(value) || !Array.isArray(value.properties)) {
    throw new Error("The management summary query returned an invalid response.");
  }
  const toNumber = (key: string) => {
    const number = Number(value[key]);
    if (!Number.isFinite(number)) throw new Error(`The management summary returned an invalid ${key} value.`);
    return number;
  };
  const properties = value.properties.map((property) => {
    if (!isRecord(property) || typeof property.id !== "string" || typeof property.name !== "string") {
      throw new Error("The management summary returned an invalid property.");
    }
    const rooms = Number(property.rooms);
    const cost = Number(property.cost);
    if (!Number.isFinite(rooms) || !Number.isFinite(cost)) throw new Error("The management summary returned invalid property totals.");
    return { id: property.id, name: property.name, rooms, cost };
  });
  return {
    totalLogs: toNumber("totalLogs"),
    completedLogs: toNumber("completedLogs"),
    awaitingApprovalLogs: toNumber("awaitingApprovalLogs"),
    activeStaff: toNumber("activeStaff"),
    laborCost: toNumber("laborCost"),
    completedRooms: toNumber("completedRooms"),
    lockedPayrollLiability: toNumber("lockedPayrollLiability"),
    properties,
  };
}

async function getScopedManagementHotelIds(user: Awaited<ReturnType<typeof requireManagement>>, supabase: ReturnType<typeof createPrivilegedServerSupabaseClient>) {
  if (isPlatformAdmin(user.role)) return null;
  let hotelsQuery = supabase.from("hotels").select("id, owner_id, manager_id").is("archived_at", null);
  hotelsQuery = user.role === "owner"
    ? hotelsQuery.eq("owner_id", user.userId)
    : hotelsQuery.eq("manager_id", user.userId);
  const { data: hotels, error } = await hotelsQuery;
  if (error) throw new Error(`Unable to verify assigned properties: ${error.message}`);
  return [...new Set([...(hotels ?? []).map((hotel) => hotel.id), ...(user.hotelId ? [user.hotelId] : [])])];
}

async function loadManagementDashboardSummary(
  supabase: ReturnType<typeof createPrivilegedServerSupabaseClient>,
  hotelIds: string[] | null,
  request: ManagementDashboardSummaryRequest,
) {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const readDate = (date: string | undefined, field: string) => {
    if (!date) return null;
    const parsedDate = datePattern.test(date) ? new Date(`${date}T00:00:00Z`) : null;
    if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
      throw new Error(`Choose a valid ${field} date.`);
    }
    return date;
  };
  const readId = (id: string | undefined, field: string) => {
    if (!id) return null;
    if (!uuidPattern.test(id)) throw new Error(`Choose a valid ${field}.`);
    return id;
  };
  const { data, error } = await supabase.rpc("get_management_dashboard_summary", {
    p_hotel_ids: hotelIds,
    p_from: readDate(request.from, "start"),
    p_to: readDate(request.to, "end"),
    p_worker: readId(request.worker, "worker"),
    p_property: readId(request.property, "property"),
    p_tenant: readId(request.tenant, "tenant"),
  });
  if (error) throw new Error(`Unable to load management summary: ${error.message}`);
  return parseDashboardSummary(data);
}

async function fetchAllRows<T>(label: string, fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>) {
  const rows: T[] = [];
  const pageSize = 500;

  for (let from = 0; ; from += pageSize) {
    try {
      const { data, error } = await fetchPage(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      const page = data ?? [];
      rows.push(...page);
      if (page.length < pageSize) return rows;
    } catch (error) {
      throw new Error(`Failed to load management ${label}.`, { cause: error });
    }
  }
}

async function requireManagement() {
  const user = await getSessionUser();
  if (!user || (!isPlatformAdmin(user.role) && !["owner", "manager"].includes(user.role))) throw new Error("Unauthorized");
  return user;
}

async function getLogForAction(logId: string) {
  const supabase = createPrivilegedServerSupabaseClient();
  const { data: log, error } = await supabase.from("work_logs").select("*").eq("id", logId).maybeSingle();
  if (error || !log) throw new Error("Work log was not found.");
  return { supabase, log };
}

async function assertRoleControlsLog(role: ApprovalRole, log: { user_id: string; hotel_id: string; owner_id: string | null; manager_id: string | null }) {
  const user = await requireManagement();
  if (user.userId === log.user_id) {
    throw new Error("You cannot approve or reject your own work log.");
  }
  if (isPlatformAdmin(user.role)) return user;
  if (user.role !== role) throw new Error(`Only the ${role} can perform this approval.`);
  if (role === "manager") {
    const supabase = createPrivilegedServerSupabaseClient();
    const { data: assignee, error } = await supabase.from("users").select("role").eq("id", log.user_id).maybeSingle();
    if (error) throw new Error(`Unable to verify the assigned user's role: ${error.message}`);
    if (!assignee || !["housekeeping_admin", "hk_admin", "cleaner"].includes(assignee.role)) {
      throw new Error("Managers can approve only work logs completed by HK Admins or Cleaners.");
    }
  }
  const snapshotId = role === "owner" ? log.owner_id : log.manager_id;
  if (snapshotId !== user.userId) throw new Error(`This work log belongs to the previous ${role} assignment and cannot be changed by the current ${role}.`);
  return user;
}

function getFinalizationTime(startTime: string) {
  const startTimestamp = Date.parse(startTime);
  const now = Date.now();
  if (!Number.isFinite(startTimestamp) || startTimestamp > now) {
    throw new Error("This task has an invalid or future start time and cannot be finalized.");
  }
  return new Date(now).toISOString();
}

async function loadManagementOverview(period?: { from: string; to: string }) {
  const user = await requireFeatureAccess("dashboard");
  if (!isPlatformAdmin(user.role) && !["owner", "manager"].includes(user.role)) throw new Error("Management access required.");
  const supabase = createPrivilegedServerSupabaseClient();
  const briefPromise = getManagementOperationalBrief(user, period);
  const hotelsQuery = supabase.from("hotels").select("id, name, location, owner_id, manager_id, created_at, is_active, latitude, longitude, floors_sections, total_rooms").is("archived_at", null).order("name").order("id");
  const hotels = await fetchAllRows("properties", (from, to) => hotelsQuery.range(from, to));
  const assignedHotelId = user.hotelId ?? null;
  const visibleHotels = isPlatformAdmin(user.role)
    ? hotels ?? []
    : (hotels ?? []).filter((hotel) => {
      const assignedUserId = user.role === "owner" ? hotel.owner_id : hotel.manager_id;
      return assignedUserId === user.userId || hotel.id === assignedHotelId;
    });
  const hotelIds = visibleHotels.map((hotel) => hotel.id);
  const hotelFilter = isPlatformAdmin(user.role) ? null : hotelIds;
  const summaryTo = new Date().toISOString().slice(0, 10);
  const summaryFrom = `${summaryTo.slice(0, 7)}-01`;
  const dashboardSummaryPromise = loadManagementDashboardSummary(
    supabase,
    isPlatformAdmin(user.role) ? null : hotelIds,
    { from: summaryFrom, to: summaryTo },
  );
  const cleanersQuery = supabase.from("users").select("id, full_name, email, role, primary_hotel_id").eq("role", "cleaner").order("full_name").order("id");
  const assigneesQuery = supabase.from("users").select("id, full_name, email, role").in("role", ["owner", "manager"]).order("full_name").order("id");
  const logsQuery = supabase.from("work_logs").select("id, user_id, hotel_id, service_id, shift_id, start_time, end_time, task_date, status, rooms_completed, room_ids, room_number, room_numbers, service_name_snapshot, service_description_snapshot, notes, cost_override, deleted_at, cancelled_at, owner_id, owner_name, manager_id, manager_name, responsibility_recorded_at, manager_approved, owner_approved, manager_rejected, owner_rejected, is_locked, rejection_notes, hotels(name), users!work_logs_user_id_fkey(full_name, email, role), services_config(name, description, default_rate, unit)").is("deleted_at", null).is("cancelled_at", null).eq("status", "active").is("end_time", null).order("start_time", { ascending: false }).order("id");
  const shiftsQuery = supabase.from("master_shifts").select("id, user_id, start_time, end_time, status").eq("status", "active").is("end_time", null).order("start_time").order("id");
  if (hotelFilter) {
    const scopedHotelIds = hotelIds.length ? hotelIds : ["00000000-0000-0000-0000-000000000000"];
    logsQuery.in("hotel_id", scopedHotelIds);
  }
  const servicesQuery = supabase.from("services_config").select("id, name, description, unit, default_rate, is_active, owner_id, created_at").order("name").order("id");
  const roomsQuery = supabase.from("rooms").select("id, hotel_id, room_name, floor_section, category, status").in("hotel_id", hotelIds.length ? hotelIds : ["00000000-0000-0000-0000-000000000000"]).eq("status", "active").order("room_name").order("id");
  const [cleaners, propertyAssignees, services, workLogs, rooms, activeShifts, dashboardSummary] = await Promise.all([
    fetchAllRows("cleaners", (from, to) => cleanersQuery.range(from, to)),
    fetchAllRows("property assignees", (from, to) => assigneesQuery.range(from, to)),
    fetchAllRows("services", (from, to) => servicesQuery.range(from, to)),
    fetchAllRows("active work logs", (from, to) => logsQuery.range(from, to)),
    fetchAllRows("rooms", (from, to) => roomsQuery.range(from, to)),
    fetchAllRows("active shifts", (from, to) => shiftsQuery.range(from, to)),
    dashboardSummaryPromise,
  ]);
  const tenantOwnerIds = new Set(visibleHotels.map((hotel) => hotel.owner_id).filter((id): id is string => Boolean(id)));
  const visibleServices = isPlatformAdmin(user.role)
    ? services
    : services.filter((service) => service.owner_id === null || tenantOwnerIds.has(service.owner_id));
  const { data: currentUser } = await supabase.from("users").select("full_name, email, avatar_url").eq("id", user.userId).maybeSingle();
  const [servicePermissionResult, payrollPermissionResult] = isPlatformAdmin(user.role)
    ? [null, null]
    : await Promise.all([
      supabase.from("user_feature_permissions").select("can_view, can_create, can_edit, can_delete").eq("user_id", user.userId).eq("feature_key", "settings").maybeSingle(),
      supabase.from("user_feature_permissions").select("can_edit, can_delete").eq("user_id", user.userId).eq("feature_key", "work_log_approvals").maybeSingle(),
    ]);
  if (servicePermissionResult?.error && servicePermissionResult.error.code !== "PGRST205") throw new Error(servicePermissionResult.error.message);
  if (payrollPermissionResult?.error && payrollPermissionResult.error.code !== "PGRST205") throw new Error(payrollPermissionResult.error.message);
  const servicePermission = servicePermissionResult?.data ?? null;
  const payrollPermission = payrollPermissionResult?.data ?? null;
  const hotelsById = new Map(visibleHotels.map((hotel) => [hotel.id, hotel.name]));
  const cleanerIdsInScope = new Set(workLogs.map((log) => log.user_id));
  const cleanersInScope = isPlatformAdmin(user.role)
    ? cleaners
    : cleaners.filter((cleaner) => Boolean(cleaner.primary_hotel_id && hotelIds.includes(cleaner.primary_hotel_id)) || cleanerIdsInScope.has(cleaner.id));
  const cleanersById = new Map(cleaners.map((cleaner) => [cleaner.id, cleaner.full_name || cleaner.email]));
  const roomsById = new Map(rooms.map((room) => [room.id, room]));
  const workLogsWithNames = workLogs.map((log) => {
    const linkedUser = Array.isArray(log.users) ? log.users[0] : log.users;
    return {
      ...log,
      room_numbers: Array.isArray(log.room_numbers) ? log.room_numbers : [],
      roomDetails: (Array.isArray(log.room_ids) ? log.room_ids : []).flatMap((roomId) => {
        const room = roomsById.get(roomId);
        return room ? [{ name: room.room_name, floor: room.floor_section ?? "Unassigned section" }] : [];
      }),
      cleanerName: cleanersById.get(log.user_id) ?? linkedUser?.full_name ?? linkedUser?.email ?? "Unknown worker",
      hotelName: hotelsById.get(log.hotel_id) ?? "Unknown hotel",
      assigneeRole: linkedUser?.role ?? "cleaner",
    };
  });
  const activeTasks = workLogsWithNames.filter((log) => !log.cancelled_at && log.status === "active" && !log.end_time);
  const cleanerRecordsById = new Map(cleaners.map((cleaner) => [cleaner.id, cleaner]));
  const visibleActiveShifts = activeShifts.filter((shift) => {
    if (isPlatformAdmin(user.role)) return true;
    const cleaner = cleanerRecordsById.get(shift.user_id);
    return Boolean(
      (cleaner?.primary_hotel_id && hotelIds.includes(cleaner.primary_hotel_id))
      || activeTasks.some((task) => task.user_id === shift.user_id && hotelIds.includes(task.hotel_id))
    );
  }).map((shift) => ({
    ...shift,
    cleanerName: cleanerRecordsById.get(shift.user_id)?.full_name || cleanerRecordsById.get(shift.user_id)?.email || "Unknown cleaner",
    task: activeTasks.find((task) => task.shift_id === shift.id) ?? activeTasks.find((task) => task.user_id === shift.user_id) ?? null,
  }));
  const brief = await briefPromise;
  return {
    cleaners: cleanersInScope.map((cleaner) => ({ id: cleaner.id, name: cleaner.full_name || cleaner.email, primary_hotel_id: cleaner.primary_hotel_id ?? null })),
    hotels: visibleHotels,
    propertyAssignees: propertyAssignees
      .filter((assignee) => isPlatformAdmin(user.role) || visibleHotels.some((hotel) => hotel.owner_id === assignee.id || hotel.manager_id === assignee.id))
      .map((assignee) => ({ id: assignee.id, name: assignee.full_name || assignee.email, role: assignee.role })),
    services: visibleServices,
    rooms,
    workLogs: workLogsWithNames,
    activeShifts: visibleActiveShifts,
    activeTasks: activeTasks,
    currentUserId: user.userId,
    summary: dashboardSummary,
    userRole: user.role,
    canViewServices: isPlatformAdmin(user.role) || servicePermission === null || servicePermission.can_view === true,
    canManageServices: isPlatformAdmin(user.role) || servicePermission === null || (servicePermission.can_create === true && servicePermission.can_edit === true && servicePermission.can_delete === true),
    canManagePayrollTasks: isPlatformAdmin(user.role) || payrollPermission === null || (payrollPermission.can_edit === true && payrollPermission.can_delete === true),
    canManageActiveOperations: isPlatformAdmin(user.role) || payrollPermission === null || payrollPermission.can_edit === true,
    userName: currentUser?.full_name ?? user.email,
    userEmail: currentUser?.email ?? user.email,
    userAvatarUrl: currentUser?.avatar_url ?? null,
    brief,
  };
}

export async function getManagementWorkLogPage(request: ManagementWorkLogPageRequest) {
  const user = await requireFeatureAccess("dashboard");
  if (!isPlatformAdmin(user.role) && !["owner", "manager"].includes(user.role)) throw new Error("Management access required.");
  const pageSize = Number.isInteger(request.pageSize) ? Math.min(50, Math.max(1, request.pageSize)) : 20;
  const requestedPage = Number.isInteger(request.page) ? Math.max(1, request.page) : 1;
  const supabase = createPrivilegedServerSupabaseClient();
  let hotelQuery = supabase.from("hotels").select("id, owner_id, manager_id").is("archived_at", null);
  if (!isPlatformAdmin(user.role)) {
    hotelQuery = hotelQuery.or(`owner_id.eq.${user.userId},manager_id.eq.${user.userId},id.eq.${user.hotelId ?? "00000000-0000-0000-0000-000000000000"}`);
  }
  const { data: scopedHotels, error: hotelError } = await hotelQuery;
  if (hotelError) throw new Error(`Unable to verify property access for work logs: ${hotelError.message}`);
  let hotelIds = (scopedHotels ?? []).map((hotel) => hotel.id);
  if (request.tenant && isPlatformAdmin(user.role)) {
    hotelIds = hotelIds.filter((id) => scopedHotels?.some((hotel) => hotel.id === id && hotel.owner_id === request.tenant));
  }
  const scopedHotelIds = hotelIds.length ? hotelIds : ["00000000-0000-0000-0000-000000000000"];
  const columns = "id, user_id, hotel_id, service_id, shift_id, start_time, end_time, task_date, status, rooms_completed, room_ids, room_number, room_numbers, service_name_snapshot, service_description_snapshot, notes, cost_override, deleted_at, cancelled_at, owner_id, owner_name, manager_id, manager_name, responsibility_recorded_at, manager_approved, owner_approved, manager_rejected, owner_rejected, is_locked, rejection_notes, hotels(name), users!work_logs_user_id_fkey(full_name, email, role), services_config(name, description, default_rate, unit)";
  const buildQuery = () => {
    let query = supabase.from("work_logs").select(columns, { count: "exact" }).is("deleted_at", null).in("hotel_id", scopedHotelIds);
    if (request.from) query = query.gte("task_date", request.from);
    if (request.to) query = query.lte("task_date", request.to);
    if (request.worker) query = query.eq("user_id", request.worker);
    if (request.property) query = query.eq("hotel_id", request.property);
    if (request.service) query = query.eq("service_id", request.service);
    if (request.tenant && isPlatformAdmin(user.role)) query = query.eq("owner_id", request.tenant);
    if (request.needsAction) query = query.eq("status", "completed").eq("is_locked", false).eq("manager_rejected", false).eq("owner_rejected", false);
    if (request.status === "Cancelled") query = query.not("cancelled_at", "is", null);
    else if (request.status === "Active") query = query.eq("status", "active").is("cancelled_at", null);
    else if (request.status === "Approved") query = query.eq("is_locked", true).is("cancelled_at", null);
    else if (request.status === "Rejected") query = query.or("manager_rejected.eq.true,owner_rejected.eq.true").is("cancelled_at", null);
    else if (request.status === "Pending approval") query = query.eq("status", "completed").eq("is_locked", false).eq("manager_rejected", false).eq("owner_rejected", false).is("cancelled_at", null);
    const sortColumn = request.sort === "cleaner" ? "user_id"
      : request.sort === "hotel" ? "hotel_id"
        : request.sort === "service" ? "service_id"
          : request.sort === "status" ? "status"
            : "task_date";
    return query.order(sortColumn, { ascending: request.ascending === true }).order("id", { ascending: request.ascending === true });
  };
  const countQuery = supabase.from("work_logs").select("id", { count: "exact", head: true }).is("deleted_at", null).in("hotel_id", scopedHotelIds);
  const addCountFilters = (query: typeof countQuery) => {
    if (request.from) query = query.gte("task_date", request.from);
    if (request.to) query = query.lte("task_date", request.to);
    if (request.worker) query = query.eq("user_id", request.worker);
    if (request.property) query = query.eq("hotel_id", request.property);
    if (request.service) query = query.eq("service_id", request.service);
    if (request.tenant && isPlatformAdmin(user.role)) query = query.eq("owner_id", request.tenant);
    if (request.needsAction) query = query.eq("status", "completed").eq("is_locked", false).eq("manager_rejected", false).eq("owner_rejected", false);
    if (request.status === "Cancelled") query = query.not("cancelled_at", "is", null);
    else if (request.status === "Active") query = query.eq("status", "active").is("cancelled_at", null);
    else if (request.status === "Approved") query = query.eq("is_locked", true).is("cancelled_at", null);
    else if (request.status === "Rejected") query = query.or("manager_rejected.eq.true,owner_rejected.eq.true").is("cancelled_at", null);
    else if (request.status === "Pending approval") query = query.eq("status", "completed").eq("is_locked", false).eq("manager_rejected", false).eq("owner_rejected", false).is("cancelled_at", null);
    return query;
  };
  const [{ count, error: countError }, { data: records, error: recordsError }] = await Promise.all([
    addCountFilters(countQuery),
    buildQuery().range((requestedPage - 1) * pageSize, requestedPage * pageSize - 1),
  ]);
  if (countError) throw new Error(`Unable to count management work logs: ${countError.message}`);
  if (recordsError) throw new Error(`Unable to load management work logs: ${recordsError.message}`);
  const totalCount = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const page = Math.min(requestedPage, pageCount);
  const pageRecords = page === requestedPage
    ? records ?? []
    : await (async () => {
      const { data, error } = await buildQuery().range((page - 1) * pageSize, page * pageSize - 1);
      if (error) throw new Error(`Unable to load management work logs: ${error.message}`);
      return data ?? [];
    })();
  const roomIds = [...new Set(pageRecords.flatMap((record) => Array.isArray(record.room_ids) ? record.room_ids : []))];
  const { data: rooms, error: roomsError } = roomIds.length
    ? await supabase.from("rooms").select("id, room_name, floor_section").in("id", roomIds)
    : { data: [], error: null };
  if (roomsError) throw new Error(`Unable to load work log room details: ${roomsError.message}`);
  const roomsById = new Map((rooms ?? []).map((room) => [room.id, room]));
  const enrichedRecords = pageRecords.map((record) => {
    const linkedUser = Array.isArray(record.users) ? record.users[0] : record.users;
    const hotel = Array.isArray(record.hotels) ? record.hotels[0] : record.hotels;
    const service = Array.isArray(record.services_config) ? record.services_config[0] : record.services_config;
    return {
      ...record,
      room_numbers: Array.isArray(record.room_numbers) ? record.room_numbers : [],
      roomDetails: (Array.isArray(record.room_ids) ? record.room_ids : []).flatMap((roomId) => {
        const room = roomsById.get(roomId);
        return room ? [{ name: room.room_name, floor: room.floor_section ?? "Unassigned section" }] : [];
      }),
      cleanerName: linkedUser?.full_name?.trim() || linkedUser?.email?.trim() || "Unknown worker",
      hotelName: hotel?.name ?? "Unknown hotel",
      assigneeRole: linkedUser?.role ?? "cleaner",
      services_config: service ? [{
        name: record.service_name_snapshot ?? service.name ?? "Service",
        description: record.service_description_snapshot ?? service.description ?? "",
        default_rate: service.default_rate ?? 0,
        unit: service.unit ?? "hourly",
      }] : [],
    };
  });
  return { records: enrichedRecords, totalCount, page, pageSize, pageCount };
}

export async function getManagementPayrollPage(request: ManagementPayrollPageRequest) {
  const user = await requireFeatureAccess("dashboard");
  if (!isPlatformAdmin(user.role) && !["owner", "manager"].includes(user.role)) throw new Error("Management access required.");
  const pageSize = Number.isInteger(request.pageSize) ? Math.min(50, Math.max(1, request.pageSize)) : 15;
  const requestedPage = Number.isInteger(request.page) ? Math.max(1, request.page) : 1;
  const supabase = createPrivilegedServerSupabaseClient();
  let hotelQuery = supabase.from("hotels").select("id, owner_id, manager_id").is("archived_at", null);
  if (!isPlatformAdmin(user.role)) {
    hotelQuery = hotelQuery.or(`owner_id.eq.${user.userId},manager_id.eq.${user.userId},id.eq.${user.hotelId ?? "00000000-0000-0000-0000-000000000000"}`);
  }
  const { data: scopedHotels, error: hotelError } = await hotelQuery;
  if (hotelError) throw new Error(`Unable to verify property access for payroll: ${hotelError.message}`);
  const hotelIds = (scopedHotels ?? [])
    .filter((hotel) => !request.tenant || !isPlatformAdmin(user.role) || hotel.owner_id === request.tenant)
    .map((hotel) => hotel.id);
  const scopedHotelIds = hotelIds.length ? hotelIds : ["00000000-0000-0000-0000-000000000000"];
  const columns = "id, user_id, hotel_id, service_id, shift_id, start_time, end_time, task_date, status, rooms_completed, room_number, room_numbers, room_ids, service_name_snapshot, service_description_snapshot, notes, cost_override, deleted_at, cancelled_at, travel_time_included, manager_approved, owner_approved, manager_approved_at, owner_approved_at, manager_rejected, owner_rejected, manager_rejected_at, owner_rejected_at, rejection_notes, owner_id, owner_name, manager_id, manager_name, responsibility_recorded_at, import_key, is_locked, created_at, updated_at, hotels(name, location), users!work_logs_user_id_fkey(full_name, email), services_config(name, description, default_rate, unit)";
  const buildQuery = () => {
    let query = supabase.from("work_logs").select(columns, { count: "exact" })
      .eq("is_locked", true).eq("status", "completed").is("deleted_at", null).is("cancelled_at", null)
      .in("hotel_id", scopedHotelIds);
    if (request.from) query = query.gte("task_date", request.from);
    if (request.to) query = query.lte("task_date", request.to);
    if (request.property) query = query.eq("hotel_id", request.property);
    if (request.worker) query = query.eq("user_id", request.worker);
    if (request.tenant && isPlatformAdmin(user.role)) query = query.eq("owner_id", request.tenant);
    return query.order("start_time", { ascending: false }).order("id");
  };
  const countQuery = supabase.from("work_logs").select("id", { count: "exact", head: true })
    .eq("is_locked", true).eq("status", "completed").is("deleted_at", null).is("cancelled_at", null)
    .in("hotel_id", scopedHotelIds);
  const addCountFilters = (query: typeof countQuery) => {
    if (request.from) query = query.gte("task_date", request.from);
    if (request.to) query = query.lte("task_date", request.to);
    if (request.property) query = query.eq("hotel_id", request.property);
    if (request.worker) query = query.eq("user_id", request.worker);
    if (request.tenant && isPlatformAdmin(user.role)) query = query.eq("owner_id", request.tenant);
    return query;
  };
  const [{ count, error: countError }, { data: records, error: recordsError }] = await Promise.all([
    addCountFilters(countQuery),
    buildQuery().range((requestedPage - 1) * pageSize, requestedPage * pageSize - 1),
  ]);
  if (countError) throw new Error(`Unable to count payroll records: ${countError.message}`);
  if (recordsError) throw new Error(`Unable to load payroll records: ${recordsError.message}`);
  const totalCount = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const page = Math.min(requestedPage, pageCount);
  const pageRecords = page === requestedPage
    ? records ?? []
    : await (async () => {
      const { data, error } = await buildQuery().range((page - 1) * pageSize, page * pageSize - 1);
      if (error) throw new Error(`Unable to load payroll records: ${error.message}`);
      return data ?? [];
    })();
  const enrichedRecords = pageRecords.map((record) => {
    const userRecord = Array.isArray(record.users) ? record.users[0] : record.users;
    const hotel = Array.isArray(record.hotels) ? record.hotels[0] : record.hotels;
    const service = Array.isArray(record.services_config) ? record.services_config[0] : record.services_config;
    return {
      ...record,
      cleanerName: userRecord?.full_name?.trim() || userRecord?.email?.trim() || "Unknown cleaner",
      cleanerEmail: userRecord?.email ?? "",
      hotelName: hotel?.name ?? "Unknown hotel",
      hotelLocation: hotel?.location ?? "",
      services_config: service ? [{
        name: record.service_name_snapshot ?? service.name ?? "Service",
        description: record.service_description_snapshot ?? service.description ?? "",
        default_rate: service.default_rate ?? 0,
        unit: service.unit ?? "hourly",
      }] : [],
    };
  });
  return { records: enrichedRecords, totalCount, page, pageSize, pageCount };
}

export async function getManagementOverview(period?: { from: string; to: string }) {
  try {
    return await loadManagementOverview(period);
  } catch (error) {
    const isExpectedStaticGeneration = Boolean(
      error && typeof error === "object" && "digest" in error && error.digest === "DYNAMIC_SERVER_USAGE"
    );
    if (!isExpectedStaticGeneration) {
      console.error("Failed to render the management dashboard.", { period, error });
    }
    throw error;
  }
}

export async function getManagementOverrideAuditPage(request: ManagementAuditPageRequest): Promise<ManagementAuditPage> {
  const user = await requireFeatureAccess("dashboard");
  if (!isPlatformAdmin(user.role) && !["owner", "manager"].includes(user.role)) {
    throw new Error("Management access required.");
  }
  const supabase = createPrivilegedServerSupabaseClient();
  const hotelIds = await getScopedManagementHotelIds(user, supabase);
  return fetchManagementAuditPage(supabase, hotelIds, request);
}

export async function getManagementResponsibilityHistoryPage(request: {
  page: number;
  pageSize: number;
  filters: ManagementHistoryFilters;
}): Promise<ManagementHistoryPage> {
  const user = await requireFeatureAccess("dashboard");
  if (!isPlatformAdmin(user.role) && !["owner", "manager"].includes(user.role)) {
    throw new Error("Management access required.");
  }
  const supabase = createPrivilegedServerSupabaseClient();
  const hotelIds = await getScopedManagementHotelIds(user, supabase);
  return fetchManagementHistoryPage(supabase, hotelIds, request);
}

export async function getManagementDashboardSummary(request: ManagementDashboardSummaryRequest): Promise<ManagementDashboardSummary> {
  const user = await requireFeatureAccess("dashboard");
  if (!isPlatformAdmin(user.role) && !["owner", "manager"].includes(user.role)) {
    throw new Error("Management access required.");
  }
  const supabase = createPrivilegedServerSupabaseClient();
  const hotelIds = await getScopedManagementHotelIds(user, supabase);
  return loadManagementDashboardSummary(supabase, hotelIds, request);
}

export type ManagementOverrideInput = {
  entityType: "shift" | "task";
  entityId: string;
  action: "force_clock_out" | "force_complete_task" | "cancel_task";
  reason: string;
  endTime?: string;
};

async function assertManagementControlsHotel(user: Awaited<ReturnType<typeof requireManagement>>, hotelId: string) {
  if (isPlatformAdmin(user.role)) return;
  const supabase = createPrivilegedServerSupabaseClient();
  const { data: hotel, error } = await supabase.from("hotels").select("owner_id, manager_id").eq("id", hotelId).maybeSingle();
  if (error) throw new Error(error.message);
  const assignedId = user.role === "owner" ? hotel?.owner_id : hotel?.manager_id;
  if (!hotel || assignedId !== user.userId) throw new Error("This operation is outside your assigned properties.");
}

export async function overrideActiveOperation(input: ManagementOverrideInput) {
  const user = await requireFeatureAccess("work_log_approvals", "edit");
  if (!isPlatformAdmin(user.role) && !["owner", "manager"].includes(user.role)) throw new Error("Management access required.");
  if (!input || typeof input.entityId !== "string" || !input.entityId || !["shift", "task"].includes(input.entityType)) {
    throw new Error("A valid active operation is required.");
  }
  if (typeof input.reason !== "string") throw new Error("An audit reason is required.");
  const reason = input.reason.trim();
  if (reason.length < 5 || reason.length > 1000) throw new Error("Enter an audit reason between 5 and 1,000 characters.");
  if (input.entityType === "shift" && input.action !== "force_clock_out") throw new Error("The requested shift action is invalid.");
  if (input.entityType === "task" && !["force_complete_task", "cancel_task"].includes(input.action)) throw new Error("The requested task action is invalid.");
  if (input.endTime !== undefined && (typeof input.endTime !== "string" || !Number.isFinite(Date.parse(input.endTime)))) throw new Error("Enter a valid end time.");

  const supabase = createPrivilegedServerSupabaseClient();
  if (input.entityType === "task") {
    const { data: task, error } = await supabase.from("work_logs").select("hotel_id").eq("id", input.entityId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!task) throw new Error("The active task was not found.");
    await assertManagementControlsHotel(user, task.hotel_id);
  } else {
    const { data: shift, error } = await supabase.from("master_shifts").select("user_id").eq("id", input.entityId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!shift) throw new Error("The active shift was not found.");
    if (!isPlatformAdmin(user.role)) {
      const [{ data: cleaner }, { data: task }] = await Promise.all([
        supabase.from("users").select("primary_hotel_id").eq("id", shift.user_id).maybeSingle(),
        supabase.from("work_logs").select("hotel_id").eq("shift_id", input.entityId).eq("status", "active").is("end_time", null).is("cancelled_at", null).limit(1).maybeSingle(),
      ]);
      const hotelId = task?.hotel_id ?? cleaner?.primary_hotel_id;
      if (!hotelId) throw new Error("This shift has no property assignment for role verification.");
      await assertManagementControlsHotel(user, hotelId);
    }
  }

  const { data, error } = await supabase.rpc("record_management_override", {
    p_entity_type: input.entityType,
    p_entity_id: input.entityId,
    p_action: input.action,
    p_actor_id: user.userId,
    p_reason: reason,
    p_end_time: input.endTime || null,
  });
  if (error) throw new Error(error.message);
  for (const path of ["/admin", "/manager", "/owner", "/dashboard"]) revalidatePath(path);
  return data;
}

export type PayrollTaskUpdate = {
  serviceId: string;
  roomsCompleted: number;
  notes: string;
  cost: number;
};

async function requirePayrollTaskAccess(action: "edit" | "delete") {
  const user = await requireFeatureAccess("work_log_approvals", action);
  if (!isPlatformAdmin(user.role) && !["manager", "owner"].includes(user.role)) throw new Error("Management access required.");
  return user;
}

export async function updatePayrollTask(logId: string, changes: PayrollTaskUpdate) {
  const user = await requirePayrollTaskAccess("edit");
  if (!logId || !changes.serviceId) throw new Error("A task and service are required.");
  if (!Number.isInteger(changes.roomsCompleted) || changes.roomsCompleted < 0 || changes.roomsCompleted > 1_000_000) {
    throw new Error("Units completed must be a whole number between 0 and 1,000,000.");
  }
  if (!Number.isFinite(changes.cost) || changes.cost < 0 || changes.cost > 1_000_000_000) {
    throw new Error("Task cost must be a non-negative amount.");
  }
  if (typeof changes.notes !== "string" || changes.notes.length > 2000) {
    throw new Error("Task notes must be 2,000 characters or fewer.");
  }

  const supabase = createPrivilegedServerSupabaseClient();
  const { data: previous, error: readError } = await supabase.from("work_logs").select("*").eq("id", logId).maybeSingle();
  if (readError || !previous) throw new Error(readError?.message ?? "Payroll task was not found.");
  await assertManagementControlsHotel(user, previous.hotel_id);
  if (!previous.is_locked || previous.status !== "completed" || previous.deleted_at) {
    throw new Error("Only active, locked completed tasks can be edited from payroll.");
  }
  const { data: service, error: serviceError } = await supabase.from("services_config").select("id, is_active, name, description").eq("id", changes.serviceId).maybeSingle();
  if (serviceError || !service || (!service.is_active && service.id !== previous.service_id)) throw new Error("Choose an active service.");

  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await supabase.from("work_logs").update({
    service_id: changes.serviceId,
    service_name_snapshot: service.name,
    service_description_snapshot: service.description,
    rooms_completed: changes.roomsCompleted,
    notes: changes.notes.trim(),
    cost_override: Math.round(changes.cost * 100) / 100,
    updated_at: now,
  }).eq("id", logId).is("deleted_at", null).select("*").single();
  if (updateError || !updated) throw new Error(updateError?.message ?? "Payroll task could not be updated.");
  const { error: auditError } = await supabase.from("work_log_audit").insert({
    work_log_id: logId,
    actor_id: user.userId,
    action: "edited",
    previous_values: previous,
    new_values: updated,
  });
  if (auditError) throw new Error(`Task was updated, but audit history could not be saved: ${auditError.message}`);
  for (const path of ["/admin", "/dashboard", "/owner", "/manager"]) revalidatePath(path);
  return { id: updated.id };
}

export async function deletePayrollTask(logId: string) {
  const user = await requirePayrollTaskAccess("delete");
  if (!logId) throw new Error("A payroll task is required.");
  const supabase = createPrivilegedServerSupabaseClient();
  const { data: previous, error: readError } = await supabase.from("work_logs").select("*").eq("id", logId).maybeSingle();
  if (readError || !previous) throw new Error(readError?.message ?? "Payroll task was not found.");
  await assertManagementControlsHotel(user, previous.hotel_id);
  if (!previous.is_locked || previous.status !== "completed" || previous.deleted_at) {
    throw new Error("Only active, locked completed tasks can be removed from payroll.");
  }

  const now = new Date().toISOString();
  const { data: deleted, error: updateError } = await supabase.from("work_logs").update({
    deleted_at: now,
    updated_at: now,
  }).eq("id", logId).is("deleted_at", null).select("*").single();
  if (updateError || !deleted) throw new Error(updateError?.message ?? "Payroll task could not be removed.");
  const { error: auditError } = await supabase.from("work_log_audit").insert({
    work_log_id: logId,
    actor_id: user.userId,
    action: "deleted",
    previous_values: previous,
    new_values: deleted,
  });
  if (auditError) throw new Error(`Task was removed, but audit history could not be saved: ${auditError.message}`);
  for (const path of ["/admin", "/dashboard", "/owner", "/manager"]) revalidatePath(path);
  return { id: deleted.id };
}

export async function updateWorkLog(logId: string, changes: WorkLogUpdate) {
  const user = await requireFeatureAccess("work_log_approvals", "edit");
  if (!isPlatformAdmin(user.role) && !["owner", "manager"].includes(user.role)) throw new Error("Management access required.");
  const { supabase, log } = await getLogForAction(logId);
  if (changes.status !== undefined && !isPlatformAdmin(user.role)) {
    throw new Error("Only an admin can change a work log status.");
  }
  if (!isPlatformAdmin(user.role)) {
    const snapshotId = user.role === "owner" ? log.owner_id : log.manager_id;
    if (snapshotId !== user.userId) throw new Error("This work log belongs to the previous management assignment and cannot be edited.");
  }
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const nextStartTime = changes.startTime ? Date.parse(changes.startTime) : Date.parse(log.start_time);
  const nextEndTime = changes.endTime ? Date.parse(changes.endTime) : log.end_time ? Date.parse(log.end_time) : null;
  if (!Number.isFinite(nextStartTime) || (nextEndTime !== null && (!Number.isFinite(nextEndTime) || nextEndTime < nextStartTime))) {
    throw new Error("The end time must be at or after the start time.");
  }
  if (changes.roomsCompleted !== undefined && (!Number.isInteger(changes.roomsCompleted) || changes.roomsCompleted < 0)) {
    throw new Error("Units completed must be a non-negative whole number.");
  }
  if (changes.hotelId) payload.hotel_id = changes.hotelId;
  if (changes.serviceId) payload.service_id = changes.serviceId;
  if (changes.startTime) payload.start_time = new Date(nextStartTime).toISOString();
  if (changes.endTime) payload.end_time = new Date(Date.parse(changes.endTime)).toISOString();
  if (changes.roomsCompleted !== undefined) payload.rooms_completed = changes.roomsCompleted;
  if (changes.roomNumber !== undefined) payload.room_number = changes.roomNumber.trim();
  if (changes.notes !== undefined) payload.notes = changes.notes.trim();
  if (changes.status !== undefined) payload.status = changes.status;
  const { data: updated, error } = await supabase.from("work_logs").update(payload).eq("id", logId).select("*").single();
  if (error || !updated) throw new Error(error?.message ?? "Unable to update work log.");
  const { error: auditError } = await supabase.from("work_log_audit").insert({ work_log_id: logId, actor_id: user.userId, action: "edited", previous_values: log, new_values: updated });
  if (auditError) throw new Error(`Work log was updated, but audit history could not be saved: ${auditError.message}`);
  revalidatePath("/dashboard"); revalidatePath("/admin"); revalidatePath("/owner"); revalidatePath("/manager");
}

export async function approveWorkLog(logId: string, role: ApprovalRole) {
  await requireFeatureAccess("work_log_approvals", "edit");
  const { supabase, log } = await getLogForAction(logId);
  const user = await assertRoleControlsLog(role, log);
  const { data: assignee, error: assigneeError } = await supabase
    .from("users")
    .select("role")
    .eq("id", log.user_id)
    .maybeSingle();
  if (assigneeError) throw new Error(`Unable to verify the assigned user's role: ${assigneeError.message}`);
  if (!assignee) throw new Error("The assigned user could not be found.");
  let approvalRecord = log;
  if (log.status !== "completed" || !log.end_time) {
    if (assignee.role === "cleaner" || !["active", "completed"].includes(log.status)) {
      throw new Error("The cleaner must clock out before this log can be approved.");
    }
    const finalizedAt = getFinalizationTime(log.start_time);
    const autoApproveManager = assignee.role === "manager";
    const { data: finalized, error: finalizeError } = await supabase.from("work_logs")
      .update({
        status: "completed",
        end_time: finalizedAt,
        rooms_completed: Math.max(0, log.rooms_completed ?? 0),
        ...(autoApproveManager ? {
          manager_approved: true,
          manager_rejected: false,
          manager_approved_at: finalizedAt,
        } : {}),
        updated_at: finalizedAt,
      })
      .eq("id", logId)
      .eq("status", log.status)
      .is("end_time", null)
      .select("*")
      .maybeSingle();
    if (finalizeError) throw new Error(`Unable to finalize the administrative task: ${finalizeError.message}`);
    if (!finalized) throw new Error("This task was already updated and must be refreshed before approval.");
    const { error: finalizeAuditError } = await supabase.from("work_log_audit").insert({
      work_log_id: logId,
      actor_id: user.userId,
      action: autoApproveManager ? "approved" : "edited",
      previous_values: log,
      new_values: autoApproveManager
        ? { ...finalized, audit_note: "Manager approval was recorded automatically when the managerial task was finalized." }
        : finalized,
    });
    if (finalizeAuditError) throw new Error(`Task was finalized, but audit history could not be saved: ${finalizeAuditError.message}`);
    approvalRecord = finalized;
  }
  if (assignee.role === "manager" && !approvalRecord.manager_approved) {
    const approvedAt = new Date().toISOString();
    const { data: managerApproved, error: managerApprovalError } = await supabase.from("work_logs")
      .update({
        manager_approved: true,
        manager_rejected: false,
        manager_approved_at: approvedAt,
        updated_at: approvedAt,
      })
      .eq("id", logId)
      .eq("status", "completed")
      .select("*")
      .single();
    if (managerApprovalError || !managerApproved) {
      throw new Error(managerApprovalError?.message ?? "Unable to record automatic Manager approval.");
    }
    const { error: managerAuditError } = await supabase.from("work_log_audit").insert({
      work_log_id: logId,
      actor_id: user.userId,
      action: "approved",
      previous_values: approvalRecord,
      new_values: { ...managerApproved, audit_note: "Manager approval was recorded automatically for the managerial assignee." },
    });
    if (managerAuditError) throw new Error(`Manager approval was recorded, but its audit history could not be saved: ${managerAuditError.message}`);
    approvalRecord = managerApproved;
  }
  if (approvalRecord.is_locked) throw new Error("This log is already locked.");
  const now = new Date().toISOString();
  const payload = role === "manager" ? { manager_approved: true, manager_rejected: false, manager_approved_at: now, rejection_notes: null } : { owner_approved: true, owner_rejected: false, owner_approved_at: now, rejection_notes: null };
  const lock = role === "manager" ? approvalRecord.owner_approved : approvalRecord.manager_approved;
  const { data: updated, error } = await supabase.from("work_logs").update({ ...payload, is_locked: lock, updated_at: now }).eq("id", logId).select("*").single();
  if (error || !updated) throw new Error(error?.message ?? "Unable to approve work log.");
  const { error: auditError } = await supabase.from("work_log_audit").insert({ work_log_id: logId, actor_id: user.userId, action: "approved", previous_values: approvalRecord, new_values: updated });
  if (auditError) throw new Error(`Work log was approved, but audit history could not be saved: ${auditError.message}`);
  revalidatePath("/admin"); revalidatePath("/owner"); revalidatePath("/manager");
}

export async function finalizeWorkLogWithoutClockOut(logId: string) {
  const user = await requireFeatureAccess("work_log_approvals", "edit");
  if (!isPlatformAdmin(user.role) && !["owner", "manager"].includes(user.role)) throw new Error("Management access required.");
  if (typeof logId !== "string" || !logId) throw new Error("A work log is required.");
  const supabase = createPrivilegedServerSupabaseClient();
  const { data: previous, error: readError } = await supabase.from("work_logs")
    .select("*")
    .eq("id", logId)
    .is("deleted_at", null)
    .is("cancelled_at", null)
    .maybeSingle();
  if (readError || !previous) throw new Error(readError?.message ?? "Work log was not found.");
  await assertManagementControlsHotel(user, previous.hotel_id);
  if (previous.is_locked || previous.status !== "active" || previous.end_time) {
    throw new Error("Only an active, unfinished work log can be finalized.");
  }
  const { data: assignee, error: assigneeError } = await supabase.from("users")
    .select("role")
    .eq("id", previous.user_id)
    .maybeSingle();
  if (assigneeError) throw new Error(`Unable to verify the assigned user's role: ${assigneeError.message}`);
  if (!assignee) throw new Error("The assigned user could not be found.");
  if (user.role === "manager" && (previous.user_id === user.userId || !["housekeeping_admin", "hk_admin"].includes(assignee.role))) {
    throw new Error("Managers can only finalize unfinished HK Admin tasks assigned to their team.");
  }
  if (!isPlatformAdmin(user.role) && user.role !== "owner" && assignee.role === "cleaner") {
    throw new Error("Clock-out bypass is only available for administrative tasks.");
  }
  const now = getFinalizationTime(previous.start_time);
  const autoApproveManager = assignee.role === "manager";
  const { data: updated, error: updateError } = await supabase.from("work_logs")
    .update({
      status: "completed",
      end_time: now,
      rooms_completed: Math.max(0, previous.rooms_completed ?? 0),
      ...(autoApproveManager ? {
        manager_approved: true,
        manager_rejected: false,
        manager_approved_at: now,
      } : {}),
      updated_at: now,
    })
    .eq("id", logId)
    .eq("status", "active")
    .is("end_time", null)
    .select("*")
    .maybeSingle();
  if (updateError) throw new Error(`Unable to finalize the task: ${updateError.message}`);
  if (!updated) throw new Error("This task was already finalized.");
  const { error: auditError } = await supabase.from("work_log_audit").insert({
    work_log_id: logId,
    actor_id: user.userId,
    action: autoApproveManager ? "approved" : "edited",
    previous_values: previous,
    new_values: autoApproveManager
      ? { ...updated, audit_note: "Manager approval was recorded automatically when the managerial task was finalized." }
      : updated,
  });
  if (auditError) throw new Error(`Task was finalized, but audit history could not be saved: ${auditError.message}`);
  for (const path of ["/admin", "/owner", "/manager"]) revalidatePath(path);
}

export async function forceEndAndApproveManagerTask(taskId: string) {
  const user = await requireFeatureAccess("work_log_approvals", "edit");
  if (!isPlatformAdmin(user.role) && user.role !== "owner") throw new Error("Only a Platform Admin or Property Owner can force-end and approve a Manager task.");
  if (typeof taskId !== "string" || !taskId) throw new Error("A work log is required.");
  const supabase = createPrivilegedServerSupabaseClient();
  const { data: task, error: taskError } = await supabase.from("work_logs")
    .select("id, user_id, hotel_id, status, is_locked, deleted_at, cancelled_at")
    .eq("id", taskId)
    .maybeSingle();
  if (taskError) throw new Error(`Unable to verify the task: ${taskError.message}`);
  if (!task || !["assigned", "active"].includes(task.status) || task.is_locked || task.deleted_at || task.cancelled_at) {
    throw new Error("Only an active or pending Manager task can be force-ended.");
  }
  const { data: assignee, error: assigneeError } = await supabase.from("users")
    .select("role")
    .eq("id", task.user_id)
    .maybeSingle();
  if (assigneeError) throw new Error(`Unable to verify the assignee: ${assigneeError.message}`);
  if (!assignee || assignee.role !== "manager") throw new Error("This action is only available for tasks assigned to a Manager.");
  await assertManagementControlsHotel(user, task.hotel_id);

  const { error } = await supabase.rpc("force_end_approve_manager_task", {
    p_task_id: task.id,
    p_actor_id: user.userId,
  });
  if (error) throw new Error(`Unable to force-end and approve the Manager task: ${error.message}`);
  for (const path of ["/admin", "/owner", "/manager", "/dashboard"]) revalidatePath(path);
}

export async function rejectWorkLog(logId: string, role: ApprovalRole, notes = "") {
  await requireFeatureAccess("work_log_approvals", "edit");
  const { supabase, log } = await getLogForAction(logId);
  const user = await assertRoleControlsLog(role, log);
  if (log.is_locked) throw new Error("Locked logs cannot be rejected.");
  const now = new Date().toISOString();
  const payload = role === "manager" ? { manager_approved: false, manager_rejected: true, manager_rejected_at: now, is_locked: false, rejection_notes: notes.trim() } : { owner_approved: false, owner_rejected: true, owner_rejected_at: now, is_locked: false, rejection_notes: notes.trim() };
  const { data: updated, error } = await supabase.from("work_logs").update({ ...payload, updated_at: now }).eq("id", logId).select("*").single();
  if (error || !updated) throw new Error(error?.message ?? "Unable to reject work log.");
  const { error: auditError } = await supabase.from("work_log_audit").insert({
    work_log_id: logId,
    actor_id: user.userId,
    action: "rejected",
    previous_values: log,
    new_values: updated,
  });
  if (auditError) throw new Error(`Work log was rejected, but audit history could not be saved: ${auditError.message}`);
  revalidatePath("/admin"); revalidatePath("/owner"); revalidatePath("/manager");
}
