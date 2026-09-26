"use client";

import imageCompression from "browser-image-compression";
import NextImage from "next/image";
import { useRef, useState } from "react";
import { Camera, Clapperboard, ImageIcon, ImagePlus, LoaderCircle, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { createRoomMediaUploadUrl, deleteRoomMedia, saveRoomMediaRecord, type RoomMediaItem } from "./roomMediaActions";

type RoomOption = { id: string; room_name: string };
type Props = { workLogId: string; rooms: RoomOption[]; initialMedia: RoomMediaItem[]; storageConfigured: boolean; uploadsEnabled?: boolean };
const MAX_VIDEO_SIZE = 50 * 1024 * 1024;

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function RoomMediaCapture({ workLogId, rooms, initialMedia, storageConfigured, uploadsEnabled = true }: Props) {
  const [locallyAddedMedia, setLocallyAddedMedia] = useState<RoomMediaItem[]>([]);
  const [locallyDeletedIds, setLocallyDeletedIds] = useState<Set<string>>(() => new Set());
  const [pendingRoomId, setPendingRoomId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const mediaById = new Map(initialMedia.map((item) => [item.id, item]));
  for (const item of locallyAddedMedia) mediaById.set(item.id, item);
  const media = [...mediaById.values()].filter((item) => !locallyDeletedIds.has(item.id));

  const appendMedia = (item: RoomMediaItem) => setLocallyAddedMedia((current) => [item, ...current.filter((existing) => existing.id !== item.id)]);

  const removeMedia = async (mediaId: string) => {
    setDeletingId(mediaId);
    setError("");
    try {
      await deleteRoomMedia(mediaId);
      setLocallyDeletedIds((current) => new Set(current).add(mediaId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to delete this file.");
    } finally {
      setDeletingId(null);
    }
  };

  if (!storageConfigured) {
    return <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Room proof storage is not configured yet. Ask an administrator to apply the room media migration.</p>;
  }

  return <section className="mt-4 border-t border-emerald-200 pt-4" aria-label="Room photo and video evidence">
    <div className="mb-3 flex items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Digital proof of work</p><p className="mt-0.5 text-xs text-emerald-900/70">Capture photos or short videos for each selected room.</p></div><Camera className="h-5 w-5 shrink-0 text-emerald-800" /></div>
    {!uploadsEnabled && <p className="mb-2 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">Save the room selection before adding evidence to newly selected rooms.</p>}
    <div className="space-y-2">{rooms.map((room) => <RoomMediaRoom key={room.id} room={room} items={media.filter((item) => item.room_id === room.id)} pending={pendingRoomId === room.id} disabled={!uploadsEnabled} deletingId={deletingId} onUploadStart={() => { setPendingRoomId(room.id); setError(""); }} onUploadEnd={() => setPendingRoomId(null)} onUploaded={appendMedia} onDelete={removeMedia} uploadFile={async (roomId, file, originalName) => {
      const metadata = { workLogId, roomId, contentType: file.type, originalName, fileSizeBytes: file.size };
      const signedUpload = await createRoomMediaUploadUrl(metadata);
      const { error: uploadError } = await createClient().storage.from(signedUpload.bucketId).uploadToSignedUrl(signedUpload.storagePath, signedUpload.token, file, { contentType: file.type, upsert: false });
      if (uploadError) throw new Error(uploadError.message);
      return saveRoomMediaRecord({ ...metadata, storagePath: signedUpload.storagePath });
    }} onError={setError} />)}</div>
    {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{error}</p>}
  </section>;
}

function RoomMediaRoom({ room, items, pending, disabled, deletingId, onUploadStart, onUploadEnd, onUploaded, onDelete, onError, uploadFile }: {
  room: RoomOption;
  items: RoomMediaItem[];
  pending: boolean;
  disabled: boolean;
  deletingId: string | null;
  onUploadStart: () => void;
  onUploadEnd: () => void;
  onUploaded: (item: RoomMediaItem) => void;
  onDelete: (id: string) => Promise<void>;
  onError: (message: string) => void;
  uploadFile: (roomId: string, file: File, originalName: string) => Promise<RoomMediaItem>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    onUploadStart();
    try {
      for (const originalFile of files) {
        let uploadFileData = originalFile;
        if (originalFile.type.startsWith("image/")) {
          const compressed = await imageCompression(originalFile, { maxSizeMB: 1, maxWidthOrHeight: 1920, useWebWorker: true, fileType: "image/jpeg" });
          uploadFileData = new File([compressed], originalFile.name, { type: compressed.type || "image/jpeg", lastModified: originalFile.lastModified });
        } else if (originalFile.size > MAX_VIDEO_SIZE) {
          throw new Error(`${originalFile.name} is larger than the 50 MB video limit.`);
        }
        onUploaded(await uploadFile(room.id, uploadFileData, originalFile.name));
      }
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Unable to upload room evidence.");
    } finally {
      onUploadEnd();
    }
  };

  return <details className="overflow-hidden rounded-lg border border-emerald-200 bg-white">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-semibold text-slate-800"><span className="min-w-0 truncate">{room.room_name}</span><span className="shrink-0 text-xs font-medium text-slate-500">{items.length} file{items.length === 1 ? "" : "s"}</span></summary>
    <div className="border-t border-slate-100 p-3">
      <input ref={inputRef} type="file" accept="image/*,video/*" capture="environment" multiple onChange={handleFiles} className="sr-only" aria-label={`Capture photos or videos for ${room.room_name}`} />
      <button type="button" disabled={pending || disabled} onClick={() => inputRef.current?.click()} className="inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"><ImagePlus className="h-4 w-4" />{pending ? <><LoaderCircle className="h-4 w-4 animate-spin" /> Uploading and saving...</> : disabled ? "Save changes before adding media" : "Capture or add media"}</button>
      {items.length > 0 && <div className="mt-3 grid grid-cols-3 gap-2">{items.map((item) => <figure key={item.id} className="relative min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100"><div className="relative aspect-square">{item.media_type === "video" ? <video src={item.signed_url} controls preload="metadata" className="h-full w-full object-cover" aria-label={`Video evidence for ${room.room_name}`} /> : <NextImage src={item.signed_url} alt={`Work evidence for ${room.room_name}`} fill unoptimized sizes="(max-width: 640px) 33vw, 160px" className="object-cover" />}</div><button type="button" disabled={deletingId === item.id} onClick={() => void onDelete(item.id)} aria-label={`Delete media for ${room.room_name}`} title="Delete media" className="absolute right-1 top-1 rounded-full bg-slate-950/80 p-1.5 text-white shadow disabled:opacity-50"><X className="h-3.5 w-3.5" /></button><figcaption className="flex items-center gap-1 px-1.5 py-1 text-[10px] text-slate-600">{item.media_type === "video" ? <Clapperboard className="h-3 w-3 shrink-0" /> : <ImageIcon className="h-3 w-3 shrink-0" />}<span className="truncate">{formatSize(item.file_size_bytes)}</span></figcaption></figure>)}</div>}
      {items.length === 0 && <p className="mt-2 text-xs text-slate-500">No evidence added for this room yet.</p>}
    </div>
  </details>;
}