"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser, setSessionCookies } from "@/lib/auth";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";
import { notifyWorkLogStatusChange } from "@/lib/notifications/taskStatusNotifications";
import { getPropertyOwnerIds } from "@/lib/propertyOwnership";
import { createServiceBlueprintSnapshot, resolveTaskChecklist } from "@/lib/serviceBlueprint";

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

async function validateSelection(
  hotelId: string,
  serviceId: string,
  roomIds: string[] = [],
  options: { levelId?: string | null; quantityValue?: number | null; zoneContext?: string; assetId?: string } = {},
) {
  const supabase = createPrivilegedServerSupabaseClient();
  if (!Array.isArray(roomIds) || roomIds.length > 100 || roomIds.some((roomId) => typeof roomId !== "string" || roomId.length > 64)) {
    throw new Error("Select no more than 100 valid units or spaces.");
  }
  if (options.levelId !== undefined && options.levelId !== null && (typeof options.levelId !== "string" || options.levelId.length > 64)) {
    throw new Error("Choose a valid floor or level.");
  }
  const uniqueRoomIds = [...new Set(roomIds)];
  const [{ data: hotel }, { data: service }, roomResult] = await Promise.all([
    supabase.from("hotels").select("id, owner_id").eq("id", hotelId).eq("is_active", true).is("archived_at", null).maybeSingle(),
    supabase.from("services_config").select("id, name, description, unit, owner_id, hotel_id, service_category, billing_model, billing_unit_label, benchmark_quantity, spatial_mode, requires_asset_reference, checklist_blueprint, default_rate").eq("id", serviceId).eq("is_active", true).maybeSingle(),
    uniqueRoomIds.length ? supabase.from("rooms").select("id, room_name, level_id, floor_section").in("id", uniqueRoomIds).eq("hotel_id", hotelId).eq("status", "active") : Promise.resolve({ data: [] }),
  ]);
  if (!hotel || !service || (service.hotel_id !== null && service.hotel_id !== hotelId)
    || (service.hotel_id === null && service.owner_id !== null && !(await getPropertyOwnerIds(supabase, [hotelId])).get(hotelId)?.includes(service.owner_id))) {
    throw new Error("Select an active hotel and service configured for your property.");
  }
  const blueprint = createServiceBlueprintSnapshot(service);
  if (options.zoneContext !== undefined && (typeof options.zoneContext !== "string" || options.zoneContext.length > 120)) {
    throw new Error("Work-area context must be 120 characters or fewer.");
  }
  if (options.assetId !== undefined && (typeof options.assetId !== "string" || options.assetId.length > 120)) {
    throw new Error("Asset identifiers must be 120 characters or fewer.");
  }
  const selectedRooms = roomResult.data ?? [];
  if (selectedRooms.length !== uniqueRoomIds.length) throw new Error("Every selected room must belong to the active hotel.");
  if (blueprint.spatialMode === "units") {
    if (!selectedRooms.length) throw new Error("Select at least one unit or space for this service.");
    if (selectedRooms.some((room) => room.level_id !== (options.levelId || null))) throw new Error("Select units from the chosen floor or level.");
  } else if (selectedRooms.length) {
    throw new Error("This service uses a zone or general work area; individual units are not required.");
  }
  if (options.levelId) {
    const { data: level, error: levelError } = await supabase.from("property_levels")
      .select("id")
      .eq("id", options.levelId)
      .eq("hotel_id", hotelId)
      .maybeSingle();
    if (levelError) throw new Error(levelError.message);
    if (!level) throw new Error("Choose a floor or level belonging to this property.");
  }
  if (blueprint.spatialMode === "open_zone" && !options.zoneContext?.trim()) throw new Error("Describe the zone or section for this task.");
  if (blueprint.requiresAssetReference && !options.assetId?.trim()) throw new Error("An asset identifier is required for this service.");
  if (blueprint.billingModel === "quantity" && blueprint.spatialMode !== "units"
    && (!Number.isFinite(options.quantityValue) || !options.quantityValue || options.quantityValue <= 0 || options.quantityValue > 999_999_999.999)) {
    throw new Error(`Enter a target quantity${blueprint.unitLabel ? ` in ${blueprint.unitLabel}` : ""}.`);
  }
  return { supabase, service, selectedRooms, blueprint };
}

