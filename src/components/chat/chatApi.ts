import type {
  AttachmentType,
  ChatContact,
  ChatMessage,
  UnreadMessage,
} from "@/lib/chat/types";
import type { UserRole } from "@/lib/roles";
import { logChatError, safeChatError } from "./chatErrors";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...init?.headers,
      },
    });
  } catch (error) {
    logChatError(error);
    throw new Error("We couldn't connect to chat. Check your internet connection and try again. / تعذر الاتصال بالمحادثة. تحقق من اتصالك بالإنترنت وحاول مرة أخرى.");
  }
  let result: unknown;
  try {
    result = await response.json();
  } catch (error) {
    logChatError(error);
    throw new Error("We couldn't load the chat response. Please try again. / تعذر تحميل رد المحادثة. حاول مرة أخرى.");
  }
  if (!response.ok) {
    const message =
      typeof result === "object" &&
      result !== null &&
      "error" in result &&
      typeof result.error === "string"
        ? result.error
        : "Chat request failed.";
    throw new Error(safeChatError(new Error(message), "We couldn't complete that chat action. Please try again."));
  }
  return result as T;
}

export const fetchContacts = () =>
  request<{ contacts: ChatContact[] }>("/api/chat?view=contacts");

export const fetchUnread = () =>
  request<{ count: number; messages: UnreadMessage[] }>("/api/chat?view=unread");

export type TaskNotice = {
  id: string;
  is_read: boolean;
  hotel_id: string;
  service_name_snapshot: string | null;
  notes: string | null;
  assigned_at: string | null;
  start_time: string;
  status: string;
  priority: "low" | "medium" | "high" | "urgent";
  due_at: string | null;
  dispatch_metadata: {
    roomIds?: string[];
    floorSection?: string;
    linenChecklist?: string[];
    durationHours?: number | null;
    issueDescription?: string;
    assetId?: string;
    photoPath?: string | null;
  } | null;
  assignee_name?: string;
  assignee_role?: UserRole | null;
  sender_name?: string;
  sender_role?: UserRole | null;
  hotel_name?: string;
  room_label?: string | null;
  room_names?: string[];
  floor_section?: string | null;
};

export type OverdueTaskNotice = {
  id: string;
  task_id: string;
  is_read: boolean;
  title: string;
  task_title: string;
  hotel_name: string;
  assignee_name: string;
  open_duration: string;
  created_at: string;
  href: string;
};

export const fetchTaskNotifications = () =>
  request<{ incoming: TaskNotice[]; outgoing: TaskNotice[]; overdue: OverdueTaskNotice[] }>(
    "/api/tasks/escalations",
    { method: "POST" }
  ).then(() =>
    request<{ incoming: TaskNotice[]; outgoing: TaskNotice[]; overdue: OverdueTaskNotice[] }>("/api/tasks/notifications")
  );

export const markTaskNotificationRead = (taskId: string) =>
  request<{ success: true }>("/api/tasks/notifications/read", {
    method: "PATCH",
    body: JSON.stringify({ taskId }),
  });

export const fetchConversation = (contactId: string, channelId?: string) =>
  request<{ messages: ChatMessage[] }>(
    channelId
      ? `/api/chat?view=history&channelId=${encodeURIComponent(channelId)}`
      : `/api/chat?view=history&contactId=${encodeURIComponent(contactId)}`
  );

export const markConversationRead = (receiverId: string, channelId?: string) =>
  request<{ updated: number }>("/api/chat", {
    method: "PATCH",
    body: JSON.stringify(channelId ? { channelId } : { receiverId }),
  });

export const setConversationPinned = (contactId: string, isPinned: boolean, channelId?: string) =>
  request<{ is_pinned: boolean }>(channelId ? "/api/chat/channels" : "/api/chat", {
    method: "PATCH",
    body: JSON.stringify(channelId
      ? { channelId, isPinned }
      : { action: "pin", contactId, isPinned }),
  });

export const uploadAttachment = (file: File, receiverId: string, channelId?: string) => {
  const formData = new FormData();
  formData.set("file", file);
  if (channelId) formData.set("channelId", channelId);
  else formData.set("receiverId", receiverId);
  return request<{ path: string; type: AttachmentType }>("/api/chat/attachment", {
    method: "POST",
    body: formData,
  });
};

export const sendMessage = (input: {
  receiverId: string;
  channelId?: string;
  content: string;
  attachmentUrl?: string;
  attachmentType?: AttachmentType | "voice";
  messageType?: ChatMessage["message_type"];
  mediaUrl?: string;
  durationSeconds?: number;
  parentId?: string | null;
}) =>
  request<{ message: ChatMessage }>("/api/chat", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const createGroupChannel = (input: {
  name: string;
  propertyId: string | null;
  memberIds: string[];
}) =>
  request<{ channel: ChatContact }>("/api/chat/channels", {
    method: "POST",
    body: JSON.stringify(input),
  });

export type GroupOptions = {
  properties: { id: string; name: string }[];
  members: { id: string; full_name: string; role: UserRole; property_ids: string[] }[];
  allowCompanyWide: boolean;
};

export const fetchGroupOptions = () =>
  request<GroupOptions>("/api/chat/channels?view=options");

export const toggleMessageReaction = (messageId: string, emoji: string) =>
  request<{ reacted: boolean }>("/api/chat/interactions", {
    method: "POST",
    body: JSON.stringify({ messageId, emoji }),
  });

export const deleteChatMessage = (messageId: string) =>
  request<{ deleted: boolean }>("/api/chat", {
    method: "DELETE",
    body: JSON.stringify({ messageId }),
  });
