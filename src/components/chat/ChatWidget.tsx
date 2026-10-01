"use client";

import { MessageCircle, X } from "lucide-react";
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
      className="fixed inset-0 z-50 flex h-[100dvh] flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl sm:inset-auto sm:bottom-6 sm:right-6 sm:h-[min(42rem,calc(100dvh-3rem))] sm:w-[min(26rem,calc(100vw-3rem))] sm:rounded-3xl"
    >
      <header className="flex h-[72px] shrink-0 items-center justify-between bg-slate-950 px-5 text-white">
        <div className="flex min-w-0 items-center gap-3">
          {activeContact && (
            <button
              type="button"
              aria-label="Back to contacts"
              onClick={() => setActiveContact(null)}
              className="rounded-lg px-1 py-2 text-sm text-slate-300 hover:text-white"
            >
              Back
            </button>
          )}
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500">
            <MessageCircle aria-hidden="true" className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">
              {activeContact?.full_name ?? "Team chat"}
            </span>
            <span className="block text-xs text-slate-400">
              {activeContact ? roleLabel(activeContact.role) : "Your hotel team"}
            </span>
          </span>
        </div>
        <button
          type="button"
          aria-label="Close chat"
          onClick={closeChat}
          className="rounded-full p-2 text-slate-300 transition hover:bg-white/10 hover:text-white"
        >
          <X aria-hidden="true" className="h-5 w-5" />
        </button>
      </header>
      {activeContact ? (
        <ConversationView userId={user.userId} contact={activeContact} />
      ) : (
        <ContactList />
      )}
    </section>
  );
}