export async function startTask(data: {
  hotelId: string;
  serviceId: string;
  roomIds?: string[];
  levelId?: string | null;
  quantityValue?: number | null;
  zoneContext?: string;
  assetId?: string;
  notes?: string;
}) {
  const user = await requireCleaner();
  if (!data.hotelId || !user.hotelIds.includes(data.hotelId)) throw new Error("Select one of your assigned properties.");
  if (data.notes !== undefined && (typeof data.notes !== "string" || data.notes.length > 2000)) throw new Error("Task notes must be 2,000 characters or fewer.");
  const { supabase: selectionClient, service, selectedRooms, blueprint } = await validateSelection(data.hotelId, data.serviceId, data.roomIds, data);
  const { shift } = await activeShiftFor(user.userId);
  if (!shift) throw new Error("Clock in before starting a task.");
  if (shift.hotel_id !== data.hotelId) throw new Error("Start tasks only at the property where you are currently clocked in.");
  const { data: activeTask, error: activeError } = await selectionClient.from("work_logs").select("id").eq("user_id", user.userId).in("status", ["active", "paused"]).is("end_time", null).limit(1).maybeSingle();
  if (activeError) throw new Error(activeError.message);
  if (activeTask) throw new Error("Complete the current task before starting another task yourself. Dispatched tasks can be accepted from Notifications.");
  const requiresNotes = /maintenance|linen|delivery/i.test(service.name);
  if (requiresNotes && !data.notes?.trim()) throw new Error("Notes are required for this service.");
  const roomNumbers = selectedRooms.map((room) => room.room_name);
  const billableQuantity = blueprint.billingModel === "quantity"
    ? blueprint.spatialMode === "units" ? selectedRooms.length : data.quantityValue ?? null
    : null;
  const { data: task, error } = await selectionClient.from("work_logs").insert({
    user_id: user.userId,
    shift_id: shift.id,
    hotel_id: data.hotelId,
    service_id: data.serviceId,
    start_time: new Date().toISOString(),
    status: "active",
    travel_time_included: true,
    room_ids: selectedRooms.map((room) => room.id),
    room_number: roomNumbers.join(", "),
    room_numbers: roomNumbers,
    rooms_completed: blueprint.spatialMode === "units" ? roomNumbers.length : 0,
    billable_quantity: billableQuantity,
    service_blueprint_snapshot: blueprint,
    execution_checklist: blueprint.checklist.items.map(() => false),
    dispatch_metadata: {
      levelId: data.levelId ?? null,
      floorSection: blueprint.spatialMode === "units" ? selectedRooms[0]?.floor_section ?? "" : data.zoneContext?.trim() ?? "",
      zoneContext: blueprint.spatialMode !== "units" ? data.zoneContext?.trim() ?? "" : "",
      quantityValue: billableQuantity,
      assetId: data.assetId?.trim() ?? "",
    },
    service_name_snapshot: service.name,
    service_description_snapshot: service.description?.trim() || service.name,
    notes: data.notes?.trim() ?? "",
  }).select("id").single();
  if (error || !task) throw new Error(error?.message ?? "Unable to start task.");
  try {
    await notifyWorkLogStatusChange({ workLogId: task.id, actorId: user.userId, previousStatus: "new", newStatus: "active" });
  } catch (notificationError) {
    console.error("Task started, but task status notifications could not be recorded:", notificationError);
  }
  revalidatePath("/dashboard");
  return task.id;
}

