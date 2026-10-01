"use client";

import { ArrowLeft, MessageCircle, Minus, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import type { AppUserSession } from "@/lib/auth";
import type { ChatContact } from "@/lib/chat/types";
import { roleLabel } from "@/lib/chat/types";
import { useChatStore } from "./chatStore";
import { ContactList } from "./ContactList";
import { ConversationView } from "./ConversationView";
import { UserAvatar } from "@/components/shared/UserAvatar";

export function ChatWidget({ user, profile }: { user: AppUserSession; profile: { name: string; avatarUrl: string | null } }) {
  const widgetId = useId().replaceAll(":", "");
  const isChatOpen = useChatStore((state) => state.isChatOpen);
  const activeContact = useChatStore((state) => state.activeContact);
  const closeChat = useChatStore((state) => state.closeChat);
  const openChat = useChatStore((state) => state.openChat);
  const setActiveContact = useChatStore((state) => state.setActiveContact);
  const historyDepth = useRef(0);
  const previousOpen = useRef(false);
  const previousContactId = useRef<string | null>(null);
  const lastContactRef = useRef<ChatContact | null>(activeContact);

  useEffect(() => {
    if (activeContact) lastContactRef.current = activeContact;
  }, [activeContact]);

  useEffect(() => {
    const updateChatEntry = (layer: "contacts" | "conversation", replace = false) => {
      const currentState =
        window.history.state && typeof window.history.state === "object"
          ? window.history.state as Record<string, unknown>
          : {};
      const nextState = { ...currentState, chatWidgetId: widgetId, chatLayer: layer };
      if (replace) {
        window.history.replaceState(nextState, "", window.location.href);
      } else {
        window.history.pushState(nextState, "", window.location.href);
        historyDepth.current += 1;
      }
    };

    if (!isChatOpen) {
      previousOpen.current = false;
      previousContactId.current = null;
      historyDepth.current = 0;
      return;
    }

    if (!previousOpen.current) {
      updateChatEntry("contacts");
      if (activeContact) updateChatEntry("conversation");
    } else if (activeContact && activeContact.id !== previousContactId.current) {
      updateChatEntry("conversation", previousContactId.current !== null);
    }

    previousOpen.current = true;
    previousContactId.current = activeContact?.id ?? null;
  }, [activeContact, isChatOpen, widgetId]);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const state = event.state as Record<string, unknown> | null;
      const isOurEntry = state?.chatWidgetId === widgetId;
      const layer = state?.chatLayer;

      if (isOurEntry && layer === "conversation") {
        historyDepth.current = 2;
        const contact = lastContactRef.current;
        if (contact) {
          previousOpen.current = true;
          previousContactId.current = contact.id;
          openChat(contact);
        }
        return;
      }

      if (isOurEntry && layer === "contacts") {
        historyDepth.current = 1;
        previousOpen.current = true;
        previousContactId.current = null;
        if (isChatOpen) setActiveContact(null);
        else openChat(null);
        return;
      }

      historyDepth.current = 0;
      previousOpen.current = false;
      previousContactId.current = null;
      if (isChatOpen) {
        setActiveContact(null);
        closeChat();
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [closeChat, isChatOpen, openChat, setActiveContact, widgetId]);

  const closeWithHistory = () => {
    if (historyDepth.current > 0) {
      window.history.go(-historyDepth.current);
      return;
    }
    setActiveContact(null);
    closeChat();
  };

  const backToContacts = () => {
    if (historyDepth.current > 1) {
      window.history.back();
      return;
    }
    setActiveContact(null);
  };

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
              onClick={backToContacts}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/90 transition hover:bg-white/15 hover:text-white"
            >
              <ArrowLeft aria-hidden="true" className="h-5 w-5" />
            </button>
          )}
          {activeContact ? (
            <UserAvatar name={activeContact.full_name} avatarUrl={activeContact.avatar_url} className="h-11 w-11 bg-white/15 text-base font-semibold text-white ring-1 ring-white/20" />
          ) : (
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-base font-semibold text-white ring-1 ring-white/20">
              <MessageCircle aria-hidden="true" className="h-5 w-5" />
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
            onClick={closeWithHistory}
            className="rounded-full p-2 text-white/90 transition hover:bg-white/15 hover:text-white"
          >
            <Minus aria-hidden="true" className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Close chat"
            onClick={closeWithHistory}
            className="rounded-full p-2 text-white/90 transition hover:bg-white/15 hover:text-white"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
      </header>
      {activeContact ? (
        <ConversationView userId={user.userId} userName={profile.name} userAvatarUrl={profile.avatarUrl} contact={activeContact} />
      ) : (
        <ContactList />
      )}
    </section>
  );
}
