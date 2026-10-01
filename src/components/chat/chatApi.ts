import type {
  AttachmentType,
  ChatContact,
  ChatMessage,
  UnreadMessage,
} from "@/lib/chat/types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof result === "object" &&
      result !== null &&
      "error" in result &&
      typeof result.error === "string"
        ? result.error
        : "Chat request failed.";
    throw new Error(message);
  }
  return result as T;
}

export const fetchContacts = () =>
  request<{ contacts: ChatContact[] }>("/api/chat?view=contacts");

export const fetchUnread = () =>
  request<{ count: number; messages: UnreadMessage[] }>("/api/chat?view=unread");

export const fetchConversation = (contactId: string) =>
  request<{ messages: ChatMessage[] }>(
    `/api/chat?view=history&contactId=${encodeURIComponent(contactId)}`
  );

export const markConversationRead = (receiverId: string) =>
  request<{ updated: number }>("/api/chat", {
    method: "PATCH",
    body: JSON.stringify({ receiverId }),
  });

export const uploadAttachment = (file: File, receiverId: string) => {
  const formData = new FormData();
  formData.set("file", file);
  formData.set("receiverId", receiverId);
  return request<{ path: string; type: AttachmentType }>("/api/chat/attachment", {
    method: "POST",
    body: formData,
  });
};

export const sendMessage = (input: {
  receiverId: string;
  content: string;
  attachmentUrl?: string;
  attachmentType?: AttachmentType;
}) =>
  request<{ message: ChatMessage }>("/api/chat", {
    method: "POST",
    body: JSON.stringify(input),
  });
