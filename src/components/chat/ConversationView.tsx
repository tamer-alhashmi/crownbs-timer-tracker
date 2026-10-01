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
  contact,
}: {
  userId: AppUserSession["userId"];
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
      <div className="flex min-h-0 flex-1 flex-col bg-[#f5f7fb]">
        <div className="flex-1 space-y-4 overflow-y-auto bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-white/80 via-[#f5f7fb] to-[#f5f7fb] px-5 py-6 sm:px-6">
          {readMutation.isError && (
            <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {readMutation.error.message}
            </p>
          )}
          {isPending ? (
            <p className="py-10 text-center text-sm text-slate-500">Loading conversation…</p>
          ) : error ? (
            <p role="alert" className="py-10 text-center text-sm text-rose-600">
              {error.message}
            </p>
          ) : data?.messages.length ? (
            data.messages.map((message) => (
              <MessageBubble key={message.id} message={message} isOwn={message.sender_id === userId} />
            ))
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
                <ArrowLeft className="h-5 w-5 rotate-180" />
              </span>
              <p className="mt-3 text-sm font-semibold text-slate-800">Start the conversation</p>
              <p className="mt-1 max-w-52 text-xs leading-5 text-slate-500">
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
          }}
        />
      </div>
    </>
  );
}
