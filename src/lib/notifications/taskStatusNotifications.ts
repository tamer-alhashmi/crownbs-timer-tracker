import "server-only";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";
import { dispatchPushNotification } from "@/lib/notifications/notificationDispatcher";

type StatusNotificationInput = {
  workLogId: string;
  actorId: string;
  previousStatus: string;
  newStatus: string;
};

export async function notifyWorkLogStatusChange(input: StatusNotificationInput) {
  if (input.previousStatus === input.newStatus) return;

  const supabase = createPrivilegedServerSupabaseClient();
  const [{ data: task, error: taskError }, { data: actor, error: actorError }] = await Promise.all([
    supabase.from("work_logs")
      .select("id, hotel_id, service_name_snapshot, room_number, status, hotels(owner_id, manager_id, name)")
      .eq("id", input.workLogId)
      .maybeSingle(),
    supabase.from("users")
      .select("id, role, full_name")
      .eq("id", input.actorId)
      .maybeSingle(),
  ]);
  if (taskError || actorError) {
    throw new Error(`Unable to load task status notification details: ${taskError?.message ?? actorError?.message}`);
  }
  if (!task || !actor) throw new Error("Unable to find the task or actor for status notification.");
  const property = Array.isArray(task.hotels) ? task.hotels[0] : task.hotels;
  if (!property) throw new Error("The task property could not be found for status notification.");
  if (actor.role === "cleaner") {
    const { error: auditError } = await supabase.from("work_log_audit").insert({
      work_log_id: task.id,
      actor_id: actor.id,
      action: "edited",
      previous_values: { status: input.previousStatus },
      new_values: { status: input.newStatus },
    });
    if (auditError) throw new Error(`Task status changed, but its audit record could not be saved: ${auditError.message}`);
  }

  const recipients = new Set<string>();
  const actorIsCleaner = actor.role === "cleaner";
  const actorIsHKAdmin = actor.role === "housekeeping_admin" || actor.role === "hk_admin";
  if (actorIsCleaner) {
    const [{ data: assignments, error: assignmentError }, { data: primaryHKAdmins, error: primaryError }] = await Promise.all([
      supabase.from("user_hotel_assignments").select("user_id").eq("hotel_id", task.hotel_id),
      supabase.from("users").select("id").in("role", ["housekeeping_admin", "hk_admin"]).eq("primary_hotel_id", task.hotel_id),
    ]);
    if (assignmentError || primaryError) {
      throw new Error(`Unable to load task notification recipients: ${assignmentError?.message ?? primaryError?.message}`);
    }
    const candidateIds = [...new Set([...(assignments ?? []).map((assignment) => assignment.user_id), ...(primaryHKAdmins ?? []).map((user) => user.id)])];
    if (candidateIds.length) {
      const { data: candidates, error: candidatesError } = await supabase.from("users")
        .select("id, role, is_active")
        .in("id", candidateIds);
      if (candidatesError) throw new Error(`Unable to load housekeeping notification recipients: ${candidatesError.message}`);
      for (const candidate of candidates ?? []) {
        if (candidate.is_active && (candidate.role === "housekeeping_admin" || candidate.role === "hk_admin")) recipients.add(candidate.id);
      }
    }
  }
  if (actorIsCleaner || actorIsHKAdmin) {
    if (property.manager_id) recipients.add(property.manager_id);
    if (property.owner_id) recipients.add(property.owner_id);
  } else if (actor.role === "manager" && property.owner_id) {
    recipients.add(property.owner_id);
  }
  recipients.delete(actor.id);
  if (!recipients.size) return;

  const recipientIds = [...recipients];
  const { data: activeRecipients, error: recipientsError } = await supabase.from("users")
    .select("id, role")
    .in("id", recipientIds)
    .eq("is_active", true);
  if (recipientsError) throw new Error(`Unable to verify task notification recipients: ${recipientsError.message}`);
  const allowedRoles = actorIsCleaner
    ? new Set(["housekeeping_admin", "hk_admin", "manager", "owner"])
    : actorIsHKAdmin
      ? new Set(["manager", "owner"])
      : actor.role === "manager"
        ? new Set(["owner"])
        : new Set<string>();
  const verifiedRecipients = (activeRecipients ?? []).filter((recipient) => allowedRoles.has(recipient.role));
  if (!verifiedRecipients.length) return;

  const taskName = task.service_name_snapshot?.trim() || "Work task";
  const room = task.room_number?.trim();
  const title = `${taskName} status updated`;
  const body = `${actor.full_name || "A team member"} changed the task status from ${input.previousStatus} to ${input.newStatus} at ${property.name}${room ? ` · ${room}` : ""}.`;
  const rows = verifiedRecipients.map((recipient) => ({
    recipient_id: recipient.id,
    work_log_id: task.id,
    actor_id: actor.id,
    previous_status: input.previousStatus,
    new_status: input.newStatus,
    title,
    body,
    href: `/tasks/${encodeURIComponent(task.id)}`,
  }));
  const { error: insertError } = await supabase.from("work_log_status_notifications").insert(rows);
  if (insertError) throw new Error(`Task status changed, but its notifications could not be recorded: ${insertError.message}`);

  const pushResults = await Promise.allSettled(verifiedRecipients.map((recipient) =>
    dispatchPushNotification({
      userId: recipient.id,
      title,
      body,
      url: `/tasks/${encodeURIComponent(task.id)}`,
      tag: `work-log-status-${task.id}-${input.newStatus}`,
      urgency: input.newStatus === "cancelled" ? "high" : "normal",
    })
  ));
  pushResults.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(`Task status push notification failed for ${verifiedRecipients[index].id}:`, result.reason);
    }
  });
}
