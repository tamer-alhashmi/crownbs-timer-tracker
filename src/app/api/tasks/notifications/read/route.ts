import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";

export async function PATCH(request: Request) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Provide a valid task notification." }, { status: 400 });
  }
  if (
    typeof body !== "object"
    || body === null
    || !("taskId" in body)
    || typeof body.taskId !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.taskId)
  ) {
    return NextResponse.json({ error: "Provide a valid task notification." }, { status: 400 });
  }

  const supabase = createPrivilegedServerSupabaseClient();
  const { data: actor, error: actorError } = await supabase
    .from("users")
    .select("id, role")
    .eq("id", session.userId)
    .maybeSingle();
  if (actorError) {
    console.error("Task notification read actor lookup failed:", actorError.message);
    return NextResponse.json({ error: "Could not verify your account." }, { status: 500 });
  }
  if (!actor || actor.role !== session.role) {
    return NextResponse.json({ error: "Your session is no longer valid." }, { status: 403 });
  }

  const { data: task, error: taskError } = await supabase.from("work_logs")
    .select("id, assigned_to, status, start_time, end_time, deleted_at, cancelled_at")
    .eq("id", body.taskId)
    .maybeSingle();
  if (taskError) {
    console.error("Task notification read ownership check failed:", taskError.message);
    return NextResponse.json({ error: "Could not update this task notification." }, { status: 500 });
  }
  if (!task) return NextResponse.json({ error: "Task notification not found." }, { status: 404 });

  let isRecipient = task.assigned_to === actor.id && task.status === "assigned";
  if (
    !isRecipient
    && task.status === "active"
    && task.end_time === null
    && task.deleted_at === null
    && task.cancelled_at === null
  ) {
    const { data: alerts, error: alertsError } = await supabase.from("task_overdue_alerts")
      .select("incident_started_at")
      .eq("recipient_id", actor.id)
      .eq("task_id", task.id);
    if (alertsError) {
      console.error("Task notification read recipient check failed:", alertsError.message);
      return NextResponse.json({ error: "Could not update this task notification." }, { status: 500 });
    }
    isRecipient = (alerts ?? []).some((alert) => alert.incident_started_at === task.start_time);
  }
  if (!isRecipient) return NextResponse.json({ error: "Task notification not found." }, { status: 404 });

  const { error: readError } = await supabase.from("task_notification_reads").upsert(
    { user_id: actor.id, task_id: task.id, read_at: new Date().toISOString() },
    { onConflict: "user_id,task_id" },
  );
  if (readError) {
    console.error("Task notification read-state update failed:", readError.message);
    return NextResponse.json({ error: "Could not update this task notification." }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
