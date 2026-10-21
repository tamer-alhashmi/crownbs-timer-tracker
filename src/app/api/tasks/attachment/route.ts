import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const BUCKET = "chat_attachments";
const MAX_FILE_SIZE = 8 * 1024 * 1024;
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const session = await getSessionUser();
  if (!session || !["owner", "manager", "hk_admin"].includes(session.role)) {
    return NextResponse.json({ error: "Task dispatch access required." }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid photo upload." }, { status: 400 });
  }
  const file = formData.get("file");
  const hotelId = formData.get("hotelId");
  if (!(file instanceof File) || typeof hotelId !== "string" || !/^[0-9a-f-]{36}$/i.test(hotelId)) {
    return NextResponse.json({ error: "A photo and valid property are required." }, { status: 400 });
  }
  if (!EXTENSIONS[file.type]) {
    return NextResponse.json({ error: "Choose a JPG, PNG, or WebP photo." }, { status: 415 });
  }
  if (file.size === 0 || file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "Choose a non-empty JPG, PNG, or WebP photo smaller than 8 MB." }, { status: 413 });
  }

  const supabase = createPrivilegedServerSupabaseClient();
  const { data: actor, error: actorError } = await supabase.from("users").select("id, role, primary_hotel_id").eq("id", session.userId).maybeSingle();
  if (actorError) {
    console.error("Task photo account lookup failed:", actorError.message);
    return NextResponse.json({ error: "Could not verify your account." }, { status: 500 });
  }
  if (!actor || actor.role !== session.role) return NextResponse.json({ error: "Your session is no longer valid." }, { status: 403 });
  const { data: hotel, error: hotelError } = await supabase.from("hotels").select("id, owner_id, manager_id, is_active").eq("id", hotelId).maybeSingle();
  if (hotelError) {
    console.error("Task photo property lookup failed:", hotelError.message);
    return NextResponse.json({ error: "Could not verify the property." }, { status: 500 });
  }
  if (!hotel || !hotel.is_active
    || (actor.role === "owner" && hotel.owner_id !== actor.id)) {
    return NextResponse.json({ error: "That property is outside your assignment scope." }, { status: 403 });
  }
  if (actor.role === "manager" || actor.role === "hk_admin") {
    const { data: assignment, error: assignmentError } = await supabase.from("user_hotel_assignments").select("hotel_id").eq("user_id", actor.id).eq("hotel_id", hotel.id).maybeSingle();
    if (assignmentError) {
      console.error("Task photo assignment lookup failed:", assignmentError.message);
      return NextResponse.json({ error: "Could not verify your hotel assignment." }, { status: 500 });
    }
    const managerPropertyMatch = actor.role !== "manager" || hotel.manager_id === actor.id;
    if (actor.role === "manager" && !managerPropertyMatch && actor.primary_hotel_id !== hotel.id && !assignment) {
      return NextResponse.json({ error: "That property is outside your assignment scope." }, { status: 403 });
    }
    if (actor.role === "hk_admin" && actor.primary_hotel_id !== hotel.id && !assignment) {
      return NextResponse.json({ error: "That property is outside your assignment scope." }, { status: 403 });
    }
  }

  const path = `${actor.id}/task-dispatch/${randomUUID()}.${EXTENSIONS[file.type]}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) {
    console.error("Task photo upload failed:", error.message);
    return NextResponse.json({ error: "Could not upload the photo. Check attachment storage configuration." }, { status: 500 });
  }
  return NextResponse.json({ path }, { status: 201 });
}

export async function GET(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const taskId = request.nextUrl.searchParams.get("taskId");
  const path = request.nextUrl.searchParams.get("path");
  if (!taskId || !path) return NextResponse.json({ error: "Task photo not found." }, { status: 404 });

  const supabase = createPrivilegedServerSupabaseClient();
  const { data: task, error } = await supabase
    .from("work_logs")
    .select("assigned_to, assigned_by, dispatch_metadata")
    .eq("id", taskId)
    .maybeSingle();
  if (error) {
    console.error("Task photo authorization lookup failed:", error.message);
    return NextResponse.json({ error: "Could not access task photo." }, { status: 500 });
  }
  const authorized = task && (task.assigned_to === session.userId || task.assigned_by === session.userId);
  const metadata = task?.dispatch_metadata as { photoPath?: string } | null;
  if (!authorized || metadata?.photoPath !== path || !/^[0-9a-f-]{36}\/task-dispatch\/[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(path)) {
    return NextResponse.json({ error: "Task photo not found." }, { status: 404 });
  }
  const { data, error: signedError } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60);
  if (signedError || !data) {
    console.error("Task photo URL creation failed:", signedError?.message);
    return NextResponse.json({ error: "Could not access task photo." }, { status: 500 });
  }
  return NextResponse.redirect(data.signedUrl, { status: 302 });
}

export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const session = await getSessionUser();
  if (!session || !["owner", "manager", "hk_admin"].includes(session.role)) {
    return NextResponse.json({ error: "Task dispatch access required." }, { status: 403 });
  }
  let body: { path?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid photo cleanup request." }, { status: 400 });
  }
  const path = body.path;
  if (typeof path !== "string" || !path.startsWith(`${session.userId}/task-dispatch/`)
    || !/^[0-9a-f-]{36}\/task-dispatch\/[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(path)) {
    return NextResponse.json({ error: "Task photo not found." }, { status: 404 });
  }
  const supabase = createPrivilegedServerSupabaseClient();
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) {
    console.error("Orphaned task photo cleanup failed:", error.message);
    return NextResponse.json({ error: "Could not remove the unused task photo." }, { status: 500 });
  }
  return NextResponse.json({ removed: true });
}
