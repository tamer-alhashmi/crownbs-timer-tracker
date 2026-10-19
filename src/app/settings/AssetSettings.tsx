"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Building2, ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import {
  archiveOwnedProperty,
  archiveServiceConfiguration,
  createOwnedProperty,
  createServiceConfiguration,
  updateOwnedProperty,
  updateServiceConfiguration,
} from "./actions";

type Service = {
  id: string;
  hotel_id: string | null;
  name: string;
  description: string;
  unit: "hourly" | "per_room" | "fixed";
  default_rate: number | string;
  is_active: boolean;
  owner_id: string | null;
};
type Property = {
  id: string;
  name: string;
  location: string;
  roomCount: number;
  floorCount: number;
  isActive: boolean;
  managerId: string | null;
  managerName: string | null;
  services: Service[];
};
type Manager = { id: string; full_name: string };
const fieldClass = "min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900";
const propertySchema = z.object({
  name: z.string().trim().min(1, "Enter a property name.").max(120),
  location: z.string().trim().min(1, "Enter an address or location.").max(240),
  roomCount: z.string().regex(/^\d{1,6}$/, "Enter a whole number of rooms."),
  floorCount: z.string().regex(/^\d{1,4}$/, "Enter a whole number of floors."),
  managerId: z.string(),
});
type PropertyValues = z.infer<typeof propertySchema>;
const serviceSchema = z.object({
  name: z.string().trim().min(1, "Enter a service name.").max(120),
  description: z.string().max(1000, "Use 1,000 characters or fewer."),
  unit: z.enum(["per_room", "hourly", "fixed"]),
  rate: z.string().regex(/^\d{1,7}(\.\d{1,2})?$/, "Enter a valid non-negative rate."),
  isActive: z.boolean(),
});
type ServiceValues = z.infer<typeof serviceSchema>;

