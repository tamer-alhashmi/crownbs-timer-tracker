"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Smile } from "lucide-react";
import { useState } from "react";
import type { ChatMessage } from "@/lib/chat/types";
import { toggleMessageReaction } from "./chatApi";
import { safeChatError } from "./chatErrors";

const EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
type Reaction = { emoji: string; count: number; reacted: boolean };

function useReactionMutation(messageId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (emoji: string) => toggleMessageReaction(messageId, emoji),
    onMutate: async (emoji) => {
      await queryClient.cancelQueries({ queryKey: ["chat", "history"] });
      const previous = queryClient.getQueriesData<{ messages: ChatMessage[] }>({ queryKey: ["chat", "history"] });
      for (const [key, cached] of previous) {
        if (!cached) continue;
        const message = cached.messages.find((item) => item.id === messageId);
        const current = message?.reactions?.find((item) => item.emoji === emoji);
        const nextReactions = [...(message?.reactions ?? []).filter((item) => item.emoji !== emoji)];
        if (!current || !current.reacted) {
          nextReactions.push({ emoji, count: (current?.count ?? 0) + 1, reacted: true });
        } else if (current.count > 1) {
          nextReactions.push({ emoji, count: current.count - 1, reacted: false });
        }
        queryClient.setQueryData<{ messages: ChatMessage[] }>(key, {
          ...cached,
          messages: cached.messages.map((item) => item.id === messageId ? { ...item, reactions: nextReactions } : item),
        });
      }
      return { previous };
    },
    onError: (_cause, _emoji, context) => {
      context?.previous.forEach(([key, value]) => queryClient.setQueryData(key, value));
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["chat", "history"] }),
  });
}

export function ReactionBadges({
  messageId,
  reactions,
  isOwn,
}: {
  messageId: string;
  reactions?: Reaction[];
  isOwn: boolean;
}) {
  const mutation = useReactionMutation(messageId);
  const [error, setError] = useState("");
  if (!reactions?.length) return null;
  return (
    <span className={`pointer-events-auto relative flex max-w-full items-center gap-1 ${isOwn ? "justify-end" : "justify-start"}`}>
      {reactions.map((reaction) => (
        <button
          key={reaction.emoji}
          type="button"
          aria-label={`${reaction.emoji}, ${reaction.count} reactions`}
          disabled={mutation.isPending}
          onClick={() => mutation.mutate(reaction.emoji, {
            onError: (cause) => setError(safeChatError(cause, "Couldn't update this reaction. Please try again.")),
          })}
          className={`rounded-full border px-1.5 py-0.5 text-xs shadow-sm ${reaction.reacted ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white/95 dark:border-slate-700 dark:bg-[#202c33]"}`}
        >
          {reaction.emoji} <span className="text-[10px]">{reaction.count}</span>
        </button>
      ))}
      {error && <span role="alert" className="absolute bottom-full right-0 z-30 mb-1 w-56 rounded-lg bg-rose-50 p-2 text-[11px] text-rose-700">{error}</span>}
    </span>
  );
}

export function ReactionPicker({ messageId }: { messageId: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const mutation = useReactionMutation(messageId);

  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        aria-label="Add reaction"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
      >
        <Smile className="h-3.5 w-3.5" />
      </button>
      {open && (
        <span className="absolute bottom-full right-0 z-30 mb-1 flex items-center gap-1 rounded-full border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-600 dark:bg-[#202c33]">
          {EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={`React ${emoji}`}
              disabled={mutation.isPending}
              onClick={() => mutation.mutate(emoji, {
                onSuccess: () => {
                  setOpen(false);
                  setError("");
                },
                onError: (cause) => setError(safeChatError(cause, "Couldn't update this reaction. Please try again.")),
              })}
              className="rounded-full p-1.5 text-base hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-700"
            >
              {emoji}
            </button>
          ))}
        </span>
      )}
      {error && <span role="alert" className="absolute bottom-full right-0 z-40 mb-9 w-56 rounded-lg bg-rose-50 p-2 text-[11px] text-rose-700">{error}</span>}
    </span>
  );
}
