import { NextResponse } from "next/server";
import { getVerifiedChatSessionUser } from "@/lib/auth";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";

function isAllowedPushEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    const acceptedHosts = [
      "fcm.googleapis.com",
      "push.services.mozilla.com",
      "updates.push.services.mozilla.com",
      "web.push.apple.com",
      "notify.windows.com",
    ];
    return acceptedHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

type SubscriptionPayload = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

function isSubscriptionPayload(value: unknown): value is SubscriptionPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.endpoint !== "string" || candidate.endpoint.length > 4096) return false;
  if (typeof candidate.keys !== "object" || candidate.keys === null) return false;
  const keys = candidate.keys as Record<string, unknown>;
  return typeof keys.p256dh === "string" && keys.p256dh.length >= 32 && keys.p256dh.length <= 256
    && /^[A-Za-z0-9_-]+$/.test(keys.p256dh)
    && typeof keys.auth === "string" && keys.auth.length >= 8 && keys.auth.length <= 256
    && /^[A-Za-z0-9_-]+$/.test(keys.auth);
}

export async function POST(request: Request) {
  const user = await getVerifiedChatSessionUser();
  if (!user) return NextResponse.json({ error: "Sign in to enable push notifications." }, { status: 401 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Provide a valid push subscription." }, { status: 400 });
  }
  if (!isSubscriptionPayload(payload) || !isAllowedPushEndpoint(payload.endpoint)) {
    return NextResponse.json({ error: "Provide a valid browser push subscription." }, { status: 400 });
  }

  const supabase = createPrivilegedServerSupabaseClient();
  const values = {
    user_id: user.userId,
    endpoint: payload.endpoint,
    p256dh: payload.keys.p256dh,
    auth: payload.keys.auth,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("user_push_subscriptions")
    .upsert(values, { onConflict: "endpoint" });
  if (error) {
    console.error("Unable to save browser push subscription:", error.message);
    return NextResponse.json({ error: "Unable to save this device for push notifications." }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

export async function DELETE(request: Request) {
  const user = await getVerifiedChatSessionUser();
  if (!user) return NextResponse.json({ error: "Sign in to update push notifications." }, { status: 401 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Provide a valid push endpoint." }, { status: 400 });
  }
  if (typeof payload !== "object" || payload === null || !("endpoint" in payload)
    || typeof payload.endpoint !== "string" || !isAllowedPushEndpoint(payload.endpoint)) {
    return NextResponse.json({ error: "Provide a valid browser push endpoint." }, { status: 400 });
  }

  const supabase = createPrivilegedServerSupabaseClient();
  const { error } = await supabase.from("user_push_subscriptions")
    .delete()
    .eq("user_id", user.userId)
    .eq("endpoint", payload.endpoint);
  if (error) {
    console.error("Unable to remove browser push subscription:", error.message);
    return NextResponse.json({ error: "Unable to disable push notifications for this device." }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
