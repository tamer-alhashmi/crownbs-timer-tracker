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
          className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-xl shadow-indigo-900/25 transition hover:scale-105 hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        >
          <MessageCircle aria-hidden="true" className="h-6 w-6" />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-6 min-w-6 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white ring-2 ring-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      )}
      <ChatWidget user={user} />
    </>
  );
}
