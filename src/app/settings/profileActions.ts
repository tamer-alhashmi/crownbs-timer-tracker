"use server";

import { revalidatePath } from "next/cache";
import { getVerifiedChatSessionUser, setSessionCookies } from "@/lib/auth";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";

export async function savePersonalProfile(input: { fullName: string; email: string; phoneNumber: string; languagePreference: string }) {
  const user = await getVerifiedChatSessionUser();
  if (!user) throw new Error("Your session has expired. Sign in again to update your profile.");

  const fullName = input.fullName.trim();
  const email = input.email.trim().toLowerCase();
  const phoneNumber = input.phoneNumber.trim();
  const languagePreference = input.languagePreference.trim();
  if (!fullName || fullName.length > 120) throw new Error("Enter a name between 1 and 120 characters.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
  if (phoneNumber.length > 32 || (phoneNumber && !/^[+()\d\s.-]{5,32}$/.test(phoneNumber))) {
    throw new Error("Enter a valid phone number or leave it blank.");
  }
  if (!["en", "ar", "fr", "es"].includes(languagePreference)) throw new Error("Choose a supported language.");

  const supabase = createPrivilegedServerSupabaseClient();
  const { data: existing, error: existingError } = await supabase.from("users").select("email").eq("id", user.userId).maybeSingle();
  if (existingError || !existing) throw new Error(existingError?.message ?? "Your profile could not be loaded.");
  if (email !== existing.email) {
    const { error: authError } = await supabase.auth.admin.updateUserById(user.userId, { email, email_confirm: true });
    if (authError) throw new Error(authError.message);
  }
  const { error } = await supabase.from("users").update({
    full_name: fullName,
    email,
    phone_number: phoneNumber || null,
    language_preference: languagePreference,
    updated_at: new Date().toISOString(),
  }).eq("id", user.userId);
  if (error) {
    if (email !== existing.email) {
      const { error: rollbackError } = await supabase.auth.admin.updateUserById(user.userId, {
        email: existing.email,
        email_confirm: true,
      });
      if (rollbackError) console.error("Profile email rollback failed:", rollbackError.message);
    }
    throw new Error(`Unable to update your profile: ${error.message}`);
  }
  if (email !== user.email) await setSessionCookies({ ...user, email });

  revalidatePath("/", "layout");
}
