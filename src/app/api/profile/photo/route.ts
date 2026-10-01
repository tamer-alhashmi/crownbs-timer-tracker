import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getVerifiedChatSessionUser } from "@/lib/auth";
import { hasSameOrigin } from "@/lib/chat/server";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "profile-photos";
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function storagePathFromPublicUrl(url: string | null, userId: string) {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const markerIndex = url.indexOf(marker);
  if (markerIndex < 0) return null;
  let path: string;
  try {
    path = decodeURIComponent(url.slice(markerIndex + marker.length));
  } catch {
    return null;
  }
  return path.startsWith(`${userId}/`) ? path : null;
}

async function getProfilePhotoContext(request: Request) {
  if (!hasSameOrigin(request)) {
    return { response: NextResponse.json({ error: "Invalid request origin." }, { status: 403 }) } as const;
  }
  const user = await getVerifiedChatSessionUser();
  if (!user) {
    return { response: NextResponse.json({ error: "Authentication required." }, { status: 401 }) } as const;
  }
  return { user, supabase: createPrivilegedServerSupabaseClient() } as const;
}

export async function POST(request: NextRequest) {
  const context = await getProfilePhotoContext(request);
  if ("response" in context) return context.response;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid photo upload." }, { status: 400 });
  }
  const file = formData.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a profile photo." }, { status: 400 });
  const extension = MIME_EXTENSIONS[file.type];
  if (!extension) return NextResponse.json({ error: "Use a JPEG, PNG, or WebP image." }, { status: 415 });
  if (file.size === 0 || file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "Profile photos must be non-empty and 5 MB or smaller." }, { status: 413 });
  }

  const { data: profile, error: profileError } = await context.supabase
    .from("users")
    .select("avatar_url")
    .eq("id", context.user.userId)
    .maybeSingle();
  if (profileError || !profile) {
    console.error("Profile photo owner lookup failed:", profileError?.message);
    return NextResponse.json({ error: "Could not load your profile." }, { status: 500 });
  }

  const path = `${context.user.userId}/${randomUUID()}.${extension}`;
  const { error: uploadError } = await context.supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) {
    console.error("Profile photo upload failed:", uploadError.message);
    return NextResponse.json({ error: "Could not upload your photo. Check profile photo storage configuration." }, { status: 500 });
  }

  const { data: publicUrl } = context.supabase.storage.from(BUCKET).getPublicUrl(path);
  const { error: updateError } = await context.supabase.from("users")
    .update({ avatar_url: publicUrl.publicUrl, updated_at: new Date().toISOString() })
    .eq("id", context.user.userId);
  if (updateError) {
    await context.supabase.storage.from(BUCKET).remove([path]);
    console.error("Profile photo save failed:", updateError.message);
    return NextResponse.json({ error: "Could not save your profile photo." }, { status: 500 });
  }

  const previousPath = storagePathFromPublicUrl(profile.avatar_url, context.user.userId);
  let warning: string | undefined;
  if (previousPath) {
    const { error: removeError } = await context.supabase.storage.from(BUCKET).remove([previousPath]);
    if (removeError) {
      console.error("Previous profile photo cleanup failed:", removeError.message);
      warning = "Your new photo was saved, but the previous file could not be removed.";
    }
  }
  revalidatePath("/", "layout");
  return NextResponse.json({ avatarUrl: publicUrl.publicUrl, warning }, { status: 200 });
}

export async function DELETE(request: NextRequest) {
  const context = await getProfilePhotoContext(request);
  if ("response" in context) return context.response;

  const { data: profile, error: profileError } = await context.supabase.from("users")
    .select("avatar_url")
    .eq("id", context.user.userId)
    .maybeSingle();
  if (profileError || !profile) {
    console.error("Profile photo owner lookup failed:", profileError?.message);
    return NextResponse.json({ error: "Could not load your profile." }, { status: 500 });
  }

  const { error: updateError } = await context.supabase.from("users")
    .update({ avatar_url: null, updated_at: new Date().toISOString() })
    .eq("id", context.user.userId);
  if (updateError) {
    console.error("Profile photo removal failed:", updateError.message);
    return NextResponse.json({ error: "Could not remove your profile photo." }, { status: 500 });
  }

  const path = storagePathFromPublicUrl(profile.avatar_url, context.user.userId);
  let warning: string | undefined;
  if (path) {
    const { error: removeError } = await context.supabase.storage.from(BUCKET).remove([path]);
    if (removeError) {
      console.error("Profile photo storage cleanup failed:", removeError.message);
      warning = "Your profile photo was removed, but the file could not be deleted from storage.";
    }
  }
  revalidatePath("/", "layout");
  return NextResponse.json({ avatarUrl: null, warning });
}