export async function endTask(taskId: string, data: { checklist?: boolean[]; notes?: string }) {
  const user = await requireCleaner();
  if (typeof data.notes !== "string" || data.notes.length > 2000) throw new Error("Task notes must be 2,000 characters or fewer.");
  const supabase = createPrivilegedServerSupabaseClient();
  const { data: task, error: taskError } = await supabase.from("work_logs").select("id, hotel_id, status, is_locked, service_blueprint_snapshot").eq("id", taskId).eq("user_id", user.userId).maybeSingle();
  if (taskError) throw new Error(taskError.message);
  if (!task || task.status !== "active") throw new Error("Active task was not found.");
  if (task.is_locked) throw new Error("Locked tasks cannot be edited.");
  const checklist = resolveTaskChecklist(task.service_blueprint_snapshot);
  const completedItems = data.checklist ?? [];
  if (!Array.isArray(completedItems) || completedItems.length > 20 || completedItems.some((completed: unknown) => typeof completed !== "boolean")) {
    throw new Error("Inspection progress is invalid.");
  }
  if (completedItems.length !== checklist.items.length || completedItems.some((completed) => completed !== true)) {
    throw new Error("Complete every required inspection item before ending this task.");
  }
  const { error: checklistError } = await supabase.from("work_logs")
    .update({ execution_checklist: completedItems, updated_at: new Date().toISOString() })
    .eq("id", taskId)
    .eq("user_id", user.userId)
    .eq("status", "active");
  if (checklistError) throw new Error(`Unable to save inspection progress: ${checklistError.message}`);
  if (checklist.requirePhoto) {
    const { count, error: mediaError } = await supabase.from("room_media")
      .select("id", { count: "exact", head: true })
      .eq("work_log_id", taskId)
      .eq("media_type", "image");
    if (mediaError) throw new Error(`Unable to verify required photo evidence: ${mediaError.message}`);
    if (!count) throw new Error("Add required photo evidence before ending this task.");
  }
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

export async function updateTask(taskId: string, data: {
  hotelId: string;
  serviceId: string;
  roomIds?: string[];
  levelId?: string | null;
  quantityValue?: number | null;
  zoneContext?: string;
  assetId?: string;
  notes?: string;
}) {
  const user = await requireCleaner();
  if (!data.hotelId || !user.hotelIds.includes(data.hotelId)) throw new Error("Select one of your assigned properties.");
  if (data.notes !== undefined && (typeof data.notes !== "string" || data.notes.length > 2000)) throw new Error("Task notes must be 2,000 characters or fewer.");
  const { supabase, service, selectedRooms, blueprint } = await validateSelection(data.hotelId, data.serviceId, data.roomIds, data);
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
  const billableQuantity = blueprint.billingModel === "quantity"
    ? blueprint.spatialMode === "units" ? selectedRooms.length : data.quantityValue ?? null
    : null;
  const { error } = await supabase.from("work_logs").update({
    hotel_id: data.hotelId,
    service_id: data.serviceId,
    room_ids: selectedRooms.map((room) => room.id),
    room_number: roomNumbers.join(", "),
    room_numbers: roomNumbers,
    rooms_completed: blueprint.spatialMode === "units" ? roomNumbers.length : 0,
    billable_quantity: billableQuantity,
    service_blueprint_snapshot: blueprint,
    execution_checklist: blueprint.checklist.items.map(() => false),
    dispatch_metadata: {
      levelId: data.levelId ?? null,
      floorSection: blueprint.spatialMode === "units" ? selectedRooms[0]?.floor_section ?? "" : data.zoneContext?.trim() ?? "",
      zoneContext: blueprint.spatialMode !== "units" ? data.zoneContext?.trim() ?? "" : "",
      quantityValue: billableQuantity,
      assetId: data.assetId?.trim() ?? "",
    },
    service_name_snapshot: service.name,
    service_description_snapshot: service.description?.trim() || service.name,
    notes: data.notes?.trim() ?? "",
    updated_at: new Date().toISOString(),
  }).eq("id", taskId).eq("user_id", user.userId);
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
