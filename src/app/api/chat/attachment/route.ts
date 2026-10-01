import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { apiError, getChatActor, getChatContact, hasSameOrigin, isUuid } from "@/lib/chat/server";
import { canMessageRole, type AttachmentType } from "@/lib/chat/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 12 * 1024 * 1024;
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
  if (!(file instanceof File) || !isUuid(receiverId) || receiverId === context.actor.id) {
    return apiError("A valid file and recipient are required.", 400);
  }
  const type = MIME_TYPES[file.type];
  if (!type) return apiError("Only images, PDF, and Word documents are supported.", 415);
  if (file.size === 0 || file.size > MAX_FILE_SIZE) {
    return apiError("Attachments must be non-empty and 12 MB or smaller.", 413);
  }
  const contact = await getChatContact(context.supabase, receiverId);
  if (!contact || !canMessageRole(context.actor.role, contact.role)) {
    return apiError("You are not permitted to message this teammate.", 403);
  }

  const extension = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "file";
  const path = `${context.actor.id}/${receiverId}/${randomUUID()}.${extension.replace(/[^a-z0-9]/g, "").slice(0, 8) || "file"}`;
  const { error } = await context.supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) {
    console.error("Chat attachment upload failed:", error.message);
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
    !/^[0-9a-f-]{36}\.[a-z0-9]{1,8}$/i.test(parts[2]) ||
    (context.actor.id !== parts[0] && context.actor.id !== parts[1])
  ) {
    return apiError("Attachment not found.", 404);
  }

  const { data: message, error } = await context.supabase
    .from("messages")
    .select("sender_id, receiver_id, attachment_url")
    .eq("attachment_url", path)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("Chat attachment authorization lookup failed:", error.message);
    return apiError("Could not access attachment.", 500);
  }
  if (
    !message ||
    message.attachment_url !== path ||
    ![message.sender_id, message.receiver_id].includes(context.actor.id)
  ) {
    return apiError("Attachment not found.", 404);
  }
  const contactId = message.sender_id === context.actor.id ? message.receiver_id : message.sender_id;
  const contact = await getChatContact(context.supabase, contactId);
  if (!contact || !canMessageRole(context.actor.role, contact.role)) {
    return apiError("You are not permitted to access this attachment.", 403);
  }

  const { data, error: signedUrlError } = await context.supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 60);
  if (signedUrlError || !data) {
    console.error("Chat attachment URL creation failed:", signedUrlError?.message);
    return apiError("Could not access attachment.", 500);
  }
  return NextResponse.redirect(data.signedUrl, { status: 302 });
}
