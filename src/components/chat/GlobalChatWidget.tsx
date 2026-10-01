"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AppUserSession } from "@/lib/auth";
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

  return <ChatWidget user={user} />;
}
