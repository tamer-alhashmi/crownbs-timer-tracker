"use server";

import { redirect } from "next/navigation";
import { createPrivilegedServerSupabaseClient, createServerSupabaseClient } from "@/lib/supabase/server";
import { setSessionCookies } from "@/lib/auth";

export type LoginMethod = "email" | "pin";

export type LoginState = { error: string };

const INVALID_CREDENTIALS = "Invalid email and password.";
const PROFILE_UNAVAILABLE = "Your account profile could not be loaded. Contact your administrator.";

function dashboardForRole(role: string) {
  if (role === "cleaner") return "/dashboard";
  if (role === "manager") return "/manager";
  if (role === "owner") return "/owner";
  return "/admin";
}

async function establishUserSession(user: { id: string; email: string; role: "admin" | "owner" | "manager" | "cleaner"; primary_hotel_id: string | null }): Promise<never> {
  await setSessionCookies({
    userId: user.id,
    email: user.email,
    role: user.role,
    hotelId: user.primary_hotel_id,
  });

  redirect(dashboardForRole(user.role));
}

async function loginWithEmailPassword(email: string, password: string): Promise<LoginState> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    return { error: INVALID_CREDENTIALS };
  }

  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("id, email, role, primary_hotel_id")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profileError || !profile) {
    if (profileError) console.error("Unable to load the authenticated user's profile.", profileError);
    return { error: PROFILE_UNAVAILABLE };
  }

  return establishUserSession(profile);
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
    console.error("PIN authentication lookup failed.", error);
    return { error: "Unable to sign in right now. Please try again." };
  }
  if (!data) return { error: "Invalid email or PIN code." };

  return establishUserSession(data);
}

export async function login(formData: FormData): Promise<LoginState> {
  const method = (formData.get("method") ?? "email") as LoginMethod;

  if (method === "email") {
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    if (!email || !password) {
      return { error: "Email and password are required." };
    }

    return loginWithEmailPassword(email, password);
  }

  if (method !== "pin") return { error: "Choose a valid sign-in method." };

  const email = String(formData.get("email") ?? "").trim();
  const pinCode = String(formData.get("pinCode") ?? "").trim();

  if (!email || !pinCode) {
    return { error: "Email or username and PIN code are required." };
  }

  return loginWithPin(email, pinCode);
}
