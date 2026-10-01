"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useEffect, useRef } from "react";
import type { AppUserSession } from "@/lib/auth";
import type { ChatContact } from "@/lib/chat/types";
import { fetchConversation, markConversationRead } from "./chatApi";
import { MessageBubble } from "./MessageBubble";
import { MessageInput } from "./MessageInput";

export function ConversationView({
  userId,
  userName,
  userAvatarUrl,
  contact,
}: {
  userId: AppUserSession["userId"];
  userName: string;
  userAvatarUrl: string | null;
  contact: ChatContact;
}) {
  const queryClient = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const markedThroughRef = useRef<string | null>(null);
  const queryKey = ["chat", "history", contact.id];
  const { data, isPending, error } = useQuery({
    queryKey,
    queryFn: () => fetchConversation(contact.id),
  });
  const readMutation = useMutation({
    mutationFn: () => markConversationRead(contact.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["chat", "unread"] });
      void queryClient.invalidateQueries({ queryKey: ["chat", "contacts"] });
      void queryClient.invalidateQueries({ queryKey });
    },
  });
  const markRead = readMutation.mutate;

  useEffect(() => {
    const unreadMessages = data?.messages.filter(
      (message) => message.receiver_id === userId && !message.is_read
    );
    const lastUnreadId = unreadMessages?.at(-1)?.id ?? null;
    if (lastUnreadId && lastUnreadId !== markedThroughRef.current && !readMutation.isPending) {
      markedThroughRef.current = lastUnreadId;
      markRead();
    }
  }, [data?.messages, markRead, readMutation.isPending, userId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [data?.messages.length]);

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col bg-[#efeae2] dark:bg-[#0b141a]">
        <div
          className="flex-1 space-y-2.5 overflow-y-auto px-3 py-5 sm:px-4"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, rgba(120, 113, 100, 0.055) 1px, transparent 1.5px), radial-gradient(circle at 75% 65%, rgba(120, 113, 100, 0.045) 1px, transparent 1.5px)",
            backgroundSize: "24px 24px, 31px 31px",
          }}
        >
          {readMutation.isError && (
            <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/50 dark:text-rose-200">
              {readMutation.error.message}
            </p>
          )}
          {isPending ? (
            <p className="py-10 text-center text-sm text-slate-600 dark:text-slate-300">Loading conversation…</p>
          ) : error ? (
            <p role="alert" className="py-10 text-center text-sm text-rose-700 dark:text-rose-300">
              {error.message}
            </p>
          ) : data?.messages.length ? (
            data.messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                isOwn={message.sender_id === userId}
                senderName={message.sender_id === userId ? userName : contact.full_name}
                senderAvatarUrl={message.sender_id === userId ? userAvatarUrl : contact.avatar_url}
              />
            ))
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/80 text-emerald-800 dark:bg-[#202c33] dark:text-emerald-200">
                <ArrowLeft className="h-5 w-5 rotate-180" />
              </span>
              <p className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">Start the conversation</p>
              <p className="mt-1 max-w-52 text-xs leading-5 text-slate-700 dark:text-slate-300">
                Messages are only visible to you and {contact.full_name}.
              </p>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
        <MessageInput
          receiverId={contact.id}
          onSent={() => {
            void queryClient.invalidateQueries({ queryKey });
            void queryClient.invalidateQueries({ queryKey: ["chat", "unread"] });
            void queryClient.invalidateQueries({ queryKey: ["chat", "contacts"] });
          }}
        />
      </div>
    </>
  );
}
