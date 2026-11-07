"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser, setSessionCookies } from "@/lib/auth";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";
import { notifyWorkLogStatusChange } from "@/lib/notifications/taskStatusNotifications";
import { getPropertyOwnerIds } from "@/lib/propertyOwnership";

async function requireCleaner() {
  const user = await getSessionUser();
  if (!user || user.role !== "cleaner") throw new Error("Unauthorized: cleaner access required.");
  const supabase = createPrivilegedServerSupabaseClient();
  const { data: profile, error } = await supabase
    .from("users")
    .select("role, primary_hotel_id, is_active")
    .eq("id", user.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!profile || profile.is_active !== true || profile.role !== "cleaner" || profile.role !== user.role) throw new Error("Your account could not be verified as an active cleaner.");
  const { data: assignments, error: assignmentsError } = await supabase
    .from("user_hotel_assignments")
    .select("hotel_id")
    .eq("user_id", user.userId);
  if (assignmentsError) throw new Error(assignmentsError.message);
  const hotelIds = new Set((assignments ?? []).map((assignment) => assignment.hotel_id));
  if (profile.primary_hotel_id) hotelIds.add(profile.primary_hotel_id);
  const activeHotelId = user.hotelId && hotelIds.has(user.hotelId)
    ? user.hotelId
    : profile.primary_hotel_id;
  return { ...user, hotelId: activeHotelId, hotelIds: [...hotelIds] };
}

async function activeShiftFor(userId: string) {
  const supabase = createPrivilegedServerSupabaseClient();
  const { data: shift, error } = await supabase.from("master_shifts").select("id, user_id, hotel_id, start_time, end_time, status").eq("user_id", userId).eq("status", "active").is("end_time", null).maybeSingle();
  if (error) throw new Error(error.message);
  return { supabase, shift };
}

async function validateSelection(hotelId: string, serviceId: string, roomIds: string[] = []) {
  const supabase = createPrivilegedServerSupabaseClient();
  const uniqueRoomIds = [...new Set(roomIds)];
  const [{ data: hotel }, { data: service }, roomResult] = await Promise.all([
    supabase.from("hotels").select("id, owner_id").eq("id", hotelId).eq("is_active", true).is("archived_at", null).maybeSingle(),
    supabase.from("services_config").select("id, name, description, unit, owner_id, hotel_id").eq("id", serviceId).eq("is_active", true).maybeSingle(),
    uniqueRoomIds.length ? supabase.from("rooms").select("id, room_name").in("id", uniqueRoomIds).eq("hotel_id", hotelId).eq("status", "active") : Promise.resolve({ data: [] }),
  ]);
  if (!hotel || !service || (service.hotel_id !== null && service.hotel_id !== hotelId)
    || (service.hotel_id === null && service.owner_id !== null && !(await getPropertyOwnerIds(supabase, [hotelId])).get(hotelId)?.includes(service.owner_id))) {
    throw new Error("Select an active hotel and service configured for your property.");
  }
  const selectedRooms = roomResult.data ?? [];
  if (selectedRooms.length !== uniqueRoomIds.length) throw new Error("Every selected room must belong to the active hotel.");
  if ((service.unit === "per_room" || /maintenance|cleaning\s*\(hourly\)/i.test(service.name)) && selectedRooms.length === 0) throw new Error("Select at least one room for this service.");
  return { supabase, service, selectedRooms };
}

export async function startTask(data: { hotelId: string; serviceId: string; roomIds?: string[]; notes?: string }) {
  const user = await requireCleaner();
  if (!data.hotelId || !user.hotelIds.includes(data.hotelId)) throw new Error("Select one of your assigned properties.");
  const { supabase: selectionClient, service, selectedRooms } = await validateSelection(data.hotelId, data.serviceId, data.roomIds);
  const { shift } = await activeShiftFor(user.userId);
  if (!shift) throw new Error("Clock in before starting a task.");
  if (shift.hotel_id !== data.hotelId) throw new Error("Start tasks only at the property where you are currently clocked in.");
  const { data: activeTask, error: activeError } = await selectionClient.from("work_logs").select("id").eq("user_id", user.userId).in("status", ["active", "paused"]).is("end_time", null).limit(1).maybeSingle();
  if (activeError) throw new Error(activeError.message);
  if (activeTask) throw new Error("Complete the current task before starting another task yourself. Dispatched tasks can be accepted from Notifications.");
  const requiresNotes = /maintenance|linen|delivery/i.test(service.name);
  if (requiresNotes && !data.notes?.trim()) throw new Error("Notes are required for this service.");
  const roomNumbers = selectedRooms.map((room) => room.room_name);
  const { data: task, error } = await selectionClient.from("work_logs").insert({ user_id: user.userId, shift_id: shift.id, hotel_id: data.hotelId, service_id: data.serviceId, start_time: new Date().toISOString(), status: "active", travel_time_included: true, room_ids: selectedRooms.map((room) => room.id), room_number: roomNumbers.join(", "), room_numbers: roomNumbers, rooms_completed: roomNumbers.length, service_name_snapshot: service.name, service_description_snapshot: service.description?.trim() || service.name, notes: data.notes?.trim() ?? "" }).select("id").single();
  if (error || !task) throw new Error(error?.message ?? "Unable to start task.");
  try {
    await notifyWorkLogStatusChange({ workLogId: task.id, actorId: user.userId, previousStatus: "new", newStatus: "active" });
  } catch (notificationError) {
    console.error("Task started, but task status notifications could not be recorded:", notificationError);
  }
  revalidatePath("/dashboard");
  return task.id;
}