export function PropertySettings({ properties, managers }: { properties: Property[]; managers: Manager[] }) {
  const [editing, setEditing] = useState<Property | null>(null);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const form = useForm<PropertyValues>({
    resolver: zodResolver(propertySchema),
    defaultValues: { name: "", location: "", roomCount: "0", floorCount: "0", managerId: "" },
  });

  const beginEdit = (property: Property) => {
    setEditing(property);
    setAdding(false);
    form.reset({ name: property.name, location: property.location, roomCount: String(property.roomCount), floorCount: String(property.floorCount), managerId: property.managerId ?? "" });
    setMessage("");
  };
  const beginAdd = () => {
    setEditing(null);
    setAdding(true);
    form.reset({ name: "", location: "", roomCount: "0", floorCount: "0", managerId: "" });
    setMessage("");
  };
  const saveProperty = form.handleSubmit((values) => startTransition(async () => {
    setMessage("");
    const input = { name: values.name, location: values.location, roomCount: Number(values.roomCount), floorCount: Number(values.floorCount), managerId: values.managerId || null };
    const result = editing ? await updateOwnedProperty(editing.id, input) : await createOwnedProperty(input);
    if (!result.success) {
      setMessage(result.error);
      return;
    }
    setMessage(editing ? "Property details saved." : "Property created.");
    setAdding(false);
    setEditing(null);
    router.refresh();
  }));
  const archive = (property: Property) => {
    if (!window.confirm(`Archive ${property.name}? Staff and work history will be retained.`)) return;
    startTransition(async () => {
      const result = await archiveOwnedProperty(property.id);
      setMessage(result.success ? `${property.name} archived.` : result.error);
      if (result.success) router.refresh();
    });
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-sky-700">Property setup</p><h2 className="mt-1 text-xl font-bold text-slate-950">Properties & Hotels</h2><p className="mt-1 text-sm text-slate-600">Keep property details, staffing, and service rates together.</p></div>
        <button type="button" onClick={beginAdd} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white"><Plus className="h-4 w-4" /> Add property</button>
      </div>
      {(adding || editing) && (
        <form onSubmit={saveProperty} noValidate className="rounded-2xl border border-sky-100 bg-white p-5 shadow-sm sm:p-6">
          <h3 className="font-bold text-slate-950">{editing ? `Edit ${editing.name}` : "Add a property"}</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Input label="Property name" error={form.formState.errors.name?.message}><input {...form.register("name")} className={fieldClass} autoComplete="organization" /></Input>
            <Input label="Address / location" error={form.formState.errors.location?.message}><input {...form.register("location")} className={fieldClass} autoComplete="street-address" /></Input>
            <Input label="Total rooms" error={form.formState.errors.roomCount?.message}><input {...form.register("roomCount")} type="number" min="0" step="1" className={fieldClass} /></Input>
            <Input label="Floors / sections" error={form.formState.errors.floorCount?.message}><input {...form.register("floorCount")} type="number" min="0" step="1" className={fieldClass} /></Input>
            <Input label="Assigned manager"><select {...form.register("managerId")} className={fieldClass}><option value="">No manager assigned</option>{managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.full_name}</option>)}</select></Input>
          </div>
          {message && <p role="alert" className="mt-3 text-sm text-rose-700">{message}</p>}
          <div className="mt-4 flex gap-2">
            <button type="submit" disabled={isPending} className="min-h-11 rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{isPending ? "Saving…" : editing ? "Save property" : "Create property"}</button>
            <button type="button" onClick={() => { setAdding(false); setEditing(null); setMessage(""); }} className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-semibold">Cancel</button>
          </div>
        </form>
      )}
      {message && !adding && !editing && <p role="status" className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">{message}</p>}

      <ul className="space-y-4">
        {properties.length ? properties.map((property) => (
          <li key={property.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-sky-50 text-sky-800"><Building2 className="h-5 w-5" /></span><div><h3 className="font-bold text-slate-950">{property.name}{!property.isActive && <span className="ml-2 rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-500">Archived</span>}</h3><p className="mt-1 text-sm text-slate-600">{property.location}</p><p className="mt-1 text-xs text-slate-500">{property.roomCount} rooms · {property.floorCount} floors/sections · {property.managerName ?? "No manager assigned"}</p></div></div>
              <div className="flex gap-2"><button type="button" onClick={() => beginEdit(property)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-semibold"><Pencil className="h-4 w-4" /> Edit</button>{property.isActive && <button type="button" onClick={() => archive(property)} disabled={isPending} className="min-h-10 rounded-lg border border-amber-200 px-3 text-sm font-semibold text-amber-800">Archive</button>}</div>
            </div>
            <PropertyServiceCatalog property={property} />
          </li>
        )) : <li className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-sm text-slate-500">No properties have been created yet. Add a property to configure its services and rates.</li>}
      </ul>
    </section>
  );
}

function PropertyServiceCatalog({ property }: { property: Property }) {
  const [isOpen, setIsOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [message, setMessage] = useState("");
  const [messageError, setMessageError] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const form = useForm<ServiceValues>({
    resolver: zodResolver(serviceSchema),
    defaultValues: { name: "", description: "", unit: "per_room", rate: "0", isActive: true },
  });
  const services = property.services ?? [];
  const beginNew = () => {
    setEditing(null);
    setShowForm(true);
    form.reset({ name: "", description: "", unit: "per_room", rate: "0", isActive: true });
    setMessage("");
    setMessageError(false);
  };
  const edit = (service: Service) => {
    setEditing(service);
    setShowForm(true);
    form.reset({ name: service.name, description: service.description, unit: service.unit, rate: String(service.default_rate), isActive: service.is_active });
    setMessage("");
    setMessageError(false);
  };
  const save = form.handleSubmit((values) => startTransition(async () => {
    setMessage("");
    setMessageError(false);
    const result = await (editing
      ? updateServiceConfiguration(editing.id, { hotelId: property.id, ...values, defaultRate: Number(values.rate) })
      : createServiceConfiguration({ hotelId: property.id, ...values, defaultRate: Number(values.rate) }));
    if (!result.success) {
      setMessage(result.error);
      setMessageError(true);
      return;
    }
    setMessage(editing ? "Service updated." : "Service added.");
    setEditing(null);
    setShowForm(false);
    form.reset({ name: "", description: "", unit: "per_room", rate: "0", isActive: true });
    router.refresh();
  }));
  const toggleActive = (service: Service) => startTransition(async () => {
    const result = await updateServiceConfiguration(service.id, {
      hotelId: property.id,
      name: service.name,
      description: service.description,
      unit: service.unit,
      defaultRate: Number(service.default_rate),
      isActive: !service.is_active,
    });
    setMessage(result.success ? `${service.name} ${service.is_active ? "deactivated" : "activated"}.` : result.error);
    setMessageError(!result.success);
    if (result.success) router.refresh();
  });
  const remove = (service: Service) => {
    if (!window.confirm(`Delete ${service.name}? It will be deactivated so existing work history is preserved.`)) return;
    startTransition(async () => {
      const result = await archiveServiceConfiguration(service.id, property.id);
      setMessage(result.success ? `${service.name} deleted from active services.` : result.error);
      setMessageError(!result.success);
      if (result.success) router.refresh();
    });
  };

  return (
    <details open={isOpen} onToggle={(event) => setIsOpen(event.currentTarget.open)} className="border-t border-slate-100">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-sm font-bold text-slate-800"><span>Services & Rates <span className="ml-1 rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{services.filter((service) => service.hotel_id === property.id).length}</span></span><ChevronDown className="h-4 w-4" /></summary>
      <div className="space-y-4 border-t border-slate-100 bg-slate-50/70 p-4 sm:p-5">
        <p className="text-sm text-slate-600">Create property-specific task types and rates. Shared catalog entries remain available to this property.</p>
        {services.length > 0 && <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
          {services.map((service) => <li key={service.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div><p className="font-semibold text-slate-900">{service.name}{!service.is_active && <span className="ml-2 text-xs text-slate-500">Inactive</span>}{service.hotel_id === null && <span className="ml-2 text-xs text-sky-700">Shared catalog</span>}</p><p className="text-xs text-slate-500">{service.description || service.unit.replace("_", " ")} · {service.unit.replace("_", " ")} · £{Number(service.default_rate).toFixed(2)}</p></div>
            {service.hotel_id === property.id && <div className="flex items-center gap-2"><label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600"><input type="checkbox" checked={service.is_active} onChange={() => toggleActive(service)} disabled={isPending} />Active</label><button type="button" onClick={() => edit(service)} className="min-h-9 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold">Edit</button><button type="button" onClick={() => remove(service)} disabled={isPending} aria-label={`Delete ${service.name}`} className="grid h-9 w-9 place-items-center rounded-lg border border-rose-200 text-rose-700"><Trash2 className="h-4 w-4" /></button></div>}
          </li>)}
        </ul>}
        <button type="button" onClick={() => { beginNew(); setIsOpen(true); }} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800"><Plus className="h-4 w-4" /> Add custom service</button>
        {showForm && (
          <form onSubmit={save} noValidate className="rounded-xl border border-slate-200 bg-white p-4">
            <h4 className="font-bold text-slate-900">{editing ? "Edit service" : "Add custom service"}</h4>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Input label="Service name" error={form.formState.errors.name?.message}><input {...form.register("name")} className={fieldClass} placeholder="Cleaning Per Room" /></Input>
              <Input label="Billing mode"><select {...form.register("unit")} className={fieldClass}><option value="per_room">Per Room</option><option value="hourly">Hourly</option><option value="fixed">Fixed</option></select></Input>
              <Input label="Rate / cost (£)" error={form.formState.errors.rate?.message}><input {...form.register("rate")} type="number" min="0" step="0.01" className={fieldClass} /></Input>
              <Input label="Description"><input {...form.register("description")} className={fieldClass} placeholder="Optional task details" /></Input>
            </div>
            <label className="mt-3 inline-flex min-h-9 items-center gap-2 text-sm font-medium text-slate-700"><input type="checkbox" {...form.register("isActive")} />Active service</label>
            <div className="mt-3 flex gap-2"><button type="submit" disabled={isPending} className="min-h-10 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white">{isPending ? "Saving…" : editing ? "Save service" : "Add service"}</button><button type="button" onClick={() => { setEditing(null); setShowForm(false); setMessage(""); setMessageError(false); }} className="min-h-10 rounded-lg border border-slate-200 px-4 text-sm font-semibold">Cancel</button></div>
          </form>
        )}
        {message && <p role={messageError ? "alert" : "status"} className={`text-sm ${messageError ? "text-rose-700" : "text-slate-600"}`}>{message}</p>}
      </div>
    </details>
  );
}

function Input({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return <label className="block text-sm font-medium text-slate-700">{label}{children}{error && <span role="alert" className="mt-1 block text-xs text-rose-700">{error}</span>}</label>;
}
