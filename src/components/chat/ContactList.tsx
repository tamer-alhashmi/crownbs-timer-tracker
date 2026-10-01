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
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <div className="p-4">
        <label className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-slate-400 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100">
          <Search className="h-4 w-4" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Find a teammate"
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {isPending ? (
          <p className="px-3 py-8 text-center text-sm text-slate-500">Loading teammates…</p>
        ) : error ? (
          <p role="alert" className="px-3 py-8 text-center text-sm text-rose-600">
            {error.message}
          </p>
        ) : contacts.length ? (
          contacts.map((contact) => (
            <button
              type="button"
              key={contact.id}
              onClick={() => setActiveContact(contact)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-slate-50"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-50 font-semibold text-indigo-700">
                {contact.full_name.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-800">
                  {contact.full_name}
                </span>
                <span className="block truncate text-xs text-slate-500">{contact.email}</span>
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-600">
                {roleLabel(contact.role)}
              </span>
            </button>
          ))
        ) : (
          <div className="px-5 py-10 text-center">
            <Users className="mx-auto h-7 w-7 text-slate-300" />
            <p className="mt-2 text-sm font-medium text-slate-700">No teammates found</p>
            <p className="mt-1 text-xs text-slate-500">Try another name or check back later.</p>
          </div>
        )}
      </div>
    </div>
  );
}
