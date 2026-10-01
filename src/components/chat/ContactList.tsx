"use client";

import { useQuery } from "@tanstack/react-query";
import { Search, Users } from "lucide-react";
import { useState } from "react";
import { fetchContacts } from "./chatApi";
import { useChatStore } from "./chatStore";
import { roleLabel } from "@/lib/chat/types";

export function ContactList() {
  const [search, setSearch] = useState("");
  const { data, isPending, error } = useQuery({
    queryKey: ["chat", "contacts"],
    queryFn: fetchContacts,
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
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
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
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-white dark:hover:bg-[#202c33]"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#d9fdd3] font-semibold text-emerald-900 dark:bg-[#005c4b] dark:text-white">
                {contact.full_name.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span                 className="block truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {contact.full_name}
                </span>
                <span className="block truncate text-xs text-slate-600 dark:text-slate-300">{contact.email}</span>
              </span>
              <span className="rounded-full bg-white px-2 py-1 text-[10px] font-medium text-slate-700 ring-1 ring-slate-200 dark:bg-[#2a3942] dark:text-slate-200 dark:ring-slate-600">
                {roleLabel(contact.role)}
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
