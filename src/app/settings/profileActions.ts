"use server";

import { createHmac, randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { render } from "@react-email/render";
import { Resend } from "resend";
import { getVerifiedChatSessionUser, setSessionCookies } from "@/lib/auth";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";
import { BrandedEmail } from "@/components/email/BrandedEmail";

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
  if (email !== existing.email.toLowerCase()) throw new Error("Verify a new email address before changing your account email.");
  const { error } = await supabase.from("users").update({
    full_name: fullName,
    phone_number: phoneNumber || null,
    language_preference: languagePreference,
    updated_at: new Date().toISOString(),
  }).eq("id", user.userId);
  if (error) throw new Error(`Unable to update your profile: ${error.message}`);

  revalidatePath("/", "layout");
}

export async function requestEmailVerification(rawEmail: string) {
  const user = await getVerifiedChatSessionUser();
  if (!user) throw new Error("Your session has expired. Sign in again to verify your email.");

  const email = rawEmail.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid personal email address.");
  }

  const supabase = createPrivilegedServerSupabaseClient();
  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("email, email_verified")
    .eq("id", user.userId)
    .maybeSingle();
  if (profileError || !profile) throw new Error(profileError?.message ?? "Your account could not be loaded.");
  if (profile.email_verified && profile.email.toLowerCase() === email) {
    throw new Error("This email address is already verified.");
  }

  const { data: duplicate, error: duplicateError } = await supabase.from("users")
    .select("id")
    .eq("email", email)
    .neq("id", user.userId)
    .maybeSingle();
  if (duplicateError) throw new Error(`Unable to check email availability: ${duplicateError.message}`);
  if (duplicate) throw new Error("That email address is already linked to another account.");

  const resendKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  const digestSecret = process.env.EMAIL_OTP_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!resendKey || !fromEmail || !digestSecret) {
    throw new Error("Email verification is not configured. Contact your administrator.");
  }

  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const codeHash = createHmac("sha256", digestSecret)
    .update(`${user.userId}:${email}:${code}`)
    .digest("hex");
  const { data: verificationId, error: insertError } = await supabase.rpc("create_email_verification_code", {
    p_user_id: user.userId,
    p_new_email: email,
    p_code_hash: codeHash,
  });
  if (insertError) throw new Error(`Unable to create a verification code: ${insertError.message}`);
  if (!verificationId) throw new Error("Wait 60 seconds before requesting another verification code.");

  const resend = new Resend(resendKey);
  const { error: sendError } = await resend.emails.send({
    from: fromEmail,
    to: email,
    subject: "Verify your email address",
    html: await render(BrandedEmail({
      preview: "Your email verification code expires in 10 minutes.",
      title: "Verify your email",
      greeting: "You requested to link this address to your CrownBS account.",
      description: "Enter the following one-time code in Settings to verify your email address.",
      verificationCode: code,
    })),
  });
  if (sendError) {
    throw new Error(`Unable to send the verification email: ${sendError.message}`);
  }
}

export async function verifyEmailAddress(rawEmail: string, rawCode: string) {
  const user = await getVerifiedChatSessionUser();
  if (!user) throw new Error("Your session has expired. Sign in again to verify your email.");

  const email = rawEmail.trim().toLowerCase();
  const code = rawCode.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(code)) {
    throw new Error("Enter a valid email address and six-digit code.");
  }

  const digestSecret = process.env.EMAIL_OTP_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!digestSecret) throw new Error("Email verification is not configured. Contact your administrator.");

  const codeHash = createHmac("sha256", digestSecret)
    .update(`${user.userId}:${email}:${code}`)
    .digest("hex");
  const supabase = createPrivilegedServerSupabaseClient();
  const { data, error } = await supabase.rpc("complete_email_verification", {
    p_user_id: user.userId,
    p_new_email: email,
    p_code_hash: codeHash,
  });
  if (error) throw new Error(`Unable to verify your email: ${error.message}`);
  if (data === "invalid") throw new Error("That code is invalid or expired. Request a new code and try again.");
  if (data === "email_taken") throw new Error("That email address is already linked to another account.");
  if (data !== "verified") throw new Error("Your account could not be verified. Sign in again and retry.");

  await setSessionCookies({ ...user, email });
  revalidatePath("/", "layout");
}

export async function saveDigestPreferences(preferences: { weekly: boolean; monthly: boolean }) {
  const user = await getVerifiedChatSessionUser();
  if (!user) throw new Error("Your session has expired. Sign in again to update digest preferences.");
  if (typeof preferences.weekly !== "boolean" || typeof preferences.monthly !== "boolean") {
    throw new Error("Choose valid email digest preferences.");
  }

  const supabase = createPrivilegedServerSupabaseClient();
  const { data: profile, error: profileError } = await supabase.from("users")
    .select("email_verified")
    .eq("id", user.userId)
    .maybeSingle();
  if (profileError || !profile) throw new Error(profileError?.message ?? "Your account could not be loaded.");
  if (!profile.email_verified) throw new Error("Verify your email before enabling executive digests.");

  const { error } = await supabase.from("users").update({
    weekly_digest_enabled: preferences.weekly,
    monthly_digest_enabled: preferences.monthly,
    updated_at: new Date().toISOString(),
  }).eq("id", user.userId);
  if (error) throw new Error(`Unable to save digest preferences: ${error.message}`);
  revalidatePath("/settings");
}

export async function saveSoundNotificationsPreference(enabled: boolean) {
  const user = await getVerifiedChatSessionUser();
  if (!user) throw new Error("Your session has expired. Sign in again to update your preferences.");
  if (typeof enabled !== "boolean") throw new Error("Choose whether notification sounds are enabled.");

  const supabase = createPrivilegedServerSupabaseClient();
  const { error } = await supabase
    .from("users")
    .update({ sound_notifications_enabled: enabled })
    .eq("id", user.userId);
  if (error) throw new Error(`Unable to update notification sounds: ${error.message}`);

  revalidatePath("/", "layout");
}
