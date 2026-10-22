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
  return NextResponse.json({
    incoming: (incoming ?? []).map(enrichTask),
    outgoing: (outgoing ?? []).map(enrichTask),
  });
}
