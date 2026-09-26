"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";

const BUCKET = "room-media";
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const mediaTypes: Record<string, { type: "image" | "video"; extension: string }> = {
  "image/jpeg": { type: "image", extension: "jpg" },
  "image/png": { type: "image", extension: "png" },
  "image/webp": { type: "image", extension: "webp" },
  "video/mp4": { type: "video", extension: "mp4" },
  "video/quicktime": { type: "video", extension: "mov" },
  "video/webm": { type: "video", extension: "webm" },
};

export type RoomMediaItem = {
  id: string;
  work_log_id: string;
  room_id: string;
  bucket_id: string;
  storage_path: string;
  media_type: "image" | "video";
  content_type: string;
  original_name: string;
  file_size_bytes: number;
  uploaded_by: string;
  created_at: string;
  signed_url: string;
};

export type RoomMediaGalleryItem = RoomMediaItem & { room_name: string };

type UploadMetadata = {
  workLogId: string;
  roomId: string;
  contentType: string;
  originalName: string;
  fileSizeBytes: number;
};

async function requireCleaner() {
  const user = await getSessionUser();
  if (!user || user.role !== "cleaner") throw new Error("Cleaner access is required to manage task evidence.");
  return user;
}

function validateMetadata(input: UploadMetadata) {
  const media = mediaTypes[input.contentType];
  if (!media) throw new Error("Choose a supported photo or video format.");
  if (!Number.isSafeInteger(input.fileSizeBytes) || input.fileSizeBytes <= 0 || input.fileSizeBytes > MAX_FILE_SIZE) {
    throw new Error("Files must be smaller than 50 MB.");
  }
  return media;
}

async function validateTaskRoom(workLogId: string, roomId: string, userId: string, requireSelectedRoom = true) {
  const supabase = createPrivilegedServerSupabaseClient();
  const [{ data: task, error: taskError }, { data: room, error: roomError }] = await Promise.all([
    supabase.from("work_logs").select("id, hotel_id, room_ids, user_id, status, is_locked").eq("id", workLogId).eq("user_id", userId).maybeSingle(),
    supabase.from("rooms").select("id, hotel_id, status").eq("id", roomId).maybeSingle(),
  ]);
  if (taskError || !task) throw new Error("The task was not found for your account.");
  if (roomError || !room || room.hotel_id !== task.hotel_id || room.status !== "active") {
    throw new Error("This room is not available for the task's hotel.");
  }
  if (requireSelectedRoom && !task.room_ids?.includes(room.id)) throw new Error("This room was not selected for the task.");
  if (task.status !== "active" && (task.status !== "completed" || task.is_locked)) throw new Error("Evidence can only be changed on active or unlocked tasks.");
  return { supabase, task, room };
}

export async function createRoomMediaUploadUrl(input: UploadMetadata) {
  const user = await requireCleaner();
  const media = validateMetadata(input);
  const { supabase, room } = await validateTaskRoom(input.workLogId, input.roomId, user.userId);
  const storagePath = `${room.id}/${input.workLogId}/${crypto.randomUUID()}.${media.extension}`;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(storagePath, { upsert: false });
  if (error || !data) {
    throw new Error(error?.message ?? "Unable to prepare upload. Confirm the room-media bucket migration has been applied.");
  }
  return { storagePath, token: data.token, bucketId: BUCKET, mediaType: media.type };
}

