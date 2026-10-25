import { NextRequest, NextResponse } from "next/server";
import {
  apiError,
  canSeeChatContact,
  getChatActor,
  getChatContact,
  hasSameOrigin,
  isChatRole,
  isUuid,
} from "@/lib/chat/server";
import type { AttachmentType } from "@/lib/chat/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ATTACHMENT_TYPES = new Set<AttachmentType>(["image", "pdf", "doc", "voice"]);
const MESSAGE_TYPES = new Set(["text", "voice"]);

export async function GET(request: NextRequest) {
  const context = await getChatActor();
  if ("response" in context) return context.response;

  const view = request.nextUrl.searchParams.get("view");
  const { supabase, actor } = context;

  if (view === "contacts") {
    const { data, error } = await supabase
      .from("users")
      .select("id, full_name, email, role, avatar_url")
      .neq("id", actor.id)
      .order("full_name");
    if (error) {
      console.error("[Chat System Error]:", error);
      return apiError("Could not load teammates.", 500);
    }
    const contacts = (data ?? []).filter((contact) =>
      isChatRole(contact.role) && canSeeChatContact(actor, contact.id)
    );
    const { data: activeShifts, error: shiftsError } = await supabase
      .from("master_shifts")
      .select("user_id")
      .eq("status", "active")
      .is("end_time", null);
    if (shiftsError) {
      console.error("[Chat System Error]:", shiftsError);
      return apiError("Could not load teammate presence.", 500);
    }
    const activeUserIds = new Set((activeShifts ?? []).map((shift) => shift.user_id));
    const { data: recentMessages, error: recentMessagesError } = await supabase
      .from("messages")
      .select("sender_id, receiver_id, content, attachment_url, created_at")
      .is("channel_id", null)
      .or(`sender_id.eq.${actor.id},receiver_id.eq.${actor.id}`)
      .order("created_at", { ascending: false })
      .limit(500);
    if (recentMessagesError) {
      console.error("[Chat System Error]:", recentMessagesError);
      return apiError("Could not load conversation activity.", 500);
    }
    const { data: preferences, error: preferencesError } = await supabase
      .from("chat_conversation_preferences")
      .select("contact_id, is_pinned")
      .eq("user_id", actor.id);
    if (preferencesError) {
      console.error("[Chat System Error]:", preferencesError);
      return apiError("Could not load conversation preferences.", 500);
    }
    const latestActivity = new Map<string, { created_at: string; content: string }>();
    for (const message of recentMessages ?? []) {
      const contactId = message.sender_id === actor.id ? message.receiver_id : message.sender_id;
      if (contactId && !latestActivity.has(contactId)) {
        latestActivity.set(contactId, {
          created_at: message.created_at,
          content: message.content || (message.attachment_url ? "Attachment" : ""),
        });
      }
    }
    const pinnedContactIds = new Set((preferences ?? []).filter((item) => item.is_pinned).map((item) => item.contact_id));
    const unreadCounts = await Promise.all(
      contacts.map(async (contact) => {
        const { count, error: countError } = await supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("sender_id", contact.id)
          .eq("receiver_id", actor.id)
          .neq("sender_id", actor.id)
          .eq("is_read", false);

        if (countError) {
          console.error("[Chat System Error]:", countError);
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
    const { data: memberships, error: membershipsError } = await supabase
      .from("chat_channel_members")
      .select("channel_id, is_pinned, last_read_at")
      .eq("user_id", actor.id);
    if (membershipsError) {
      console.error("[Chat System Error]:", membershipsError);
      return apiError("Could not load group conversations.", 500);
    }
    const channelIds = (memberships ?? []).map((item) => item.channel_id);
    const { data: channels, error: channelsError } = channelIds.length
      ? await supabase
          .from("chat_channels")
          .select("id, name, property_id, avatar_url, updated_at")
          .eq("type", "group")
          .in("id", channelIds)
      : { data: [], error: null };
    if (channelsError) {
      console.error("[Chat System Error]:", channelsError);
      return apiError("Could not load group conversations.", 500);
    }
    const { data: groupMessages, error: groupMessagesError } = channelIds.length
      ? await supabase
          .from("messages")
          .select("channel_id, sender_id, content, attachment_url, created_at")
          .in("channel_id", channelIds)
          .order("created_at", { ascending: false })
          .limit(500)
      : { data: [], error: null };
    if (groupMessagesError) {
      console.error("[Chat System Error]:", groupMessagesError);
      return apiError("Could not load group activity.", 500);
    }
    const groupActivity = new Map<string, { at: string; content: string }>();
    const groupUnread = new Map<string, number>();
    const groupReadAt = new Map((memberships ?? []).map((item) => [item.channel_id, item.last_read_at]));
    for (const message of groupMessages ?? []) {
      if (!groupActivity.has(message.channel_id)) {
        groupActivity.set(message.channel_id, {
          at: message.created_at,
          content: message.content || (message.attachment_url ? "Attachment" : ""),
        });
      }
      const readAt = groupReadAt.get(message.channel_id);
      if (message.sender_id !== actor.id && (!readAt || message.created_at > readAt)) {
        groupUnread.set(message.channel_id, (groupUnread.get(message.channel_id) ?? 0) + 1);
      }
    }
    const groupContacts = (channels ?? []).map((channel) => {
      const member = (memberships ?? []).find((item) => item.channel_id === channel.id);
      return {
        id: channel.id,
        channel_id: channel.id,
        conversation_type: "group" as const,
        full_name: channel.name,
        email: channel.property_id ? "Property group" : "Company group",
        role: actor.role,
        avatar_url: channel.avatar_url,
        is_pinned: member?.is_pinned ?? false,
        unread_count: groupUnread.get(channel.id) ?? 0,
        last_message_at: groupActivity.get(channel.id)?.at ?? channel.updated_at,
        last_message: groupActivity.get(channel.id)?.content ?? "",
      };
    });
    return NextResponse.json({
      contacts: [...contacts.map((contact) => ({
        ...contact,
        is_clocked_in: activeUserIds.has(contact.id),
        unread_count: unreadCountBySender.get(contact.id) ?? 0,
        is_pinned: pinnedContactIds.has(contact.id),
        last_message_at: latestActivity.get(contact.id)?.created_at ?? null,
        last_message: latestActivity.get(contact.id)?.content ?? null,
      })), ...groupContacts],
    });
  }

  if (view === "unread") {
    const currentUserId = actor.id;
    const visibleContactIds = [...actor.visibleContactIds];
    const { data, count, error } = visibleContactIds.length
      ? await supabase
          .from("messages")
          .select("id, sender_id, receiver_id, content, attachment_url, attachment_type, is_read, sent_at, delivered_at, read_at, created_at", {
            count: "exact",
          })
          .eq("receiver_id", currentUserId)
          .neq("sender_id", currentUserId)
          .eq("is_read", false)
          .in("sender_id", visibleContactIds)
          .order("created_at", { ascending: false })
          .limit(8)
      : { data: [], count: 0, error: null };
    if (error) {
      console.error("[Chat System Error]:", error);
      return apiError("Could not load notifications.", 500);
    }
    const senderIds = [...new Set((data ?? []).map((message) => message.sender_id))];
    const { data: senders, error: sendersError } = senderIds.length
      ? await supabase.from("users").select("id, full_name, email, role, avatar_url").in("id", senderIds)
      : { data: [], error: null };
    if (sendersError) {
      console.error("[Chat System Error]:", sendersError);
      return apiError("Could not load notifications.", 500);
    }
    const senderMap = new Map(
      (senders ?? []).map((sender) => [sender.id, sender])
    );
    const messages = (data ?? [])
      .map((message) => {
        if (message.sender_id === currentUserId || message.is_read) return null;
        const sender = senderMap.get(message.sender_id);
        return sender && isChatRole(sender.role) && canSeeChatContact(actor, sender.id)
          ? { ...message, sender }
          : null;
      })
      .filter((message) => message !== null);
    const { data: memberships, error: membershipsError } = await supabase
      .from("chat_channel_members")
      .select("channel_id, last_read_at")
      .eq("user_id", actor.id);
    if (membershipsError) {
      console.error("[Chat System Error]:", membershipsError);
      return apiError("Could not load group notifications.", 500);
    }
    const groupUnreadCounts = await Promise.all((memberships ?? []).map(async (membership) => {
      let query = supabase.from("messages")
        .select("id", { count: "exact", head: true })
        .eq("channel_id", membership.channel_id)
        .neq("sender_id", currentUserId);
      if (membership.last_read_at) query = query.gt("created_at", membership.last_read_at);
      const { count: groupCount, error: groupCountError } = await query;
      if (groupCountError) {
        console.error("[Chat System Error]:", groupCountError);
        return null;
      }
      return groupCount ?? 0;
    }));
    if (groupUnreadCounts.some((item) => item === null)) return apiError("Could not load group notifications.", 500);
    const groupUnreadCount = groupUnreadCounts.reduce<number>((total, value) => total + (value ?? 0), 0);
    return NextResponse.json({ currentUserId, count: (count ?? 0) + groupUnreadCount, messages });
  }

  if (view === "history") {
    const channelId = request.nextUrl.searchParams.get("channelId");
    if (isUuid(channelId)) {
      const { data: membership, error: membershipError } = await supabase
        .from("chat_channel_members")
        .select("id")
        .eq("channel_id", channelId)
        .eq("user_id", actor.id)
        .maybeSingle();
      if (membershipError) {
        console.error("[Chat System Error]:", membershipError);
        return apiError("Could not verify group access.", 500);
      }
      if (!membership) return apiError("You are not a member of this group.", 403);
      const { data: rows, error } = await supabase
        .from("messages")
        .select("id, sender_id, receiver_id, channel_id, content, attachment_url, attachment_type, is_read, sent_at, delivered_at, read_at, created_at, parent_id, message_type, media_url, duration_seconds")
        .eq("channel_id", channelId)
        .order("created_at", { ascending: true })
        .limit(200);
      if (error) {
        console.error("[Chat System Error]:", error);
        return apiError("Could not load this group conversation.", 500);
      }
      const messageIds = (rows ?? []).map((message) => message.id);
      const parentIds = [...new Set((rows ?? []).map((message) => message.parent_id).filter((id): id is string => Boolean(id)))];
      const participantIds = [...new Set((rows ?? []).map((message) => message.sender_id))];
      const [{ data: participants, error: participantsError }, { data: reactions, error: reactionsError }, { data: parents, error: parentsError }] = await Promise.all([
        participantIds.length
          ? supabase.from("users").select("id, full_name, avatar_url, role").in("id", participantIds)
          : Promise.resolve({ data: [], error: null }),
        messageIds.length
          ? supabase.from("chat_message_reactions").select("message_id, user_id, emoji").in("message_id", messageIds)
          : Promise.resolve({ data: [], error: null }),
        parentIds.length
          ? supabase.from("messages").select("id, sender_id, content, message_type").in("id", parentIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (participantsError || reactionsError || parentsError) {
        console.error("[Chat System Error]:", participantsError ?? reactionsError ?? parentsError);
        return apiError("Could not load group message details.", 500);
      }
      const participantById = new Map((participants ?? []).map((person) => [person.id, person]));
      const parentById = new Map((parents ?? []).map((parent) => [parent.id, parent]));
      const reactionRows = reactions ?? [];
      return NextResponse.json({
        messages: (rows ?? []).map((message) => ({
          ...message,
          sender: participantById.get(message.sender_id) ?? null,
          parent: message.parent_id ? parentById.get(message.parent_id) ?? null : null,
          reactions: [...new Set(reactionRows.filter((reaction) => reaction.message_id === message.id).map((reaction) => reaction.emoji))]
            .map((emoji) => ({
              emoji,
              count: reactionRows.filter((reaction) => reaction.message_id === message.id && reaction.emoji === emoji).length,
              reacted: reactionRows.some((reaction) => reaction.message_id === message.id && reaction.emoji === emoji && reaction.user_id === actor.id),
            })),
        })),
      });
    }
    const contactId = request.nextUrl.searchParams.get("contactId");
    if (!isUuid(contactId) || contactId === actor.id) {
      return apiError("A valid chat contact is required.", 400);
    }
    const contact = await getChatContact(supabase, contactId);
    if (!contact) return apiError("Chat contact not found.", 404);
    if (!canSeeChatContact(actor, contact.id)) {
      return apiError("You are not permitted to message this teammate.", 403);
    }
    const { data, error } = await supabase
      .from("messages")
      .select("id, sender_id, receiver_id, channel_id, content, attachment_url, attachment_type, is_read, sent_at, delivered_at, read_at, created_at, parent_id, message_type, media_url, duration_seconds")
      .or(
        `and(sender_id.eq.${actor.id},receiver_id.eq.${contact.id}),and(sender_id.eq.${contact.id},receiver_id.eq.${actor.id})`
      )
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) {
      console.error("[Chat System Error]:", error);
      return apiError("Could not load this conversation.", 500);
    }
    const messageIds = (data ?? []).map((message) => message.id);
    const parentIds = [...new Set((data ?? []).map((message) => message.parent_id).filter((id): id is string => Boolean(id)))];
    const [{ data: reactions, error: reactionsError }, { data: parents, error: parentsError }] = await Promise.all([
      messageIds.length
        ? supabase.from("chat_message_reactions").select("message_id, user_id, emoji").in("message_id", messageIds)
        : Promise.resolve({ data: [], error: null }),
      parentIds.length
        ? supabase.from("messages").select("id, sender_id, content, message_type").in("id", parentIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (reactionsError || parentsError) {
      console.error("[Chat System Error]:", reactionsError ?? parentsError);
      return apiError("Could not load message reactions.", 500);
    }
    const reactionRows = reactions ?? [];
    const parentById = new Map((parents ?? []).map((parent) => [parent.id, parent]));
    return NextResponse.json({
      messages: (data ?? []).map((message) => ({
        ...message,
        parent: message.parent_id ? parentById.get(message.parent_id) ?? null : null,
        reactions: [...new Set(reactionRows.filter((reaction) => reaction.message_id === message.id).map((reaction) => reaction.emoji))]
          .map((emoji) => ({
            emoji,
            count: reactionRows.filter((reaction) => reaction.message_id === message.id && reaction.emoji === emoji).length,
            reacted: reactionRows.some((reaction) => reaction.message_id === message.id && reaction.emoji === emoji && reaction.user_id === actor.id),
          })),
      })),
    });
  }

  return apiError("Unknown chat view.", 400);
}

export async function POST(request: NextRequest) {
  if (!hasSameOrigin(request)) return apiError("Invalid request origin.", 403);
  const context = await getChatActor();
  if ("response" in context) return context.response;

  let body: {
    receiverId?: unknown;
    channelId?: unknown;
    content?: unknown;
    attachmentUrl?: unknown;
    attachmentType?: unknown;
    messageType?: unknown;
    mediaUrl?: unknown;
    durationSeconds?: unknown;
    parentId?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid message request.", 400);
  }

  const { supabase, actor } = context;
  const receiverId = body.receiverId;
  const channelId = body.channelId;
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const attachmentUrl = body.attachmentUrl;
  const attachmentType = body.attachmentType;
  const messageType = body.messageType ?? (attachmentType === "voice" ? "voice" : "text");
  const parentId = body.parentId === undefined || body.parentId === null ? null : body.parentId;
  const mediaUrl = body.mediaUrl === undefined ? attachmentUrl : body.mediaUrl;
  if (!isUuid(channelId) && (!isUuid(receiverId) || receiverId === actor.id)) return apiError("A valid recipient is required.", 400);
  if (channelId !== undefined && !isUuid(channelId)) return apiError("A valid group is required.", 400);
  if (!MESSAGE_TYPES.has(String(messageType))) return apiError("Unsupported message type.", 400);
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
  if (messageType === "voice" && (attachmentType !== "voice" || typeof mediaUrl !== "string" ||
    !Number.isFinite(body.durationSeconds) || Number(body.durationSeconds) <= 0 || Number(body.durationSeconds) > 180)) {
    return apiError("A valid voice note is required.", 400);
  }
  const targetId = isUuid(channelId) ? channelId : receiverId as string;
  if (isUuid(channelId)) {
    const { data: member, error: memberError } = await supabase
      .from("chat_channel_members")
      .select("id")
      .eq("channel_id", channelId)
      .eq("user_id", actor.id)
      .maybeSingle();
    if (memberError) {
      console.error("[Chat System Error]:", memberError);
      return apiError("Could not verify group membership.", 500);
    }
    if (!member) return apiError("You are not a member of this group.", 403);
  } else {
    const contact = await getChatContact(supabase, receiverId as string);
    if (!contact) return apiError("Recipient not found.", 404);
    if (!canSeeChatContact(actor, contact.id)) {
      return apiError("You are not permitted to message this teammate.", 403);
    }
  }
  if (attachmentUrl && (!attachmentUrl.startsWith(`${actor.id}/${targetId}/`) || mediaUrl !== attachmentUrl)) {
    return apiError("Invalid attachment.", 400);
  }
  if (parentId !== null && !isUuid(parentId)) return apiError("Invalid reply target.", 400);
  if (parentId !== null) {
    const { data: parent, error: parentError } = await supabase
      .from("messages")
      .select("id, sender_id, receiver_id, channel_id")
      .eq("id", parentId)
      .maybeSingle();
    if (parentError) {
      console.error("[Chat System Error]:", parentError);
      return apiError("Could not verify the reply.", 500);
    }
    const validParent = parent && (isUuid(channelId)
      ? parent.channel_id === channelId
      : parent.channel_id === null &&
        [parent.sender_id, parent.receiver_id].includes(actor.id) &&
        [parent.sender_id, parent.receiver_id].includes(receiverId as string));
    if (!validParent) return apiError("That message is no longer available to reply to.", 404);
  }

  const { data, error } = await supabase
    .from("messages")
    .insert({
      sender_id: actor.id,
      receiver_id: isUuid(channelId) ? null : receiverId,
      channel_id: isUuid(channelId) ? channelId : null,
      content,
      attachment_url: attachmentUrl ?? null,
      attachment_type: attachmentType ?? null,
      message_type: messageType,
      media_url: mediaUrl ?? null,
      duration_seconds: messageType === "voice" ? Number(body.durationSeconds) : null,
      parent_id: parentId,
      is_read: false,
    })
    .select("id, sender_id, receiver_id, channel_id, content, attachment_url, attachment_type, is_read, sent_at, delivered_at, read_at, created_at, parent_id, message_type, media_url, duration_seconds")
    .single();

  if (error) {
    console.error("[Chat System Error]:", error);
    return apiError("Could not send message.", 500);
  }
  return NextResponse.json({ message: data }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  if (!hasSameOrigin(request)) return apiError("Invalid request origin.", 403);
  const context = await getChatActor();
  if ("response" in context) return context.response;

  let body: { receiverId?: unknown; contactId?: unknown; channelId?: unknown; action?: unknown; isPinned?: unknown };
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid read receipt request.", 400);
  }
  if (body.action === "pin") {
    const isPinned = body.isPinned === true;
    if (isUuid(body.channelId)) {
      const { data: member, error: memberError } = await context.supabase
        .from("chat_channel_members")
        .select("id")
        .eq("channel_id", body.channelId)
        .eq("user_id", context.actor.id)
        .maybeSingle();
      if (memberError) {
        console.error("[Chat System Error]:", memberError);
        return apiError("Could not update conversation preferences.", 500);
      }
      if (!member) return apiError("You are not a member of this group.", 403);
      const { error } = await context.supabase
        .from("chat_channel_members")
        .update({ is_pinned: isPinned })
        .eq("id", member.id);
      if (error) {
        console.error("[Chat System Error]:", error);
        return apiError("Could not update conversation preferences.", 500);
      }
      return NextResponse.json({ is_pinned: isPinned });
    }
    if (!isUuid(body.contactId) || body.contactId === context.actor.id) {
      return apiError("A valid conversation is required.", 400);
    }
    const contact = await getChatContact(context.supabase, body.contactId);
    if (!contact || !canSeeChatContact(context.actor, contact.id)) {
      return apiError("You are not permitted to access this conversation.", 403);
    }
    const { error } = await context.supabase.from("chat_conversation_preferences").upsert({
      user_id: context.actor.id,
      contact_id: contact.id,
      is_pinned: isPinned,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      console.error("[Chat System Error]:", error);
      return apiError("Could not update conversation preferences.", 500);
    }
    return NextResponse.json({ is_pinned: isPinned });
  }
  const receiverId = body.receiverId;
  if (isUuid(body.channelId)) {
    const { data: membership, error: membershipError } = await context.supabase
      .from("chat_channel_members")
      .select("id")
      .eq("channel_id", body.channelId)
      .eq("user_id", context.actor.id)
      .maybeSingle();
    if (membershipError) {
      console.error("[Chat System Error]:", membershipError);
      return apiError("Could not update group read status.", 500);
    }
    if (!membership) return apiError("You are not a member of this group.", 403);
    const { error } = await context.supabase
      .from("chat_channel_members")
      .update({ last_read_at: new Date().toISOString() })
      .eq("id", membership.id);
    if (error) {
      console.error("[Chat System Error]:", error);
      return apiError("Could not update group read status.", 500);
    }
    return NextResponse.json({ updated: 1 });
  }
  if (!isUuid(receiverId) || receiverId === context.actor.id) {
    return apiError("A valid conversation is required.", 400);
  }

  const contact = await getChatContact(context.supabase, receiverId);
  if (!contact || !canSeeChatContact(context.actor, contact.id)) {
    return apiError("You are not permitted to access this conversation.", 403);
  }
  const { data, error } = await context.supabase
    .from("messages")
    .update({
      is_read: true,
      delivered_at: new Date().toISOString(),
      read_at: new Date().toISOString(),
    })
    .eq("sender_id", receiverId)
    .eq("receiver_id", context.actor.id)
    .eq("is_read", false)
    .select("id");
  if (error) {
    console.error("[Chat System Error]:", error);
    return apiError("Could not update read receipts.", 500);
  }
  return NextResponse.json({ updated: data?.length ?? 0 });
}

export async function DELETE(request: NextRequest) {
  if (!hasSameOrigin(request)) return apiError("Invalid request origin.", 403);
  const context = await getChatActor();
  if ("response" in context) return context.response;

  let messageId: unknown;
  try {
    ({ messageId } = await request.json());
  } catch {
    return apiError("Invalid delete message request.", 400);
  }
  if (!isUuid(messageId)) return apiError("A valid message is required.", 400);

  const { data: message, error: lookupError } = await context.supabase
    .from("messages")
    .select("id, sender_id, receiver_id, channel_id, attachment_url")
    .eq("id", messageId)
    .maybeSingle();
  if (lookupError) {
    console.error("[Chat System Error]:", lookupError);
    return apiError("Could not load this message.", 500);
  }
  if (!message || message.sender_id !== context.actor.id) {
    return apiError("Only your own messages can be deleted.", 403);
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
      return apiError("Could not verify group access.", 500);
    }
    if (!membership) return apiError("You are not a member of this group.", 403);
  } else {
    if (!message.receiver_id) return apiError("This message is no longer available.", 404);
    const contact = await getChatContact(context.supabase, message.receiver_id);
    if (!contact || !canSeeChatContact(context.actor, contact.id)) {
      return apiError("You are not permitted to access this conversation.", 403);
    }
  }

  const { error: deleteError } = await context.supabase
    .from("messages")
    .delete()
    .eq("id", message.id)
    .eq("sender_id", context.actor.id);
  if (deleteError) {
    console.error("[Chat System Error]:", deleteError);
    return apiError("Could not delete this message.", 500);
  }
  if (message.attachment_url) {
    const { error: storageError } = await context.supabase.storage
      .from("chat_attachments")
      .remove([message.attachment_url]);
    if (storageError) console.error("[Chat System Error]:", storageError);
  }
  return NextResponse.json({ deleted: true });
}
