"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";
import { getManagementOperationalBrief } from "@/lib/operationalBrief";
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
  const { data: hotels, error: hotelsError } = await supabase.from("hotels").select("id, name, location, owner_id, manager_id").order("name");
  if (hotelsError) throw new Error(hotelsError.message);
  const assignedHotelId = user.hotelId ?? null;
  const visibleHotels = user.role === "admin"
    ? hotels ?? []
    : (hotels ?? []).filter((hotel) => {
      const assignedUserId = user.role === "owner" ? hotel.owner_id : hotel.manager_id;
      return assignedUserId === user.userId || hotel.id === assignedHotelId;
    });
  const hotelIds = visibleHotels.map((hotel) => hotel.id);
  const hotelFilter = user.role === "admin" ? null : hotelIds;
  const cleanersQuery = supabase.from("users").select("id, full_name, email, role, primary_hotel_id").eq("role", "cleaner");
  const logsQuery = supabase.from("work_logs").select("id, user_id, hotel_id, service_id, start_time, end_time, task_date, status, rooms_completed, room_number, room_numbers, service_name_snapshot, service_description_snapshot, notes, owner_id, owner_name, manager_id, manager_name, responsibility_recorded_at, manager_approved, owner_approved, manager_rejected, owner_rejected, is_locked, hotels(name), users(full_name, email), services_config(name, description, default_rate)").order("start_time", { ascending: false });
  const payrollQuery = supabase.from("work_logs").select("id, user_id, hotel_id, start_time, end_time, task_date, rooms_completed, room_number, room_numbers, service_name_snapshot, service_description_snapshot, notes, owner_id, owner_name, manager_id, manager_name, responsibility_recorded_at, hotels(name), users(full_name, email), services_config(name, description, default_rate)").eq("is_locked", true).eq("status", "completed").order("start_time", { ascending: false });
  if (hotelFilter) { logsQuery.in("hotel_id", hotelIds); payrollQuery.in("hotel_id", hotelIds); }
  const [{ data: cleaners }, { data: services }, { data: workLogs }, { data: payroll }] = await Promise.all([
    cleanersQuery,
    supabase.from("services_config").select("id, name, default_rate, is_active").order("name"),
    logsQuery,
    payrollQuery,
  ]);
  const { data: rooms } = await supabase.from("rooms").select("id, hotel_id, room_name, category, status").in("hotel_id", hotelIds.length ? hotelIds : ["00000000-0000-0000-0000-000000000000"]).eq("status", "active").order("room_name");
  const { data: currentUser } = await supabase.from("users").select("full_name, email").eq("id", user.userId).maybeSingle();
  const hotelsById = new Map(visibleHotels.map((hotel) => [hotel.id, hotel.name]));
  const cleanersById = new Map((cleaners ?? []).map((cleaner) => [cleaner.id, cleaner.full_name || cleaner.email]));
  const workLogsWithNames = (workLogs ?? []).map((log) => ({
    ...log,
    cleanerName: cleanersById.get(log.user_id) ?? "Unknown cleaner",
    hotelName: hotelsById.get(log.hotel_id) ?? "Unknown hotel",
  }));
  const payrollWithNames = (payroll ?? []).map((log) => ({
    ...log,
    cleanerName: cleanersById.get(log.user_id) ?? "Unknown cleaner",
    hotelName: hotelsById.get(log.hotel_id) ?? "Unknown hotel",
  }));
  const brief = await briefPromise;
  return { cleaners: cleaners ?? [], hotels: visibleHotels, services: services ?? [], rooms: rooms ?? [], workLogs: workLogsWithNames, payroll: payrollWithNames, userRole: user.role, userName: currentUser?.full_name ?? user.email, userEmail: currentUser?.email ?? user.email, brief };
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
  const payload = role === "manager" ? { manager_approved: true, manager_rejected: false, manager_approved_at: now } : { owner_approved: true, owner_rejected: false, owner_approved_at: now };
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
