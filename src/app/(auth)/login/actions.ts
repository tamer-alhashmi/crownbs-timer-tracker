"use server";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { setSessionCookies } from "@/lib/auth";

export type LoginMethod = "email" | "pin";

export async function loginWithEmailPassword(email: string, password: string) {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    throw new Error("Invalid email or password.");
  }

  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("id, email, role, primary_hotel_id, full_name")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profileError || !profile) {
    throw new Error("User profile could not be loaded.");
  }

  await setSessionCookies({
    userId: profile.id,
    email: profile.email,
    role: profile.role,
    hotelId: profile.primary_hotel_id,
  });

  redirect(profile.role === "cleaner" ? "/dashboard" : "/admin");
}

export async function loginWithPin(email: string, pinCode: string) {
  const supabase = await createServerSupabaseClient();
  const trimmedEmail = email.trim().toLowerCase();
  const trimmedPin = pinCode.trim();

  if (!trimmedEmail) {
    throw new Error("Email or username is required.");
  }

  if (!/^\d{4}$/.test(trimmedPin)) {
    throw new Error("PIN must be exactly 4 digits.");
  }

  const { data, error } = await supabase
    .from("users")
    .select("id, email, role, primary_hotel_id, full_name")
    .eq("email", trimmedEmail)
    .eq("pin_code", trimmedPin)
    .maybeSingle();

  if (error || !data) {
    throw new Error("Invalid email or PIN code.");
  }

  await setSessionCookies({
    userId: data.id,
    email: data.email,
    role: data.role,
    hotelId: data.primary_hotel_id,
  });

  redirect(data.role === "cleaner" ? "/dashboard" : "/admin");
}

export async function login(formData: FormData) {
  const method = (formData.get("method") ?? "email") as LoginMethod;

  if (method === "email") {
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    if (!email || !password) {
      throw new Error("Email and password are required.");
    }

    await loginWithEmailPassword(email, password);
  }

  const email = String(formData.get("email") ?? "").trim();
  const pinCode = String(formData.get("pinCode") ?? "").trim();

  if (!email || !pinCode) {
    throw new Error("Email or username and PIN code are required.");
  }

  await loginWithPin(email, pinCode);
}
