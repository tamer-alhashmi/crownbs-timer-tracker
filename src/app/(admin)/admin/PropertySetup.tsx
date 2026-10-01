"use client";

import { forwardRef, useCallback, useImperativeHandle, useState, useTransition, type FormEvent } from "react";
import { Pencil, Power, X } from "lucide-react";
import { createProperty, updateProperty, type PropertyRecord } from "./propertyActions";

type Assignee = { id: string; name: string; role: "owner" | "manager" };
type PropertyForm = { name: string; location: string; owner_id: string; manager_id: string };

const EMPTY_FORM: PropertyForm = { name: "", location: "", owner_id: "", manager_id: "" };

export type PropertySetupHandle = { openCreate: () => void };

export const PropertySetup = forwardRef<PropertySetupHandle, { initialProperties: PropertyRecord[]; assignees: Assignee[]; canManage?: boolean }>(function PropertySetup({ initialProperties, assignees, canManage = true }, ref) {
  const [properties, setProperties] = useState(initialProperties);
  const [editing, setEditing] = useState<PropertyRecord | null>(null);
  const [form, setForm] = useState<PropertyForm>(EMPTY_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();
  const owners = assignees.filter((person) => person.role === "owner");
  const managers = assignees.filter((person) => person.role === "manager");
  const ownerNames = new Map(owners.map((person) => [person.id, person.name]));
  const managerNames = new Map(managers.map((person) => [person.id, person.name]));

  const openCreate = useCallback(() => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
    setMessage(null);
  }, []);
  useImperativeHandle(ref, () => ({ openCreate }), [openCreate]);

  const openEdit = (property: PropertyRecord) => {
    setEditing(property);
    setForm({ name: property.name, location: property.location ?? "", owner_id: property.owner_id ?? "", manager_id: property.manager_id ?? "" });
    setFormOpen(true);
    setMessage(null);
  };

  const saveProperty = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startTransition(async () => {
      try {
        const saved = editing
          ? await updateProperty(editing.id, form)
          : await createProperty(form);
        setProperties((current) => {
          const next = current.some((property) => property.id === saved.id)
            ? current.map((property) => property.id === saved.id ? saved : property)
            : [...current, saved];
          return next.sort((left, right) => left.name.localeCompare(right.name));
        });
        setFormOpen(false);
        setMessage({ text: `${saved.name} saved.`, error: false });
      } catch (error) {
        setMessage({ text: error instanceof Error ? error.message : "Unable to save property.", error: true });
      }
    });
  };

  const toggleProperty = (property: PropertyRecord) => startTransition(async () => {
    try {
      const updated = await updateProperty(property.id, {
        name: property.name,
        location: property.location ?? "",
        owner_id: property.owner_id ?? "",
        manager_id: property.manager_id ?? "",
        is_active: !property.is_active,
      });
      setProperties((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage({ text: `${updated.name} ${updated.is_active ? "activated" : "deactivated"}.`, error: false });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Unable to update property status.", error: true });
    }
  });

  return <section className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/70 p-4 sm:p-5" aria-labelledby="property-setup-title">
    <div className="flex flex-col gap-3 border-b border-slate-800 pb-4 sm:flex-row sm:items-center sm:justify-between">
      <div><h3 id="property-setup-title" className="text-lg font-bold text-white">Properties</h3><p className="mt-1 text-sm text-slate-400">{canManage ? "Manage properties, assignments, and active status" : "Properties and current management assignments"} · {properties.length} total</p></div>
    </div>
    {message && <p role={message.error ? "alert" : "status"} className={`mt-3 rounded-lg border px-3 py-2 text-sm ${message.error ? "border-rose-800 bg-rose-950/60 text-rose-200" : "border-emerald-800 bg-emerald-950/50 text-emerald-200"}`}>{message.text}</p>}
    <div className="admin-config-scroll mt-4 max-h-80 overflow-y-auto rounded-xl border border-slate-800 p-2">
      <div className="sticky top-0 z-10 mb-2 flex items-center justify-between bg-slate-950/95 px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400 backdrop-blur"><span>Properties</span><span>{properties.length} configured</span></div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      {properties.map((property) => <article key={property.id} className="min-w-0 rounded-xl border border-slate-800 bg-slate-900 p-3">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h4 className="break-words font-semibold text-white">{property.name}</h4><p className="mt-1 text-sm text-slate-300">{property.location || "No location"}</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${property.is_active ? "bg-emerald-950 text-emerald-300" : "bg-slate-800 text-slate-400"}`}>{property.is_active ? "Active" : "Inactive"}</span></div>
        <dl className="mt-3 space-y-1.5 border-t border-slate-800 pt-3 text-xs text-slate-400"><div className="flex justify-between gap-3"><dt>Owner</dt><dd className="text-right text-slate-200">{ownerNames.get(property.owner_id ?? "") ?? "Unassigned"}</dd></div><div className="flex justify-between gap-3"><dt>Manager</dt><dd className="text-right text-slate-200">{managerNames.get(property.manager_id ?? "") ?? "Unassigned"}</dd></div><div><dt className="sr-only">Property UUID</dt><dd className="break-all font-mono text-[11px]">{property.id}</dd></div><div className="flex justify-between gap-3"><dt>Created</dt><dd>{new Date(property.created_at).toLocaleString()}</dd></div></dl>
        {canManage && <div className="mt-3 flex justify-end gap-1 border-t border-slate-800 pt-2">
          <button type="button" onClick={() => openEdit(property)} aria-label={`Edit ${property.name}`} title="Edit property" className="rounded-lg p-2 text-slate-300 hover:bg-slate-800 hover:text-white"><Pencil className="h-4 w-4" /></button>
          <button type="button" role="switch" aria-checked={property.is_active} onClick={() => toggleProperty(property)} disabled={isPending} aria-label={`${property.is_active ? "Deactivate" : "Activate"} ${property.name}`} title={property.is_active ? "Deactivate property" : "Activate property"} className={`rounded-lg p-2 disabled:opacity-50 ${property.is_active ? "text-emerald-300 hover:bg-slate-800" : "text-slate-500 hover:bg-slate-800 hover:text-emerald-300"}`}><Power className="h-4 w-4" /></button>
        </div>}
      </article>)}
      {!properties.length && <p className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-400 md:col-span-2 xl:col-span-3">No properties configured.</p>}
      </div>
    </div>
    {canManage && formOpen && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/75 p-4" role="dialog" aria-modal="true" aria-labelledby="property-form-title">
      <form onSubmit={saveProperty} className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-5 text-slate-100 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300">Property setup</p><h3 id="property-form-title" className="mt-1 text-lg font-bold text-white">{editing ? "Edit property" : "Add property"}</h3></div><button type="button" onClick={() => setFormOpen(false)} aria-label="Close form" className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-4 w-4" /></button></div>
        <div className="mt-5 grid gap-4">
          <label className="text-sm font-medium text-slate-300">Property name<input required maxLength={120} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white outline-none focus:border-cyan-400" /></label>
          <label className="text-sm font-medium text-slate-300">Location<input required maxLength={240} value={form.location} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white outline-none focus:border-cyan-400" /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-300">Owner<select value={form.owner_id} onChange={(event) => setForm((current) => ({ ...current, owner_id: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white"><option value="">Unassigned</option>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select></label>
            <label className="text-sm font-medium text-slate-300">Manager<select value={form.manager_id} onChange={(event) => setForm((current) => ({ ...current, manager_id: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white"><option value="">Unassigned</option>{managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name}</option>)}</select></label>
          </div>
          <p className="text-xs text-slate-400">A UUID and creation timestamp are generated automatically. New properties are active by default.</p>
        </div>
        {message?.error && <p role="alert" className="mt-4 rounded-lg border border-rose-800 bg-rose-950/60 px-3 py-2 text-sm text-rose-200">{message.text}</p>}
        <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setFormOpen(false)} className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-800">Cancel</button><button type="submit" disabled={isPending} className="rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50">{editing ? "Save changes" : "Create property"}</button></div>
      </form>
    </div>}
  </section>;
});
