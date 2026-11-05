"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { Building2, LoaderCircle, Pencil, Plus, Power, Trash2, X } from "lucide-react";
import { createService, deleteService, getServices, updateService, type ServiceRecord } from "./serviceActions";
import type { PropertyRecord } from "./propertyActions";
import { PropertySetup, type PropertySetupHandle } from "./PropertySetup";
import type { BillingUnit } from "@/lib/servicePricing";
import { showActionToast } from "@/components/ui/ActionToast";
import { ActionErrorMessage } from "@/components/ui/ActionErrorMessage";
import { formatUserMessage } from "@/lib/userMessages";

type ServiceForm = { name: string; default_rate: string; unit: BillingUnit; description: string };
type Props = {
  initialServices: ServiceRecord[];
  initialProperties: PropertyRecord[];
  propertyAssignees: { id: string; name: string; role: "owner" | "manager" }[];
  canManageServices?: boolean;
  canManageProperties?: boolean;
};

const EMPTY_FORM: ServiceForm = { name: "", default_rate: "15.00", unit: "hourly", description: "" };
const UNIT_LABELS: Record<BillingUnit, string> = { hourly: "Hourly", per_room: "Per room", fixed: "Fixed per task" };
const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

export function ServicePricingManager({ initialServices, initialProperties, propertyAssignees, canManageServices = true, canManageProperties = true }: Props) {
  const propertySetupRef = useRef<PropertySetupHandle>(null);
  const [services, setServices] = useState(initialServices);
  const [form, setForm] = useState<ServiceForm>(EMPTY_FORM);
  const [editing, setEditing] = useState<ServiceRecord | null>(null);
  const [viewing, setViewing] = useState<ServiceRecord | null>(null);
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
        const message = `${saved.name} saved.`;
        setMessage({ text: message, error: false });
        showActionToast("success", message);
      } catch (error) {
        const message = formatUserMessage(error, "Unable to save service.");
        setMessage({ text: message, error: true });
        showActionToast("error", message);
      }
    });
  };

  const toggleService = (service: ServiceRecord) => startTransition(async () => {
    try {
      const updated = await updateService(service.id, { is_active: !service.is_active });
      setServices((current) => current.map((item) => item.id === updated.id ? updated : item));
      const message = `${updated.name} ${updated.is_active ? "activated" : "deactivated"}.`;
      setMessage({ text: message, error: false });
      showActionToast("success", message);
    } catch (error) {
      const message = formatUserMessage(error, "Unable to update service status.");
      setMessage({ text: message, error: true });
      showActionToast("error", message);
    }
  });

  const confirmDeactivate = () => {
    if (!deactivating) return;
    startTransition(async () => {
      try {
        const removed = await deleteService(deactivating.id);
        setServices((current) => current.map((service) => service.id === removed.id ? removed : service));
        const message = `${removed.name} deactivated. Existing work logs are preserved.`;
        setMessage({ text: message, error: false });
        showActionToast("success", message);
        setDeactivating(null);
      } catch (error) {
        const message = formatUserMessage(error, "Unable to deactivate service.");
        setMessage({ text: message, error: true });
        showActionToast("error", message);
      }
    });
  };

  const refreshServices = () => startTransition(async () => {
    try {
      setServices(await getServices());
      setMessage({ text: "Service list refreshed.", error: false });
    } catch (error) {
      setMessage({ text: formatUserMessage(error, "Unable to refresh services."), error: true });
    }
  });

  return <section id="service-pricing" className="min-w-0 space-y-5 text-ink">
    <div className="flex flex-col gap-4 border-b border-line pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-800">Operations setup</p>
        <h2 className="mt-1 text-xl font-bold text-ink">Setup Property &amp; Services</h2>
        <p className="mt-1 text-sm text-ink-secondary">{initialProperties.length} properties · {activeCount} active of {services.length} configured services</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {canManageProperties && <button type="button" onClick={() => propertySetupRef.current?.openCreate()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink-secondary shadow-sm hover:bg-surface-secondary">
          {isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Building2 className="h-4 w-4" />}Add / Setup Property
        </button>}
        <button type="button" onClick={refreshServices} disabled={isPending} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink-secondary shadow-sm hover:bg-surface-secondary disabled:opacity-50">
          {isPending && <LoaderCircle className="h-4 w-4 animate-spin" />}Refresh
        </button>
        {canManageServices && <button type="button" onClick={openCreate} disabled={isPending} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
          {isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{isPending ? "Updating…" : "Add service"}
        </button>}
      </div>
    </div>

    {message?.error ? <ActionErrorMessage error={message.text} /> : message && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">{message.text}</p>}

    <div className="space-y-3">
    <div className="flex items-center justify-between px-1 text-xs font-semibold uppercase tracking-wide text-ink-muted"><span>Configured services</span><span>{services.length} total</span></div>
    <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {services.map((service) => <article key={service.id} className="min-w-0 rounded-2xl border border-line/80 bg-surface p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <button type="button" onClick={() => setViewing(service)} className="min-h-11 break-words text-left font-semibold text-ink underline decoration-slate-300 underline-offset-4 hover:decoration-cyan-700">{service.name}</button>
            <p className="mt-1 line-clamp-2 min-h-10 text-sm text-ink-secondary">{service.description || "No description"}</p>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${service.is_active ? "bg-emerald-50 text-emerald-800" : "bg-surface-secondary text-ink-secondary"}`}>{service.is_active ? "Active" : "Inactive"}</span>
        </div>
        <div className="mt-4 flex items-end justify-between gap-3 border-t border-line pt-3">
          <div><p className="text-2xl font-bold tabular-nums text-ink">{money.format(Number(service.default_rate))}</p><p className="mt-0.5 text-xs text-cyan-800">{UNIT_LABELS[service.unit]}</p></div>
          {canManageServices && <div className="flex items-center gap-1">
            <button type="button" onClick={() => openEdit(service)} disabled={isPending} aria-label={`Edit ${service.name}`} title="Edit service" className="flex h-11 w-11 items-center justify-center rounded-lg text-ink-secondary hover:bg-surface-secondary hover:text-ink disabled:opacity-50"><Pencil className="h-4 w-4" /></button>
            <button type="button" role="switch" aria-checked={service.is_active} onClick={() => toggleService(service)} disabled={isPending} aria-label={`${service.is_active ? "Deactivate" : "Activate"} ${service.name}`} title={service.is_active ? "Deactivate service" : "Activate service"} className={`flex h-11 w-11 items-center justify-center rounded-lg disabled:opacity-50 ${service.is_active ? "text-emerald-700 hover:bg-emerald-50" : "text-ink-muted hover:bg-surface-secondary hover:text-emerald-700"}`}><Power className="h-4 w-4" /></button>
            {service.is_active && <button type="button" onClick={() => setDeactivating(service)} disabled={isPending} aria-label={`Delete ${service.name}`} title="Deactivate service" className="flex h-11 w-11 items-center justify-center rounded-lg text-rose-700 hover:bg-rose-50 disabled:opacity-50"><Trash2 className="h-4 w-4" /></button>}
          </div>}
        </div>
      </article>)}
      {services.length === 0 && <p className="rounded-xl border border-dashed border-line bg-surface p-8 text-center text-sm text-ink-secondary sm:col-span-2 xl:col-span-3">No services configured.</p>}
    </div>
    </div>

    <PropertySetup ref={propertySetupRef} initialProperties={initialProperties} assignees={propertyAssignees} canManage={canManageProperties} />

    {viewing && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/75 p-4" role="dialog" aria-modal="true" aria-labelledby="service-details-title">
      <section className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl border border-line bg-surface p-5 text-ink shadow-2xl">
        <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-800">Service details</p><h3 id="service-details-title" className="mt-1 text-lg font-bold text-ink">{viewing.name}</h3></div><button type="button" onClick={() => setViewing(null)} aria-label="Close service details" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-secondary hover:text-ink"><X className="h-4 w-4" /></button></div>
        <p className="mt-4 text-sm text-ink-secondary">{viewing.description || "No description"}</p>
        <dl className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-surface-secondary p-4 text-sm ring-1 ring-line"><div><dt className="text-ink-secondary">Rate</dt><dd className="mt-1 font-semibold text-ink">{money.format(Number(viewing.default_rate))}</dd></div><div><dt className="text-ink-secondary">Billing unit</dt><dd className="mt-1 font-semibold text-ink">{UNIT_LABELS[viewing.unit]}</dd></div><div><dt className="text-ink-secondary">Status</dt><dd className="mt-1 font-semibold text-ink">{viewing.is_active ? "Active" : "Inactive"}</dd></div><div><dt className="text-ink-secondary">Created</dt><dd className="mt-1 font-semibold text-ink">{new Date(viewing.created_at).toLocaleDateString()}</dd></div></dl>
        <div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => setViewing(null)} className="min-h-11 rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-ink-secondary hover:bg-surface-secondary">Close</button>{canManageServices && <button type="button" onClick={() => { openEdit(viewing); setViewing(null); }} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800"><Pencil className="h-4 w-4" />Edit</button>}{canManageServices && viewing.is_active && <button type="button" onClick={() => { setDeactivating(viewing); setViewing(null); }} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-rose-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-800"><Trash2 className="h-4 w-4" />Delete</button>}</div>
      </section>
    </div>}

    {canManageServices && formOpen && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/75 p-4" role="dialog" aria-modal="true" aria-labelledby="service-form-title">
      <form onSubmit={saveService} className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl border border-line bg-surface p-5 text-ink shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-800">Service catalog</p><h3 id="service-form-title" className="mt-1 text-lg font-bold text-ink">{editing ? "Edit service" : "Add service"}</h3></div><button type="button" onClick={() => setFormOpen(false)} aria-label="Close form" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-secondary hover:text-ink"><X className="h-4 w-4" /></button></div>
        <div className="mt-5 grid gap-4">
          <label className="text-sm font-medium text-ink-secondary">Service name<input required maxLength={120} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className="mt-1.5 min-h-11 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-ink outline-none focus:border-cyan-700" /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-ink-secondary">Rate (GBP)<input required type="number" min="0.01" step="0.01" value={form.default_rate} onChange={(event) => setForm((current) => ({ ...current, default_rate: event.target.value }))} className="mt-1.5 min-h-11 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-ink outline-none focus:border-cyan-700" /></label>
            <label className="text-sm font-medium text-ink-secondary">Billing unit<select value={form.unit} onChange={(event) => setForm((current) => ({ ...current, unit: event.target.value as BillingUnit }))} className="mt-1.5 min-h-11 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-ink outline-none focus:border-cyan-700">{Object.entries(UNIT_LABELS).map(([unit, label]) => <option key={unit} value={unit}>{label}</option>)}</select></label>
          </div>
          <label className="text-sm font-medium text-ink-secondary">Description<textarea rows={3} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className="mt-1.5 w-full resize-y rounded-xl border border-line bg-surface px-3 py-2.5 text-ink outline-none focus:border-cyan-700" /></label>
        </div>
        {message?.error && <ActionErrorMessage error={message.text} className="mt-4" />}
        <div className="mt-6 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => setFormOpen(false)} className="min-h-11 rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-ink-secondary hover:bg-surface-secondary">Cancel</button><button type="submit" disabled={isPending} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">{isPending && <LoaderCircle className="h-4 w-4 animate-spin" />}{editing ? "Save changes" : "Create service"}</button></div>
      </form>
    </div>}

    {canManageServices && deactivating && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/75 p-4" role="alertdialog" aria-modal="true" aria-labelledby="service-delete-title">
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto overscroll-contain rounded-2xl border border-line bg-surface p-5 text-ink shadow-2xl">
        <h3 id="service-delete-title" className="text-lg font-bold text-ink">Deactivate {deactivating.name}?</h3>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">The service will no longer be available for new tasks. Existing work logs and their service references will remain intact.</p>
        <div className="mt-6 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => setDeactivating(null)} className="min-h-11 rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-ink-secondary hover:bg-surface-secondary">Cancel</button><button type="button" onClick={confirmDeactivate} disabled={isPending} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-rose-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-800 disabled:opacity-50">{isPending && <LoaderCircle className="h-4 w-4 animate-spin" />}Deactivate</button></div>
      </div>
    </div>}
  </section>;
}