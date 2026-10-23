import { NextResponse } from "next/server";
import { setSessionCookies } from "@/lib/auth";
import { isUserRole } from "@/lib/roles";
import { createPrivilegedServerSupabaseClient, createServerSupabaseClient } from "@/lib/supabase/server";

function loginRedirect(requestUrl: URL, reason: "callback" | "profile") {
  const loginUrl = new URL("/login", requestUrl.origin);
  loginUrl.searchParams.set("authError", reason);
  return NextResponse.redirect(loginUrl);
}

function dashboardForRole(role: string) {
  if (role === "cleaner") return "/dashboard";
  if (role === "manager") return "/manager";
  if (role === "owner") return "/owner";
  if (role === "hk_admin") return "/hk-admin";
  return "/admin";
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  if (!code) return loginRedirect(requestUrl, "callback");

  try {
    const supabase = await createServerSupabaseClient();
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) {
      console.error("[Auth Exception]:", exchangeError);
      return loginRedirect(requestUrl, "callback");
    }

    const { data: authData, error: userError } = await supabase.auth.getUser();
    if (userError || !authData.user) {
      if (userError) console.error("[Auth Callback Exception]:", userError);
      return loginRedirect(requestUrl, "callback");
    }

    const email = authData.user.email?.toLowerCase().trim();
    if (!email || !authData.user.email_confirmed_at) {
      console.error("[Auth Callback Exception]: OAuth account has no verified email.");
      return loginRedirect(requestUrl, "profile");
    }

    const privilegedSupabase = createPrivilegedServerSupabaseClient();
    const { data: emailProfiles, error: emailLookupError } = await privilegedSupabase
      .from("users")
      .select("id, email, role, primary_hotel_id")
      .ilike("email", email.replace(/[\\%_]/g, "\\$&"));

    if (emailLookupError) {
      console.error("[Auth Callback Exception]: Unable to find an app profile by verified email.", emailLookupError);
      return loginRedirect(requestUrl, "profile");
    }

    let profile = emailProfiles?.length === 1 ? emailProfiles[0] : null;
    if (emailProfiles && emailProfiles.length > 1) {
      console.error("[Auth Callback Exception]: Multiple app profiles matched the verified OAuth email.", {
        email,
        profileIds: emailProfiles.map((candidate) => candidate.id),
      });
      return loginRedirect(requestUrl, "profile");
    }

    if (!profile) {
      const { data: idProfile, error: idLookupError } = await privilegedSupabase
        .from("users")
        .select("id, email, role, primary_hotel_id")
        .eq("id", authData.user.id)
        .maybeSingle();
      if (idLookupError) {
        console.error("[Auth Callback Exception]: Unable to find an app profile by authenticated user ID.", idLookupError);
        return loginRedirect(requestUrl, "profile");
      }
      profile = idProfile;
    } else if (profile.id !== authData.user.id) {
      console.error("[Auth Callback Exception]: Verified OAuth email matched an existing app profile with a different UUID. Keeping the app profile UUID because it is the key used by existing application records.", {
        authUserId: authData.user.id,
        profileId: profile.id,
      });
    }

    if (!profile || !isUserRole(profile.role) || !profile.email) {
      if (!profile) {
        console.error("[Auth Callback] Profile not found in users table for email:", authData.user.email);
      } else {
        console.error("[Auth Callback Exception]: The app profile has an invalid role or no email.", {
          authUserId: authData.user.id,
          email,
        });
      }
      return loginRedirect(requestUrl, "profile");
    }

    await setSessionCookies({
      userId: profile.id,
      email: profile.email,
      role: profile.role,
      hotelId: profile.primary_hotel_id,
    });

    const requestedNext = requestUrl.searchParams.get("next");
    const safeNext = requestedNext?.startsWith("/") && !requestedNext.startsWith("//") && !requestedNext.includes("\\")
      ? requestedNext
      : dashboardForRole(profile.role);
    return NextResponse.redirect(new URL(safeNext, requestUrl.origin));
  } catch (error) {
    console.error("[Auth Callback Exception]:", error);
    return loginRedirect(requestUrl, "callback");
  }
}
