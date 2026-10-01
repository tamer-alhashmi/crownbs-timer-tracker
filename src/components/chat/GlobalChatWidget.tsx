"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import type { AppUserSession } from "@/lib/auth";
import { fetchUnread } from "./chatApi";
import { useChatStore } from "./chatStore";
import { NotificationBell } from "./NotificationBell";
import { ChatWidget } from "./ChatWidget";

export function GlobalChatWidget({ user }: { user: AppUserSession }) {
  const queryClient = useQueryClient();
  const isChatOpen = useChatStore((state) => state.isChatOpen);
  const openChat = useChatStore((state) => state.openChat);
  const { data, error } = useQuery({
    queryKey: ["chat", "unread"],
    queryFn: fetchUnread,
    refetchInterval: 60_000,
  });
  const unreadCount = data?.count ?? 0;

  useEffect(() => {
    const events = new EventSource("/api/chat/events");
    events.onmessage = () => {
      void queryClient.invalidateQueries({ queryKey: ["chat"] });
    };
    return () => events.close();
  }, [queryClient]);

  return (
    <>
      <div className="fixed right-5 top-4 z-40">
        <NotificationBell data={data} error={error} />
      </div>
      {!isChatOpen && (
        <button
          type="button"
          aria-label={`Open team chat${unreadCount ? `, ${unreadCount} unread messages` : ""}`}
          onClick={() => openChat()}
          className="group fixed bottom-5 right-5 z-40 flex h-16 w-16 items-center justify-center rounded-[1.4rem] bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-700 text-white shadow-xl shadow-indigo-950/30 ring-1 ring-white/20 transition duration-200 hover:-translate-y-1 hover:shadow-2xl hover:shadow-indigo-950/35 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-600 sm:bottom-7 sm:right-7"
        >
          <MessageCircle
            aria-hidden="true"
            className="h-7 w-7 transition-transform duration-200 group-hover:scale-110"
            strokeWidth={2}
          />
          {unreadCount > 0 && (
            <span className="absolute -right-2 -top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-rose-600 px-1.5 text-[10px] font-bold text-white ring-[3px] ring-white shadow-md">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
          <span className="pointer-events-none absolute right-[calc(100%+0.75rem)] whitespace-nowrap rounded-xl bg-slate-950 px-3 py-2 text-xs font-semibold text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 max-sm:hidden">
            Open team chat
          </span>
        </button>
      )}
      <ChatWidget user={user} />
    </>
  );
}
