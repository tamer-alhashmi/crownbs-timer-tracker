"use client";

import { forwardRef, useCallback, useImperativeHandle, useState, useTransition, type FormEvent } from "react";
import { Loader2, MapPin, Pencil, Plus, Power, X } from "lucide-react";
import { createProperty, getPropertyRooms, updateProperty, type PropertyRecord, type RoomSetupInput } from "./propertyActions";
import { showActionToast } from "@/components/ui/ActionToast";

type Assignee = { id: string; name: string; role: "owner" | "manager" };
type RoomDraft = RoomSetupInput & { photoFiles: File[]; photos: string[] };
type PropertyForm = {
  name: string;
  location: string;
  owner_id: string;
  manager_id: string;
  latitude: number | null;
  longitude: number | null;
  floors_sections: string[];
  total_rooms: number;
  rooms: RoomDraft[];
};

const EMPTY_FORM: PropertyForm = { name: "", location: "", owner_id: "", manager_id: "", latitude: null, longitude: null, floors_sections: [], total_rooms: 0, rooms: [] };
const newRoom = (roomName: string): RoomDraft => ({
  room_name: roomName,
  floor_section: "",
  category: "Standard",
  max_capacity: 2,
  adults_capacity: 2,
  children_capacity: 0,
  bedroom_count: 1,
  bed_configuration: "",
  amenities: [],
  status: "active",
  photoFiles: [],
  photos: [],
});

export type PropertySetupHandle = { openCreate: () => void };

