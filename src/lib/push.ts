import webpush, { type PushSubscription } from "web-push";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";

type TaskPushInput = {
  taskId: string;
  userId: string;
  hotelName: string;
  priority: string;
  roomLabel: string;
  taskTitle: string;
  scheduledStart: string;
  assignerName: string;
};

export async function sendTaskAssignmentPush(input: TaskPushInput) {
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

  const priority = input.priority.toLowerCase();
  const priorityIcon = priority === "urgent" ? "🔴" : priority === "high" ? "🟠" : "🟢";
  const scheduled = Number.isNaN(Date.parse(input.scheduledStart))
    ? input.scheduledStart
    : new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(input.scheduledStart));
  const payload = JSON.stringify({
    title: `🛎️ New Task: ${input.hotelName}`,
    body: `Priority: [${priority.toUpperCase()}] ${priorityIcon} • ${input.roomLabel}: ${input.taskTitle}\nStarts: ${scheduled} • Assigned by: ${input.assignerName}`,
    tag: `task-${input.taskId}`,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    url: `/tasks/${encodeURIComponent(input.taskId)}`,
    actions: [
      { action: "view-task", title: "View Task" },
      { action: "dismiss", title: "Dismiss" },
    ],
    requireInteraction: priority === "urgent" || priority === "high",
  });

  await Promise.all(subscriptions.map(async (subscription) => {
    const pushSubscription: PushSubscription = {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    };
    try {
      await webpush.sendNotification(pushSubscription, payload, {
        TTL: 60 * 60,
        urgency: priority === "urgent" || priority === "high" ? "high" : "normal",
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
      console.error("Task push delivery failed:", error);
    }
  }));
}
