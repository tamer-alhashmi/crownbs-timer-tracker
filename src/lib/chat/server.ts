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
    console.error("Chat profile lookup failed:", error.message);
    return { response: apiError("Could not verify your account.", 500) } as const;
  }
  if (!profile || !isChatRole(profile.role)) {
    return { response: apiError("Your account is not authorized for chat.", 403) } as const;
  }

  const { data: hotels, error: hotelsError } = await supabase
    .from("hotels")
    .select("id, owner_id, manager_id, is_active");
  if (hotelsError) {
    console.error("Chat hotel scope lookup failed:", hotelsError.message);
    return { response: apiError("Could not verify your chat scope.", 500) } as const;
  }
  const { data: users, error: usersError } = await supabase
    .from("users")
    .select("id, role, primary_hotel_id");
  if (usersError) {
    console.error("Chat user scope lookup failed:", usersError.message);
    return { response: apiError("Could not verify your chat scope.", 500) } as const;
  }

  const { data: allHotelAssignments, error: allAssignmentsError } = await supabase
    .from("user_hotel_assignments")
    .select("user_id, hotel_id");
  if (allAssignmentsError) {
    console.error("Chat hotel assignment lookup failed:", allAssignmentsError.message);
    return { response: apiError("Could not verify your chat scope.", 500) } as const;
  }
  const assignments = allHotelAssignments ?? [];
  let hkAdminHotelIds: string[] = [];
  if (profile.role === "hk_admin") {
    const { data: assignments, error: assignmentsError } = await supabase
      .from("user_hotel_assignments")
      .select("hotel_id")
      .eq("user_id", profile.id);
    if (assignmentsError) {
      console.error("Housekeeping hotel assignment lookup failed:", assignmentsError.message);
      return { response: apiError("Could not verify your chat scope.", 500) } as const;
    }
    hkAdminHotelIds = (assignments ?? []).map((assignment) => assignment.hotel_id);
  }
  const hotelsForActor = profile.role === "owner"
    ? (hotels ?? []).filter((hotel) => hotel.is_active && hotel.owner_id === profile.id)
    : profile.role === "manager"
      ? (hotels ?? []).filter((hotel) => hotel.is_active && hotel.manager_id === profile.id)
      : profile.role === "hk_admin"
        ? (hotels ?? []).filter((hotel) => hotel.is_active && (hotel.id === profile.primary_hotel_id || hkAdminHotelIds.includes(hotel.id)))
        : profile.role === "cleaner"
          ? (hotels ?? []).filter((hotel) => hotel.is_active && hotel.id === profile.primary_hotel_id)
          : [];
  const hotelIds = new Set(hotelsForActor.map((hotel) => hotel.id));
  const visibleIds = new Set<string>();
  if (profile.role === "admin") {
    (users ?? []).forEach((candidate) => visibleIds.add(candidate.id));
  } else if (profile.role === "owner") {
    hotelsForActor.forEach((hotel) => {
      if (hotel.manager_id) visibleIds.add(hotel.manager_id);
    });
    (users ?? []).filter((candidate) =>
      (candidate.role === "hk_admin" || candidate.role === "cleaner") &&
      (
        (candidate.primary_hotel_id !== null && hotelIds.has(candidate.primary_hotel_id)) ||
        (candidate.role === "hk_admin" && assignments.some((assignment) =>
          assignment.user_id === candidate.id && hotelIds.has(assignment.hotel_id)
        ))
      )
    ).forEach((candidate) => visibleIds.add(candidate.id));
  } else if (profile.role === "manager") {
    hotelsForActor.forEach((hotel) => {
      if (hotel.owner_id) visibleIds.add(hotel.owner_id);
      if (hotel.manager_id) visibleIds.add(hotel.manager_id);
    });
    (users ?? []).filter((candidate) =>
      (candidate.role === "manager" || candidate.role === "hk_admin" || candidate.role === "cleaner") &&
      (
        (candidate.primary_hotel_id !== null && hotelIds.has(candidate.primary_hotel_id)) ||
        (candidate.role === "hk_admin" && assignments.some((assignment) =>
          assignment.user_id === candidate.id && hotelIds.has(assignment.hotel_id)
        ))
      )
    ).forEach((candidate) => visibleIds.add(candidate.id));
  } else if (profile.role === "hk_admin") {
    hotelsForActor.forEach((hotel) => {
      if (hotel.owner_id) visibleIds.add(hotel.owner_id);
      if (hotel.manager_id) visibleIds.add(hotel.manager_id);
    });
    (users ?? []).filter((candidate) =>
      candidate.role === "cleaner" &&
      candidate.primary_hotel_id !== null &&
      hotelIds.has(candidate.primary_hotel_id)
    ).forEach((candidate) => visibleIds.add(candidate.id));
  } else if (profile.role === "cleaner") {
    hotelsForActor.forEach((hotel) => {
      if (hotel.manager_id) visibleIds.add(hotel.manager_id);
    });
    (users ?? []).filter((candidate) =>
      candidate.role === "hk_admin" &&
      (
        (candidate.primary_hotel_id !== null && hotelIds.has(candidate.primary_hotel_id)) ||
        assignments.some((assignment) =>
          assignment.user_id === candidate.id && hotelIds.has(assignment.hotel_id)
        )
      )
    ).forEach((candidate) => visibleIds.add(candidate.id));
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
    console.error("Chat contact lookup failed:", error.message);
    throw new Error("Could not load chat contact.");
  }
  if (!data || !isUserRole(data.role)) return null;
  return data as ChatContact;
}
