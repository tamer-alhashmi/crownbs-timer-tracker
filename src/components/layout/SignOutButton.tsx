"use client";

import { useRef } from "react";
import type { FormEvent } from "react";
import { LogOut } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { signOut } from "@/app/actions";
import { useChatStore } from "@/components/chat/chatStore";

export function SignOutButton() {
  const submitState = useRef<"idle" | "preparing" | "ready">("idle");
  const queryClient = useQueryClient();
  const clearClientSession = () => {
    useChatStore.getState().resetChat();
    queryClient.clear();
    window.dispatchEvent(new Event("app:signout"));
  };
  const unlinkDeviceAndSignOut = async (event: FormEvent<HTMLFormElement>) => {
    if (submitState.current === "ready") {
      submitState.current = "idle";
      return;
    }
    event.preventDefault();
    if (submitState.current === "preparing") return;
    submitState.current = "preparing";
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    try {
      const registration = await navigator.serviceWorker?.getRegistration("/push/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const response = await fetch("/api/push/subscriptions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        if (!response.ok) console.error("[Internal Error]: Unable to unlink push subscription before sign-out.");
      }
    } catch (error) {
      console.error("[Internal Error]: Unable to unlink push subscription before sign-out.", error);
    }
    clearClientSession();
    submitState.current = "ready";
    if (submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement) form.requestSubmit(submitter);
    else form.requestSubmit();
  };

  return (
    <form action={signOut} onSubmit={(event) => void unlinkDeviceAndSignOut(event)}>
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
