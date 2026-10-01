"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Search, Users } from "lucide-react";
import { useState } from "react";
import { fetchContacts } from "./chatApi";
import { useChatStore } from "./chatStore";
import { roleLabel } from "@/lib/chat/types";
import { UserAvatar } from "@/components/shared/UserAvatar";

export function ContactList() {
  const [search, setSearch] = useState("");
  const { data, isPending, error } = useQuery({
    queryKey: ["chat", "contacts"],
    queryFn: fetchContacts,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const setActiveContact = useChatStore((state) => state.setActiveContact);
  const contacts = (data?.contacts ?? []).filter((contact) =>
    `${contact.full_name} ${contact.email} ${roleLabel(contact.role)}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

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
        {isPending ? (
          <p className="px-3 py-8 text-center text-sm text-slate-600 dark:text-slate-300">Loading teammates…</p>
        ) : error ? (
          <p role="alert" className="px-3 py-8 text-center text-sm text-rose-700 dark:text-rose-300">
            {error.message}
          </p>
        ) : contacts.length ? (
          contacts.map((contact) => (
            <button
              type="button"
              key={contact.id}
              onClick={() => setActiveContact(contact)}
              className="group mb-2 flex w-full items-center gap-3 rounded-2xl border border-transparent bg-white px-3.5 py-3.5 text-left shadow-[0_1px_3px_rgba(15,23,42,0.05)] transition hover:-translate-y-0.5 hover:border-emerald-100 hover:shadow-md hover:shadow-emerald-950/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:bg-[#202c33]"
            >
              <UserAvatar name={contact.full_name} avatarUrl={contact.avatar_url} className="h-11 w-11 bg-[#d9fdd3] font-semibold text-emerald-900 ring-1 ring-emerald-100 dark:bg-[#005c4b] dark:text-white dark:ring-emerald-900" />
              <span className="min-w-0 flex-1">
                <span                 className="block truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {contact.full_name}
                </span>
                <span className="block truncate text-xs text-slate-600 dark:text-slate-300">{contact.email}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                {contact.unread_count ? (
                  <span
                    aria-label={`${contact.unread_count} unread messages`}
                    className="flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1.5 text-[10px] font-bold leading-none text-white shadow-sm"
                  >
                    {contact.unread_count > 99 ? "99+" : contact.unread_count}
                  </span>
                ) : null}
                <span className="rounded-full bg-white px-2 py-1 text-[10px] font-medium text-slate-700 ring-1 ring-slate-200 dark:bg-[#2a3942] dark:text-slate-200 dark:ring-slate-600">
                  {roleLabel(contact.role)}
                </span>
                <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5 text-slate-300 transition group-hover:text-indigo-500" />
              </span>
            </button>
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
