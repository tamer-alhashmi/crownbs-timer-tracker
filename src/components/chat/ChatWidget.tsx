"use client";

import { MessageCircle, Minus, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { AppUserSession } from "@/lib/auth";
import { roleLabel } from "@/lib/chat/types";
import { fetchUnread } from "./chatApi";
import { useChatStore } from "./chatStore";
import { ContactList } from "./ContactList";
import { ConversationView } from "./ConversationView";

export function ChatWidget({ user }: { user: AppUserSession }) {
  const isChatOpen = useChatStore((state) => state.isChatOpen);
  const activeContact = useChatStore((state) => state.activeContact);
  const openChat = useChatStore((state) => state.openChat);
  const closeChat = useChatStore((state) => state.closeChat);
  const setActiveContact = useChatStore((state) => state.setActiveContact);
  const { data: unread } = useQuery({
    queryKey: ["chat", "unread"],
    queryFn: fetchUnread,
    refetchInterval: 60_000,
  });
  const unreadCount = unread?.count ?? 0;

  return (
    <>
      {isChatOpen ? (
        <section
          aria-label="Chat"
          className="fixed inset-0 z-[60] flex h-[100dvh] flex-col overflow-hidden bg-white shadow-2xl sm:inset-auto sm:bottom-6 sm:right-6 sm:h-[min(680px,calc(100dvh-3rem))] sm:w-[400px] sm:rounded-3xl sm:border sm:border-slate-200"
        >
          <header className="flex min-h-[76px] shrink-0 items-center justify-between gap-3 bg-[#075e54] px-4 text-white">
            <div className="flex min-w-0 items-center gap-3">
              {activeContact ? (
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-base font-semibold text-white ring-1 ring-white/20">
                  {activeContact.full_name.trim().charAt(0).toUpperCase()}
                </span>
              ) : (
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-white ring-1 ring-white/20">
                  <MessageCircle className="h-5 w-5" />
                </span>
              )}
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-semibold leading-5">
                  {activeContact?.full_name ?? "Team chat"}
                </span>
                {activeContact ? (
                  <span className="mt-1 flex items-center gap-1.5">
                    <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold leading-4 text-emerald-50">
                      {roleLabel(activeContact.role)}
                    </span>
                    <span className="truncate text-[11px] text-emerald-50/90">Private conversation</span>
                  </span>
                ) : (
                  <span className="block text-xs text-emerald-50/90">Your hotel team</span>
                )}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                aria-label="Minimize chat"
                onClick={closeChat}
                className="rounded-full p-2 text-white/90 transition hover:bg-white/15 hover:text-white"
              >
                <Minus className="h-5 w-5" />
              </button>
              <button
                type="button"
                aria-label="Close chat"
                onClick={() => {
                  setActiveContact(null);
                  closeChat();
                }}
                className="rounded-full p-2 text-white/90 transition hover:bg-white/15 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </header>
          {activeContact ? (
            <ConversationView userId={user.userId} contact={activeContact} />
          ) : (
            <ContactList />
          )}
        </section>
      ) : (
        <button
          type="button"
          aria-label="Open team chat"
          onClick={() => openChat()}
          className="fixed bottom-6 right-6 z-50 flex h-16 w-16 items-center justify-center rounded-full bg-[#25d366] text-[#063b2a] shadow-2xl shadow-emerald-950/30 transition hover:scale-105 hover:bg-[#20c45e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
        >
          <MessageCircle className="h-7 w-7" strokeWidth={2.4} />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-white bg-rose-600 px-1 text-[10px] font-bold text-white shadow-md">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      )}
    </>
  );
}
