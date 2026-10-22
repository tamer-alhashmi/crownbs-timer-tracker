"use client";

import { CornerUpLeft, X } from "lucide-react";

export type ReplyTarget = {
  id: string;
  content: string;
  senderName: string;
  messageType?: string;
};

export function ReplyPreview({ reply, onCancel }: { reply: ReplyTarget | null; onCancel: () => void }) {
  if (!reply) return null;
  return (
    <div className="flex items-center gap-2 border-l-4 border-emerald-600 bg-white/90 px-3 py-2 dark:bg-[#182229]">
      <CornerUpLeft className="h-4 w-4 shrink-0 text-emerald-700" />
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">Replying to {reply.senderName}</span>
        <span className="block truncate text-xs text-slate-600 dark:text-slate-300">{reply.content || (reply.messageType === "voice" ? "Voice note" : "Message")}</span>
      </span>
      <button type="button" aria-label="Cancel reply" onClick={onCancel} className="rounded-full p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"><X className="h-4 w-4" /></button>
    </div>
  );
}
