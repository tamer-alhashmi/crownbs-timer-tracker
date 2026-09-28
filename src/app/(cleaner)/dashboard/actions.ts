"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser, setSessionCookies } from "@/lib/auth";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";

async function requireCleaner() {
  const user = await getSessionUser();
  if (!user || user.role !== "cleaner") throw new Error("Unauthorized: cleaner access required.");
  return user;
}

async function activeShiftFor(userId: string) {
  const supabase = createPrivilegedServerSupabaseClient();
  const { data: shift } = await supabase.from("master_shifts").select("id, user_id, start_time, end_time, status").eq("user_id", userId).eq("status", "active").maybeSingle();
  return { supabase, shift };
}

async function validateSelection(hotelId: string, serviceId: string, roomIds: string[] = []) {
  const supabase = createPrivilegedServerSupabaseClient();
  const uniqueRoomIds = [...new Set(roomIds)];
  const [{ data: hotel }, { data: service }, roomResult] = await Promise.all([
    supabase.from("hotels").select("id").eq("id", hotelId).eq("is_active", true).maybeSingle(),
    supabase.from("services_config").select("id, name, description, unit").eq("id", serviceId).eq("is_active", true).maybeSingle(),
    uniqueRoomIds.length ? supabase.from("rooms").select("id, room_name").in("id", uniqueRoomIds).eq("hotel_id", hotelId).eq("status", "active") : Promise.resolve({ data: [] }),
  ]);
  if (!hotel || !service) throw new Error("Select an active hotel and service.");
  const selectedRooms = roomResult.data ?? [];
  if (selectedRooms.length !== uniqueRoomIds.length) throw new Error("Every selected room must belong to the active hotel.");
  if ((service.unit === "per_room" || /maintenance|cleaning\s*\(hourly\)/i.test(service.name)) && selectedRooms.length === 0) throw new Error("Select at least one room for this service.");
  return { supabase, service, selectedRooms };
}

export async function clockIn() {
  const user = await requireCleaner();
  const { supabase, shift } = await activeShiftFor(user.userId);
  if (shift) throw new Error("A master shift is already active.");
  const { data, error } = await supabase.from("master_shifts").insert({ user_id: user.userId, start_time: new Date().toISOString(), status: "active" }).select("id").single();
  if (error || !data) throw new Error(error?.message ?? "Unable to start master shift.");
  revalidatePath("/dashboard");
  return data.id;
}

export async function startTask(data: { hotelId: string; serviceId: string; roomIds?: string[]; notes?: string }) {
  const user = await requireCleaner();
  const { supabase: selectionClient, service, selectedRooms } = await validateSelection(data.hotelId, data.serviceId, data.roomIds);
  const { shift } = await activeShiftFor(user.userId);
  if (!shift) throw new Error("Clock in before starting a task.");
  const { data: activeTask } = await selectionClient.from("work_logs").select("id").eq("shift_id", shift.id).eq("status", "active").maybeSingle();
  if (activeTask) throw new Error("End the current task before starting another.");
  const requiresNotes = /maintenance|linen|delivery/i.test(service.name);
  if (requiresNotes && !data.notes?.trim()) throw new Error("Notes are required for this service.");
  const roomNumbers = selectedRooms.map((room) => room.room_name);
  const { data: task, error } = await selectionClient.from("work_logs").insert({ user_id: user.userId, shift_id: shift.id, hotel_id: data.hotelId, service_id: data.serviceId, start_time: new Date().toISOString(), status: "active", travel_time_included: true, room_ids: selectedRooms.map((room) => room.id), room_number: roomNumbers.join(", "), room_numbers: roomNumbers, rooms_completed: roomNumbers.length, service_name_snapshot: service.name, service_description_snapshot: service.description?.trim() || service.name, notes: data.notes?.trim() ?? "" }).select("id").single();
  if (error || !task) throw new Error(error?.message ?? "Unable to start task.");
  revalidatePath("/dashboard");
  return task.id;
}

export async function endTask(taskId: string, data: { roomIds?: string[]; notes?: string }) {
  const user = await requireCleaner();
  const supabase = createPrivilegedServerSupabaseClient();
  const { data: task } = await supabase.from("work_logs").select("id, status, is_locked").eq("id", taskId).eq("user_id", user.userId).maybeSingle();
  if (!task || task.status !== "active") throw new Error("Active task was not found.");
  if (task.is_locked) throw new Error("Locked tasks cannot be edited.");
  const { error } = await supabase.from("work_logs").update({ end_time: new Date().toISOString(), status: "completed", notes: data.notes?.trim() ?? "", updated_at: new Date().toISOString() }).eq("id", taskId).eq("user_id", user.userId);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard");
}

export async function clockOut() {
  const user = await requireCleaner();
  const { supabase, shift } = await activeShiftFor(user.userId);
  if (!shift) throw new Error("No active master shift.");
  const { data: activeTask } = await supabase.from("work_logs").select("id").eq("shift_id", shift.id).eq("status", "active").maybeSingle();
  if (activeTask) throw new Error("End the active task before clocking out.");
  const { error } = await supabase.from("master_shifts").update({ end_time: new Date().toISOString(), status: "completed", updated_at: new Date().toISOString() }).eq("id", shift.id).eq("user_id", user.userId);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard");
}

export async function updateTask(taskId: string, data: { hotelId: string; serviceId: string; roomIds?: string[]; notes?: string }) {
  const user = await requireCleaner();
  const { supabase, service, selectedRooms } = await validateSelection(data.hotelId, data.serviceId, data.roomIds);
  const { data: task } = await supabase.from("work_logs").select("id, is_locked, status").eq("id", taskId).eq("user_id", user.userId).maybeSingle();
  if (!task || task.is_locked) throw new Error("This task cannot be modified.");
  if (/maintenance|linen|delivery/i.test(service.name) && !data.notes?.trim()) throw new Error("Notes are required for this service.");
  const roomNumbers = selectedRooms.map((room) => room.room_name);
  const { error } = await supabase.from("work_logs").update({ hotel_id: data.hotelId, service_id: data.serviceId, room_ids: selectedRooms.map((room) => room.id), room_number: roomNumbers.join(", "), room_numbers: roomNumbers, rooms_completed: roomNumbers.length, service_name_snapshot: service.name, service_description_snapshot: service.description?.trim() || service.name, notes: data.notes?.trim() ?? "", updated_at: new Date().toISOString() }).eq("id", taskId).eq("user_id", user.userId);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard");
}

export async function switchHotel(newHotelId: string) {
  const user = await requireCleaner();
  const supabase = createPrivilegedServerSupabaseClient();
  const { data: hotel } = await supabase.from("hotels").select("id").eq("id", newHotelId).eq("is_active", true).maybeSingle();
  if (!hotel) throw new Error("Select an active hotel.");
  await setSessionCookies({ ...user, hotelId: newHotelId });
  revalidatePath("/dashboard");
}
