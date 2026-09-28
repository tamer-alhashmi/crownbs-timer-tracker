"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { ChevronDown, LoaderCircle, Pencil, Plus, Power, Trash2, X } from "lucide-react";
import { createService, deleteService, getServices, updateService, type ServiceRecord } from "./serviceActions";
import type { BillingUnit } from "@/lib/servicePricing";

type ServiceForm = { name: string; default_rate: string; unit: BillingUnit; description: string };
type Props = { initialServices: ServiceRecord[] };

const EMPTY_FORM: ServiceForm = { name: "", default_rate: "15.00", unit: "hourly", description: "" };
const UNIT_LABELS: Record<BillingUnit, string> = { hourly: "Hourly", per_room: "Per room", fixed: "Fixed per task" };
const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

export function ServicePricingManager({ initialServices }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const panelId = useId();
  const [services, setServices] = useState(initialServices);
  const [form, setForm] = useState<ServiceForm>(EMPTY_FORM);
  const [editing, setEditing] = useState<ServiceRecord | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deactivating, setDeactivating] = useState<ServiceRecord | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();
  const activeCount = services.filter((service) => service.is_active).length;

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
    setMessage(null);
  };

  const openEdit = (service: ServiceRecord) => {
    setEditing(service);
    setForm({ name: service.name, default_rate: Number(service.default_rate).toFixed(2), unit: service.unit, description: service.description ?? "" });
    setFormOpen(true);
    setMessage(null);
  };

  const saveService = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startTransition(async () => {
      try {
        const input = { name: form.name, default_rate: Number(form.default_rate), unit: form.unit, description: form.description };
        const saved = editing ? await updateService(editing.id, input) : await createService(input);
        setServices((current) => editing ? current.map((service) => service.id === saved.id ? saved : service) : [...current, saved].sort((left, right) => left.name.localeCompare(right.name)));
        setFormOpen(false);
        setMessage({ text: `${saved.name} saved.`, error: false });
      } catch (error) {
        setMessage({ text: error instanceof Error ? error.message : "Unable to save service.", error: true });
      }
    });
  };

  const toggleService = (service: ServiceRecord) => startTransition(async () => {
    try {
      const updated = await updateService(service.id, { is_active: !service.is_active });
      setServices((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage({ text: `${updated.name} ${updated.is_active ? "activated" : "deactivated"}.`, error: false });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Unable to update service status.", error: true });
    }
  });

  const confirmDeactivate = () => {
    if (!deactivating) return;
    startTransition(async () => {
      try {
        const removed = await deleteService(deactivating.id);
        setServices((current) => current.map((service) => service.id === removed.id ? removed : service));
        setMessage({ text: `${removed.name} deactivated. Existing work logs are preserved.`, error: false });
        setDeactivating(null);
      } catch (error) {
        setMessage({ text: error instanceof Error ? error.message : "Unable to deactivate service.", error: true });
      }
    });
  };

  const refreshServices = () => startTransition(async () => {
    try {
      setServices(await getServices());
      setMessage({ text: "Service list refreshed.", error: false });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Unable to refresh services.", error: true });
    }
  });

  return <section id="service-pricing" className="mt-6 rounded-3xl bg-slate-950 p-4 text-slate-100 shadow-lg sm:p-6">
    <div className="flex flex-col gap-4 border-b border-slate-800 pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Operations setup</p>
        <h2 className="mt-1 text-xl font-bold text-white">Services &amp; pricing</h2>
        <p className="mt-1 text-sm text-slate-400">{activeCount} active of {services.length} configured services</p>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => setIsOpen((value) => !value)} aria-expanded={isOpen} aria-controls={panelId} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700">
          {isOpen ? "Hide section" : "Open section"}<ChevronDown className={`h-4 w-4 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
        </button>
        <button type="button" onClick={refreshServices} disabled={isPending} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-900 disabled:opacity-50">
          {isPending && <LoaderCircle className="h-4 w-4 animate-spin" />}Refresh
        </button>
        <button type="button" onClick={openCreate} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400">
          <Plus className="h-4 w-4" />Add service
        </button>
      </div>
    </div>

    {message && <p role="status" className={`mt-4 rounded-xl border px-3 py-2.5 text-sm ${message.error ? "border-rose-800 bg-rose-950/60 text-rose-200" : "border-emerald-800 bg-emerald-950/50 text-emerald-200"}`}>{message.text}</p>}

    <div id={panelId} aria-hidden={!isOpen} hidden={!isOpen} className={isOpen ? "mt-4" : ""}>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {services.map((service) => <article key={service.id} className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="break-words font-semibold text-white">{service.name}</h3>
            <p className="mt-1 line-clamp-2 min-h-10 text-sm text-slate-400">{service.description || "No description"}</p>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${service.is_active ? "bg-emerald-950 text-emerald-300" : "bg-slate-800 text-slate-400"}`}>{service.is_active ? "Active" : "Inactive"}</span>
        </div>
        <div className="mt-4 flex items-end justify-between gap-3 border-t border-slate-800 pt-3">
          <div><p className="text-2xl font-bold tabular-nums text-white">{money.format(Number(service.default_rate))}</p><p className="mt-0.5 text-xs text-cyan-300">{UNIT_LABELS[service.unit]}</p></div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => openEdit(service)} aria-label={`Edit ${service.name}`} title="Edit service" className="rounded-lg p-2 text-slate-300 hover:bg-slate-800 hover:text-white"><Pencil className="h-4 w-4" /></button>
            <button type="button" role="switch" aria-checked={service.is_active} onClick={() => toggleService(service)} disabled={isPending} aria-label={`${service.is_active ? "Deactivate" : "Activate"} ${service.name}`} title={service.is_active ? "Deactivate service" : "Activate service"} className={`rounded-lg p-2 disabled:opacity-50 ${service.is_active ? "text-emerald-300 hover:bg-slate-800" : "text-slate-500 hover:bg-slate-800 hover:text-emerald-300"}`}><Power className="h-4 w-4" /></button>
            {service.is_active && <button type="button" onClick={() => setDeactivating(service)} aria-label={`Delete ${service.name}`} title="Deactivate service" className="rounded-lg p-2 text-rose-300 hover:bg-rose-950/70"><Trash2 className="h-4 w-4" /></button>}
          </div>
        </div>
      </article>)}
      {services.length === 0 && <p className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-400 md:col-span-2 xl:col-span-3">No services configured.</p>}
    </div>
    </div>

    {formOpen && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/75 p-4" role="dialog" aria-modal="true" aria-labelledby="service-form-title">
      <form onSubmit={saveService} className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-5 text-slate-100 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300">Service catalog</p><h3 id="service-form-title" className="mt-1 text-lg font-bold text-white">{editing ? "Edit service" : "Add service"}</h3></div><button type="button" onClick={() => setFormOpen(false)} aria-label="Close form" className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-4 w-4" /></button></div>
        <div className="mt-5 grid gap-4">
          <label className="text-sm font-medium text-slate-300">Service name<input required maxLength={120} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white outline-none focus:border-cyan-400" /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-300">Rate (GBP)<input required type="number" min="0.01" step="0.01" value={form.default_rate} onChange={(event) => setForm((current) => ({ ...current, default_rate: event.target.value }))} className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white outline-none focus:border-cyan-400" /></label>
            <label className="text-sm font-medium text-slate-300">Billing unit<select value={form.unit} onChange={(event) => setForm((current) => ({ ...current, unit: event.target.value as BillingUnit }))} className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white outline-none focus:border-cyan-400">{Object.entries(UNIT_LABELS).map(([unit, label]) => <option key={unit} value={unit}>{label}</option>)}</select></label>
          </div>
          <label className="text-sm font-medium text-slate-300">Description<textarea rows={3} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className="mt-1.5 w-full resize-y rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-white outline-none focus:border-cyan-400" /></label>
        </div>
        {message?.error && <p role="alert" className="mt-4 rounded-lg border border-rose-800 bg-rose-950/60 px-3 py-2 text-sm text-rose-200">{message.text}</p>}
        <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setFormOpen(false)} className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-800">Cancel</button><button type="submit" disabled={isPending} className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50">{isPending && <LoaderCircle className="h-4 w-4 animate-spin" />}{editing ? "Save changes" : "Create service"}</button></div>
      </form>
    </div>}

    {deactivating && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/75 p-4" role="alertdialog" aria-modal="true" aria-labelledby="service-delete-title">
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 text-slate-100 shadow-2xl">
        <h3 id="service-delete-title" className="text-lg font-bold text-white">Deactivate {deactivating.name}?</h3>
        <p className="mt-2 text-sm leading-6 text-slate-300">The service will no longer be available for new tasks. Existing work logs and their service references will remain intact.</p>
        <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setDeactivating(null)} className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-800">Cancel</button><button type="button" onClick={confirmDeactivate} disabled={isPending} className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-50">{isPending && <LoaderCircle className="h-4 w-4 animate-spin" />}Deactivate</button></div>
      </div>
    </div>}
  </section>;
}