import type { UserRole } from "@/lib/roles";

export type ChatRole = UserRole;
export type AttachmentType = "image" | "pdf" | "doc" | "voice";

export type ChatContact = {
  id: string;
  full_name: string;
  email: string;
  role: ChatRole;
  avatar_url: string | null;
  channel_id?: string;
  conversation_type?: "direct" | "group";
  is_pinned?: boolean;
  last_message_at?: string | null;
  last_message?: string | null;
  is_clocked_in?: boolean;
  unread_count?: number;
};

export type ChatMessage = {
  id: string;
  sender_id: string;
  receiver_id: string | null;
  content: string;
  attachment_url: string | null;
  attachment_type: AttachmentType | "voice" | null;
  channel_id?: string | null;
  parent_id?: string | null;
  message_type?: "text" | "voice" | "system" | "call_log";
  media_url?: string | null;
  duration_seconds?: number | null;
  sender?: Pick<ChatContact, "id" | "full_name" | "avatar_url" | "role">;
  parent?: Pick<ChatMessage, "id" | "content" | "sender_id" | "message_type"> | null;
  reactions?: { emoji: string; count: number; reacted: boolean }[];
  is_read: boolean;
  sent_at: string;
  delivered_at: string | null;
  read_at: string | null;
  created_at: string;
};

export type UnreadMessage = ChatMessage & {
  sender: ChatContact;
};

export function roleLabel(role: ChatRole): string {
  return role === "hk_admin" ? "Housekeeping Admin" : role[0].toUpperCase() + role.slice(1);
}

export function canMessageRole(sender: ChatRole, recipient: ChatRole): boolean {
  return sender === "admin" || recipient !== "admin";
}
