export type ChatRole = "admin" | "owner" | "manager" | "cleaner";
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
  created_at: string;
};

export type UnreadMessage = ChatMessage & {
  sender: ChatContact;
};

export function roleLabel(role: ChatRole): string {
  return role === "admin" ? "HK Admin" : role[0].toUpperCase() + role.slice(1);
}

export function canMessageRole(sender: ChatRole, recipient: ChatRole): boolean {
  if (recipient === "owner") return sender === "manager";
  if (sender === "owner") return true;

  switch (sender) {
    case "manager":
      return recipient === "admin" || recipient === "cleaner";
    case "admin":
    case "cleaner":
      return recipient === "manager" || recipient === (sender === "admin" ? "cleaner" : "admin");
  }
}