export async function endTask(taskId: string, data: { roomIds?: string[]; notes?: string }) {
  const user = await requireCleaner();
  if (typeof data.notes !== "string" || data.notes.length > 2000) throw new Error("Task notes must be 2,000 characters or fewer.");
  const supabase = createPrivilegedServerSupabaseClient();
  const { data: task, error: taskError } = await supabase.from("work_logs").select("id, hotel_id, status, is_locked").eq("id", taskId).eq("user_id", user.userId).maybeSingle();
  if (taskError) throw new Error(taskError.message);
  if (!task || task.status !== "active") throw new Error("Active task was not found.");
  if (task.is_locked) throw new Error("Locked tasks cannot be edited.");
  const { data: result, error } = await supabase.rpc("complete_active_work_log", {
    p_task_id: taskId,
    p_user_id: user.userId,
    p_notes: data.notes.trim(),
  });
  if (error) throw new Error(error.message);
  if (!result || typeof result !== "object" || !("completed_task_id" in result) || result.completed_task_id !== taskId) {
    throw new Error("The task was not completed. Refresh and try again.");
  }
  const resumedTaskId = "resumed_task_id" in result && typeof result.resumed_task_id === "string" ? result.resumed_task_id : null;
  try {
    await notifyWorkLogStatusChange({ workLogId: task.id, actorId: user.userId, previousStatus: task.status, newStatus: "completed" });
    if (resumedTaskId) {
      await notifyWorkLogStatusChange({ workLogId: resumedTaskId, actorId: user.userId, previousStatus: "paused", newStatus: "active" });
    }
  } catch (notificationError) {
    console.error("Task completion or resume succeeded, but status notifications could not be recorded:", notificationError);
  }
  revalidatePath("/dashboard");
}

export async function updateTask(taskId: string, data: { hotelId: string; serviceId: string; roomIds?: string[]; notes?: string }) {
  const user = await requireCleaner();
  if (!data.hotelId || !user.hotelIds.includes(data.hotelId)) throw new Error("Select one of your assigned properties.");
  const { supabase, service, selectedRooms } = await validateSelection(data.hotelId, data.serviceId, data.roomIds);
  const { data: task, error: taskError } = await supabase.from("work_logs").select("id, hotel_id, shift_id, is_locked, status").eq("id", taskId).eq("user_id", user.userId).maybeSingle();
  if (taskError) throw new Error(taskError.message);
  if (!task || task.is_locked || !["active", "completed"].includes(task.status)) throw new Error("This task cannot be modified.");
  if (task.status === "active") {
    const { shift } = await activeShiftFor(user.userId);
    if (!shift || shift.id !== task.shift_id || shift.hotel_id !== task.hotel_id || shift.hotel_id !== data.hotelId) {
      throw new Error("A task can only be edited at the property of your active shift.");
    }
  } else if (task.hotel_id !== data.hotelId) {
    throw new Error("A completed task cannot be moved to another property.");
  }
  if (/maintenance|linen|delivery/i.test(service.name) && !data.notes?.trim()) throw new Error("Notes are required for this service.");
  const roomNumbers = selectedRooms.map((room) => room.room_name);
  const { error } = await supabase.from("work_logs").update({ hotel_id: data.hotelId, service_id: data.serviceId, room_ids: selectedRooms.map((room) => room.id), room_number: roomNumbers.join(", "), room_numbers: roomNumbers, rooms_completed: roomNumbers.length, service_name_snapshot: service.name, service_description_snapshot: service.description?.trim() || service.name, notes: data.notes?.trim() ?? "", updated_at: new Date().toISOString() }).eq("id", taskId).eq("user_id", user.userId);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard");
}

export async function switchHotel(newHotelId: string) {
  const user = await requireCleaner();
  const supabase = createPrivilegedServerSupabaseClient();
  if (!user.hotelIds.includes(newHotelId)) throw new Error("You can only switch to a property assigned to you.");
  const { data: hotel, error } = await supabase.from("hotels").select("id").eq("id", newHotelId).eq("is_active", true).is("archived_at", null).maybeSingle();
  if (error) throw new Error(error.message);
  if (!hotel) throw new Error("Select an active hotel.");
  const { data: shift, error: shiftError } = await supabase.from("master_shifts")
    .select("id, hotel_id")
    .eq("user_id", user.userId)
    .eq("status", "active")
    .is("end_time", null)
    .maybeSingle();
  if (shiftError) throw new Error(shiftError.message);
  if (shift && shift.hotel_id !== newHotelId) {
    throw new Error("Clock out from your active shift before switching properties.");
  }
  await setSessionCookies({ ...user, hotelId: newHotelId });
  revalidatePath("/dashboard");
}
