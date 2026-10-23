"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Pin, PinOff, Search, Users } from "lucide-react";
import { useState } from "react";
import { fetchContacts, setConversationPinned } from "./chatApi";
import { useChatStore } from "./chatStore";
import { roleLabel } from "@/lib/chat/types";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { LiveStatusIndicator } from "@/components/ui/LiveStatusIndicator";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { safeChatError } from "./chatErrors";
import { GroupChannelComposer } from "./GroupChannelComposer";
import type { UserRole } from "@/lib/roles";

export function ContactList({ userRole }: { userRole: UserRole }) {
  const [search, setSearch] = useState("");
  const [pinError, setPinError] = useState("");
  const queryClient = useQueryClient();
  const { data, isPending, error } = useQuery({
    queryKey: ["chat", "contacts"],
    queryFn: fetchContacts,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const setActiveContact = useChatStore((state) => state.setActiveContact);
  const pinMutation = useMutation({
    mutationFn: ({ contactId, isPinned, channelId }: { contactId: string; isPinned: boolean; channelId?: string }) =>
      setConversationPinned(contactId, isPinned, channelId),
    onSuccess: () => {
      setPinError("");
      return queryClient.invalidateQueries({ queryKey: ["chat", "contacts"] });
    },
    onError: (cause) => setPinError(safeChatError(cause, "Couldn't update the pin. Please try again.")),
  });
  const contacts = (data?.contacts ?? [])
    .filter((contact) =>
      `${contact.full_name} ${contact.email} ${roleLabel(contact.role)}`
        .toLowerCase()
        .includes(search.toLowerCase())
    )
    .sort((a, b) => {
      if (Boolean(a.is_pinned) !== Boolean(b.is_pinned)) return a.is_pinned ? -1 : 1;
      const unreadDifference = Number((b.unread_count ?? 0) > 0) - Number((a.unread_count ?? 0) > 0);
      if (unreadDifference) return unreadDifference;
      return (b.last_message_at ?? "").localeCompare(a.last_message_at ?? "");
    });

  const formatTimestamp = (timestamp?: string | null) => {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "";
    const today = new Date();
    if (date.toDateString() === today.toDateString()) {
      return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    return date.toDateString() === yesterday.toDateString()
      ? "Yesterday"
      : date.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#f7f5f2] dark:bg-[#111b21]">
      <div className="border-b border-slate-200/80 bg-white p-4 dark:border-slate-700 dark:bg-[#111b21]">
        <label className="flex h-11 items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 text-slate-500 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-100 dark:border-slate-700 dark:bg-[#202c33] dark:text-slate-300 dark:focus-within:ring-emerald-900">
          <Search className="h-4 w-4" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Find a teammate"
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-500 dark:text-slate-100 dark:placeholder:text-slate-300"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-5 sm:px-4">
        {["owner", "manager", "housekeeping_admin", "hk_admin"].includes(userRole) && <GroupChannelComposer userRole={userRole} />}
        {pinError && <p role="alert" className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{pinError}</p>}
        {isPending ? (
          <p className="px-3 py-8 text-center text-sm text-slate-600 dark:text-slate-300">Loading teammates…</p>
        ) : error ? (
          <p role="alert" className="px-3 py-8 text-center text-sm text-rose-700 dark:text-rose-300">
            {safeChatError(error, "We couldn't load your conversations. Please try again.")}
          </p>
        ) : contacts.length ? (
          contacts.map((contact) => (
            <div
              key={contact.id}
              className="group mb-2 flex items-center rounded-2xl border border-transparent bg-white shadow-[0_1px_3px_rgba(15,23,42,0.05)] transition hover:border-emerald-100 hover:shadow-md hover:shadow-emerald-950/5 dark:bg-[#202c33]"
            >
              <button
                type="button"
                onClick={() => setActiveContact(contact)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  pinMutation.mutate({ contactId: contact.id, isPinned: !contact.is_pinned, channelId: contact.channel_id });
                }}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-l-2xl px-3.5 py-3.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
              >
                <UserAvatar name={contact.full_name} avatarUrl={contact.avatar_url} role={contact.role} className="h-11 w-11 bg-[#d9fdd3] font-semibold text-emerald-900 ring-1 ring-emerald-100 dark:bg-[#005c4b] dark:text-white dark:ring-emerald-900" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="block truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{contact.full_name}</span>
                    {contact.is_pinned && <Pin aria-label="Pinned conversation" className="h-3.5 w-3.5 shrink-0 fill-amber-500 text-amber-500" />}
                  </span>
                  <span className="mt-1 block truncate text-xs text-slate-600 dark:text-slate-300">
                    {contact.last_message || contact.email || roleLabel(contact.role)}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {contact.last_message_at && (
                    <span className={`text-[10px] ${contact.unread_count ? "font-semibold text-emerald-600" : "font-normal text-slate-400"}`}>
                      {formatTimestamp(contact.last_message_at)}
                    </span>
                  )}
                  {contact.unread_count ? (
                    <span aria-label={`${contact.unread_count} unread messages`} className="flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-600 px-1.5 text-[10px] font-bold leading-none text-white">
                      {contact.unread_count > 99 ? "99+" : contact.unread_count}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <LiveStatusIndicator isClockedIn={contact.is_clocked_in ?? false} showLabel={false} />
                      <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5 text-slate-300 transition group-hover:text-indigo-500" />
                    </span>
                  )}
                </span>
              </button>
              <button
                type="button"
                aria-label={contact.is_pinned ? "Unpin conversation" : "Pin conversation"}
                title={contact.is_pinned ? "Unpin conversation" : "Pin conversation"}
                onClick={() => pinMutation.mutate({ contactId: contact.id, isPinned: !contact.is_pinned, channelId: contact.channel_id })}
                disabled={pinMutation.isPending}
                className="mr-2 rounded-full p-2 text-slate-400 transition hover:bg-amber-50 hover:text-amber-600"
              >
                {contact.is_pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
              </button>
            </div>
          ))
        ) : (
          <div className="px-5 py-10 text-center">
            <Users className="mx-auto h-7 w-7 text-slate-300" />
            <p className="mt-2 text-sm font-medium text-slate-800 dark:text-slate-100">No teammates found</p>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Try another name or check back later.</p>
          </div>
        )}
      </div>
    </div>
  );
}
