import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const supabase = createPrivilegedServerSupabaseClient();
  const { data: actor, error: actorError } = await supabase
    .from("users")
    .select("id, role")
    .eq("id", session.userId)
    .maybeSingle();
  if (actorError) {
    console.error("Task notification actor lookup failed:", actorError.message);
    return NextResponse.json({ error: "Could not verify your account." }, { status: 500 });
  }
  if (!actor || actor.role !== session.role) {
    return NextResponse.json({ error: "Your session is no longer valid." }, { status: 403 });
  }

  const columns = "id, user_id, assigned_by, assigned_to, assigned_at, hotel_id, service_name_snapshot, notes, status, start_time, priority, due_at, dispatch_metadata, room_ids, room_number, room_numbers";
  const [{ data: incoming, error: incomingError }, { data: outgoing, error: outgoingError }] = await Promise.all([
    supabase.from("work_logs").select(columns).eq("assigned_to", actor.id).eq("status", "assigned").order("assigned_at", { ascending: false }).limit(30),
    supabase.from("work_logs").select(columns).eq("assigned_by", actor.id).eq("status", "active").order("start_time", { ascending: false }).limit(30),
  ]);
  if (incomingError || outgoingError) {
    console.error("Task notifications query failed:", incomingError?.message ?? outgoingError?.message);
    return NextResponse.json({ error: "Could not load task notifications." }, { status: 500 });
  }

  const tasks = [...(incoming ?? []), ...(outgoing ?? [])];
  const userIds = [...new Set(tasks.flatMap((task) => [task.assigned_by, task.assigned_to]).filter((id): id is string => Boolean(id)))];
  const hotelIds = [...new Set(tasks.map((task) => task.hotel_id).filter((id): id is string => Boolean(id)))];
  const roomIds = [...new Set(tasks.flatMap((task) => [
    ...(task.room_ids ?? []),
    ...(task.dispatch_metadata?.roomIds ?? []),
  ]).filter((id): id is string => Boolean(id)))];
  const [{ data: relatedUsers, error: usersError }, { data: hotels, error: hotelsError }, { data: rooms, error: roomsError }] = await Promise.all([
    userIds.length ? supabase.from("users").select("id, full_name, role").in("id", userIds) : Promise.resolve({ data: [], error: null }),
    hotelIds.length ? supabase.from("hotels").select("id, name").in("id", hotelIds) : Promise.resolve({ data: [], error: null }),
    roomIds.length ? supabase.from("rooms").select("id, room_name, floor_section").in("id", roomIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (usersError || hotelsError || roomsError) {
    console.error("Task notification details lookup failed:", usersError?.message ?? hotelsError?.message ?? roomsError?.message);
    return NextResponse.json({ error: "Could not load task notifications." }, { status: 500 });
  }
  const usersById = new Map((relatedUsers ?? []).map((user) => [user.id, user]));
  const hotelNames = new Map((hotels ?? []).map((hotel) => [hotel.id, hotel.name]));
  const roomsById = new Map((rooms ?? []).map((room) => [room.id, room]));
  const enrichTask = (task: NonNullable<typeof incoming>[number]) => {
    const selectedRoomIds = [...new Set([...(task.room_ids ?? []), ...(task.dispatch_metadata?.roomIds ?? [])])];
    const roomNames = selectedRoomIds.map((id) => roomsById.get(id)?.room_name).filter((name): name is string => Boolean(name));
    const roomLabel = roomNames.length
      ? roomNames.join(", ")
      : (task.room_numbers ?? []).join(", ") || task.room_number || task.dispatch_metadata?.floorSection || null;
    return {
      ...task,
      sender_name: task.assigned_by ? usersById.get(task.assigned_by)?.full_name ?? "Team member" : "Team member",
      sender_role: task.assigned_by ? usersById.get(task.assigned_by)?.role ?? null : null,
      hotel_name: hotelNames.get(task.hotel_id) ?? "Property",
      room_label: roomLabel,
      room_names: roomNames,
      floor_section: selectedRoomIds.map((id) => roomsById.get(id)?.floor_section).find(Boolean) ?? task.dispatch_metadata?.floorSection ?? null,
      assignee_name: task.assigned_to ? usersById.get(task.assigned_to)?.full_name ?? "Team member" : "Team member",
      assignee_role: task.assigned_to ? usersById.get(task.assigned_to)?.role ?? null : null,
    };
  };
  const { data: alertRecords, error: alertsError } = await supabase
    .from("task_overdue_alerts")
    .select("id, task_id, incident_started_at, created_at")
    .eq("recipient_id", actor.id)
    .order("created_at", { ascending: false })
    .limit(30);
  if (alertsError) {
    console.error("Overdue task notification query failed:", alertsError.message);
    return NextResponse.json({ error: "Could not load task notifications." }, { status: 500 });
  }

  const alertTaskIds = [...new Set((alertRecords ?? []).map((alert) => alert.task_id))];
  const { data: alertTasks, error: alertTasksError } = alertTaskIds.length
    ? await supabase
        .from("work_logs")
        .select("id, hotel_id, user_id, assigned_to, start_time, status, end_time, deleted_at, cancelled_at, service_name_snapshot")
        .in("id", alertTaskIds)
        .eq("status", "active")
        .is("end_time", null)
        .is("deleted_at", null)
        .is("cancelled_at", null)
    : { data: [], error: null };
  if (alertTasksError) {
    console.error("Overdue task details query failed:", alertTasksError.message);
    return NextResponse.json({ error: "Could not load task notifications." }, { status: 500 });
  }

  const activeAlertRecords = (alertRecords ?? []).filter((alert) =>
    (alertTasks ?? []).some((task) => task.id === alert.task_id && task.start_time === alert.incident_started_at)
  );
  const visibleTaskIds = [...new Set([
    ...(incoming ?? []).map((task) => task.id),
    ...activeAlertRecords.map((alert) => alert.task_id),
  ])];
  const { data: readMarkers, error: readError } = visibleTaskIds.length
    ? await supabase.from("task_notification_reads")
        .select("task_id")
        .eq("user_id", actor.id)
        .in("task_id", visibleTaskIds)
    : { data: [], error: null };
  if (readError) {
    console.error("Task notification read-state lookup failed:", readError.message);
    return NextResponse.json({ error: "Could not load task notifications." }, { status: 500 });
  }
  const readTaskIds = new Set((readMarkers ?? []).map((marker) => marker.task_id));
  const alertAssigneeIds = [...new Set((alertTasks ?? []).map((task) => task.assigned_to ?? task.user_id))];
  const alertHotelIds = [...new Set((alertTasks ?? []).map((task) => task.hotel_id))];
  const [{ data: alertUsers, error: alertUsersError }, { data: alertHotels, error: alertHotelsError }] = await Promise.all([
    alertAssigneeIds.length ? supabase.from("users").select("id, full_name").in("id", alertAssigneeIds) : Promise.resolve({ data: [], error: null }),
    alertHotelIds.length ? supabase.from("hotels").select("id, name").in("id", alertHotelIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (alertUsersError || alertHotelsError) {
    console.error("Overdue task notification detail lookup failed:", alertUsersError?.message ?? alertHotelsError?.message);
    return NextResponse.json({ error: "Could not load task notifications." }, { status: 500 });
  }
  const alertTaskById = new Map((alertTasks ?? []).map((task) => [task.id, task]));
  const alertUserById = new Map((alertUsers ?? []).map((user) => [user.id, user.full_name]));
  const alertHotelById = new Map((alertHotels ?? []).map((hotel) => [hotel.id, hotel.name]));
  const overdue = activeAlertRecords.flatMap((alert) => {
    const task = alertTaskById.get(alert.task_id);
    if (!task) return [];
    const elapsedMinutes = Math.max(0, Math.floor((Date.now() - Date.parse(task.start_time)) / 60_000));
    const duration = `${Math.floor(elapsedMinutes / 60)}h ${String(elapsedMinutes % 60).padStart(2, "0")}m`;
    const dashboardPath = session.role === "housekeeping_admin" || session.role === "hk_admin" ? "/hk-admin" : session.role === "owner" ? "/owner" : "/manager";
    return [{
      id: alert.id,
      task_id: task.id,
      is_read: readTaskIds.has(task.id),
      title: "Stale Task Alert (Overdue)",
      task_title: task.service_name_snapshot || "Active task",
      hotel_name: alertHotelById.get(task.hotel_id) ?? "Property",
      assignee_name: alertUserById.get(task.assigned_to ?? task.user_id) ?? "Team member",
      open_duration: duration,
      created_at: alert.created_at,
      href: `${dashboardPath}?tab=operations&taskId=${encodeURIComponent(task.id)}`,
    }];
  });

  return NextResponse.json({
    incoming: (incoming ?? []).map((task) => ({ ...enrichTask(task), is_read: readTaskIds.has(task.id) })),
    outgoing: (outgoing ?? []).map(enrichTask),
    overdue,
  });
}
