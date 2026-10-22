"use client";

import { Check, CheckCheck, CornerUpLeft, FileText, MoreHorizontal, X } from "lucide-react";
import { useState } from "react";
import type { ChatMessage } from "@/lib/chat/types";
import type { UserRole } from "@/lib/roles";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { AudioMessagePlayer } from "./AudioMessagePlayer";
import { ReactionBadges, ReactionPicker } from "./ReactionPicker";

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
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const attachmentHref = message.attachment_url
    ? `/api/chat/attachment?path=${encodeURIComponent(message.attachment_url)}`
    : undefined;

  return (
    <div
      id={`chat-message-${message.id}`}
      className={`group/message relative flex w-full min-w-0 items-end gap-2 ${isOwn ? "justify-end" : "justify-start"}`}
    >
      {!isOwn && (
        <UserAvatar
          name={senderName}
          avatarUrl={senderAvatarUrl}
          role={senderRole}
          className="mb-0.5 h-7 w-7 shrink-0 bg-white text-xs font-semibold text-slate-700 ring-1 ring-slate-200 dark:bg-[#202c33] dark:text-slate-100 dark:ring-slate-700"
        />
      )}
      <div className={`relative flex w-fit min-w-0 max-w-[82%] flex-col sm:max-w-[70%] ${isOwn ? "items-end" : "items-start"}`}>
        {showSenderName && (
          <span className="mb-1 ml-2 text-[10px] font-semibold text-emerald-800 dark:text-emerald-300">
            {senderName}
          </span>
        )}
        <div
          className={`relative w-fit min-w-0 max-w-full rounded-2xl px-3.5 py-2 shadow-sm ${
            isOwn
              ? "rounded-br-md bg-[#128c7e] text-white dark:bg-[#005c4b]"
              : "rounded-bl-md border border-slate-200/70 bg-white text-slate-900 dark:border-slate-700 dark:bg-[#202c33] dark:text-slate-100"
          }`}
        >
          {message.parent_id && (
            <button
              type="button"
              onClick={() => {
                document.getElementById(`chat-message-${message.parent_id}`)?.scrollIntoView({
                  behavior: "smooth",
                  block: "center",
                });
              }}
              className={`mb-2 block w-full min-w-0 rounded-lg border-l-2 px-2 py-1 text-left ${
                isOwn ? "border-white/60 bg-black/10" : "border-emerald-500 bg-slate-100 dark:bg-[#111b21]"
              }`}
            >
              <span className="block text-[10px] font-semibold opacity-80">
                {message.parent?.sender_id
                  ? message.parent.sender_id === message.sender_id
                    ? "You"
                    : "Original sender"
                  : "Reply"}
              </span>
              <span className="block truncate text-xs opacity-80">
                {message.parent?.content || (message.parent?.message_type === "voice" ? "Voice note" : "Message")}
              </span>
            </button>
          )}
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
            <AudioMessagePlayer src={attachmentHref} isOwn={isOwn} />
          )}
          {message.attachment_type && message.attachment_type !== "image" && message.attachment_type !== "voice" && attachmentHref && (
            <a
              href={attachmentHref}
              target="_blank"
              rel="noreferrer"
              className={`mb-2 flex min-w-0 items-center gap-2 rounded-xl p-2.5 ${
                isOwn
                  ? "bg-black/10 text-white dark:bg-black/15"
                  : "bg-slate-100 text-slate-700 dark:bg-[#111b21] dark:text-slate-100"
              }`}
            >
              <FileText className="h-5 w-5 shrink-0" />
              <span className="truncate text-xs font-medium">
                {message.attachment_type === "pdf" ? "PDF document" : "Shared file"}
              </span>
            </a>
          )}
          {message.content && (
            <p className="break-words whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">
              {message.content}
              <span className="ml-3 inline-flex translate-y-0.5 items-center gap-1 whitespace-nowrap text-[10px] leading-none">
                <time
                  dateTime={message.created_at}
                  className={isOwn ? "text-white/75" : "text-slate-500 dark:text-slate-400"}
                >
                  {new Date(message.created_at).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </time>
                {isOwn && (message.read_at || message.is_read ? (
                  <CheckCheck aria-label="Read" className="h-3.5 w-3.5 text-blue-300" />
                ) : message.delivered_at ? (
                  <CheckCheck aria-label="Delivered" className="h-3.5 w-3.5 text-white/70" />
                ) : (
                  <Check aria-label="Sent" className="h-3.5 w-3.5 text-white/70" />
                ))}
              </span>
            </p>
          )}
          {!message.content && (
            <div className="mt-1 flex items-center justify-end gap-1 text-[10px]">
              <time dateTime={message.created_at} className={isOwn ? "text-white/75" : "text-slate-500 dark:text-slate-400"}>
                {new Date(message.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              </time>
              {isOwn && (message.read_at || message.is_read ? (
                <CheckCheck aria-label="Read" className="h-3.5 w-3.5 text-blue-300" />
              ) : message.delivered_at ? (
                <CheckCheck aria-label="Delivered" className="h-3.5 w-3.5 text-white/70" />
              ) : (
                <Check aria-label="Sent" className="h-3.5 w-3.5 text-white/70" />
              ))}
            </div>
          )}
          <div className={`pointer-events-none absolute -bottom-2 ${isOwn ? "right-2" : "left-2"}`}>
            <ReactionBadges messageId={message.id} reactions={message.reactions} isOwn={isOwn} />
          </div>
        </div>
        <div
          className={`absolute -top-3 z-10 flex items-center gap-1 rounded-full border border-slate-200 bg-white p-1 shadow-md transition-opacity dark:border-slate-600 dark:bg-[#202c33] ${
            isOwn ? "right-2" : "left-2"
          } ${
            mobileActionsOpen
              ? "opacity-100"
              : "pointer-events-none opacity-0 group-hover/message:pointer-events-auto group-hover/message:opacity-100 group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100"
          }`}
        >
          {onReply && (
            <button
              type="button"
              aria-label="Reply to message"
              onClick={() => {
                onReply(message);
                setMobileActionsOpen(false);
              }}
              className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 hover:text-emerald-700 dark:hover:bg-slate-700"
            >
              <CornerUpLeft className="h-3.5 w-3.5" />
            </button>
          )}
          <ReactionPicker messageId={message.id} />
          <button
            type="button"
            aria-label="Hide message actions"
            onClick={() => setMobileActionsOpen(false)}
            className={`rounded-full p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 sm:hidden ${mobileActionsOpen ? "" : "hidden"}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <button
          type="button"
          aria-label={mobileActionsOpen ? "Hide message actions" : "Show message actions"}
          aria-expanded={mobileActionsOpen}
          onClick={() => setMobileActionsOpen((open) => !open)}
          className={`absolute -top-3 z-20 rounded-full border border-slate-200 bg-white p-1.5 text-slate-500 shadow-md dark:border-slate-600 dark:bg-[#202c33] ${
            isOwn ? "right-2" : "left-2"
          } sm:hidden ${mobileActionsOpen ? "pointer-events-none opacity-0" : "opacity-100"}`}
        >
          {mobileActionsOpen ? <X className="h-3.5 w-3.5" /> : <MoreHorizontal className="h-3.5 w-3.5" />}
        </button>
      </div>
      {isOwn && (
        <UserAvatar
          name={senderName}
          avatarUrl={senderAvatarUrl}
          role={senderRole}
          className="mb-0.5 h-7 w-7 shrink-0 bg-white text-xs font-semibold text-slate-700 ring-1 ring-slate-200 dark:bg-[#202c33] dark:text-slate-100 dark:ring-slate-700"
        />
      )}
    </div>
  );
}
