import { NextResponse } from "next/server";
import { getVerifiedChatSessionUser } from "@/lib/auth";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";
import type { ChatContact, ChatRole } from "./types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHAT_ROLES = new Set<ChatRole>(["admin", "owner", "manager", "cleaner"]);

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
    .select("id, full_name, email, role, avatar_url")
    .eq("id", session.userId)
    .maybeSingle();

  if (error) {
    console.error("Chat profile lookup failed:", error.message);
    return { response: apiError("Could not verify your account.", 500) } as const;
  }
  if (!profile || !isChatRole(profile.role)) {
    return { response: apiError("Your account is not authorized for chat.", 403) } as const;
  }

  return {
    supabase,
    actor: {
      id: profile.id,
      name: profile.full_name,
      email: profile.email,
      role: profile.role,
    },
  } as const;
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
  if (!data || !isChatRole(data.role)) return null;
  return data as ChatContact;
}
