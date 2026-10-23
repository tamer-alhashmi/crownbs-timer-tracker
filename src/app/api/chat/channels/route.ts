import { NextRequest, NextResponse } from "next/server";
import { apiError, getChatActor, hasSameOrigin, isUuid } from "@/lib/chat/server";
import { isHousekeepingAdmin } from "@/lib/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const context = await getChatActor();
  if ("response" in context) return context.response;
  if (request.nextUrl.searchParams.get("view") === "options") {
    const [{ data: hotels, error: hotelsError }, { data: assignments, error: assignmentsError }, { data: users, error: usersError }] = await Promise.all([
      context.supabase.from("hotels").select("id, name, owner_id, manager_id, is_active"),
      context.supabase.from("user_hotel_assignments").select("user_id, hotel_id"),
      context.supabase.from("users").select("id, full_name, role, primary_hotel_id").neq("id", context.actor.id),
    ]);
    if (hotelsError || assignmentsError || usersError) {
      console.error("[Chat System Error]:", hotelsError ?? assignmentsError ?? usersError);
      return apiError("Could not load group options.", 500);
    }
    const eligibleHotels = (hotels ?? []).filter((hotel) => hotel.is_active && (
      context.actor.role === "owner"
        ? hotel.owner_id === context.actor.id
        : context.actor.role === "manager"
          ? hotel.manager_id === context.actor.id || context.actor.primaryHotelId === hotel.id ||
            (assignments ?? []).some((item) => item.user_id === context.actor.id && item.hotel_id === hotel.id)
          : context.actor.primaryHotelId === hotel.id ||
            (assignments ?? []).some((item) => item.user_id === context.actor.id && item.hotel_id === hotel.id)
    ));
    const propertyIds = new Set(eligibleHotels.map((hotel) => hotel.id));
    const people = (users ?? []).filter((person) =>
      context.actor.role === "owner"
        ? true
        : (context.actor.role === "manager"
            ? ["hk_admin", "cleaner"].includes(person.role)
            : person.role === "cleaner") &&
          ([...(assignments ?? []).filter((item) => item.user_id === person.id).map((item) => item.hotel_id), person.primary_hotel_id]
            .some((id) => id && propertyIds.has(id)))
    ).map((person) => ({
      id: person.id,
      full_name: person.full_name,
      role: person.role,
      property_ids: [...new Set([
        ...(assignments ?? []).filter((item) => item.user_id === person.id).map((item) => item.hotel_id),
        ...(person.primary_hotel_id ? [person.primary_hotel_id] : []),
      ])],
    }));
    return NextResponse.json({
      properties: eligibleHotels.map(({ id, name }) => ({ id, name })),
      members: people,
      allowCompanyWide: context.actor.role === "owner",
    });
  }
  const { data: memberships, error: membershipsError } = await context.supabase
    .from("chat_channel_members")
    .select("channel_id, is_pinned, last_read_at, role")
    .eq("user_id", context.actor.id);
  if (membershipsError) {
    console.error("[Chat System Error]:", membershipsError);
    return apiError("Could not load group conversations.", 500);
  }
  const channelIds = (memberships ?? []).map((item) => item.channel_id);
  if (!channelIds.length) return NextResponse.json({ channels: [] });
  const { data: channels, error: channelsError } = await context.supabase
    .from("chat_channels")
    .select("id, name, property_id, avatar_url, created_at, updated_at")
    .eq("type", "group")
    .in("id", channelIds);
  if (channelsError) {
    console.error("[Chat System Error]:", channelsError);
    return apiError("Could not load group conversations.", 500);
  }
  const lastReads = new Map((memberships ?? []).map((item) => [item.channel_id, item.last_read_at]));
  const { data: groupMessages, error: messageError } = await context.supabase
    .from("messages")
    .select("id, channel_id, sender_id, content, created_at, attachment_url")
    .in("channel_id", channelIds)
    .order("created_at", { ascending: false })
    .limit(500);
  if (messageError) {
    console.error("[Chat System Error]:", messageError);
    return apiError("Could not load group activity.", 500);
  }
  const latest = new Map<string, { created_at: string; content: string }>();
  const unread = new Map<string, number>();
  for (const message of groupMessages ?? []) {
    if (!latest.has(message.channel_id)) {
      latest.set(message.channel_id, {
        created_at: message.created_at,
        content: message.content || (message.attachment_url ? "Attachment" : ""),
      });
    }
    const readAt = lastReads.get(message.channel_id);
    if (message.sender_id !== context.actor.id && (!readAt || message.created_at > readAt)) {
      unread.set(message.channel_id, (unread.get(message.channel_id) ?? 0) + 1);
    }
  }
  return NextResponse.json({
    channels: (channels ?? []).map((channel) => {
      const membership = (memberships ?? []).find((item) => item.channel_id === channel.id);
      return {
        ...channel,
        is_pinned: membership?.is_pinned ?? false,
        unread_count: unread.get(channel.id) ?? 0,
        last_message_at: latest.get(channel.id)?.created_at ?? channel.updated_at,
        last_message: latest.get(channel.id)?.content ?? "",
      };
    }),
  });
}

