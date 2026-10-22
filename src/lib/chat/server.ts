import { NextResponse } from "next/server";
import { getVerifiedChatSessionUser } from "@/lib/auth";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";
import type { ChatContact, ChatRole } from "./types";
import { USER_ROLES, isUserRole } from "@/lib/roles";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHAT_ROLES = new Set<ChatRole>(USER_ROLES);

export function isChatRole(value: unknown): value is ChatRole {
  return typeof value === "string" && CHAT_ROLES.has(value as ChatRole);
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function apiError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export function hasSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function getChatActor() {
  const session = await getVerifiedChatSessionUser();
  if (!session) return { response: apiError("Authentication required.", 401) } as const;

  const supabase = createPrivilegedServerSupabaseClient();
  const { data: profile, error } = await supabase
    .from("users")
    .select("id, full_name, email, role, avatar_url, primary_hotel_id")
    .eq("id", session.userId)
    .maybeSingle();

  if (error) {
    console.error("[Chat System Error]:", error);
    return { response: apiError("Could not verify your account.", 500) } as const;
  }
  if (!profile || !isChatRole(profile.role)) {
    return { response: apiError("Your account is not authorized for chat.", 403) } as const;
  }

  const { data: hotels, error: hotelsError } = await supabase
    .from("hotels")
    .select("id, owner_id, manager_id, is_active");
  if (hotelsError) {
    console.error("[Chat System Error]:", hotelsError);
    return { response: apiError("Could not verify your chat scope.", 500) } as const;
  }
  const { data: users, error: usersError } = await supabase
    .from("users")
    .select("id, role, primary_hotel_id");
  if (usersError) {
    console.error("[Chat System Error]:", usersError);
    return { response: apiError("Could not verify your chat scope.", 500) } as const;
  }

  const { data: allHotelAssignments, error: allAssignmentsError } = await supabase
    .from("user_hotel_assignments")
    .select("user_id, hotel_id");
  if (allAssignmentsError) {
    console.error("[Chat System Error]:", allAssignmentsError);
    return { response: apiError("Could not verify your chat scope.", 500) } as const;
  }
  const assignments = allHotelAssignments ?? [];
  const actorHotelIds = new Set(
    assignments.filter((assignment) => assignment.user_id === profile.id).map((assignment) => assignment.hotel_id)
  );
  if (profile.primary_hotel_id) actorHotelIds.add(profile.primary_hotel_id);
  if (profile.role === "owner" || profile.role === "manager") {
    (hotels ?? []).filter((hotel) =>
      hotel.is_active && (profile.role === "owner" ? hotel.owner_id === profile.id : hotel.manager_id === profile.id)
    ).forEach((hotel) => actorHotelIds.add(hotel.id));
  }

  const visibleIds = new Set<string>();
  if (profile.role === "admin") {
    (users ?? []).forEach((candidate) => visibleIds.add(candidate.id));
  } else {
    const hotelIds = actorHotelIds;
    (users ?? []).filter((candidate) => candidate.role === "admin").forEach((candidate) => visibleIds.add(candidate.id));
    (hotels ?? []).filter((hotel) => hotel.is_active && hotelIds.has(hotel.id)).forEach((hotel) => {
      if (hotel.owner_id) visibleIds.add(hotel.owner_id);
      if (hotel.manager_id) visibleIds.add(hotel.manager_id);
    });
    (users ?? []).filter((candidate) => {
      if (candidate.id === profile.id || !isChatRole(candidate.role)) return false;
      const candidateHotelIds = new Set(
        assignments.filter((assignment) => assignment.user_id === candidate.id).map((assignment) => assignment.hotel_id)
      );
      if (candidate.primary_hotel_id) candidateHotelIds.add(candidate.primary_hotel_id);
      return [...candidateHotelIds].some((hotelId) => hotelIds.has(hotelId));
    }).forEach((candidate) => visibleIds.add(candidate.id));

    const { data: existingThreads, error: threadsError } = await supabase
      .from("messages")
      .select("sender_id, receiver_id")
      .or(`sender_id.eq.${profile.id},receiver_id.eq.${profile.id}`)
      .is("channel_id", null);
    // Direct-message visibility is derived from the legacy sender/receiver pair only.
    if (threadsError) {
      console.error("[Chat System Error]:", threadsError);
      return { response: apiError("Could not verify your chat contacts.", 500) } as const;
    }
    (existingThreads ?? []).forEach((message) => {
      const contactId = message.sender_id === profile.id ? message.receiver_id : message.sender_id;
      if (contactId) visibleIds.add(contactId);
    });
  }
  visibleIds.delete(profile.id);

  return {
    supabase,
    actor: {
      id: profile.id,
      name: profile.full_name,
      email: profile.email,
      role: profile.role,
      primaryHotelId: profile.primary_hotel_id,
      visibleContactIds: visibleIds,
    },
  } as const;
}

export function canSeeChatContact(
  actor: { id: string; role: ChatRole; visibleContactIds: Set<string> },
  contactId: string
): boolean {
  return actor.id !== contactId && (actor.role === "admin" || actor.visibleContactIds.has(contactId));
}

export async function getChatContact(
  supabase: ReturnType<typeof createPrivilegedServerSupabaseClient>,
  id: string
): Promise<ChatContact | null> {
  const { data, error } = await supabase
    .from("users")
    .select("id, full_name, email, role, avatar_url")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[Chat System Error]:", error);
    throw new Error("Could not load chat contact.");
  }
  if (!data || !isUserRole(data.role)) return null;
  return data as ChatContact;
}
