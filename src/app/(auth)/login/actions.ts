"use server";

import { createHmac, timingSafeEqual } from "node:crypto";
import { createPrivilegedServerSupabaseClient, createServerSupabaseClient } from "@/lib/supabase/server";
import { clearSessionCookies, setSessionCookies } from "@/lib/auth";
import { isUserRole, normalizeUserRole, type UserRole } from "@/lib/roles";

export type LoginMethod = "email" | "pin";

export type LoginState = { error?: string; redirectTo?: string };

const INVALID_CREDENTIALS = "Invalid email and password.";
const PROFILE_UNAVAILABLE = "Your account profile could not be loaded. Contact your administrator.";
const DEACTIVATED_ACCOUNT = "This account has been deactivated. Please contact management.";
const PIN_RATE_LIMITED = "Too many failed attempts. Please try again in 15 minutes or contact your manager.";

function pinIdentifierHash(identifier: string) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for PIN login rate limiting.");
  return createHmac("sha256", secret).update(identifier).digest("hex");
}

function matchesPin(storedPin: string | null, submittedPin: string) {
  if (!storedPin) return false;
  const stored = Buffer.from(storedPin);
  const submitted = Buffer.from(submittedPin);
  return stored.length === submitted.length && timingSafeEqual(stored, submitted);
}

async function clearRejectedLoginSession() {
  try {
    await clearSessionCookies();
  } catch (error) {
    console.error("[Auth Exception]: Unable to clear app session cookies after a rejected login.", error);
  }
}

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
): Promise<LoginState> {
  await setSessionCookies({
    userId: user.id,
    email: user.email,
    role: normalizeUserRole(user.role),
    hotelId: user.primary_hotel_id,
  }, { rememberMe });

  return { redirectTo: dashboardForRole(normalizeUserRole(user.role)) };
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
      .select("id, email, role, primary_hotel_id, is_active")
      .eq("id", data.user.id)
      .maybeSingle();
    profile = result.data;
    if (result.error) console.error("[Auth Exception]:", result.error);
  } catch (error) {
    console.error("[Auth Exception]:", error);
    return { error: PROFILE_UNAVAILABLE };
  }

  if (!profile) return { error: PROFILE_UNAVAILABLE };
  if (profile.is_active !== true) {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) console.error("[Auth Exception]: Unable to end deactivated user's Supabase session.", error);
    } catch (error) {
      console.error("[Auth Exception]: Unable to end deactivated user's Supabase session.", error);
    }
    await clearRejectedLoginSession();
    return { error: DEACTIVATED_ACCOUNT };
  }
  if (!isUserRole(profile.role)) return { error: PROFILE_UNAVAILABLE };

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
  const trimmedEmail = email.trim().toLowerCase();
  const trimmedPin = pinCode.trim();

  if (!trimmedEmail) {
    return { error: "Email or username is required." };
  }

  if (!/^\d{4}$/.test(trimmedPin)) {
    return { error: "PIN must be exactly 4 digits." };
  }

  const supabase = createPrivilegedServerSupabaseClient();
  const identifierHash = pinIdentifierHash(trimmedEmail);
  const { data, error } = await supabase
    .from("users")
    .select("id, email, role, primary_hotel_id, is_active, pin_code")
    .eq("email", trimmedEmail)
    .maybeSingle();

  if (error) {
    console.error("[Auth Exception]:", error);
    return { error: "Unable to sign in right now. Please try again." };
  }

  const { data: rateLimitData, error: rateLimitError } = await supabase.rpc("consume_pin_login_attempt", {
    p_identifier_hash: identifierHash,
  });
  const rateLimit = Array.isArray(rateLimitData) ? rateLimitData[0] : null;
  if (rateLimitError || !rateLimit) {
    console.error("[Auth Exception]: Unable to check PIN login rate limit.", rateLimitError);
    return { error: "Unable to sign in right now. Please try again." };
  }
  if (!rateLimit.allowed) return { error: PIN_RATE_LIMITED };

  if (!data || !matchesPin(data.pin_code, trimmedPin)) {
    const { data: lockedByFailure, error: failureError } = await supabase.rpc("lock_pin_login_after_failure", {
      p_identifier_hash: identifierHash,
    });
    if (failureError) {
      console.error("[Auth Exception]: Unable to record failed PIN login.", failureError);
      return { error: "Unable to sign in right now. Please try again." };
    }
    return { error: lockedByFailure ? PIN_RATE_LIMITED : "Invalid email or PIN code." };
  }
  if (data.is_active !== true) {
    await clearRejectedLoginSession();
    return { error: DEACTIVATED_ACCOUNT };
  }
  if (!isUserRole(data.role)) return { error: PROFILE_UNAVAILABLE };

  const { error: resetError } = await supabase.rpc("reset_pin_login_attempts", {
    p_identifier_hash: identifierHash,
  });
  if (resetError) {
    console.error("[Auth Exception]: Unable to reset successful PIN login attempts.", resetError);
    return { error: "Unable to sign in right now. Please try again." };
  }

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