export const PropertySetup = forwardRef<PropertySetupHandle, { initialProperties: PropertyRecord[]; assignees: Assignee[]; canManage?: boolean }>(function PropertySetup({ initialProperties, assignees, canManage = true }, ref) {
  const [properties, setProperties] = useState(initialProperties);
  const [editing, setEditing] = useState<PropertyRecord | null>(null);
  const [form, setForm] = useState<PropertyForm>(EMPTY_FORM);
  const [newFloor, setNewFloor] = useState("");
  const [roomRange, setRoomRange] = useState({ from: "101", to: "120" });
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
    setNewFloor("");
    setRoomRange({ from: "101", to: "120" });
    setFormOpen(true);
    setMessage(null);
  }, []);
  useImperativeHandle(ref, () => ({ openCreate }), [openCreate]);

  const openEdit = (property: PropertyRecord) => {
    setEditing(property);
    setForm({
      name: property.name,
      location: property.location ?? "",
      owner_id: property.owner_id ?? "",
      manager_id: property.manager_id ?? "",
      latitude: property.latitude,
      longitude: property.longitude,
      floors_sections: property.floors_sections ?? [],
      total_rooms: property.total_rooms ?? 0,
      rooms: [],
    });
    setFormOpen(true);
    setMessage(null);
    startTransition(async () => {
      try {
        const rooms = await getPropertyRooms(property.id);
        setForm((current) => ({ ...current, rooms: rooms.map((room) => ({ ...room, photoFiles: [] })) }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to load property rooms.";
        setMessage({ text: message, error: true });
        showActionToast("error", message);
      }
    });
  };

  const saveProperty = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startTransition(async () => {
      let saved: PropertyRecord;
      try {
        saved = editing
          ? await updateProperty(editing.id, { ...form, rooms: form.rooms })
          : await createProperty({ ...form, rooms: form.rooms });
      } catch (error) {
        setMessage({ text: error instanceof Error ? error.message : "Unable to save property.", error: true });
        return;
      }
      setProperties((current) => {
        const next = current.some((property) => property.id === saved.id)
          ? current.map((property) => property.id === saved.id ? saved : property)
          : [...current, saved];
        return next.sort((left, right) => left.name.localeCompare(right.name));
      });
      setFormOpen(false);
      setMessage({ text: `${saved.name} saved.`, error: false });
      showActionToast("success", `${saved.name} ${editing ? "updated" : "created"}.`);
      try {
        for (const room of form.rooms) {
          for (const file of room.photoFiles) {
            const photoForm = new FormData();
            photoForm.set("hotelId", saved.id);
            photoForm.set("roomName", room.room_name);
            photoForm.set("category", room.category);
            photoForm.set("file", file);
            const response = await fetch("/api/admin/rooms/photo", { method: "POST", body: photoForm });
            const result: { error?: string } = await response.json();
            if (!response.ok) throw new Error(result.error ?? "Room photo upload failed.");
          }
        }
      } catch (error) {
        const message = error instanceof Error ? `Property saved; photo upload failed: ${error.message}` : "Property saved, but photo upload failed.";
        setMessage({ text: message, error: true });
        showActionToast("error", message);
      }
    });
  };

  const locateProperty = () => {
    if (!navigator.geolocation) {
      setMessage({ text: "This device does not support location detection.", error: true });
      return;
    }
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      setForm((current) => ({ ...current, latitude: coords.latitude, longitude: coords.longitude }));
      try {
        const params = new URLSearchParams({ format: "jsonv2", lat: String(coords.latitude), lon: String(coords.longitude) });
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`);
        if (!response.ok) throw new Error("Reverse geocoding service is unavailable.");
        const data: { display_name?: string } = await response.json();
        const address = data.display_name;
        if (address) setForm((current) => ({ ...current, location: address.slice(0, 240) }));
        else setMessage({ text: "Location was detected but no formatted address was found.", error: true });
      } catch (error) {
        setMessage({ text: error instanceof Error ? error.message : "Unable to find an address for this location.", error: true });
      }
    }, (error) => setMessage({ text: error.message || "Unable to access device location.", error: true }), { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 });
  };

  const generateRooms = () => {
    const from = Number(roomRange.from);
    const to = Number(roomRange.to);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to - from > 1999) {
      setMessage({ text: "Enter a valid room range of up to 2,000 rooms.", error: true });
      return;
    }
    const additions = Array.from({ length: to - from + 1 }, (_, index) => newRoom(String(from + index)));
    setForm((current) => {
      const rooms = [...current.rooms, ...additions.filter((room) => !current.rooms.some((existing) => existing.room_name === room.room_name))];
      return { ...current, rooms, total_rooms: Math.max(current.total_rooms, rooms.length) };
    });
  };

  const updateRoom = (index: number, changes: Partial<RoomDraft>) => {
    setForm((current) => ({ ...current, rooms: current.rooms.map((room, roomIndex) => roomIndex === index ? { ...room, ...changes } : room) }));
  };

  const toggleProperty = (property: PropertyRecord) => startTransition(async () => {
    try {
      const updated = await updateProperty(property.id, {
        name: property.name,
        location: property.location ?? "",
        owner_id: property.owner_id ?? "",
        manager_id: property.manager_id ?? "",
        latitude: property.latitude,
        longitude: property.longitude,
        floors_sections: property.floors_sections ?? [],
        total_rooms: property.total_rooms ?? 0,
        rooms: [],
        is_active: !property.is_active,
      });
      setProperties((current) => current.map((item) => item.id === updated.id ? updated : item));
      const message = `${updated.name} ${updated.is_active ? "activated" : "deactivated"}.`;
      setMessage({ text: message, error: false });
      showActionToast("success", message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update property status.";
      setMessage({ text: message, error: true });
      showActionToast("error", message);
    }
  });

  return <section className="min-w-0 border-t border-slate-200 pt-5" aria-labelledby="property-setup-title">
    <div className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
      <div><h3 id="property-setup-title" className="text-lg font-bold text-slate-950">Properties</h3><p className="mt-1 text-sm text-slate-600">{canManage ? "Manage properties, assignments, and active status" : "Properties and current management assignments"} · {properties.length} total</p></div>
    </div>
    {message && <p role={message.error ? "alert" : "status"} className={`mb-3 rounded-lg border px-3 py-2 text-sm ${message.error ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{message.text}</p>}
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {properties.map((property) => <article key={property.id} className="min-w-0 rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h4 className="break-words font-semibold text-slate-900">{property.name}</h4><p className="mt-1 text-sm text-slate-600">{property.location || "No location"}</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${property.is_active ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{property.is_active ? "Active" : "Inactive"}</span></div>
        <dl className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-xs text-slate-600"><div className="flex justify-between gap-3"><dt>Owner</dt><dd className="text-right text-slate-800">{ownerNames.get(property.owner_id ?? "") ?? "Unassigned"}</dd></div><div className="flex justify-between gap-3"><dt>Manager</dt><dd className="text-right text-slate-800">{managerNames.get(property.manager_id ?? "") ?? "Unassigned"}</dd></div><div><dt className="sr-only">Property UUID</dt><dd className="break-all font-mono text-[11px]">{property.id}</dd></div><div className="flex justify-between gap-3"><dt>Created</dt><dd>{new Date(property.created_at).toLocaleString()}</dd></div></dl>
        {canManage && <div className="mt-3 flex justify-end gap-1 border-t border-slate-100 pt-2">
          <button type="button" onClick={() => openEdit(property)} aria-label={`Edit ${property.name}`} title="Edit property" className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-950"><Pencil className="h-4 w-4" /></button>
          <button type="button" role="switch" aria-checked={property.is_active} onClick={() => toggleProperty(property)} disabled={isPending} aria-label={`${property.is_active ? "Deactivate" : "Activate"} ${property.name}`} title={property.is_active ? "Deactivate property" : "Activate property"} className={`flex h-11 w-11 items-center justify-center rounded-lg disabled:opacity-50 ${property.is_active ? "text-emerald-700 hover:bg-emerald-50" : "text-slate-500 hover:bg-slate-100 hover:text-emerald-700"}`}><Power className="h-4 w-4" /></button>
        </div>}
      </article>)}
      {!properties.length && <p className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600 sm:col-span-2 xl:col-span-3">No properties configured.</p>}
      </div>
    {canManage && formOpen && <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-labelledby="property-form-title">
      <form onSubmit={saveProperty} className="my-auto max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-800">Property setup</p><h3 id="property-form-title" className="mt-1 text-lg font-bold text-slate-950">{editing ? "Edit property" : "Add property"}</h3></div><button type="button" onClick={() => setFormOpen(false)} aria-label="Close form" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"><X className="h-4 w-4" /></button></div>
        <div className="mt-5 grid gap-4">
          <label className="text-sm font-medium text-slate-700">Property name<input required maxLength={120} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-slate-900 outline-none focus:border-cyan-700" /></label>
          <div className="text-sm font-medium text-slate-700"><label htmlFor="property-location">Address / location</label><div className="mt-1.5 flex gap-2"><input id="property-location" required maxLength={240} value={form.location} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))} className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-slate-900 outline-none focus:border-cyan-700" /><button type="button" onClick={locateProperty} aria-label="Detect property location" title="Detect current location" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-cyan-800 hover:bg-cyan-50"><MapPin className="h-5 w-5" /></button></div>{form.latitude !== null && form.longitude !== null && <p className="mt-1 text-xs text-slate-500">GPS: {form.latitude.toFixed(5)}, {form.longitude.toFixed(5)}</p>}</div>
          <section className="rounded-xl border border-slate-200 p-3">
            <h4 className="text-sm font-semibold text-slate-800">Floors and sections</h4>
            <div className="mt-2 flex gap-2"><input value={newFloor} onChange={(event) => setNewFloor(event.target.value)} maxLength={80} placeholder="e.g. Ground Floor" className="min-h-10 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" /><button type="button" onClick={() => { const name = newFloor.trim(); if (name && !form.floors_sections.includes(name)) setForm((current) => ({ ...current, floors_sections: [...current.floors_sections, name] })); setNewFloor(""); }} className="inline-flex min-h-10 items-center gap-1 rounded-lg bg-slate-100 px-3 text-sm font-medium text-slate-700"><Plus className="h-4 w-4" />Add</button></div>
            <div className="mt-2 flex flex-wrap gap-2">{form.floors_sections.map((floor) => <button key={floor} type="button" onClick={() => setForm((current) => ({ ...current, floors_sections: current.floors_sections.filter((item) => item !== floor), rooms: current.rooms.map((room) => room.floor_section === floor ? { ...room, floor_section: "" } : room) }))} className="rounded-full bg-cyan-50 px-3 py-1.5 text-xs font-medium text-cyan-900">{floor} ×</button>)}</div>
          </section>
          <section className="rounded-xl border border-slate-200 p-3">
            <div className="flex items-center justify-between gap-3"><div><h4 className="text-sm font-semibold text-slate-800">Room configuration</h4><p className="mt-1 text-xs text-slate-500">Set up rooms before completing property creation.</p></div><label className="text-xs font-medium text-slate-600">Total rooms<input type="number" min={0} max={2000} value={form.total_rooms} onChange={(event) => setForm((current) => ({ ...current, total_rooms: Number(event.target.value) }))} className="mt-1 block w-24 rounded-lg border border-slate-200 px-2 py-2 text-sm text-slate-900" /></label></div>
            <div className="mt-3 grid grid-cols-[1fr_1fr_auto] items-end gap-2"><label className="text-xs text-slate-600">From<input type="number" value={roomRange.from} onChange={(event) => setRoomRange((current) => ({ ...current, from: event.target.value }))} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-2 text-sm" /></label><label className="text-xs text-slate-600">To<input type="number" value={roomRange.to} onChange={(event) => setRoomRange((current) => ({ ...current, to: event.target.value }))} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-2 text-sm" /></label><button type="button" onClick={generateRooms} className="min-h-10 rounded-lg bg-cyan-800 px-3 text-xs font-semibold text-white">Generate</button></div>
            <button type="button" onClick={() => setForm((current) => ({ ...current, rooms: [...current.rooms, newRoom(String(current.rooms.length + 1))], total_rooms: Math.max(current.total_rooms, current.rooms.length + 1) }))} className="mt-2 inline-flex min-h-10 items-center gap-1 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700"><Plus className="h-4 w-4" />Add room</button>
            <div className="mt-3 space-y-3">{form.rooms.map((room, index) => <div key={`${room.room_name}-${room.category}-${index}`} className="space-y-2 rounded-lg bg-slate-50 p-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><label className="text-xs text-slate-600">Room number/name<input value={room.room_name} onChange={(event) => updateRoom(index, { room_name: event.target.value })} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm" /></label><label className="text-xs text-slate-600">Floor/section<select value={room.floor_section} onChange={(event) => updateRoom(index, { floor_section: event.target.value })} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm"><option value="">Unassigned</option>{form.floors_sections.map((floor) => <option key={floor} value={floor}>{floor}</option>)}</select></label><label className="text-xs text-slate-600">Category<select value={room.category} onChange={(event) => updateRoom(index, { category: event.target.value })} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm">{["Standard", "Suite", "Deluxe", "Studio"].map((category) => <option key={category}>{category}</option>)}</select></label><label className="text-xs text-slate-600">Status<select value={room.status} onChange={(event) => updateRoom(index, { status: event.target.value as RoomSetupInput["status"] })} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm">{["active", "inactive", "maintenance", "cleaning"].map((status) => <option key={status}>{status}</option>)}</select></label></div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{([["max_capacity", "Max capacity"], ["adults_capacity", "Adults"], ["children_capacity", "Children"], ["bedroom_count", "Bedrooms"]] as const).map(([key, label]) => <label key={key} className="text-xs text-slate-600">{label}<input type="number" min={0} max={100} value={room[key]} onChange={(event) => updateRoom(index, { [key]: Number(event.target.value) })} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm" /></label>)}</div>
              <label className="block text-xs text-slate-600">Bed configuration<input value={room.bed_configuration} onChange={(event) => updateRoom(index, { bed_configuration: event.target.value })} placeholder="1 King, 2 Twin" className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm" /></label>
              <label className="block text-xs text-slate-600">Amenities<input value={room.amenities.join(", ")} onChange={(event) => updateRoom(index, { amenities: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} placeholder="WiFi, Balcony, Minibar, Safe" className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm" /></label>
              <label className="block text-xs text-slate-600">Room photos<input type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple onChange={(event) => updateRoom(index, { photoFiles: [...room.photoFiles, ...Array.from(event.target.files ?? [])] })} className="mt-1 block w-full text-xs text-slate-700 file:mr-2 file:rounded-md file:border-0 file:bg-white file:px-3 file:py-2" /></label>
              {(room.photos.length > 0 || room.photoFiles.length > 0) && <p className="text-xs text-slate-500">{room.photos.length + room.photoFiles.length} photo(s) attached</p>}
            </div>)}</div>
          </section>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">Owner<select value={form.owner_id} onChange={(event) => setForm((current) => ({ ...current, owner_id: event.target.value }))} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-slate-900"><option value="">Unassigned</option>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select></label>
            <label className="text-sm font-medium text-slate-700">Manager<select value={form.manager_id} onChange={(event) => setForm((current) => ({ ...current, manager_id: event.target.value }))} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-slate-900"><option value="">Unassigned</option>{managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name}</option>)}</select></label>
          </div>
          <p className="text-xs text-slate-600">A UUID and creation timestamp are generated automatically. New properties are active by default.</p>
        </div>
        {message?.error && <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{message.text}</p>}
        <div className="mt-6 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => setFormOpen(false)} className="min-h-11 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button><button type="submit" disabled={isPending} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">{isPending && <Loader2 className="h-4 w-4 animate-spin" />}{isPending ? "Saving…" : editing ? "Save changes" : "Create property"}</button></div>
      </form>
    </div>}
  </section>;
});
