"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";
import { isHousekeepingAdmin, normalizeUserRole, type UserRole } from "@/lib/roles";
import type { ActiveAssignedTaskDetails } from "@/components/dashboard/ActiveAssignedTaskCard";

export type HousekeepingStatus = "dirty" | "in_progress" | "inspect_ready" | "clean";

export type HousekeepingDashboardData = {
  userName: string;
  activeTask: ActiveAssignedTaskDetails | null;
  hotels: {
    id: string;
    name: string;
    floors: string[];
    rooms: {
      id: string;
      name: string;
      category: string;
      floor: string;
      availabilityStatus: "vacant" | "occupied" | "maintenance" | "out_of_order";
      housekeepingStatus: HousekeepingStatus;
      inspectionNotes: string;
    }[];
  }[];
  cleaners: { id: string; name: string }[];
  shifts: {
    id: string;
    user_id: string;
    start_time: string;
    cleanerName: string;
    task: {
      id: string;
      user_id: string;
      cleanerName: string;
      hotelName: string;
      service_name_snapshot: string | null;
      room_number: string | null;
      room_numbers: string[] | null;
      start_time: string;
    } | null;
  }[];
  logs: {
    id: string;
    user_id: string;
    activityType: "Cleaning task" | "Master shift";
    cleanerName: string;
    hotelName: string;
    serviceName: string;
    start_time: string;
    end_time: string | null;
    task_date: string;
    room_number: string | null;
    room_numbers: string[] | null;
    notes: string | null;
  }[];
  evidence: {
    id: string;
    roomName: string;
    cleanerName: string;
    createdAt: string;
    mediaType: "image" | "video";
    originalName: string;
    signedUrl: string;
  }[];
};

const HOUSEKEEPING_STATUSES = ["dirty", "in_progress", "inspect_ready", "clean"] as const;
const NEXT_STATUS: Record<HousekeepingStatus, HousekeepingStatus> = {
  dirty: "in_progress",
  in_progress: "inspect_ready",
  inspect_ready: "clean",
  clean: "dirty",
};

async function getHKAdminContext() {
  const session = await getSessionUser();
  if (!session || !isHousekeepingAdmin(session.role)) throw new Error("Housekeeping administrator access is required.");

  const supabase = createPrivilegedServerSupabaseClient();
  const { data: actor, error: actorError } = await supabase
    .from("users")
    .select("id, role, full_name, primary_hotel_id")
    .eq("id", session.userId)
    .maybeSingle();
  if (actorError) throw new Error(`Unable to verify housekeeping administrator: ${actorError.message}`);
  if (!actor || !isHousekeepingAdmin(normalizeUserRole(actor.role as UserRole))) throw new Error("Your role could not be verified. Sign in again.");

  const { data: assignments, error: assignmentsError } = await supabase
    .from("user_hotel_assignments")
    .select("hotel_id")
    .eq("user_id", actor.id);
  if (assignmentsError) throw new Error(`Unable to load property assignments: ${assignmentsError.message}`);

  return {
    actor,
    supabase,
    hotelIds: [...new Set([
      ...(assignments ?? []).map((assignment) => assignment.hotel_id),
      ...(actor.primary_hotel_id ? [actor.primary_hotel_id] : []),
    ])],
  };
}

function normalizeHousekeepingStatus(value: unknown): HousekeepingStatus {
  return HOUSEKEEPING_STATUSES.includes(value as HousekeepingStatus)
    ? value as HousekeepingStatus
    : "clean";
}

