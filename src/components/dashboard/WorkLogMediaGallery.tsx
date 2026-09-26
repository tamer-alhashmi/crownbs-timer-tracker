"use client";

import NextImage from "next/image";
import { useEffect, useState } from "react";
import { Clapperboard, ImageIcon, LoaderCircle, X } from "lucide-react";
import { getWorkLogRoomMedia, type RoomMediaGalleryItem } from "@/app/(cleaner)/dashboard/roomMediaActions";

export function WorkLogMediaGallery({ workLogId }: { workLogId: string }) {
  const [items, setItems] = useState<RoomMediaGalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<RoomMediaGalleryItem | null>(null);

  useEffect(() => {
    let cancelled = false;
    getWorkLogRoomMedia(workLogId).then((result) => {
      if (!cancelled) setItems(result);
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load work evidence.");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [workLogId]);

  return <section className="mt-4 rounded-xl border border-slate-200 p-4" aria-label="Work evidence gallery">
    <div className="flex items-center justify-between gap-3"><div><h3 className="font-semibold text-slate-900">Room media</h3><p className="text-xs text-slate-500">Photo and video evidence attached by room</p></div><span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{items.length}</span></div>
    {loading && <p className="mt-3 flex items-center gap-2 text-sm text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" /> Loading media...</p>}
    {error && <p className="mt-3 text-sm text-amber-800">{error}</p>}
    {!loading && !error && items.length === 0 && <p className="mt-3 text-sm text-slate-500">No photos or videos were submitted for this task.</p>}
    {items.length > 0 && <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{items.map((item) => <button key={item.id} type="button" onClick={() => setSelected(item)} className="group overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-left hover:border-sky-300"><span className="relative block aspect-square">{item.media_type === "video" ? <><video src={item.signed_url} preload="metadata" className="h-full w-full object-cover" aria-label={`Video proof for ${item.room_name}`} /><span className="absolute inset-0 grid place-items-center bg-slate-950/15 text-white"><Clapperboard className="h-7 w-7" /></span></> : <NextImage src={item.signed_url} alt={`Work proof for ${item.room_name}`} fill unoptimized sizes="(max-width: 640px) 50vw, 180px" className="object-cover transition group-hover:scale-[1.02]" />}</span><span className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-slate-600"><span className="truncate font-medium text-slate-800">{item.room_name}</span><span className="shrink-0">·</span>{item.media_type === "video" ? <Clapperboard className="h-3.5 w-3.5 shrink-0" /> : <ImageIcon className="h-3.5 w-3.5 shrink-0" />}</span></button>)}</div>}
    {selected && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/90 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={`Room evidence for ${selected.room_name}`} onClick={() => setSelected(null)}><div className="relative flex max-h-full w-full max-w-5xl flex-col items-center" onClick={(event) => event.stopPropagation()}><div className="mb-3 flex w-full items-center justify-between gap-3 text-white"><p className="truncate text-sm font-semibold">{selected.room_name} <span className="font-normal text-slate-300">· {selected.original_name}</span></p><button type="button" onClick={() => setSelected(null)} aria-label="Close media viewer" className="rounded-lg bg-white/10 p-2 hover:bg-white/20"><X className="h-5 w-5" /></button></div>{selected.media_type === "video" ? <video src={selected.signed_url} controls autoPlay className="max-h-[78vh] max-w-full rounded-lg" /> : <NextImage src={selected.signed_url} alt={`Work proof for ${selected.room_name}`} width={1800} height={1400} unoptimized className="max-h-[78vh] h-auto w-auto max-w-full rounded-lg object-contain" />}</div></div>}
  </section>;
}