import { dispatchPushNotification } from "@/lib/notifications/notificationDispatcher";

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
  const priority = input.priority.toLowerCase();
  const priorityIcon = priority === "urgent" ? "🔴" : priority === "high" ? "🟠" : "🟢";
  const scheduled = Number.isNaN(Date.parse(input.scheduledStart))
    ? input.scheduledStart
    : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" })
      .format(new Date(input.scheduledStart));

  await dispatchPushNotification({
    userId: input.userId,
    title: `New Task: ${input.hotelName}`,
    body: `Priority: [${priority.toUpperCase()}] ${priorityIcon} · ${input.roomLabel}: ${input.taskTitle}\nStarts: ${scheduled} · Assigned by: ${input.assignerName}`,
    url: `/tasks/${encodeURIComponent(input.taskId)}`,
    tag: `task-${input.taskId}`,
    urgency: priority === "urgent" || priority === "high" ? "high" : "normal",
  });
}
