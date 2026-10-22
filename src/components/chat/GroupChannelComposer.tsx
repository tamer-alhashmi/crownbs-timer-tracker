"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, Plus, Users, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { UserRole } from "@/lib/roles";
import { roleLabel } from "@/lib/chat/types";
import { createGroupChannel, fetchGroupOptions } from "./chatApi";
import { safeChatError } from "./chatErrors";
import { useChatStore } from "./chatStore";

export function GroupChannelComposer({ userRole }: { userRole: UserRole }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const queryClient = useQueryClient();
  const setActiveContact = useChatStore((state) => state.setActiveContact);
  const options = useQuery({
    queryKey: ["chat", "group-options"],
    queryFn: fetchGroupOptions,
    enabled: open,
  });
  const selectedPropertyId = propertyId || (userRole !== "owner" ? options.data?.properties[0]?.id ?? "" : "");
  const members = useMemo(
    () => (options.data?.members ?? []).filter((member) =>
      userRole === "owner" && !selectedPropertyId
        ? true
        : member.property_ids.includes(selectedPropertyId)
    ),
    [options.data?.members, selectedPropertyId, userRole]
  );
  const mutation = useMutation({
    mutationFn: () => createGroupChannel({
      name: name.trim(),
      propertyId: selectedPropertyId || null,
      memberIds,
    }),
    onSuccess: ({ channel }) => {
      void queryClient.invalidateQueries({ queryKey: ["chat", "contacts"] });
      setActiveContact(channel);
      setName("");
      setMemberIds([]);
      setOpen(false);
      setError("");
    },
    onError: (cause) => setError(safeChatError(cause, "We couldn't create the group. Please try again.")),
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-emerald-300 bg-white px-3 py-2.5 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50 dark:bg-[#202c33] dark:text-emerald-200"
      >
        <Plus className="h-4 w-4" /> Create a group
      </button>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="chat-group-title" className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
            <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h2 id="chat-group-title" className="flex items-center gap-2 font-semibold text-slate-900"><Users className="h-4 w-4 text-emerald-700" /> New group</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-full p-2 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
            </header>
            <div className="space-y-3 overflow-y-auto p-4">
              <label className="block text-xs font-semibold text-slate-600">
                Group name
                <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-emerald-500" />
              </label>
              <label className="block text-xs font-semibold text-slate-600">
                Property
                <select value={selectedPropertyId} onChange={(event) => { setPropertyId(event.target.value); setMemberIds([]); }} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900">
                  {options.data?.allowCompanyWide && <option value="">Company-wide group</option>}
                  {(options.data?.properties ?? []).map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
                </select>
              </label>
              <div>
                <p className="mb-2 text-xs font-semibold text-slate-600">Add members</p>
                {options.isPending ? <p className="text-sm text-slate-500">Loading available members…</p> : options.error ? (
                  <p role="alert" className="text-sm text-rose-700">{safeChatError(options.error, "We couldn't load group members.")}</p>
                ) : members.length ? (
                  <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                    {members.map((member) => (
                      <label key={member.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-800 hover:bg-slate-50">
                        <input type="checkbox" checked={memberIds.includes(member.id)} onChange={(event) => setMemberIds((current) => event.target.checked ? [...current, member.id] : current.filter((id) => id !== member.id))} />
                        <span className="min-w-0 flex-1 truncate">{member.full_name}</span>
                        <span className="text-xs text-slate-500">{roleLabel(member.role)}</span>
                      </label>
                    ))}
                  </div>
                ) : <p className="text-sm text-slate-500">No eligible teammates are available for this group.</p>}
              </div>
              {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
            </div>
            <footer className="flex justify-end gap-2 border-t border-slate-200 p-3">
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Cancel</button>
              <button type="button" disabled={mutation.isPending || !name.trim() || memberIds.length === 0} onClick={() => mutation.mutate()} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {mutation.isPending && <LoaderCircle className="h-4 w-4 animate-spin" />} Create group
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
