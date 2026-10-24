"use server";

import { redirect } from "next/navigation";
import { createPrivilegedServerSupabaseClient, createServerSupabaseClient } from "@/lib/supabase/server";
import { setSessionCookies } from "@/lib/auth";
import { isUserRole, normalizeUserRole, type UserRole } from "@/lib/roles";

export type LoginMethod = "email" | "pin";

export type LoginState = { error: string };

const INVALID_CREDENTIALS = "Invalid email and password.";
const PROFILE_UNAVAILABLE = "Your account profile could not be loaded. Contact your administrator.";

function dashboardForRole(role: string) {
  if (role === "cleaner") return "/dashboard";
  if (role === "manager") return "/manager";
  if (role === "owner") return "/owner";
  if (role === "housekeeping_admin" || role === "hk_admin") return "/hk-admin";
  return "/admin";
}

async function establishUserSession(
  user: { id: string; email: string; role: UserRole; primary_hotel_id: string | null },
  rememberMe = false
): Promise<never> {
  await setSessionCookies({
    userId: user.id,
    email: user.email,
    role: normalizeUserRole(user.role),
    hotelId: user.primary_hotel_id,
  }, { rememberMe });

  redirect(dashboardForRole(normalizeUserRole(user.role)));
}

async function loginWithEmailPassword(email: string, password: string, rememberMe: boolean): Promise<LoginState> {
  let supabase;
  let data;
  let authError;
  try {
    supabase = await createServerSupabaseClient();
    ({ data, error: authError } = await supabase.auth.signInWithPassword({ email, password }));
  } catch (error) {
    console.error("[Auth Exception]:", error);
    return { error: "Unable to sign in. Please check your connection and try again." };
  }

  if (authError || !data.user) {
    return { error: INVALID_CREDENTIALS };
  }

  let profile;
  try {
    const result = await supabase
      .from("users")
      .select("id, email, role, primary_hotel_id")
      .eq("id", data.user.id)
      .maybeSingle();
    profile = result.data;
    if (result.error) console.error("[Auth Exception]:", result.error);
  } catch (error) {
    console.error("[Auth Exception]:", error);
    return { error: PROFILE_UNAVAILABLE };
  }

  if (!profile || !isUserRole(profile.role)) {
    return { error: PROFILE_UNAVAILABLE };
  }

  const { error: providerError } = await supabase.from("users").update({
    auth_provider: "email",
    ...(data.user.email_confirmed_at ? {
      email_verified: true,
      email_verified_at: data.user.email_confirmed_at,
    } : {}),
  }).eq("id", profile.id);
  if (providerError) {
    console.error("[Auth Exception]: Unable to update account authentication metadata.", providerError);
    return { error: PROFILE_UNAVAILABLE };
  }

  return establishUserSession(profile, rememberMe);
}

async function loginWithPin(email: string, pinCode: string): Promise<LoginState> {
  // PIN authentication has no Supabase Auth identity yet, so the RLS-protected
  // users table must be queried only from this trusted server action.
  const supabase = createPrivilegedServerSupabaseClient();
  const trimmedEmail = email.trim().toLowerCase();
  const trimmedPin = pinCode.trim();

  if (!trimmedEmail) {
    return { error: "Email or username is required." };
  }

  if (!/^\d{4}$/.test(trimmedPin)) {
    return { error: "PIN must be exactly 4 digits." };
  }

  const { data, error } = await supabase
    .from("users")
    .select("id, email, role, primary_hotel_id")
    .eq("email", trimmedEmail)
    .eq("pin_code", trimmedPin)
    .maybeSingle();

  if (error) {
    console.error("[Auth Exception]:", error);
    return { error: "Unable to sign in right now. Please try again." };
  }
  if (!data) return { error: "Invalid email or PIN code." };

  const { error: providerError } = await supabase.from("users")
    .update({ auth_provider: "pin" })
    .eq("id", data.id);
  if (providerError) {
    console.error("[Auth Exception]: Unable to update account authentication metadata.", providerError);
    return { error: PROFILE_UNAVAILABLE };
  }

  return establishUserSession(data);
}

export async function login(formData: FormData): Promise<LoginState> {
  const method = (formData.get("method") ?? "email") as LoginMethod;

  if (method === "email") {
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const rememberMe = formData.get("rememberMe") === "on";

    if (!email || !password) {
      return { error: "Email and password are required." };
    }

    return loginWithEmailPassword(email, password, rememberMe);
  }

  if (method !== "pin") return { error: "Choose a valid sign-in method." };

  const email = String(formData.get("email") ?? "").trim();
  const pinCode = String(formData.get("pinCode") ?? "").trim();

  if (!email || !pinCode) {
    return { error: "Email or username and PIN code are required." };
  }

  return loginWithPin(email, pinCode);
}
