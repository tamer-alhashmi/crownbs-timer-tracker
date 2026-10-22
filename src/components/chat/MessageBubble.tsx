"use client";

import { Check, CheckCheck, Copy, CornerUpLeft, FileText, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type TouchEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ChatMessage } from "@/lib/chat/types";
import type { UserRole } from "@/lib/roles";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { AudioMessagePlayer } from "./AudioMessagePlayer";
import { ReactionBadges, ReactionPicker } from "./ReactionPicker";
import { deleteChatMessage, toggleMessageReaction } from "./chatApi";
import { safeChatError } from "./chatErrors";

export function MessageBubble({
  message,
  isOwn,
  senderName,
  senderAvatarUrl,
  senderRole,
  onReply,
  showAvatar = false,
  showSenderName = false,
}: {
  message: ChatMessage;
  isOwn: boolean;
  senderName: string;
  senderAvatarUrl: string | null;
  senderRole: UserRole;
  onReply?: (message: ChatMessage) => void;
  showAvatar?: boolean;
  showSenderName?: boolean;
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const [actionError, setActionError] = useState("");
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryClient = useQueryClient();
  const attachmentHref = message.attachment_url
    ? `/api/chat/attachment?path=${encodeURIComponent(message.attachment_url)}`
    : undefined;

  const clearLongPress = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };

  const openActions = () => {
    setActionsOpen(true);
    setActionError("");
    if (typeof navigator !== "undefined") navigator.vibrate?.(40);
  };

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest("button, a, input")) return;
    clearLongPress();
    longPressTimer.current = setTimeout(openActions, 450);
  };

  useEffect(() => () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }, []);

  const handleTouchEnd = () => clearLongPress();
  const handleTouchMove = () => {
    clearLongPress();
  };

  const copyMessage = async () => {
    if (!message.content) {
      setActionError("This message has no text to copy.");
      return;
    }
    try {
      await navigator.clipboard.writeText(message.content);
      setActionsOpen(false);
    } catch (cause) {
      setActionError(safeChatError(cause, "Couldn't copy this message. Please try again."));
    }
  };

  const addQuickReaction = async (emoji: string) => {
    try {
      await toggleMessageReaction(message.id, emoji);
      await queryClient.invalidateQueries({ queryKey: ["chat", "history"] });
      setActionsOpen(false);
    } catch (cause) {
      setActionError(safeChatError(cause, "Couldn't add your reaction. Please try again."));
    }
  };

  const removeMessage = async () => {
    if (!window.confirm("Delete this message?")) return;
    try {
      await deleteChatMessage(message.id);
      await queryClient.invalidateQueries({ queryKey: ["chat"] });
      setActionsOpen(false);
    } catch (cause) {
      setActionError(safeChatError(cause, "Couldn't delete this message. Please try again."));
    }
  };

  return (
    <>
      {actionsOpen && (
        <button
          type="button"
          aria-label="Dismiss message actions"
          onClick={() => setActionsOpen(false)}
          className="fixed inset-0 z-30 cursor-default bg-slate-950/10"
        />
      )}
      <div
        id={`chat-message-${message.id}`}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
        onTouchCancel={handleTouchEnd}
        onContextMenu={(event) => {
          event.preventDefault();
          openActions();
        }}
        className={`group/message relative flex w-full min-w-0 items-end gap-2 ${isOwn ? "justify-end" : "justify-start"}`}
      >
      {showAvatar && !isOwn && (
        <UserAvatar
          name={senderName}
          avatarUrl={senderAvatarUrl}
          role={senderRole}
          className="mb-0.5 h-7 w-7 shrink-0 bg-white text-xs font-semibold text-slate-700 ring-1 ring-slate-200 dark:bg-[#202c33] dark:text-slate-100 dark:ring-slate-700"
        />
      )}
      <div className={`relative flex w-fit min-w-0 max-w-[85%] flex-col sm:max-w-[75%] ${isOwn ? "items-end" : "items-start"}`}>
        {showSenderName && (
          <span className="mb-1 ml-2 text-[10px] font-semibold text-emerald-800 dark:text-emerald-300">
            {senderName}
          </span>
        )}
        <div
          className={`relative w-fit min-w-0 max-w-[85%] rounded-2xl px-3.5 py-2 shadow-sm sm:max-w-[75%] ${
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
            <div className="mt-1 flex items-center justify-end gap-1 pb-0.5 pr-0.5 text-[10px]">
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
        {actionsOpen && (
          <div
            role="group"
            aria-label="Message actions"
            onTouchStart={(event: TouchEvent<HTMLDivElement>) => event.stopPropagation()}
            className="absolute bottom-full left-1/2 z-40 mb-2 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-600 dark:bg-[#202c33]"
          >
            <div className="flex items-center justify-center gap-1 border-b border-slate-100 pb-2 dark:border-slate-700">
              {["👍", "❤️", "😂", "😮", "😢", "🙏"].map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={`React ${emoji}`}
                  onClick={() => void addQuickReaction(emoji)}
                  className="rounded-full p-1.5 text-lg transition hover:scale-110 hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  {emoji}
                </button>
              ))}
              <ReactionPicker messageId={message.id} trigger="plus" />
            </div>
            <div className="flex items-center justify-center gap-1 pt-1">
              {onReply && (
                <button type="button" onClick={() => { onReply(message); setActionsOpen(false); }} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700">
                  <CornerUpLeft className="h-3.5 w-3.5" /> Reply
                </button>
              )}
              {message.content && (
                <button type="button" onClick={() => void copyMessage()} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700">
                  <Copy className="h-3.5 w-3.5" /> Copy
                </button>
              )}
              {isOwn && (
                <button type="button" onClick={() => void removeMessage()} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/40">
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </button>
              )}
            </div>
            {actionError && <p role="alert" className="px-2 pt-1 text-center text-[11px] text-rose-700">{actionError}</p>}
          </div>
        )}
      </div>
      {showAvatar && isOwn && (
        <UserAvatar
          name={senderName}
          avatarUrl={senderAvatarUrl}
          role={senderRole}
          className="mb-0.5 h-7 w-7 shrink-0 bg-white text-xs font-semibold text-slate-700 ring-1 ring-slate-200 dark:bg-[#202c33] dark:text-slate-100 dark:ring-slate-700"
        />
      )}
      </div>
    </>
  );
}
