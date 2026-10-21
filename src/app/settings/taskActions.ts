"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/roles";

type TaskResult = { success: true; taskId?: string } | { success: false; error: string };
type DispatchInput = {
  hotelId: string;
  serviceId: string;
  assignedTo: string;
  priority: "low" | "medium" | "high" | "urgent";
  dueAt?: string | null;
  metadata?: {
    roomIds?: string[];
    floorSection?: string;
    linenChecklist?: string[];
    durationHours?: number | null;
    issueDescription?: string;
    assetId?: string;
    photoPath?: string | null;
  };
  notes: string;
};

export async function getTaskDispatchData() {
  const { actor, supabase } = await getVerifiedActor();
  if (!["owner", "manager", "hk_admin"].includes(actor.role)) {
    throw new Error("Task assignment is not available for this account.");
  }
  let assignedHotelIds: string[] = [];
  if (actor.role === "hk_admin") {
    const { data: assignments, error: assignmentError } = await supabase
      .from("user_hotel_assignments")
      .select("hotel_id")
      .eq("user_id", actor.id);
    if (assignmentError) throw new Error(assignmentError.message);
    assignedHotelIds = (assignments ?? []).map((assignment) => assignment.hotel_id);
  }
  const { data: hotels, error: hotelError } = await supabase
    .from("hotels")
    .select("id, name, owner_id, manager_id, is_active")
    .order("name");
  if (hotelError) throw new Error(hotelError.message);
  const activeHotels = (hotels ?? []).filter((hotel) =>
    hotel.is_active && (
      actor.role === "owner" ? hotel.owner_id === actor.id :
        actor.role === "manager" ? hotel.manager_id === actor.id :
          hotel.id === actor.primary_hotel_id || assignedHotelIds.includes(hotel.id)
    )
  );
  const activeHotelIds = activeHotels.map((hotel) => hotel.id);
  if (!activeHotelIds.length) {
    return { hotels: [], users: [], services: [], rooms: [], stats: { pending: 0, active: 0, completedToday: 0 } };
  }
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [{ data: users, error: usersError }, { data: assignments, error: usersAssignmentsError }, { data: services, error: servicesError }, { data: rooms, error: roomsError }, stats] = await Promise.all([
    supabase.from("users").select("id, full_name, role, primary_hotel_id").in("role", ["manager", "hk_admin", "cleaner"]).order("full_name"),
    supabase.from("user_hotel_assignments").select("user_id, hotel_id"),
    supabase.from("services_config").select("id, hotel_id, name, description, unit, is_active, owner_id").eq("is_active", true),
    supabase.from("rooms").select("id, hotel_id, room_name, category, floor_section").in("hotel_id", activeHotelIds).eq("status", "active").order("floor_section").order("room_name"),
    Promise.all([
      supabase.from("work_logs").select("id", { count: "exact", head: true }).in("hotel_id", activeHotelIds).eq("status", "assigned").is("deleted_at", null).is("cancelled_at", null),
      supabase.from("work_logs").select("id", { count: "exact", head: true }).in("hotel_id", activeHotelIds).eq("status", "active").is("end_time", null).is("deleted_at", null).is("cancelled_at", null),
      supabase.from("work_logs").select("id", { count: "exact", head: true }).in("hotel_id", activeHotelIds).eq("status", "completed").eq("task_date", today).is("deleted_at", null).is("cancelled_at", null),
    ]),
  ]);
  if (usersError) throw new Error(usersError.message);
  if (usersAssignmentsError) throw new Error(usersAssignmentsError.message);
  if (servicesError) throw new Error(servicesError.message);
  if (roomsError) throw new Error(roomsError.message);
  const [pendingResult, activeResult, completedResult] = stats;
  if (pendingResult.error || activeResult.error || completedResult.error) {
    throw new Error(pendingResult.error?.message ?? activeResult.error?.message ?? completedResult.error?.message ?? "Unable to load task dispatch statistics.");
  }
  const hotelIds = new Set(activeHotelIds);
  const assignmentRows = assignments ?? [];
  const ownersByHotel = new Map(activeHotels.map((hotel) => [hotel.id, hotel.owner_id]));
  const assignees = (users ?? []).filter((user) => activeHotels.some((hotel) => {
    if (user.role === "manager") return hotel.manager_id === user.id || user.primary_hotel_id === hotel.id;
    if (user.role === "hk_admin") return user.primary_hotel_id === hotel.id || assignmentRows.some((assignment) => assignment.user_id === user.id && assignment.hotel_id === hotel.id);
    return user.primary_hotel_id === hotel.id;
  }));
  return {
    hotels: activeHotels.map(({ id, name, owner_id }) => ({ id, name, ownerId: owner_id })),
    users: assignees.map((user) => ({
      id: user.id,
      full_name: user.full_name,
      role: user.role as UserRole,
      assignedHotels: activeHotels.filter((hotel) =>
        user.primary_hotel_id === hotel.id ||
        (user.role === "hk_admin" && assignmentRows.some((assignment) => assignment.user_id === user.id && assignment.hotel_id === hotel.id)) ||
        (user.role === "manager" && hotel.manager_id === user.id)
      ).map(({ id, name }) => ({ id, name })),
    })),
    services: (services ?? [])
      .filter((service) => service.hotel_id === null || hotelIds.has(service.hotel_id))
      .filter((service) => service.owner_id === null || activeHotels.some((hotel) => service.owner_id === ownersByHotel.get(hotel.id)))
      .map(({ id, hotel_id, name, description, unit, is_active, owner_id }) => ({ id, hotel_id, name, description, unit, is_active, owner_id })),
    rooms: rooms ?? [],
    stats: { pending: pendingResult.count ?? 0, active: activeResult.count ?? 0, completedToday: completedResult.count ?? 0 },
  };
}

