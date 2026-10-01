"use client";

import { ArrowLeft, MessageCircle, X } from "lucide-react";
import type { AppUserSession } from "@/lib/auth";
import { useChatStore } from "./chatStore";
import { ContactList } from "./ContactList";
import { ConversationView } from "./ConversationView";
import { roleLabel } from "@/lib/chat/types";

export function ChatWidget({ user }: { user: AppUserSession }) {
  const isChatOpen = useChatStore((state) => state.isChatOpen);
  const activeContact = useChatStore((state) => state.activeContact);
  const closeChat = useChatStore((state) => state.closeChat);
  const setActiveContact = useChatStore((state) => state.setActiveContact);

  if (!isChatOpen) return null;

  return (
    <section
      aria-label="Chat"
      className="fixed inset-0 z-50 flex h-[100dvh] flex-col overflow-hidden bg-white shadow-2xl sm:inset-auto sm:bottom-7 sm:right-7 sm:h-[min(44rem,calc(100dvh-3.5rem))] sm:w-[min(28rem,calc(100vw-3.5rem))] sm:rounded-[1.75rem] sm:border sm:border-slate-200/80"
    >
      <header className="relative shrink-0 overflow-hidden bg-gradient-to-br from-slate-950 via-indigo-950 to-indigo-800 px-5 pb-5 pt-5 text-white sm:px-6 sm:pt-6">
        <div aria-hidden="true" className="pointer-events-none absolute -right-8 -top-16 h-48 w-48 rounded-full border-[24px] border-white/[0.06]" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-16 right-24 h-32 w-32 rounded-full bg-indigo-400/10 blur-2xl" />
        <div className="relative flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
          {activeContact && (
            <button
              type="button"
              aria-label="Back to contacts"
              onClick={() => setActiveContact(null)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-slate-200 transition hover:bg-white/20 hover:text-white"
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            </button>
          )}
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/20 bg-white/15 shadow-inner shadow-white/10">
              {activeContact ? (
                <span className="text-base font-bold">{activeContact.full_name.charAt(0).toUpperCase()}</span>
              ) : (
                <MessageCircle aria-hidden="true" className="h-5 w-5" />
              )}
            </span>
            <span className="min-w-0">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-indigo-200">
                {activeContact ? roleLabel(activeContact.role) : "Team messaging"}
              </span>
              <span className="block truncate text-base font-semibold tracking-tight">
                {activeContact?.full_name ?? "Your conversations"}
              </span>
            </span>
          </div>
          <button
            type="button"
            aria-label="Close chat"
            onClick={closeChat}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-slate-200 transition hover:bg-white/20 hover:text-white"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
        {!activeContact && (
          <p className="relative mt-4 pl-14 text-xs leading-5 text-indigo-100/75">
            Keep your hotel team connected, one message at a time.
          </p>
        )}
      </header>
      {activeContact ? (
        <ConversationView userId={user.userId} contact={activeContact} />
      ) : (
        <ContactList />
      )}
    </section>
  );
}
