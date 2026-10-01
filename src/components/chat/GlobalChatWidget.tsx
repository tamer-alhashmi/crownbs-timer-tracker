"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import type { AppUserSession } from "@/lib/auth";
import { fetchUnread } from "./chatApi";
import { useChatStore } from "./chatStore";
import { ChatWidget } from "./ChatWidget";

export function GlobalChatWidget({ user }: { user: AppUserSession }) {
  const queryClient = useQueryClient();
  const isChatOpen = useChatStore((state) => state.isChatOpen);
  const openChat = useChatStore((state) => state.openChat);
  const { data } = useQuery({
    queryKey: ["chat", "unread"],
    queryFn: fetchUnread,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const unreadCount = data?.count ?? 0;

  useEffect(() => {
    const events = new EventSource("/api/chat/events");
    const refreshChat = () => {
      void queryClient.invalidateQueries({ queryKey: ["chat"] });
    };
    events.onmessage = refreshChat;
    events.onopen = refreshChat;
    events.onerror = refreshChat;
    return () => events.close();
  }, [queryClient]);

  return (
    <>
      {!isChatOpen && (
        <button
          type="button"
          aria-label={`Open team chat${unreadCount ? `, ${unreadCount} unread messages` : ""}`}
          onClick={() => openChat()}
          className="chat-launcher group fixed bottom-6 right-6 z-50 flex h-16 w-16 items-center justify-center rounded-full bg-[#25d366] text-[#063b2a] shadow-2xl shadow-emerald-950/30 transition hover:scale-105 hover:bg-[#20c45e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
        >
          <MessageCircle
            aria-hidden="true"
            className="h-7 w-7 transition-transform duration-200 group-hover:scale-110"
            strokeWidth={2.4}
          />
          {unreadCount > 0 && (
            <span className="chat-unread-badge absolute -right-1 -top-1 flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-white bg-rose-600 px-1 text-[10px] font-bold text-white shadow-md">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      )}
      <ChatWidget user={user} />
    </>
  );
}
