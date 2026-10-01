"use client";

import { useQuery } from "@tanstack/react-query";
import { Bell, MessageCircle } from "lucide-react";
import { useState } from "react";
import { fetchUnread } from "./chatApi";
import { useChatStore } from "./chatStore";
import { roleLabel } from "@/lib/chat/types";

export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const { data, error } = useQuery({
    queryKey: ["chat", "unread"],
    queryFn: fetchUnread,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const openChat = useChatStore((state) => state.openChat);
  const unreadCount = data?.count ?? 0;

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread messages` : ""}`}
        aria-expanded={isOpen}
        title={error ? "Notifications could not be loaded" : undefined}
        onClick={() => setIsOpen((open) => !open)}
        className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="chat-unread-badge absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white ring-2 ring-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
      {isOpen && (
        <div className="absolute right-0 top-12 z-[70] w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/15">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Notifications</p>
              <p className="text-xs text-slate-500">{unreadCount} unread messages</p>
            </div>
            <MessageCircle className="h-4 w-4 text-indigo-600" />
          </div>
          {error ? (
            <p role="alert" className="px-4 py-5 text-sm text-rose-600">
              {error.message}
            </p>
          ) : data?.messages.length ? (
            <div className="max-h-80 overflow-y-auto p-2">
              {data.messages.map((message) => (
                <button
                  type="button"
                  key={message.id}
                  onClick={() => {
                    openChat(message.sender);
                    setIsOpen(false);
                  }}
                  className="flex w-full gap-3 rounded-xl p-3 text-left transition hover:bg-slate-50"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700">
                    {message.sender.full_name.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-slate-800">
                        {message.sender.full_name}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {new Date(message.created_at).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {message.content || (message.attachment_type === "image" ? "Photo" : "Attachment")}
                      <span className="ml-1 text-slate-400">· {roleLabel(message.sender.role)}</span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="px-4 py-8 text-center text-sm text-slate-500">You’re all caught up.</p>
          )}
        </div>
      )}
    </div>
  );
}