const ROLE_LEVEL: Record<UserRole, number> = {
  admin: 5,
  owner: 4,
  manager: 3,
  hk_admin: 2,
  cleaner: 1,
};

function failure(error: unknown, fallback: string): TaskResult {
  const message = error instanceof Error ? error.message : fallback;
  console.error(fallback, error);
  return { success: false, error: message };
}

async function getVerifiedActor() {
  const session = await getSessionUser();
  if (!session) throw new Error("Your session has expired. Sign in again.");
  const supabase = createPrivilegedServerSupabaseClient();
  const { data: actor, error } = await supabase
    .from("users")
    .select("id, role, primary_hotel_id")
    .eq("id", session.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!actor || actor.role !== session.role) throw new Error("Your role could not be verified. Sign in again.");
  return { actor: { ...actor, role: actor.role as UserRole }, supabase };
}

export async function dispatchTask(input: DispatchInput): Promise<TaskResult> {
  try {
    const { actor, supabase } = await getVerifiedActor();
    if (!["admin", "owner", "manager", "hk_admin"].includes(actor.role)) {
      throw new Error("Your role cannot assign tasks.");
    }
    const { data: hotel, error: hotelError } = await supabase
      .from("hotels")
      .select("id, owner_id, manager_id, is_active")
      .eq("id", input.hotelId)
      .maybeSingle();
    if (hotelError) throw new Error(hotelError.message);
    if (!hotel || !hotel.is_active) throw new Error("Select an active property.");
    if (actor.role === "owner" && hotel.owner_id !== actor.id) throw new Error("That property is outside your account.");
    if (actor.role === "manager" && hotel.manager_id !== actor.id) throw new Error("That property is outside your management scope.");
    if (actor.role === "hk_admin") {
      const { data: assignment, error: assignmentError } = await supabase
        .from("user_hotel_assignments")
        .select("hotel_id")
        .eq("user_id", actor.id)
        .eq("hotel_id", hotel.id)
        .maybeSingle();
      if (assignmentError) throw new Error(assignmentError.message);
      if (actor.primary_hotel_id !== hotel.id && !assignment) throw new Error("That property is outside your hotel assignment.");
    }
    if (!["low", "medium", "high", "urgent"].includes(input.priority)) throw new Error("Choose a valid task priority.");
    const notes = typeof input.notes === "string" ? input.notes.trim() : "";
    if (notes.length > 2000) throw new Error("Task notes must be 2,000 characters or fewer.");
    if (input.dueAt && (Number.isNaN(Date.parse(input.dueAt)) || new Date(input.dueAt).getTime() <= Date.now())) {
      throw new Error("Choose a due time in the future.");
    }
    const metadata = input.metadata ?? {};
    const requestedRoomIds = metadata.roomIds ?? [];
    if (!Array.isArray(requestedRoomIds)) throw new Error("Select valid rooms.");
    const roomIds = [...new Set(requestedRoomIds)];
    if (roomIds.some((id) => typeof id !== "string" || id.length > 64)) throw new Error("Select valid rooms.");
    for (const [label, value, maximum] of [
      ["Floor or section", metadata.floorSection, 120],
      ["Issue description", metadata.issueDescription, 2000],
      ["Fixture or asset ID", metadata.assetId, 120],
    ] as const) {
      if (typeof value === "string" && value.length > maximum) throw new Error(`${label} must be ${maximum} characters or fewer.`);
    }
    if (metadata.durationHours !== undefined && metadata.durationHours !== null
      && (!Number.isFinite(metadata.durationHours) || metadata.durationHours <= 0 || metadata.durationHours > 168)) {
      throw new Error("Estimated duration must be between 0 and 168 hours.");
    }
    if (metadata.photoPath && !new RegExp(`^${actor.id}/task-dispatch/[0-9a-f-]{36}\\.(jpg|png|webp)$`, "i").test(metadata.photoPath)) {
      throw new Error("The task photo could not be verified.");
    }

    const { data: assignee, error: assigneeError } = await supabase
      .from("users")
      .select("id, role, primary_hotel_id")
      .eq("id", input.assignedTo)
      .maybeSingle();
    if (assigneeError) throw new Error(assigneeError.message);
    if (!assignee) throw new Error("The selected assignee was not found.");
    const targetRole = assignee.role as UserRole;
    const permitted = actor.role === "admin" || actor.role === "owner"
      ? ["manager", "hk_admin", "cleaner"].includes(targetRole)
      : actor.role === "manager"
        ? ["hk_admin", "cleaner"].includes(targetRole)
        : targetRole === "cleaner";
    let hotelAssignmentMatches = assignee.primary_hotel_id === hotel.id || hotel.manager_id === assignee.id;
    if (targetRole === "hk_admin") {
      const { data: assignment, error: assignmentError } = await supabase
        .from("user_hotel_assignments")
        .select("hotel_id")
        .eq("user_id", assignee.id)
        .eq("hotel_id", hotel.id)
        .maybeSingle();
      if (assignmentError) throw new Error(assignmentError.message);
      hotelAssignmentMatches ||= Boolean(assignment);
    }
    if (!permitted || !hotelAssignmentMatches || ROLE_LEVEL[targetRole] >= ROLE_LEVEL[actor.role]) {
      throw new Error("The selected user cannot receive tasks for this property.");
    }

    const { data: service, error: serviceError } = await supabase
      .from("services_config")
      .select("id, hotel_id, name, description, owner_id, is_active")
      .eq("id", input.serviceId)
      .maybeSingle();
    if (serviceError) throw new Error(serviceError.message);
    if (!service || !service.is_active
      || (service.hotel_id !== null && service.hotel_id !== hotel.id)
      || (service.owner_id !== null && service.owner_id !== hotel.owner_id)) {
      throw new Error("Select an active service configured for this property.");
    }
    if (roomIds.length) {
      const { data: rooms, error: roomsError } = await supabase
        .from("rooms")
        .select("id, room_name")
        .eq("hotel_id", hotel.id)
        .eq("status", "active")
        .in("id", roomIds);
      if (roomsError) throw new Error(roomsError.message);
      if ((rooms ?? []).length !== roomIds.length) throw new Error("Every selected room must belong to this property.");
    }
    const assignedAt = new Date();
    const { data: task, error: insertError } = await supabase
      .from("work_logs")
      .insert({
        user_id: assignee.id,
        assigned_to: assignee.id,
        assigned_by: actor.id,
        assigned_at: assignedAt.toISOString(),
        hotel_id: hotel.id,
        service_id: service.id,
        start_time: assignedAt.toISOString(),
        end_time: null,
        status: "assigned",
        priority: input.priority,
        due_at: input.dueAt || null,
        dispatch_metadata: {
          roomIds,
          floorSection: metadata.floorSection?.trim() ?? "",
          linenChecklist: Array.isArray(metadata.linenChecklist)
            ? metadata.linenChecklist.filter((item) => ["sheets", "towels", "robes"].includes(item))
            : [],
          durationHours: metadata.durationHours ?? null,
          issueDescription: metadata.issueDescription?.trim() ?? "",
          assetId: metadata.assetId?.trim() ?? "",
          photoPath: metadata.photoPath ?? null,
        },
        room_ids: roomIds,
        room_number: "",
        room_numbers: [],
        rooms_completed: 0,
        task_date: assignedAt.toISOString().slice(0, 10),
        service_name_snapshot: service.name,
        service_description_snapshot: service.description || service.name,
        notes,
      })
      .select("id")
      .single();
    if (insertError) throw new Error(insertError.message);
    revalidatePath("/settings");
    revalidatePath("/dashboard");
    revalidatePath("/owner");
    revalidatePath("/manager");
    revalidatePath("/hk-admin");
    return { success: true, taskId: task.id };
  } catch (error) {
    return failure(error, "Task assignment failed:");
  }
}

