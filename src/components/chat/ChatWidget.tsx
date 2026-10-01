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
  const openChat = useChatStore((state) => state.openChat);
  const closeChat = useChatStore((state) => state.closeChat);
  const setActiveContact = useChatStore((state) => state.setActiveContact);

  return (
    <>
      {isChatOpen ? (
        <section
          aria-label="Chat"
          className="fixed inset-0 z-50 flex h-[100dvh] flex-col overflow-hidden bg-white shadow-2xl sm:inset-auto sm:bottom-6 sm:right-6 sm:h-[550px] sm:w-96 sm:rounded-3xl sm:border sm:border-slate-200"
        >
          <header className="flex h-[68px] shrink-0 items-center justify-between bg-slate-950 px-4 text-white">
            <div className="flex items-center gap-3">
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
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500">
                <MessageCircle className="h-5 w-5" />
              </span>
              <span>
                <span className="block text-sm font-semibold">
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
              <X className="h-5 w-5" />
            </button>
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
          className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-xl shadow-indigo-900/25 transition hover:scale-105 hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        >
          <MessageCircle className="h-6 w-6" />
        </button>
      )}
    </>
  );
}
