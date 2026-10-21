import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getVerifiedChatSessionUser } from "@/lib/auth";
import { hasSameOrigin } from "@/lib/chat/server";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

export async function POST(request: NextRequest) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const session = await getVerifiedChatSessionUser();
  if (!session || !["admin", "owner", "manager"].includes(session.role)) return NextResponse.json({ error: "Property management access required." }, { status: 403 });

  const supabase = createPrivilegedServerSupabaseClient();
  const { data: profile, error: profileError } = await supabase.from("users")
    .select("role")
    .eq("id", session.userId)
    .maybeSingle();
  if (profileError || profile?.role !== session.role) return NextResponse.json({ error: "Property management access could not be verified." }, { status: 403 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid room photo upload." }, { status: 400 });
  }
  const hotelId = formData.get("hotelId");
  const roomId = formData.get("roomId");
  const roomName = formData.get("roomName");
  const category = formData.get("category");
  const file = formData.get("file");
  if (typeof hotelId !== "string" || !(file instanceof File)
    || (typeof roomId !== "string" && (typeof roomName !== "string" || typeof category !== "string"))) {
    return NextResponse.json({ error: "Choose a room and photo to upload." }, { status: 400 });
  }
  const { data: hotel, error: hotelError } = await supabase.from("hotels")
    .select("id, owner_id, manager_id")
    .eq("id", hotelId)
    .maybeSingle();
  if (hotelError) return NextResponse.json({ error: `Unable to verify property access: ${hotelError.message}` }, { status: 500 });
  if (!hotel || (profile?.role === "owner" && hotel.owner_id !== session.userId) || (profile?.role === "manager" && hotel.manager_id !== session.userId)) {
    return NextResponse.json({ error: "That property is outside your management scope." }, { status: 403 });
  }
  const extension = MIME_EXTENSIONS[file.type];
  if (!extension) return NextResponse.json({ error: "Use a JPEG, PNG, WebP, or AVIF image." }, { status: 415 });
  if (file.size < 1 || file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "Room photos must be non-empty and 5 MB or smaller." }, { status: 413 });
  }

  let roomQuery = supabase.from("rooms")
    .select("id, room_photos")
    .eq("hotel_id", hotelId);
  roomQuery = typeof roomId === "string"
    ? roomQuery.eq("id", roomId)
    : roomQuery.eq("room_name", (roomName as string).trim()).eq("category", category as string);
  const { data: room, error: roomError } = await roomQuery.maybeSingle();
  if (roomError || !room) {
    return NextResponse.json({ error: roomError?.message ?? "Save the room configuration before uploading its photo." }, { status: 404 });
  }

  const path = `${hotelId}/${room.id}/${randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage.from("rooms").upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (uploadError) {
    return NextResponse.json({ error: `Could not upload the room photo: ${uploadError.message}` }, { status: 500 });
  }
  const existingPaths = Array.isArray(room.room_photos)
    ? room.room_photos.filter((photo: unknown): photo is string => typeof photo === "string")
    : [];
  const { error: updateError } = await supabase.from("rooms")
    .update({ room_photos: [...existingPaths, path] })
    .eq("id", room.id);
  if (updateError) {
    const { error: cleanupError } = await supabase.storage.from("rooms").remove([path]);
    const message = cleanupError
      ? `${updateError.message}; uploaded photo cleanup failed: ${cleanupError.message}`
      : updateError.message;
    return NextResponse.json({ error: message }, { status: 500 });
  }
  return NextResponse.json({ path }, { status: 201 });
}
