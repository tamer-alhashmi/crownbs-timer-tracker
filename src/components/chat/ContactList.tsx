"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Search, Users } from "lucide-react";
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
    <div className="flex min-h-0 flex-1 flex-col bg-gradient-to-b from-slate-50/70 to-white">
      <div className="px-5 pb-4 pt-5 sm:px-6">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Start a conversation</h2>
            <p className="mt-1 text-xs text-slate-500">Choose a teammate to send a private message.</p>
          </div>
          {data?.contacts && (
            <span className="shrink-0 rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700">
              {data.contacts.length} {data.contacts.length === 1 ? "teammate" : "teammates"}
            </span>
          )}
        </div>
        <label className="flex h-12 items-center gap-2.5 rounded-2xl border border-slate-200 bg-white px-3.5 text-slate-400 shadow-sm transition focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-100/80">
          <Search aria-hidden="true" className="h-4 w-4 shrink-0" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Find a teammate"
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-5 sm:px-4">
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
              className="group mb-2 flex w-full items-center gap-3 rounded-2xl border border-transparent bg-white px-3.5 py-3.5 text-left shadow-[0_1px_3px_rgba(15,23,42,0.05)] transition hover:-translate-y-0.5 hover:border-indigo-100 hover:shadow-md hover:shadow-indigo-950/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-100 to-violet-100 font-semibold text-indigo-700 ring-1 ring-indigo-100/80">
                {contact.full_name.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-800">
                  {contact.full_name}
                </span>
                <span className="block truncate text-xs text-slate-500">{contact.email}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-600">
                  {roleLabel(contact.role)}
                </span>
                <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5 text-slate-300 transition group-hover:text-indigo-500" />
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
