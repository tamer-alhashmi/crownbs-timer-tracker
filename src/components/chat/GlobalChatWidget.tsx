"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, X } from "lucide-react";
import type { AppUserSession } from "@/lib/auth";
import type { UnreadMessage } from "@/lib/chat/types";
import { fetchUnread } from "./chatApi";
import { useChatStore } from "./chatStore";
import { ChatWidget } from "./ChatWidget";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { useSoundSettings } from "./ChatProviders";
import { playChatSound } from "./chatSound";
import { ActiveCallModal } from "./ActiveCallModal";
import { ChatErrorBoundary } from "./ChatErrorBoundary";

function GlobalChatWidgetContent({ user, profile }: { user: AppUserSession; profile: { name: string; avatarUrl: string | null; role: AppUserSession["role"] } }) {
  const queryClient = useQueryClient();
  const sessionUserId = useChatStore((state) => state.sessionUserId);
  const isChatOpen = useChatStore((state) => state.isChatOpen);
  const activeContact = useChatStore((state) => state.activeContact);
  const openChat = useChatStore((state) => state.openChat);
  const { soundNotificationsEnabled } = useSoundSettings();
  const [toast, setToast] = useState<UnreadMessage | null>(null);
  const seenMessageIds = useRef<Set<string> | null>(null);
  const toastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { data } = useQuery({
    queryKey: ["chat", "unread"],
    queryFn: fetchUnread,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const unreadCount = data?.count ?? 0;

  useLayoutEffect(() => {
    useChatStore.getState().setSessionUser(user.userId);
    return () => {
      if (useChatStore.getState().sessionUserId === user.userId) {
        useChatStore.getState().resetChat();
      }
      if (toastTimeout.current) clearTimeout(toastTimeout.current);
    };
  }, [user.userId]);

  useEffect(() => {
    const events = new EventSource("/api/chat/events");
    const refreshChat = () => {
      void queryClient.invalidateQueries({ queryKey: ["chat"] });
      void queryClient.invalidateQueries({ queryKey: ["tasks", "notifications"] });
    };
    const closeEvents = () => events.close();
    events.onmessage = refreshChat;
    events.onopen = refreshChat;
    window.addEventListener("app:signout", closeEvents);
    return () => {
      window.removeEventListener("app:signout", closeEvents);
      events.close();
    };
  }, [queryClient]);

  useEffect(() => {
    if (!data) return;
    const currentIds = new Set(data.messages.map((message) => message.id));
    if (!seenMessageIds.current) {
      seenMessageIds.current = currentIds;
      return;
    }
    const newMessage = data.messages.find((message) => !seenMessageIds.current?.has(message.id));
    seenMessageIds.current = currentIds;
    if (!newMessage || (isChatOpen && activeContact?.id === newMessage.sender_id)) return;

    setToast(newMessage);
    if (toastTimeout.current) clearTimeout(toastTimeout.current);
    toastTimeout.current = setTimeout(() => setToast(null), 6000);
    if (soundNotificationsEnabled) playChatSound("received");
  }, [activeContact?.id, data, isChatOpen, soundNotificationsEnabled]);

  if (sessionUserId !== user.userId) return null;

  return (
    <>
      {toast && (
        <div role="status" aria-live="polite" className="fixed right-4 top-4 z-[80] flex w-[min(22rem,calc(100vw-2rem))] items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl shadow-slate-900/15">
          <button
            type="button"
            onClick={() => {
              openChat(toast.sender);
              setToast(null);
            }}
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
          >
            <UserAvatar name={toast.sender.full_name} avatarUrl={toast.sender.avatar_url} role={toast.sender.role} className="h-10 w-10 bg-emerald-100 text-sm font-semibold text-emerald-800" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-slate-900">{toast.sender.full_name}</span>
              <span className="block truncate text-xs text-slate-600">{toast.content || (toast.attachment_type === "image" ? "Shared a photo" : "Shared an attachment")}</span>
            </span>
          </button>
          <button type="button" aria-label="Dismiss chat notification" onClick={() => setToast(null)} className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
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
      <ChatWidget user={user} profile={profile} />
      <ActiveCallModal userId={user.userId} />
    </>
  );
}

export function GlobalChatWidget({ user, profile }: { user: AppUserSession; profile: { name: string; avatarUrl: string | null; role: AppUserSession["role"] } }) {
  return (
    <ChatErrorBoundary>
      <GlobalChatWidgetContent user={user} profile={profile} />
    </ChatErrorBoundary>
  );
}
