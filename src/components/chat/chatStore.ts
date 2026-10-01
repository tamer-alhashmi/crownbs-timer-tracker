"use client";

import { create } from "zustand";
import type { ChatContact } from "@/lib/chat/types";

type ChatState = {
  isChatOpen: boolean;
  activeContact: ChatContact | null;
  openChat: (contact?: ChatContact | null) => void;
  closeChat: () => void;
  setActiveContact: (contact: ChatContact | null) => void;
};

export const useChatStore = create<ChatState>((set) => ({
  isChatOpen: false,
  activeContact: null,
  openChat: (contact) =>
    set((state) => ({
      isChatOpen: true,
      activeContact: contact === undefined ? state.activeContact : contact,
    })),
  closeChat: () => set({ isChatOpen: false }),
  setActiveContact: (activeContact) => set({ activeContact }),
}));