export async function getHKAdminDashboardData(): Promise<HousekeepingDashboardData> {
  const { actor, supabase, hotelIds } = await getHKAdminContext();
  if (!hotelIds.length) {
    return { userName: actor.full_name ?? "Housekeeping Admin", activeTask: null, hotels: [], cleaners: [], shifts: [], logs: [], evidence: [] };
  }

  const [
    { data: hotels, error: hotelsError },
    { data: rooms, error: roomsError },
    { data: assignments, error: cleanerAssignmentsError },
    { data: users, error: usersError },
    { data: shifts, error: shiftsError },
    { data: activeTasks, error: tasksError },
    { data: ownActiveTask, error: ownTaskError },
    { data: logs, error: logsError },
  ] = await Promise.all([
    supabase.from("hotels").select("id, name, floors_sections").in("id", hotelIds).eq("is_active", true).order("name"),
    supabase.from("rooms").select("id, hotel_id, room_name, category, floor_section, availability_status, housekeeping_status, inspection_notes").in("hotel_id", hotelIds).eq("status", "active").order("floor_section").order("room_name"),
    supabase.from("user_hotel_assignments").select("user_id, hotel_id").in("hotel_id", hotelIds),
    supabase.from("users").select("id, full_name, role, primary_hotel_id").eq("role", "cleaner").order("full_name"),
    supabase.from("master_shifts").select("id, user_id, start_time").eq("status", "active").is("end_time", null).order("start_time"),
    supabase.from("work_logs").select("id, user_id, hotel_id, service_name_snapshot, room_number, room_numbers, start_time").in("hotel_id", hotelIds).eq("status", "active").is("end_time", null).is("deleted_at", null).is("cancelled_at", null),
    supabase.from("work_logs").select("id, hotel_id, service_name_snapshot, room_number, room_numbers, room_ids, start_time").eq("user_id", actor.id).in("hotel_id", hotelIds).eq("status", "active").is("end_time", null).is("deleted_at", null).is("cancelled_at", null).order("start_time", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("work_logs").select("id, user_id, hotel_id, service_name_snapshot, room_number, room_numbers, start_time, end_time, task_date, notes").in("hotel_id", hotelIds).eq("status", "completed").is("deleted_at", null).is("cancelled_at", null).order("start_time", { ascending: false }).limit(100),
  ]);

  if (hotelsError) throw new Error(`Unable to load assigned properties: ${hotelsError.message}`);
  if (roomsError) throw new Error(`Unable to load room statuses: ${roomsError.message}`);
  if (cleanerAssignmentsError) throw new Error(`Unable to load cleaner assignments: ${cleanerAssignmentsError.message}`);
  if (usersError) throw new Error(`Unable to load assigned cleaners: ${usersError.message}`);
  if (shiftsError) throw new Error(`Unable to load active shifts: ${shiftsError.message}`);
  if (tasksError) throw new Error(`Unable to load active tasks: ${tasksError.message}`);
  if (ownTaskError) throw new Error(`Unable to load your active task: ${ownTaskError.message}`);
  if (logsError) throw new Error(`Unable to load work history: ${logsError.message}`);

  const activeHotels = hotels ?? [];
  const activeHotelIds = new Set(activeHotels.map((hotel) => hotel.id));
  const roomRows = rooms ?? [];
  const assignmentRows = assignments ?? [];
  const cleanerRows = (users ?? []).filter((cleaner) =>
    (cleaner.primary_hotel_id !== null && activeHotelIds.has(cleaner.primary_hotel_id)) ||
    assignmentRows.some((assignment) => assignment.user_id === cleaner.id && activeHotelIds.has(assignment.hotel_id))
  );
  const cleanerIds = new Set(cleanerRows.map((cleaner) => cleaner.id));
  const cleanerNames = new Map(cleanerRows.map((cleaner) => [cleaner.id, cleaner.full_name ?? "Cleaner"]));
  const cleanerPrimaryHotels = new Map(cleanerRows.map((cleaner) => [cleaner.id, cleaner.primary_hotel_id]));
  const hotelNames = new Map(activeHotels.map((hotel) => [hotel.id, hotel.name]));
  const ownTaskHotel = ownActiveTask ? hotelNames.get(ownActiveTask.hotel_id) : null;
  const ownTaskRooms = ownActiveTask && Array.isArray(ownActiveTask.room_ids)
    ? ownActiveTask.room_ids.flatMap((roomId) => {
      const room = roomRows.find((item) => item.id === roomId);
      return room ? [`${room.room_name}${room.floor_section ? ` (${room.floor_section})` : ""}`] : [];
    })
    : [];
  const activeTaskRows = (activeTasks ?? []).filter((task) => cleanerIds.has(task.user_id));
  const taskByCleaner = new Map(activeTaskRows.map((task) => [task.user_id, task]));
  const activeShiftRows = (shifts ?? []).filter((shift) => cleanerIds.has(shift.user_id));

  const recentLogs = (logs ?? []).filter((log) => cleanerIds.has(log.user_id));
  const { data: completedShifts, error: completedShiftsError } = cleanerIds.size
    ? await supabase.from("master_shifts").select("id, user_id, start_time, end_time").in("user_id", [...cleanerIds]).eq("status", "completed").not("end_time", "is", null).order("start_time", { ascending: false }).limit(100)
    : { data: [], error: null };
  if (completedShiftsError) throw new Error(`Unable to load shift history: ${completedShiftsError.message}`);
  const evidenceLogIds = recentLogs.slice(0, 40).map((log) => log.id);
  let evidence: HousekeepingDashboardData["evidence"] = [];
  if (evidenceLogIds.length) {
    const { data: media, error: mediaError } = await supabase
      .from("room_media")
      .select("id, work_log_id, room_id, bucket_id, storage_path, media_type, original_name, created_at")
      .in("work_log_id", evidenceLogIds)
      .order("created_at", { ascending: false })
      .limit(40);
    if (mediaError) throw new Error(`Unable to load inspection evidence: ${mediaError.message}`);
    const roomNameById = new Map(roomRows.map((room) => [room.id, room.room_name]));
    const logById = new Map(recentLogs.map((log) => [log.id, log]));
    evidence = (await Promise.all((media ?? []).map(async (item) => {
      const { data, error } = await supabase.storage.from(item.bucket_id).createSignedUrl(item.storage_path, 3600);
      if (error || !data) throw new Error(`Unable to open inspection photo: ${error?.message ?? "A signed URL was not returned."}`);
      const log = logById.get(item.work_log_id);
      return {
        id: item.id,
        roomName: roomNameById.get(item.room_id) ?? "Room",
        cleanerName: log ? cleanerNames.get(log.user_id) ?? "Cleaner" : "Cleaner",
        createdAt: item.created_at,
        mediaType: item.media_type as "image" | "video",
        originalName: item.original_name,
        signedUrl: data.signedUrl,
      };
    }))).slice(0, 24);
  }

  return {
    userName: actor.full_name ?? "Housekeeping Admin",
    activeTask: ownActiveTask && ownTaskHotel ? {
      id: ownActiveTask.id,
      name: ownActiveTask.service_name_snapshot ?? "Active task",
      hotelName: ownTaskHotel,
      roomLabel: ownTaskRooms.join(", ") || (Array.isArray(ownActiveTask.room_numbers) ? ownActiveTask.room_numbers.join(", ") : ownActiveTask.room_number ?? ""),
      startTime: ownActiveTask.start_time,
    } : null,
    hotels: activeHotels.map((hotel) => ({
      id: hotel.id,
      name: hotel.name,
      floors: Array.isArray(hotel.floors_sections)
        ? hotel.floors_sections.filter((floor: unknown): floor is string => typeof floor === "string")
        : [],
      rooms: roomRows.filter((room) => room.hotel_id === hotel.id).map((room) => ({
        id: room.id,
        name: room.room_name,
        category: room.category ?? "",
        floor: room.floor_section ?? "Unassigned section",
        availabilityStatus: room.availability_status as HousekeepingDashboardData["hotels"][number]["rooms"][number]["availabilityStatus"],
        housekeepingStatus: normalizeHousekeepingStatus(room.housekeeping_status),
        inspectionNotes: room.inspection_notes ?? "",
      })),
    })),
    cleaners: cleanerRows.map((cleaner) => ({ id: cleaner.id, name: cleanerNames.get(cleaner.id) ?? "Cleaner" })),
    shifts: activeShiftRows.map((shift) => {
      const task = taskByCleaner.get(shift.user_id);
      return {
        id: shift.id,
        user_id: shift.user_id,
        start_time: shift.start_time,
        cleanerName: cleanerNames.get(shift.user_id) ?? "Cleaner",
        task: task ? {
          id: task.id,
          user_id: task.user_id,
          cleanerName: cleanerNames.get(task.user_id) ?? "Cleaner",
          hotelName: hotelNames.get(task.hotel_id) ?? "Property",
          service_name_snapshot: task.service_name_snapshot,
          room_number: task.room_number,
          room_numbers: task.room_numbers,
          start_time: task.start_time,
        } : null,
      };
    }),
    logs: [
      ...recentLogs.map((log) => ({
        id: log.id,
        user_id: log.user_id,
        activityType: "Cleaning task" as const,
        cleanerName: cleanerNames.get(log.user_id) ?? "Cleaner",
        hotelName: hotelNames.get(log.hotel_id) ?? "Property",
        serviceName: log.service_name_snapshot ?? "Cleaning task",
        start_time: log.start_time,
        end_time: log.end_time,
        task_date: log.task_date,
        room_number: log.room_number,
        room_numbers: log.room_numbers,
        notes: log.notes,
      })),
      ...(completedShifts ?? []).map((shift) => ({
        id: shift.id,
        user_id: shift.user_id,
        activityType: "Master shift" as const,
        cleanerName: cleanerNames.get(shift.user_id) ?? "Cleaner",
        hotelName: hotelNames.get(cleanerPrimaryHotels.get(shift.user_id) ?? "") ?? "Assigned property",
        serviceName: "Master shift",
        start_time: shift.start_time,
        end_time: shift.end_time,
        task_date: shift.start_time.slice(0, 10),
        room_number: null,
        room_numbers: null,
        notes: null,
      })),
    ].sort((left, right) => Date.parse(right.start_time) - Date.parse(left.start_time)).slice(0, 100),
    evidence,
  };
}

export async function updateHKRoomStatus(roomId: string, status: HousekeepingStatus, inspectionNotes: string) {
  if (!roomId || !HOUSEKEEPING_STATUSES.includes(status)) throw new Error("Choose a valid room status.");
  if (typeof inspectionNotes !== "string" || inspectionNotes.trim().length > 2000) {
    throw new Error("Inspection notes must be 2,000 characters or fewer.");
  }
  const { supabase, hotelIds } = await getHKAdminContext();
  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("id, hotel_id, housekeeping_status")
    .eq("id", roomId)
    .maybeSingle();
  if (roomError) throw new Error(`Unable to verify room access: ${roomError.message}`);
  if (!room || !hotelIds.includes(room.hotel_id)) throw new Error("This room is outside your assigned properties.");
  const currentStatus = normalizeHousekeepingStatus(room.housekeeping_status);
  if (status !== currentStatus && NEXT_STATUS[currentStatus] !== status) {
    throw new Error(`Move the room from ${currentStatus.replace("_", " ")} to ${NEXT_STATUS[currentStatus].replace("_", " ")} before selecting that status.`);
  }
  const { error } = await supabase.from("rooms").update({
    housekeeping_status: status,
    inspection_notes: inspectionNotes.trim(),
    updated_at: new Date().toISOString(),
  }).eq("id", room.id);
  if (error) throw new Error(`Unable to update room inspection: ${error.message}`);
  revalidatePath("/hk-admin");
}

export async function interveneHKActiveTask(taskId: string, action: "force_complete_task" | "cancel_task", reason: string) {
  if (!taskId || !["force_complete_task", "cancel_task"].includes(action)) throw new Error("Choose a valid task intervention.");
  if (typeof reason !== "string" || reason.trim().length < 5 || reason.trim().length > 1000) {
    throw new Error("Enter an audit reason between 5 and 1,000 characters.");
  }
  const { actor, supabase, hotelIds } = await getHKAdminContext();
  const { data: task, error: taskError } = await supabase
    .from("work_logs")
    .select("id, user_id, hotel_id, start_time")
    .eq("id", taskId)
    .eq("status", "active")
    .is("end_time", null)
    .is("deleted_at", null)
    .is("cancelled_at", null)
    .maybeSingle();
  if (taskError) throw new Error(`Unable to verify active task: ${taskError.message}`);
  if (!task || !hotelIds.includes(task.hotel_id)) throw new Error("This task is outside your assigned properties or is no longer active.");
  const { data: cleaner, error: cleanerError } = await supabase.from("users").select("role").eq("id", task.user_id).maybeSingle();
  if (cleanerError) throw new Error(`Unable to verify task assignee: ${cleanerError.message}`);
  if (cleaner?.role !== "cleaner") throw new Error("Housekeeping Admin interventions are limited to cleaner tasks.");

  const { error } = await supabase.rpc("record_management_override", {
    p_entity_type: "task",
    p_entity_id: task.id,
    p_action: action,
    p_actor_id: actor.id,
    p_reason: reason.trim(),
    p_end_time: null,
  });
  if (error) throw new Error(`Unable to record task intervention: ${error.message}`);
  revalidatePath("/hk-admin");
}
