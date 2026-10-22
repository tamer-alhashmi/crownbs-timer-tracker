import { NextRequest, NextResponse } from "next/server";
import { apiError, canSeeChatContact, getChatActor, getChatContact, hasSameOrigin, isUuid } from "@/lib/chat/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_REACTIONS = new Set(["👍", "❤️", "😂", "😮", "😢", "🙏"]);

export async function POST(request: NextRequest) {
  if (!hasSameOrigin(request)) return apiError("Invalid request origin.", 403);
  const context = await getChatActor();
  if ("response" in context) return context.response;
  let body: { messageId?: unknown; emoji?: unknown };
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid reaction request.", 400);
  }
  if (!isUuid(body.messageId) || typeof body.emoji !== "string" || !ALLOWED_REACTIONS.has(body.emoji)) {
    return apiError("Choose a supported reaction.", 400);
  }
  const { data: message, error: messageError } = await context.supabase
    .from("messages")
    .select("id, sender_id, receiver_id, channel_id")
    .eq("id", body.messageId)
    .maybeSingle();
  if (messageError) {
    console.error("[Chat System Error]:", messageError);
    return apiError("Could not load this message.", 500);
  }
  if (!message) return apiError("This message is no longer available.", 404);
  if (message.channel_id) {
    const { data: membership, error } = await context.supabase
      .from("chat_channel_members")
      .select("id")
      .eq("channel_id", message.channel_id)
      .eq("user_id", context.actor.id)
      .maybeSingle();
    if (error) {
      console.error("[Chat System Error]:", error);
      return apiError("Could not verify group access.", 500);
    }
    if (!membership) return apiError("You are not a member of this group.", 403);
  } else {
    const contactId = message.sender_id === context.actor.id ? message.receiver_id : message.sender_id;
    if (!contactId) return apiError("This conversation is no longer available.", 404);
    const contact = await getChatContact(context.supabase, contactId);
    if (!contact || !canSeeChatContact(context.actor, contact.id)) {
      return apiError("You are not permitted to access this conversation.", 403);
    }
  }
  const { data: existing, error: existingError } = await context.supabase
    .from("chat_message_reactions")
    .select("id")
    .eq("message_id", message.id)
    .eq("user_id", context.actor.id)
    .eq("emoji", body.emoji)
    .maybeSingle();
  if (existingError) {
    console.error("[Chat System Error]:", existingError);
    return apiError("Could not update this reaction.", 500);
  }
  if (existing) {
    const { error } = await context.supabase.from("chat_message_reactions").delete().eq("id", existing.id);
    if (error) {
      console.error("[Chat System Error]:", error);
      return apiError("Could not remove this reaction.", 500);
    }
    return NextResponse.json({ reacted: false });
  }
  const { error } = await context.supabase.from("chat_message_reactions").insert({
    message_id: message.id,
    user_id: context.actor.id,
    emoji: body.emoji,
  });
  if (error) {
    console.error("[Chat System Error]:", error);
    return apiError("Could not add this reaction.", 500);
  }
  return NextResponse.json({ reacted: true });
}
