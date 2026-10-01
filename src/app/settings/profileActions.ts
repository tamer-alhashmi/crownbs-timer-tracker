"use server";

import { revalidatePath } from "next/cache";
import { getVerifiedChatSessionUser } from "@/lib/auth";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";

export async function savePersonalProfile(input: { fullName: string; phoneNumber: string }) {
  const user = await getVerifiedChatSessionUser();
  if (!user) throw new Error("Your session has expired. Sign in again to update your profile.");

  const fullName = input.fullName.trim();
  const phoneNumber = input.phoneNumber.trim();
  if (!fullName || fullName.length > 120) throw new Error("Enter a name between 1 and 120 characters.");
  if (phoneNumber.length > 32 || (phoneNumber && !/^[+()\d\s.-]{5,32}$/.test(phoneNumber))) {
    throw new Error("Enter a valid phone number or leave it blank.");
  }

  const supabase = createPrivilegedServerSupabaseClient();
  const { error } = await supabase.from("users").update({
    full_name: fullName,
    phone_number: phoneNumber || null,
    updated_at: new Date().toISOString(),
  }).eq("id", user.userId);
  if (error) throw new Error(`Unable to update your profile: ${error.message}`);

  revalidatePath("/", "layout");
}