export async function POST(request: NextRequest) {
  if (!hasSameOrigin(request)) return apiError("Invalid request origin.", 403);
  const context = await getChatActor();
  if ("response" in context) return context.response;
  if (!["owner", "manager", "hk_admin"].includes(context.actor.role)) {
    return apiError("Your role cannot create group conversations.", 403);
  }

  let body: { name?: unknown; propertyId?: unknown; memberIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid group conversation request.", 400);
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const propertyId = body.propertyId === null ? null : body.propertyId;
  if (!name || name.length > 120 || (propertyId !== null && !isUuid(propertyId))) {
    return apiError("Enter a group name and valid property.", 400);
  }
  if (!Array.isArray(body.memberIds) || body.memberIds.length < 1 || body.memberIds.length > 100 || !body.memberIds.every(isUuid)) {
    return apiError("Choose at least one group member.", 400);
  }
  const memberIds = [...new Set([...body.memberIds, context.actor.id])];
  const { data: hotels, error: hotelsError } = await context.supabase
    .from("hotels")
    .select("id, owner_id, manager_id, is_active");
  if (hotelsError) {
    console.error("[Chat System Error]:", hotelsError);
    return apiError("Could not verify group permissions.", 500);
  }
  const { data: assignments, error: assignmentsError } = await context.supabase
    .from("user_hotel_assignments")
    .select("user_id, hotel_id");
  if (assignmentsError) {
    console.error("[Chat System Error]:", assignmentsError);
    return apiError("Could not verify group permissions.", 500);
  }
  const selectedProperty = propertyId ? (hotels ?? []).find((hotel) => hotel.id === propertyId && hotel.is_active) : null;
  if (propertyId && !selectedProperty) return apiError("Choose an active property.", 400);
  const propertyUsers = new Set<string>();
  if (propertyId) {
    (assignments ?? []).filter((item) => item.hotel_id === propertyId).forEach((item) => propertyUsers.add(item.user_id));
    const { data: primaryUsers, error: primaryError } = await context.supabase
      .from("users")
      .select("id")
      .eq("primary_hotel_id", propertyId);
    if (primaryError) {
      console.error("[Chat System Error]:", primaryError);
      return apiError("Could not verify group members.", 500);
    }
    (primaryUsers ?? []).forEach((item) => propertyUsers.add(item.id));
    if (context.actor.role === "manager" && (selectedProperty?.manager_id === context.actor.id || context.actor.primaryHotelId === propertyId)) {
      propertyUsers.add(context.actor.id);
    }
    if (isHousekeepingAdmin(context.actor.role) && context.actor.primaryHotelId === propertyId) {
      propertyUsers.add(context.actor.id);
    }
  }
  if (context.actor.role === "owner") {
    if (propertyId && selectedProperty?.owner_id !== context.actor.id) {
      return apiError("You can only create groups for your properties.", 403);
    }
  } else {
    if (!propertyId) return apiError("Select a property for this group.", 400);
    if (context.actor.role === "manager" && selectedProperty?.manager_id !== context.actor.id && context.actor.primaryHotelId !== propertyId &&
      !(assignments ?? []).some((item) => item.user_id === context.actor.id && item.hotel_id === propertyId)) {
      return apiError("You can only create groups for your assigned property.", 403);
    }
    if (isHousekeepingAdmin(context.actor.role) && context.actor.primaryHotelId !== propertyId &&
      !(assignments ?? []).some((item) => item.user_id === context.actor.id && item.hotel_id === propertyId)) {
      return apiError("You can only create groups for your assigned property.", 403);
    }
  }
  if (context.actor.role !== "owner" && memberIds.some((id) => !propertyUsers.has(id))) {
    return apiError("Group members must belong to the selected property.", 403);
  }
  const { data: members, error: memberLookupError } = await context.supabase
    .from("users")
    .select("id, role")
    .in("id", memberIds);
  if (memberLookupError || (members ?? []).length !== memberIds.length) {
    if (memberLookupError) console.error("[Chat System Error]:", memberLookupError);
    return apiError("Could not verify the selected group members.", 500);
  }
  const roleAllowed = (role: string) => {
    if (context.actor.role === "owner") return ["super_admin", "admin", "owner", "manager", "housekeeping_admin", "hk_admin", "cleaner"].includes(role);
    if (context.actor.role === "manager") return ["housekeeping_admin", "hk_admin", "cleaner"].includes(role);
    return role === "cleaner";
  };
  if ((members ?? []).some((member) => !roleAllowed(member.role))) {
    return apiError("Some selected members are not available for this group.", 403);
  }
  const { data: channel, error: createError } = await context.supabase
    .from("chat_channels")
    .insert({
      name,
      type: "group",
      property_id: propertyId,
      created_by: context.actor.id,
    })
    .select("id, name, property_id, avatar_url, created_at, updated_at")
    .single();
  if (createError) {
    console.error("[Chat System Error]:", createError);
    return apiError("Could not create this group. Please try again.", 500);
  }
  const { error: addMembersError } = await context.supabase.from("chat_channel_members").insert(
    memberIds.map((userId) => ({
      channel_id: channel.id,
      user_id: userId,
      role: userId === context.actor.id ? "admin" : "member",
    }))
  );
  if (addMembersError) {
    console.error("[Chat System Error]:", addMembersError);
    await context.supabase.from("chat_channels").delete().eq("id", channel.id);
    return apiError("Could not add members to this group.", 500);
  }
  return NextResponse.json({
    channel: {
      ...channel,
      channel_id: channel.id,
      conversation_type: "group",
      email: propertyId ? "Property group" : "Company group",
      role: context.actor.role,
      is_pinned: false,
      unread_count: 0,
      last_message: "",
    },
  }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  if (!hasSameOrigin(request)) return apiError("Invalid request origin.", 403);
  const context = await getChatActor();
  if ("response" in context) return context.response;
  let body: { channelId?: unknown; isPinned?: unknown };
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid group preference request.", 400);
  }
  if (!isUuid(body.channelId)) return apiError("A valid group is required.", 400);
  const { data: member, error: lookupError } = await context.supabase
    .from("chat_channel_members")
    .select("id")
    .eq("channel_id", body.channelId)
    .eq("user_id", context.actor.id)
    .maybeSingle();
  if (lookupError) {
    console.error("[Chat System Error]:", lookupError);
    return apiError("Could not update group preferences.", 500);
  }
  if (!member) return apiError("You are not a member of this group.", 403);
  const { error } = await context.supabase
    .from("chat_channel_members")
    .update({ is_pinned: body.isPinned === true })
    .eq("id", member.id);
  if (error) {
    console.error("[Chat System Error]:", error);
    return apiError("Could not update group preferences.", 500);
  }
  return NextResponse.json({ is_pinned: body.isPinned === true });
}
