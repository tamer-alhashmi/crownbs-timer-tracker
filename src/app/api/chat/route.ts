import { NextRequest, NextResponse } from "next/server";
import {
  apiError,
  getChatActor,
  getChatContact,
  hasSameOrigin,
  isChatRole,
  isUuid,
} from "@/lib/chat/server";
import { canMessageRole, type AttachmentType } from "@/lib/chat/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ATTACHMENT_TYPES = new Set<AttachmentType>(["image", "pdf", "doc"]);

export async function GET(request: NextRequest) {
  const context = await getChatActor();
  if ("response" in context) return context.response;

  const view = request.nextUrl.searchParams.get("view");
  const { supabase, actor } = context;

  if (view === "contacts") {
    const { data, error } = await supabase
      .from("users")
      .select("id, full_name, email, role")
      .neq("id", actor.id)
      .order("full_name");
    if (error) {
      console.error("Chat contacts query failed:", error.message);
      return apiError("Could not load teammates.", 500);
    }
    const contacts = (data ?? []).filter(
      (contact) =>
        ["admin", "owner", "manager", "cleaner"].includes(contact.role) &&
        canMessageRole(actor.role, contact.role)
    );
    const unreadCounts = await Promise.all(
      contacts.map(async (contact) => {
        const { count, error: countError } = await supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("sender_id", contact.id)
          .eq("receiver_id", actor.id)
          .eq("is_read", false);

        if (countError) {
          console.error("Unread contact count query failed:", countError.message);
          return null;
        }
        return [contact.id, count ?? 0] as const;
      })
    );
    if (unreadCounts.some((item) => item === null)) {
      return apiError("Could not load teammate unread counts.", 500);
    }
    const unreadCountBySender = new Map(
      unreadCounts.filter((item): item is readonly [string, number] => item !== null)
    );
    return NextResponse.json({
      contacts: contacts.map((contact) => ({
        ...contact,
        unread_count: unreadCountBySender.get(contact.id) ?? 0,
      })),
    });
  }

  if (view === "unread") {
    const { data, count, error } = await supabase
      .from("messages")
      .select("id, sender_id, receiver_id, content, attachment_url, attachment_type, is_read, created_at", {
        count: "exact",
      })
      .eq("receiver_id", actor.id)
      .eq("is_read", false)
      .order("created_at", { ascending: false })
      .limit(8);
    if (error) {
      console.error("Unread chat query failed:", error.message);
      return apiError("Could not load notifications.", 500);
    }
    const senderIds = [...new Set((data ?? []).map((message) => message.sender_id))];
    const { data: senders, error: sendersError } = senderIds.length
      ? await supabase.from("users").select("id, full_name, email, role").in("id", senderIds)
      : { data: [], error: null };
    if (sendersError) {
      console.error("Chat notification sender lookup failed:", sendersError.message);
      return apiError("Could not load notifications.", 500);
    }
    const senderMap = new Map(
      (senders ?? []).map((sender) => [sender.id, sender])
    );
    const messages = (data ?? [])
      .map((message) => {
        const sender = senderMap.get(message.sender_id);
        return sender && isChatRole(sender.role) && canMessageRole(sender.role, actor.role)
          ? { ...message, sender }
          : null;
      })
      .filter((message) => message !== null);
    return NextResponse.json({ count: count ?? 0, messages });
  }

  if (view === "history") {
    const contactId = request.nextUrl.searchParams.get("contactId");
    if (!isUuid(contactId) || contactId === actor.id) {
      return apiError("A valid chat contact is required.", 400);
    }
    const contact = await getChatContact(supabase, contactId);
    if (!contact) return apiError("Chat contact not found.", 404);
    if (!canMessageRole(actor.role, contact.role)) {
      return apiError("You are not permitted to message this teammate.", 403);
    }
    const { data, error } = await supabase
      .from("messages")
      .select("id, sender_id, receiver_id, content, attachment_url, attachment_type, is_read, created_at")
      .or(
        `and(sender_id.eq.${actor.id},receiver_id.eq.${contact.id}),and(sender_id.eq.${contact.id},receiver_id.eq.${actor.id})`
      )
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) {
      console.error("Chat history query failed:", error.message);
      return apiError("Could not load this conversation.", 500);
    }
    return NextResponse.json({ messages: data ?? [] });
  }

  return apiError("Unknown chat view.", 400);
}

export async function POST(request: NextRequest) {
  if (!hasSameOrigin(request)) return apiError("Invalid request origin.", 403);
  const context = await getChatActor();
  if ("response" in context) return context.response;

  let body: {
    receiverId?: unknown;
    content?: unknown;
    attachmentUrl?: unknown;
    attachmentType?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid message request.", 400);
  }

  const { supabase, actor } = context;
  const receiverId = body.receiverId;
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const attachmentUrl = body.attachmentUrl;
  const attachmentType = body.attachmentType;
  if (!isUuid(receiverId) || receiverId === actor.id) {
    return apiError("A valid recipient is required.", 400);
  }
  if (content.length > 5000) return apiError("Messages must be 5,000 characters or fewer.", 400);
  if (attachmentUrl !== undefined && typeof attachmentUrl !== "string") {
    return apiError("Invalid attachment.", 400);
  }
  if (attachmentType !== undefined && !ATTACHMENT_TYPES.has(attachmentType as AttachmentType)) {
    return apiError("Unsupported attachment type.", 400);
  }
  if (!content && !attachmentUrl) return apiError("Write a message or attach a file.", 400);
  if (Boolean(attachmentUrl) !== Boolean(attachmentType)) {
    return apiError("Attachment details are incomplete.", 400);
  }

  const contact = await getChatContact(supabase, receiverId);
  if (!contact) return apiError("Recipient not found.", 404);
  if (!canMessageRole(actor.role, contact.role)) {
    return apiError("You are not permitted to message this teammate.", 403);
  }
  if (attachmentUrl && !attachmentUrl.startsWith(`${actor.id}/${receiverId}/`)) {
    return apiError("Invalid attachment.", 400);
  }

  const { data, error } = await supabase
    .from("messages")
    .insert({
      sender_id: actor.id,
      receiver_id: receiverId,
      content,
      attachment_url: attachmentUrl ?? null,
      attachment_type: attachmentType ?? null,
      is_read: false,
    })
    .select("id, sender_id, receiver_id, content, attachment_url, attachment_type, is_read, created_at")
    .single();

  if (error) {
    console.error("Chat message insert failed:", error.message);
    return apiError("Could not send message.", 500);
  }
  return NextResponse.json({ message: data }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  if (!hasSameOrigin(request)) return apiError("Invalid request origin.", 403);
  const context = await getChatActor();
  if ("response" in context) return context.response;

  let receiverId: unknown;
  try {
    ({ receiverId } = await request.json());
  } catch {
    return apiError("Invalid read receipt request.", 400);
  }
  if (!isUuid(receiverId) || receiverId === context.actor.id) {
    return apiError("A valid conversation is required.", 400);
  }

  const contact = await getChatContact(context.supabase, receiverId);
  if (!contact || !canMessageRole(context.actor.role, contact.role)) {
    return apiError("You are not permitted to access this conversation.", 403);
  }
  const { data, error } = await context.supabase
    .from("messages")
    .update({ is_read: true })
    .eq("sender_id", receiverId)
    .eq("receiver_id", context.actor.id)
    .eq("is_read", false)
    .select("id");
  if (error) {
    console.error("Chat read receipt update failed:", error.message);
    return apiError("Could not update read receipts.", 500);
  }
  return NextResponse.json({ updated: data?.length ?? 0 });
}
