import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { apiError, canSeeChatContact, getChatActor, getChatContact, hasSameOrigin, isUuid } from "@/lib/chat/server";
import type { AttachmentType } from "@/lib/chat/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 12 * 1024 * 1024;
const MAX_VOICE_SIZE = 2 * 1024 * 1024;
const MIME_TYPES: Record<string, AttachmentType> = {
  "image/avif": "image",
  "image/gif": "image",
  "image/heic": "image",
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "doc",
  "audio/webm": "voice",
  "audio/ogg": "voice",
  "audio/webm;codecs=opus": "voice",
  "audio/ogg;codecs=opus": "voice",
};
const BUCKET = "chat_attachments";

export async function POST(request: NextRequest) {
  if (!hasSameOrigin(request)) return apiError("Invalid request origin.", 403);
  const context = await getChatActor();
  if ("response" in context) return context.response;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return apiError("Invalid attachment upload.", 400);
  }
  const file = formData.get("file");
  const receiverId = formData.get("receiverId");
  const channelId = formData.get("channelId");
  const isGroup = isUuid(channelId);
  if (!(file instanceof File) || (isGroup ? false : !isUuid(receiverId) || receiverId === context.actor.id) ||
    (channelId !== null && !isGroup)) {
    return apiError("A valid file and conversation are required.", 400);
  }
  const type = MIME_TYPES[file.type];
  if (!type) return apiError("Only images, documents, and WebM or Ogg audio are supported.", 415);
  if (file.size === 0 || file.size > (type === "voice" ? MAX_VOICE_SIZE : MAX_FILE_SIZE)) {
    return apiError(type === "voice" ? "Voice notes must be 2 MB or smaller." : "Attachments must be non-empty and 12 MB or smaller.", 413);
  }
  const targetId = isGroup ? channelId : receiverId as string;
  if (isGroup) {
    const { data: membership, error } = await context.supabase
      .from("chat_channel_members")
      .select("id")
      .eq("channel_id", channelId)
      .eq("user_id", context.actor.id)
      .maybeSingle();
    if (error) {
      console.error("[Chat System Error]:", error);
      return apiError("Could not verify group access.", 500);
    }
    if (!membership) return apiError("You are not a member of this group.", 403);
  } else {
    const contact = await getChatContact(context.supabase, receiverId as string);
    if (!contact || !canSeeChatContact(context.actor, contact.id)) {
      return apiError("You are not permitted to message this teammate.", 403);
    }
  }

  const extension = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "file";
  const path = `${context.actor.id}/${targetId}/${randomUUID()}.${extension.replace(/[^a-z0-9]/g, "").slice(0, 8) || "file"}`;
  const { error } = await context.supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) {
    console.error("[Chat System Error]:", error);
    return apiError("Could not upload attachment. Check chat storage configuration.", 500);
  }
  return NextResponse.json({ path, type }, { status: 201 });
}

export async function GET(request: NextRequest) {
  const context = await getChatActor();
  if ("response" in context) return context.response;

  const path = request.nextUrl.searchParams.get("path");
  const parts = path?.split("/");
  if (
    !path ||
    !parts ||
    parts.length !== 3 ||
    !isUuid(parts[0]) ||
    !isUuid(parts[1]) ||
    !/^[0-9a-f-]{36}\.[a-z0-9]{1,8}$/i.test(parts[2])
  ) {
    return apiError("Attachment not found.", 404);
  }

  const { data: message, error } = await context.supabase
    .from("messages")
    .select("sender_id, receiver_id, channel_id, attachment_url")
    .eq("attachment_url", path)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[Chat System Error]:", error);
    return apiError("Could not access attachment.", 500);
  }
  if (!message || message.attachment_url !== path) {
    return apiError("Attachment not found.", 404);
  }
  if (message.channel_id) {
    const { data: membership, error: membershipError } = await context.supabase
      .from("chat_channel_members")
      .select("id")
      .eq("channel_id", message.channel_id)
      .eq("user_id", context.actor.id)
      .maybeSingle();
    if (membershipError) {
      console.error("[Chat System Error]:", membershipError);
      return apiError("Could not verify attachment access.", 500);
    }
    if (!membership) return apiError("Attachment not found.", 404);
  } else {
    if (!message.receiver_id || ![message.sender_id, message.receiver_id].includes(context.actor.id)) {
      return apiError("Attachment not found.", 404);
    }
    const contactId = message.sender_id === context.actor.id ? message.receiver_id : message.sender_id;
    const contact = await getChatContact(context.supabase, contactId);
    if (!contact || !canSeeChatContact(context.actor, contact.id)) {
      return apiError("You are not permitted to access this attachment.", 403);
    }
  }

  const { data, error: signedUrlError } = await context.supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 60);
  if (signedUrlError || !data) {
    if (signedUrlError) console.error("[Chat System Error]:", signedUrlError);
    return apiError("Could not access attachment.", 500);
  }
  return NextResponse.redirect(data.signedUrl, { status: 302 });
}
