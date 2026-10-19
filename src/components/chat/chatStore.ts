"use client";

import { create } from "zustand";
import type { ChatContact } from "@/lib/chat/types";

type ChatState = {
  sessionUserId: string | null;
  isChatOpen: boolean;
  activeContact: ChatContact | null;
  setSessionUser: (userId: string) => void;
  openChat: (contact?: ChatContact | null) => void;
  closeChat: () => void;
  setActiveContact: (contact: ChatContact | null) => void;
  resetChat: () => void;
};

export const useChatStore = create<ChatState>((set) => ({
  sessionUserId: null,
  isChatOpen: false,
  activeContact: null,
  setSessionUser: (sessionUserId) => set({ sessionUserId, isChatOpen: false, activeContact: null }),
  openChat: (contact) =>
    set((state) => ({
      isChatOpen: true,
      activeContact: contact === undefined ? state.activeContact : contact,
    })),
  closeChat: () => set({ isChatOpen: false }),
  setActiveContact: (activeContact) => set({ activeContact }),
  resetChat: () => set({ sessionUserId: null, isChatOpen: false, activeContact: null }),
}));