export async function endOwnManagementTask(taskId: string) {
  const { actor, supabase } = await getVerifiedActor();
  if (!["manager", "hk_admin"].includes(actor.role)) throw new Error("Only managers and housekeeping administrators can end their own assigned tasks here.");
  if (typeof taskId !== "string" || !taskId) throw new Error("An active task is required.");

  const { data: task, error: taskError } = await supabase.from("work_logs")
    .select("id, hotel_id, user_id, status, end_time, is_locked")
    .eq("id", taskId)
    .eq("user_id", actor.id)
    .eq("status", "active")
    .is("end_time", null)
    .is("deleted_at", null)
    .is("cancelled_at", null)
    .maybeSingle();
  if (taskError) throw new Error(`Unable to verify your active task: ${taskError.message}`);
  if (!task) throw new Error("This active task is no longer assigned to you.");
  if (task.is_locked) throw new Error("Locked tasks cannot be ended.");

  const { data: hotel, error: hotelError } = await supabase.from("hotels")
    .select("id, manager_id")
    .eq("id", task.hotel_id)
    .maybeSingle();
  if (hotelError) throw new Error(`Unable to verify task property: ${hotelError.message}`);
  if (!hotel) throw new Error("The task property could not be found.");
  if (actor.role === "manager" && hotel.manager_id !== actor.id) {
    throw new Error("This task is outside your management scope.");
  }
  if (actor.role === "hk_admin") {
    const { data: assignment, error: assignmentError } = await supabase.from("user_hotel_assignments")
      .select("hotel_id")
      .eq("user_id", actor.id)
      .eq("hotel_id", hotel.id)
      .maybeSingle();
    if (assignmentError) throw new Error(`Unable to verify your property assignment: ${assignmentError.message}`);
    if (actor.primary_hotel_id !== hotel.id && !assignment) throw new Error("This task is outside your assigned properties.");
  }

  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await supabase.from("work_logs")
    .update({ status: "completed", end_time: now, updated_at: now })
    .eq("id", task.id)
    .eq("user_id", actor.id)
    .eq("status", "active")
    .is("end_time", null)
    .select("id")
    .maybeSingle();
  if (updateError) throw new Error(`Unable to end your active task: ${updateError.message}`);
  if (!updated) throw new Error("This active task was already ended.");
  for (const path of ["/manager", "/hk-admin", "/admin"]) revalidatePath(path);
}

