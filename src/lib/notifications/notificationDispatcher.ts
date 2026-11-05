import "server-only";
import webpush, { type PushSubscription } from "web-push";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";

export type PushNotificationInput = {
  userId: string;
  title: string;
  body: string;
  url: string;
  tag: string;
  urgency?: "very-low" | "low" | "normal" | "high";
};

async function getUnreadCount(userId: string) {
  const supabase = createPrivilegedServerSupabaseClient();
  const [messages, shifts, overtime, assignments] = await Promise.all([
    supabase.from("messages").select("id", { count: "exact", head: true })
      .eq("receiver_id", userId).neq("sender_id", userId).eq("is_read", false),
    supabase.from("workforce_shift_notifications").select("id", { count: "exact", head: true })
      .eq("recipient_id", userId).eq("is_read", false),
    supabase.from("workforce_overtime_notifications").select("id", { count: "exact", head: true })
      .eq("recipient_id", userId).eq("is_read", false),
    supabase.from("work_logs").select("id, assigned_by")
      .eq("assigned_to", userId).eq("status", "assigned")
      .or(`assigned_by.is.null,assigned_by.neq.${userId}`).limit(500),
  ]);
  const failed = [messages, shifts, overtime, assignments].find((result) => result.error);
  if (failed?.error) throw new Error(`Unable to count unread notifications: ${failed.error.message}`);
  const assignmentIds = (assignments.data ?? []).map((task) => task.id);
  const { data: readAssignments, error: readAssignmentsError } = assignmentIds.length
    ? await supabase.from("task_notification_reads").select("task_id")
      .eq("user_id", userId).in("task_id", assignmentIds)
    : { data: [], error: null };
  if (readAssignmentsError) throw new Error(`Unable to count unread task notifications: ${readAssignmentsError.message}`);
  const readAssignmentIds = new Set((readAssignments ?? []).map((read) => read.task_id));
  const unreadAssignments = assignmentIds.filter((taskId) => !readAssignmentIds.has(taskId)).length;

  const { data: alertRows, error: alertsError } = await supabase.from("task_overdue_alerts")
    .select("task_id")
    .eq("recipient_id", userId)
    .limit(500);
  if (alertsError) throw new Error(`Unable to count overdue task notifications: ${alertsError.message}`);
  const taskIds = [...new Set((alertRows ?? []).map((alert) => alert.task_id))];
  const [{ data: activeTasks, error: activeTasksError }, { data: readMarkers, error: readMarkersError }] = taskIds.length
    ? await Promise.all([
      supabase.from("work_logs").select("id").in("id", taskIds)
        .eq("status", "active").is("end_time", null).is("deleted_at", null).is("cancelled_at", null),
      supabase.from("task_notification_reads").select("task_id")
        .eq("user_id", userId).in("task_id", taskIds),
    ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (activeTasksError || readMarkersError) {
    throw new Error(`Unable to count overdue task notifications: ${activeTasksError?.message ?? readMarkersError?.message}`);
  }
  const activeTaskIds = new Set((activeTasks ?? []).map((task) => task.id));
  const readTaskIds = new Set((readMarkers ?? []).map((marker) => marker.task_id));
  const unreadOverdue = taskIds.filter((taskId) => activeTaskIds.has(taskId) && !readTaskIds.has(taskId)).length;
  return [messages.count, unreadAssignments, shifts.count, overtime.count, unreadOverdue]
    .reduce<number>((total, count) => total + (count ?? 0), 0);
}

export async function dispatchPushNotification(input: PushNotificationInput) {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    throw new Error("Web Push is not configured. Set NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT.");
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);

  const supabase = createPrivilegedServerSupabaseClient();
  const { data: subscriptions, error } = await supabase.from("user_push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", input.userId);
  if (error) throw new Error(`Unable to load device subscriptions: ${error.message}`);
  if (!subscriptions?.length) return;

  const unreadCount = await getUnreadCount(input.userId);
  const payload = JSON.stringify({
    title: input.title,
    body: input.body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    url: input.url,
    tag: input.tag,
    unreadCount,
    requireInteraction: input.urgency === "high",
  });

  await Promise.all(subscriptions.map(async (subscription) => {
    const pushSubscription: PushSubscription = {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    };
    try {
      await webpush.sendNotification(pushSubscription, payload, {
        TTL: 60 * 60,
        urgency: input.urgency ?? "normal",
      });
    } catch (error) {
      const statusCode = typeof error === "object" && error !== null && "statusCode" in error
        ? error.statusCode
        : undefined;
      if (statusCode === 404 || statusCode === 410) {
        const { error: deleteError } = await supabase.from("user_push_subscriptions")
          .delete()
          .eq("id", subscription.id);
        if (deleteError) console.error("Unable to prune expired push subscription:", deleteError.message);
        return;
      }
      console.error("Push notification delivery failed:", error);
    }
  }));
}
