"use client";

import { Check, CheckCheck, FileText } from "lucide-react";
import type { ChatMessage } from "@/lib/chat/types";

export function MessageBubble({
  message,
  isOwn,
}: {
  message: ChatMessage;
  isOwn: boolean;
}) {
  const attachmentHref = message.attachment_url
    ? `/api/chat/attachment?path=${encodeURIComponent(message.attachment_url)}`
    : undefined;

  return (
    <div className={`flex ${isOwn ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[84%] rounded-2xl px-4 py-3 shadow-sm ${
          isOwn
            ? "rounded-br-md bg-indigo-600 text-white"
            : "rounded-bl-md border border-slate-200 bg-white text-slate-800"
        }`}
      >
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
        {message.attachment_type && message.attachment_type !== "image" && attachmentHref && (
          <a
            href={attachmentHref}
            target="_blank"
            rel="noreferrer"
            className={`mb-2 flex items-center gap-2 rounded-xl p-2.5 ${
              isOwn ? "bg-white/10 text-white" : "bg-slate-100 text-slate-700"
            }`}
          >
            <FileText className="h-5 w-5 shrink-0" />
            <span className="truncate text-xs font-medium">
              {message.attachment_type === "pdf" ? "PDF document" : "Shared file"}
            </span>
          </a>
        )}
        {message.content && (
          <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.content}</p>
        )}
        <div
          className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${
            isOwn ? "text-indigo-100" : "text-slate-400"
          }`}
        >
          <time dateTime={message.created_at}>
            {new Date(message.created_at).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })}
          </time>
          {isOwn &&
            (message.is_read ? (
              <CheckCheck aria-label="Read" className="h-3.5 w-3.5 text-sky-200" />
            ) : (
              <Check aria-label="Sent" className="h-3.5 w-3.5" />
            ))}
        </div>
      </div>
    </div>
  );
}