export async function startAssignedTask(taskId: string): Promise<TaskResult> {
  try {
    const { actor, supabase } = await getVerifiedActor();
    const { data: task, error: taskError } = await supabase
      .from("work_logs")
      .select("id, user_id, assigned_to, status")
      .eq("id", taskId)
      .eq("assigned_to", actor.id)
      .maybeSingle();
    if (taskError) throw new Error(taskError.message);
    if (!task || task.user_id !== actor.id || task.status !== "assigned") {
      throw new Error("This task is no longer waiting to be started.");
    }

    const { data: activeTask, error: activeError } = await supabase
      .from("work_logs")
      .select("id")
      .eq("user_id", actor.id)
      .eq("status", "active")
      .is("end_time", null)
      .limit(1)
      .maybeSingle();
    if (activeError) throw new Error(activeError.message);
    if (activeTask) {
      throw new Error("You already have an active running task. Please complete or pause your current task before starting a new one.");
    }

    let shiftId: string | null = null;
    if (actor.role === "cleaner") {
      const { data: shift, error: shiftError } = await supabase
        .from("master_shifts")
        .select("id")
        .eq("user_id", actor.id)
        .eq("status", "active")
        .maybeSingle();
      if (shiftError) throw new Error(shiftError.message);
      if (!shift) throw new Error("Clock in before starting an assigned task.");
      shiftId = shift.id;
    }

    const { data: started, error: updateError } = await supabase
      .from("work_logs")
      .update({
        status: "active",
        start_time: new Date().toISOString(),
        shift_id: shiftId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", task.id)
      .eq("assigned_to", actor.id)
      .eq("status", "assigned")
      .select("id")
      .maybeSingle();
    if (updateError) throw new Error(updateError.message);
    if (!started) throw new Error("This task was already started or is no longer assigned to you.");
    revalidatePath("/dashboard");
    revalidatePath("/settings");
    return { success: true, taskId: started.id };
  } catch (error) {
    return failure(error, "Assigned task start failed:");
  }
}
