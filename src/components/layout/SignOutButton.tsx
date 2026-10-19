"use client";

import { LogOut } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { signOut } from "@/app/actions";
import { useChatStore } from "@/components/chat/chatStore";

export function SignOutButton() {
  const queryClient = useQueryClient();
  const clearClientSession = () => {
    useChatStore.getState().resetChat();
    queryClient.clear();
    window.dispatchEvent(new Event("app:signout"));
  };

  return (
    <form action={signOut} onSubmit={clearClientSession}>
      <button
        type="submit"
        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
      >
        <LogOut className="h-4 w-4" />
        Sign out
      </button>
    </form>
  );
}
