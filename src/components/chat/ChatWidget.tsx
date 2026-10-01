"use client";

import { ArrowLeft, MessageCircle, Minus, X } from "lucide-react";
import type { AppUserSession } from "@/lib/auth";
import { roleLabel } from "@/lib/chat/types";
import { useChatStore } from "./chatStore";
import { ContactList } from "./ContactList";
import { ConversationView } from "./ConversationView";

export function ChatWidget({ user }: { user: AppUserSession }) {
  const isChatOpen = useChatStore((state) => state.isChatOpen);
  const activeContact = useChatStore((state) => state.activeContact);
  const closeChat = useChatStore((state) => state.closeChat);
  const setActiveContact = useChatStore((state) => state.setActiveContact);

  if (!isChatOpen) return null;

  return (
    <section
      aria-label="Chat"
      className="chat-panel fixed inset-0 z-[60] flex h-[100dvh] flex-col overflow-hidden bg-white shadow-2xl sm:inset-auto sm:bottom-6 sm:right-6 sm:h-[min(680px,calc(100dvh-3rem))] sm:w-[400px] sm:rounded-3xl sm:border sm:border-slate-200"
    >
      <header className="flex min-h-[76px] shrink-0 items-center justify-between gap-3 bg-[#075e54] px-4 text-white">
        <div className="flex min-w-0 items-center gap-2">
          {activeContact && (
            <button
              type="button"
              aria-label="Back to contacts"
              onClick={() => setActiveContact(null)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/90 transition hover:bg-white/15 hover:text-white"
            >
              <ArrowLeft aria-hidden="true" className="h-5 w-5" />
            </button>
          )}
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-base font-semibold text-white ring-1 ring-white/20">
            {activeContact ? (
              activeContact.full_name.trim().charAt(0).toUpperCase()
            ) : (
              <MessageCircle aria-hidden="true" className="h-5 w-5" />
            )}
          </span>
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
            <Minus aria-hidden="true" className="h-5 w-5" />
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
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
      </header>
      {activeContact ? (
        <ConversationView userId={user.userId} contact={activeContact} />
      ) : (
        <ContactList />
      )}
    </section>
  );
}
