import type { UserRole } from "@/lib/roles";

export type ChatRole = UserRole;
export type AttachmentType = "image" | "pdf" | "doc";

export type ChatContact = {
  id: string;
  full_name: string;
  email: string;
  role: ChatRole;
  avatar_url: string | null;
  unread_count?: number;
};

export type ChatMessage = {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  attachment_url: string | null;
  attachment_type: AttachmentType | null;
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