export async function saveRoomMediaRecord(input: UploadMetadata & { storagePath: string }) {
  const user = await requireCleaner();
  const media = validateMetadata(input);
  const { supabase, room } = await validateTaskRoom(input.workLogId, input.roomId, user.userId);
  const prefix = `${room.id}/${input.workLogId}/`;
  const fileName = input.storagePath.startsWith(prefix) ? input.storagePath.slice(prefix.length) : "";
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp|mp4|mov|webm)$/i.test(fileName) || !fileName.endsWith(`.${media.extension}`)) {
    throw new Error("The uploaded file path is invalid.");
  }

  const folder = `${room.id}/${input.workLogId}`;
  const { data: storedFiles, error: listError } = await supabase.storage.from(BUCKET).list(folder, { search: fileName });
  if (listError || !storedFiles?.some((file) => file.name === fileName)) {
    throw new Error("The uploaded file could not be verified in private storage.");
  }

  const { data: record, error } = await supabase.from("room_media").insert({
    work_log_id: input.workLogId,
    room_id: room.id,
    bucket_id: BUCKET,
    storage_path: input.storagePath,
    media_type: media.type,
    content_type: input.contentType,
    original_name: input.originalName.slice(0, 255),
    file_size_bytes: input.fileSizeBytes,
    uploaded_by: user.userId,
  }).select("id, work_log_id, room_id, bucket_id, storage_path, media_type, content_type, original_name, file_size_bytes, uploaded_by, created_at").single();

  if (error || !record) {
    await supabase.storage.from(BUCKET).remove([input.storagePath]);
    throw new Error(error?.message ?? "Unable to save the room media record.");
  }

  const { data: signed, error: signedError } = await supabase.storage.from(BUCKET).createSignedUrl(record.storage_path, 3600);
  if (signedError || !signed) throw new Error(signedError?.message ?? "The file uploaded, but its preview could not be created.");
  revalidatePath("/dashboard");
  return { ...record, signed_url: signed.signedUrl } as RoomMediaItem;
}

export async function deleteRoomMedia(mediaId: string) {
  const user = await requireCleaner();
  const supabase = createPrivilegedServerSupabaseClient();
  const { data: record, error: readError } = await supabase.from("room_media").select("id, work_log_id, room_id, bucket_id, storage_path, uploaded_by").eq("id", mediaId).maybeSingle();
  if (readError || !record || record.uploaded_by !== user.userId) throw new Error("This room media item cannot be deleted.");
  await validateTaskRoom(record.work_log_id, record.room_id, user.userId, false);
  const { error: storageError } = await supabase.storage.from(record.bucket_id).remove([record.storage_path]);
  if (storageError) throw new Error(storageError.message);
  const { error } = await supabase.from("room_media").delete().eq("id", mediaId).eq("uploaded_by", user.userId);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard");
}

export async function getWorkLogRoomMedia(workLogId: string): Promise<RoomMediaGalleryItem[]> {
  const user = await getSessionUser();
  if (!user) throw new Error("Sign in to view work evidence.");
  const supabase = createPrivilegedServerSupabaseClient();
  const { data: log, error: logError } = await supabase.from("work_logs").select("id, hotel_id, user_id, owner_id, manager_id").eq("id", workLogId).maybeSingle();
  if (logError || !log) throw new Error("Work log was not found.");

  let authorized = user.role === "admin" || (user.role === "cleaner" && log.user_id === user.userId);
  if (!authorized && (user.role === "owner" || user.role === "manager")) {
    const responsibilityId = user.role === "owner" ? log.owner_id : log.manager_id;
    const assignmentColumn = user.role === "owner" ? "owner_id" : "manager_id";
    const { data: hotel } = await supabase.from("hotels").select("owner_id, manager_id").eq("id", log.hotel_id).maybeSingle();
    authorized = responsibilityId === user.userId || hotel?.[assignmentColumn] === user.userId;
  }
  if (!authorized) throw new Error("You do not have access to this work evidence.");

  const { data: items, error } = await supabase.from("room_media")
    .select("id, work_log_id, room_id, bucket_id, storage_path, media_type, content_type, original_name, file_size_bytes, uploaded_by, created_at")
    .eq("work_log_id", workLogId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const signedItems = await Promise.all((items ?? []).map(async (item) => {
    const [{ data: signed, error: signedError }, { data: room }] = await Promise.all([
      supabase.storage.from(item.bucket_id).createSignedUrl(item.storage_path, 3600),
      supabase.from("rooms").select("room_name").eq("id", item.room_id).maybeSingle(),
    ]);
    if (signedError || !signed) return null;
    return { ...item, signed_url: signed.signedUrl, room_name: room?.room_name ?? "Room" };
  }));
  return signedItems.filter((item): item is NonNullable<typeof item> => item !== null) as RoomMediaGalleryItem[];
}