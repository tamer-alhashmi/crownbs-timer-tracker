"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AppUserSession } from "@/lib/auth";
import { NotificationBell } from "./NotificationBell";
import { ChatWidget } from "./ChatWidget";

export function GlobalChatWidget({ user }: { user: AppUserSession }) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const events = new EventSource("/api/chat/events");
    events.onmessage = () => {
      void queryClient.invalidateQueries({ queryKey: ["chat"] });
    };
    return () => events.close();
  }, [queryClient]);

  return (
    <>
      <div className="fixed right-5 top-4 z-40">
        <NotificationBell />
      </div>
      <ChatWidget user={user} />
    </>
  );
}
