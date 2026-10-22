"use client";

import { Check, CheckCheck, CornerUpLeft, FileText } from "lucide-react";
import type { ChatMessage } from "@/lib/chat/types";
import type { UserRole } from "@/lib/roles";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { AudioMessagePlayer } from "./AudioMessagePlayer";
import { ReactionPicker } from "./ReactionPicker";

export function MessageBubble({
  message,
  isOwn,
  senderName,
  senderAvatarUrl,
  senderRole,
  onReply,
  showSenderName = false,
}: {
  message: ChatMessage;
  isOwn: boolean;
  senderName: string;
  senderAvatarUrl: string | null;
  senderRole: UserRole;
  onReply?: (message: ChatMessage) => void;
  showSenderName?: boolean;
}) {
  const attachmentHref = message.attachment_url
    ? `/api/chat/attachment?path=${encodeURIComponent(message.attachment_url)}`
    : undefined;

  return (
    <div id={`chat-message-${message.id}`} className={`group flex items-end gap-1.5 ${isOwn ? "justify-end" : "justify-start"}`}>
      {!isOwn && <UserAvatar name={senderName} avatarUrl={senderAvatarUrl} role={senderRole} className="mb-0.5 h-7 w-7 bg-white text-xs font-semibold text-slate-700 ring-1 ring-slate-200 dark:bg-[#202c33] dark:text-slate-100 dark:ring-slate-700" />}
      <div className={`flex max-w-[86%] flex-col ${isOwn ? "items-end" : "items-start"}`}>
      {showSenderName && <span className="mb-1 ml-2 text-[10px] font-semibold text-emerald-800 dark:text-emerald-300">{senderName}</span>}
      <div
        className={`relative max-w-[80%] rounded-2xl px-3.5 py-2.5 shadow-sm ${
          isOwn
            ? "rounded-br-md bg-[#128c7e] text-white dark:bg-[#005c4b]"
            : "rounded-bl-md border border-slate-200/70 bg-white text-slate-900 dark:border-slate-700 dark:bg-[#202c33] dark:text-slate-100"
        }`}
      >
        <span
          aria-hidden="true"
          className={`absolute -bottom-0.5 h-3 w-3 rotate-45 ${
            isOwn
              ? "right-0.5 bg-[#128c7e] dark:bg-[#005c4b]"
              : "left-0.5 bg-white dark:bg-[#202c33]"
          }`}
        />
        {message.attachment_type === "image" && attachmentHref && (
          <a href={attachmentHref} target="_blank" rel="noreferrer" className="mb-2 block">
            {/* Native image loading preserves private signed-URL redirects through the API. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={attachmentHref}
              alt="Shared image"
              className="max-h-56 w-full rounded-xl object-cover"
            />
          </a>
        )}
        {message.attachment_type === "voice" && attachmentHref && (
          <AudioMessagePlayer src={attachmentHref} durationSeconds={message.duration_seconds} isOwn={isOwn} />
        )}
        {message.attachment_type && message.attachment_type !== "image" && message.attachment_type !== "voice" && attachmentHref && (
          <a
            href={attachmentHref}
            target="_blank"
            rel="noreferrer"
            className={`mb-2 flex items-center gap-2 rounded-xl p-2.5 ${
              isOwn
                ? "bg-black/10 text-white dark:bg-black/15"
                : "bg-slate-100 text-slate-700 dark:bg-[#111b21] dark:text-slate-100"
            }`}
          >
            <FileText className="h-5 w-5 shrink-0" />
            <span className="truncate text-xs font-medium">
              {message.attachment_type === "pdf" ? "PDF document" : "Shared file"}
            </span>
            {message.parent_id && (
              <button type="button" onClick={() => {
                document.getElementById(`chat-message-${message.parent_id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
              }} className={`mb-2 block w-full rounded-lg border-l-2 px-2 py-1 text-left ${isOwn ? "border-white/60 bg-black/10" : "border-emerald-500 bg-slate-100 dark:bg-[#111b21]"}`}>
                <span className="block text-[10px] font-semibold opacity-80">{message.parent?.sender_id
                  ? ((message.parent.sender_id === message.sender_id) === isOwn ? "You" : senderName)
                  : "Reply"}</span>
                <span className="block truncate text-xs opacity-80">{message.parent?.content || (message.parent?.message_type === "voice" ? "Voice note" : "Message")}</span>
              </button>
            )}
          </a>
        )}
        {message.content && (
          <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.content}</p>
        )}
        <div
          className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${
            isOwn ? "text-white/80" : "text-slate-500 dark:text-slate-400"
          }`}
        >
          <time dateTime={message.created_at}>
            {new Date(message.created_at).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })}
          </time>
          {isOwn && (message.read_at || message.is_read ? (
            <CheckCheck aria-label="Read" className="h-3.5 w-3.5 text-blue-500" />
          ) : message.delivered_at ? (
            <CheckCheck aria-label="Delivered" className="h-3.5 w-3.5 text-slate-400" />
          ) : (
            <Check aria-label="Sent" className="h-3.5 w-3.5 text-slate-400" />
          ))}
        </div>
      </div>
      <div className={`mt-1 flex items-center gap-1 ${isOwn ? "justify-end" : "justify-start"}`}>
        {onReply && <button type="button" aria-label="Reply to message" onClick={() => onReply(message)} className="rounded-full p-1 text-slate-400 opacity-70 hover:bg-white hover:text-emerald-700 group-hover:opacity-100"><CornerUpLeft className="h-3.5 w-3.5" /></button>}
        <ReactionPicker messageId={message.id} reactions={message.reactions} />
      </div>
      </div>
      {isOwn && <UserAvatar name={senderName} avatarUrl={senderAvatarUrl} role={senderRole} className="mb-0.5 h-7 w-7 bg-white text-xs font-semibold text-slate-700 ring-1 ring-slate-200 dark:bg-[#202c33] dark:text-slate-100 dark:ring-slate-700" />}
    </div>
  );
}
