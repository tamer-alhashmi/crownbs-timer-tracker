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

  const columns = "id, user_id, assigned_by, assigned_to, assigned_at, hotel_id, service_name_snapshot, notes, status, start_time, priority, due_at, dispatch_metadata";
  const [{ data: incoming, error: incomingError }, { data: outgoing, error: outgoingError }] = await Promise.all([
    supabase.from("work_logs").select(columns).eq("assigned_to", actor.id).eq("status", "assigned").order("assigned_at", { ascending: false }).limit(30),
    supabase.from("work_logs").select(columns).eq("assigned_by", actor.id).eq("status", "active").order("start_time", { ascending: false }).limit(30),
  ]);
  if (incomingError || outgoingError) {
    console.error("Task notifications query failed:", incomingError?.message ?? outgoingError?.message);
    return NextResponse.json({ error: "Could not load task notifications." }, { status: 500 });
  }

  const userIds = [...new Set((outgoing ?? []).map((task) => task.assigned_to).filter((id): id is string => Boolean(id)))];
  const { data: assignees, error: assigneeError } = userIds.length
    ? await supabase.from("users").select("id, full_name").in("id", userIds)
    : { data: [], error: null };
  if (assigneeError) {
    console.error("Task notification assignee lookup failed:", assigneeError.message);
    return NextResponse.json({ error: "Could not load task notifications." }, { status: 500 });
  }
  const assigneeNames = new Map((assignees ?? []).map((assignee) => [assignee.id, assignee.full_name]));
  return NextResponse.json({
    incoming: incoming ?? [],
    outgoing: (outgoing ?? []).map((task) => ({
      ...task,
      assignee_name: task.assigned_to ? assigneeNames.get(task.assigned_to) ?? "Team member" : "Team member",
    })),
  });
}
