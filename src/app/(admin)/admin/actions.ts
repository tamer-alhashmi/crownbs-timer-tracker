"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";
import { getManagementOperationalBrief } from "@/lib/operationalBrief";
import type { ServicePricing } from "@/lib/servicePricing";
import { requireFeatureAccess } from "@/lib/featureAccess";

type ApprovalRole = "manager" | "owner";
type WorkLogUpdate = {
  hotelId?: string;
  serviceId?: string;
  startTime?: string;
  endTime?: string;
  roomsCompleted?: number;
  roomNumber?: string;
  notes?: string;
};

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

async function fetchAllRows<T>(fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>) {
  const rows: T[] = [];
  const pageSize = 500;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

async function requireManagement() {
  const user = await getSessionUser();
  if (!user || !["admin", "owner", "manager"].includes(user.role)) throw new Error("Unauthorized");
  return user;
}

async function getLogForAction(logId: string) {
  const supabase = createPrivilegedServerSupabaseClient();
  const { data: log, error } = await supabase.from("work_logs").select("*").eq("id", logId).maybeSingle();
  if (error || !log) throw new Error("Work log was not found.");
  return { supabase, log };
}

async function assertRoleControlsLog(role: ApprovalRole, log: { hotel_id: string; owner_id: string | null; manager_id: string | null }) {
  const user = await requireManagement();
  if (user.role === "admin") return user;
  if (user.role !== role) throw new Error(`Only the ${role} can perform this approval.`);
  const snapshotId = role === "owner" ? log.owner_id : log.manager_id;
  if (snapshotId !== user.userId) throw new Error(`This work log belongs to the previous ${role} assignment and cannot be changed by the current ${role}.`);
  return user;
}

export async function getManagementOverview(period?: { from: string; to: string }) {
  const user = await requireFeatureAccess("dashboard");
  if (!["admin", "owner", "manager"].includes(user.role)) throw new Error("Management access required.");
  const supabase = createPrivilegedServerSupabaseClient();
  const briefPromise = getManagementOperationalBrief(user, period);
  const hotelsQuery = supabase.from("hotels").select("id, name, location, owner_id, manager_id, created_at, is_active").order("name").order("id");
  const hotels = await fetchAllRows((from, to) => hotelsQuery.range(from, to));
  const assignedHotelId = user.hotelId ?? null;
  const visibleHotels = user.role === "admin"
    ? hotels ?? []
    : (hotels ?? []).filter((hotel) => {
      const assignedUserId = user.role === "owner" ? hotel.owner_id : hotel.manager_id;
      return assignedUserId === user.userId || hotel.id === assignedHotelId;
    });
  const hotelIds = visibleHotels.map((hotel) => hotel.id);
  const hotelFilter = user.role === "admin" ? null : hotelIds;
  const cleanersQuery = supabase.from("users").select("id, full_name, email, role, primary_hotel_id").eq("role", "cleaner").order("full_name").order("id");
  const assigneesQuery = supabase.from("users").select("id, full_name, email, role").in("role", ["owner", "manager"]).order("full_name").order("id");
  const logsQuery = supabase.from("work_logs").select("id, user_id, hotel_id, service_id, start_time, end_time, task_date, status, rooms_completed, room_number, room_numbers, service_name_snapshot, service_description_snapshot, notes, cost_override, deleted_at, owner_id, owner_name, manager_id, manager_name, responsibility_recorded_at, manager_approved, owner_approved, manager_rejected, owner_rejected, is_locked, hotels(name), users(full_name, email), services_config(name, description, default_rate, unit)").is("deleted_at", null).order("start_time", { ascending: false }).order("id");
  const payrollQuery = supabase.from("work_logs").select("id, user_id, hotel_id, service_id, shift_id, start_time, end_time, task_date, status, rooms_completed, room_number, room_numbers, room_ids, service_name_snapshot, service_description_snapshot, notes, cost_override, deleted_at, travel_time_included, manager_approved, owner_approved, manager_approved_at, owner_approved_at, manager_rejected, owner_rejected, manager_rejected_at, owner_rejected_at, rejection_notes, owner_id, owner_name, manager_id, manager_name, responsibility_recorded_at, import_key, is_locked, created_at, updated_at, hotels(name, location), users(full_name, email), services_config(name, description, default_rate, unit)").eq("is_locked", true).eq("status", "completed").is("deleted_at", null).order("start_time", { ascending: false }).order("id");
  if (hotelFilter) { logsQuery.in("hotel_id", hotelIds); payrollQuery.in("hotel_id", hotelIds); }
  const servicesQuery = supabase.from("services_config").select("id, name, description, unit, default_rate, is_active, created_at").order("name").order("id");
  const roomsQuery = supabase.from("rooms").select("id, hotel_id, room_name, category, status").in("hotel_id", hotelIds.length ? hotelIds : ["00000000-0000-0000-0000-000000000000"]).eq("status", "active").order("room_name").order("id");
  const [cleaners, propertyAssignees, services, workLogs, payroll, rooms] = await Promise.all([
    fetchAllRows((from, to) => cleanersQuery.range(from, to)),
    fetchAllRows((from, to) => assigneesQuery.range(from, to)),
    fetchAllRows((from, to) => servicesQuery.range(from, to)),
    fetchAllRows((from, to) => logsQuery.range(from, to)),
    fetchAllRows((from, to) => payrollQuery.range(from, to)),
    fetchAllRows((from, to) => roomsQuery.range(from, to)),
  ]);
  const { data: currentUser } = await supabase.from("users").select("full_name, email").eq("id", user.userId).maybeSingle();
  const hotelsById = new Map(visibleHotels.map((hotel) => [hotel.id, hotel.name]));
  const cleanerIdsInScope = new Set(workLogs.map((log) => log.user_id));
  const cleanersInScope = user.role === "admin"
    ? cleaners
    : cleaners.filter((cleaner) => Boolean(cleaner.primary_hotel_id && hotelIds.includes(cleaner.primary_hotel_id)) || cleanerIdsInScope.has(cleaner.id));
  const cleanersById = new Map(cleaners.map((cleaner) => [cleaner.id, cleaner.full_name || cleaner.email]));
  const workLogsWithNames = workLogs.map((log) => ({
    ...log,
    cleanerName: cleanersById.get(log.user_id) ?? "Unknown cleaner",
    hotelName: hotelsById.get(log.hotel_id) ?? "Unknown hotel",
  }));
  const payrollWithNames = payroll.map((log) => {
    const service = Array.isArray(log.services_config) ? log.services_config[0] : log.services_config;
    const cleaner = Array.isArray(log.users) ? log.users[0] : log.users;
    const hotel = Array.isArray(log.hotels) ? log.hotels[0] : log.hotels;
    return {
      ...log,
      cleanerName: cleanersById.get(log.user_id) ?? "Unknown cleaner",
      hotelName: hotelsById.get(log.hotel_id) ?? "Unknown hotel",
      cleanerEmail: cleaner?.email ?? "",
      hotelLocation: hotel?.location ?? "",
      services_config: [{ name: log.service_name_snapshot ?? service?.name ?? "Service", description: log.service_description_snapshot ?? service?.description ?? "", default_rate: service?.default_rate ?? 0, unit: service?.unit ?? "hourly" }] as [ServicePricing],
    };
  });
  const brief = await briefPromise;
  return {
    cleaners: cleanersInScope.map((cleaner) => ({ id: cleaner.id, name: cleaner.full_name || cleaner.email })),
    hotels: visibleHotels,
    propertyAssignees: user.role === "admin"
      ? propertyAssignees.map((assignee) => ({ id: assignee.id, name: assignee.full_name || assignee.email, role: assignee.role }))
      : [],
    services,
    rooms,
    workLogs: workLogsWithNames,
    payroll: payrollWithNames,
    userRole: user.role,
    userName: currentUser?.full_name ?? user.email,
    userEmail: currentUser?.email ?? user.email,
    brief,
  };
}

export type PayrollTaskUpdate = {
  serviceId: string;
  roomsCompleted: number;
  notes: string;
  cost: number;
};

async function requireAdminPayrollAccess(action: "edit" | "delete") {
  const user = await requireFeatureAccess("work_log_approvals", action);
  if (user.role !== "admin") throw new Error("Only administrators can manage locked payroll tasks.");
  return user;
}

export async function updatePayrollTask(logId: string, changes: PayrollTaskUpdate) {
  const user = await requireAdminPayrollAccess("edit");
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
  const user = await requireAdminPayrollAccess("delete");
  if (!logId) throw new Error("A payroll task is required.");
  const supabase = createPrivilegedServerSupabaseClient();
  const { data: previous, error: readError } = await supabase.from("work_logs").select("*").eq("id", logId).maybeSingle();
  if (readError || !previous) throw new Error(readError?.message ?? "Payroll task was not found.");
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
  if (!["admin", "owner", "manager"].includes(user.role)) throw new Error("Management access required.");
  const { supabase, log } = await getLogForAction(logId);
  if (user.role !== "admin") {
    const snapshotId = user.role === "owner" ? log.owner_id : log.manager_id;
    if (snapshotId !== user.userId) throw new Error("This work log belongs to the previous management assignment and cannot be edited.");
  }
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (changes.hotelId) payload.hotel_id = changes.hotelId;
  if (changes.serviceId) payload.service_id = changes.serviceId;
  if (changes.startTime) payload.start_time = new Date(changes.startTime).toISOString();
  if (changes.endTime) payload.end_time = new Date(changes.endTime).toISOString();
  if (typeof changes.roomsCompleted === "number" && changes.roomsCompleted >= 0) payload.rooms_completed = changes.roomsCompleted;
  if (changes.roomNumber !== undefined) payload.room_number = changes.roomNumber.trim();
  if (changes.notes !== undefined) payload.notes = changes.notes.trim();
  const { data: updated, error } = await supabase.from("work_logs").update(payload).eq("id", logId).select("*").single();
  if (error || !updated) throw new Error(error?.message ?? "Unable to update work log.");
  await supabase.from("work_log_audit").insert({ work_log_id: logId, actor_id: user.userId, action: "edited", previous_values: log, new_values: updated });
  revalidatePath("/dashboard"); revalidatePath("/admin"); revalidatePath("/owner"); revalidatePath("/manager");
}

export async function approveWorkLog(logId: string, role: ApprovalRole) {
  await requireFeatureAccess("work_log_approvals", "edit");
  const { supabase, log } = await getLogForAction(logId);
  const user = await assertRoleControlsLog(role, log);
  if (log.status !== "completed" || !log.end_time) {
    throw new Error("The cleaner must clock out before this log can be approved.");
  }
  if (log.is_locked) throw new Error("This log is already locked.");
  const now = new Date().toISOString();
  const payload = role === "manager" ? { manager_approved: true, manager_rejected: false, manager_approved_at: now, rejection_notes: null } : { owner_approved: true, owner_rejected: false, owner_approved_at: now, rejection_notes: null };
  const lock = role === "manager" ? log.owner_approved : log.manager_approved;
  const { data: updated, error } = await supabase.from("work_logs").update({ ...payload, is_locked: lock, updated_at: now }).eq("id", logId).select("*").single();
  if (error || !updated) throw new Error(error?.message ?? "Unable to approve work log.");
  await supabase.from("work_log_audit").insert({ work_log_id: logId, actor_id: user.userId, action: "approved", previous_values: log, new_values: updated });
  revalidatePath("/admin"); revalidatePath("/owner"); revalidatePath("/manager");
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
  await supabase.from("work_log_audit").insert({ work_log_id: logId, actor_id: user.userId, action: "rejected", previous_values: log, new_values: updated });
  revalidatePath("/admin"); revalidatePath("/owner"); revalidatePath("/manager");
}
