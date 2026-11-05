"use client";

import { useState, useTransition, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Building2, ChevronDown, ChevronLeft, ChevronRight, Loader2, MapPin, Pencil, Plus, Search, Trash2, Upload } from "lucide-react";
import { showActionToast } from "@/components/ui/ActionToast";
import {
  archiveOwnedProperty,
  archiveServiceConfiguration,
  createOwnedProperty,
  createServiceConfiguration,
  updateOwnedProperty,
  updateServiceConfiguration,
} from "./actions";
import {
  archivePropertyRoom,
  createPropertyRoom,
  createPropertyRoomBatch,
  listPropertyRooms,
  updatePropertyRoom,
  type ManagedRoom,
} from "./roomActions";

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
const PROPERTY_PAGE_SIZE = 20;
function getPropertyPageNumbers(pageCount: number, currentPage: number): Array<number | "ellipsis"> {
  const pages: Array<number | "ellipsis"> = [];
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    if (pageNumber === 1 || pageNumber === pageCount || Math.abs(pageNumber - currentPage) <= 1) {
      const previous = pages[pages.length - 1];
      if (typeof previous === "number" && pageNumber - previous > 1) pages.push("ellipsis");
      pages.push(pageNumber);
    }
  }
  return pages;
}
const MapLocationPicker = dynamic(() => import("./MapLocationPicker"), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink/55 p-4">
      <div className="inline-flex items-center gap-2 rounded-xl bg-surface px-4 py-3 text-sm font-medium text-ink-secondary shadow-xl">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading map…
      </div>
    </div>
  ),
});
const fieldClass = "min-h-11 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink";
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
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [propertySearch, setPropertySearch] = useState("");
  const [page, setPage] = useState(1);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const query = propertySearch.trim().toLowerCase();
  const filteredProperties = properties.filter((property) =>
    !query || `${property.name} ${property.id} ${property.managerName ?? ""}`.toLowerCase().includes(query)
  );
  const pageCount = Math.max(1, Math.ceil(filteredProperties.length / PROPERTY_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageNumbers = getPropertyPageNumbers(pageCount, currentPage);
  const visibleProperties = filteredProperties.slice((currentPage - 1) * PROPERTY_PAGE_SIZE, currentPage * PROPERTY_PAGE_SIZE);
  const form = useForm<PropertyValues>({
    resolver: zodResolver(propertySchema),
    defaultValues: { name: "", location: "", roomCount: "0", floorCount: "0", managerId: "" },
  });
  const locationRegistration = form.register("location");

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
    try {
      const result = editing ? await updateOwnedProperty(editing.id, input) : await createOwnedProperty(input);
      if (!result.success) {
        setMessage(result.error ?? "Unable to save this property.");
        showActionToast("error", result.error ?? "Unable to save this property.");
        return;
      }
      setMessage(editing ? "Property details saved." : "Property created.");
      showActionToast("success", editing ? "Property details updated." : "Property created.");
      setAdding(false);
      setEditing(null);
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save this property.";
      setMessage(message);
      showActionToast("error", message);
    }
  }));
  const archive = (property: Property) => {
    if (!window.confirm(`Archive ${property.name}? Staff and work history will be retained.`)) return;
    startTransition(async () => {
      try {
        const result = await archiveOwnedProperty(property.id);
        setMessage(result.success ? `${property.name} archived.` : result.error);
        if (result.success) {
          showActionToast("success", `${property.name} archived.`);
          router.refresh();
        } else showActionToast("error", result.error);
      } catch (error) {
        const message = error instanceof Error ? error.message : `Unable to archive ${property.name}.`;
        setMessage(message);
        showActionToast("error", message);
      }
    });
  };

  return (
    <section id="properties-setup" className="scroll-mt-24 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-accent">Property setup</p><h2 className="mt-1 text-xl font-bold text-ink">Properties & Hotels</h2><p className="mt-1 text-sm text-ink-secondary">Keep property details, staffing, and service rates together.</p></div>
        <button type="button" onClick={beginAdd} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-ink px-4 text-sm font-semibold text-white"><Plus className="h-4 w-4" /> Add property</button>
      </div>
      <label className="relative block w-full md:max-w-md">
        <span className="sr-only">Search properties by name, ID, or manager</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
        <input value={propertySearch} onChange={(event) => { setPropertySearch(event.target.value); setPage(1); }} placeholder="Search property name, ID, or manager..." className="min-h-11 w-full rounded-xl border border-line bg-surface py-2 pl-9 pr-3 text-sm text-ink" />
      </label>
      {(adding || editing) && (
        <form onSubmit={saveProperty} noValidate className="rounded-2xl border border-accent/30 bg-surface p-5 shadow-sm sm:p-6">
          <h3 className="font-bold text-ink">{editing ? `Edit ${editing.name}` : "Add a property"}</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Input label="Property name" error={form.formState.errors.name?.message}><input {...form.register("name")} className={fieldClass} autoComplete="organization" /></Input>
            <Input label="Address / location" error={form.formState.errors.location?.message}>
              <div className="relative">
                <input {...locationRegistration} className={`${fieldClass} pr-12`} autoComplete="street-address" />
                <button
                  type="button"
                  title="Pick property location on map"
                  aria-label="Pick property location on map"
                  onClick={() => setLocationPickerOpen(true)}
                  className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-xl text-accent transition hover:bg-accent/10"
                >
                  <MapPin className="h-5 w-5" />
                </button>
              </div>
            </Input>
            <Input label="Total rooms" error={form.formState.errors.roomCount?.message}><input {...form.register("roomCount")} type="number" min="0" step="1" className={fieldClass} /></Input>
            <Input label="Floors / sections" error={form.formState.errors.floorCount?.message}><input {...form.register("floorCount")} type="number" min="0" step="1" className={fieldClass} /></Input>
            <Input label="Assigned manager"><select {...form.register("managerId")} className={fieldClass}><option value="">No manager assigned</option>{managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.full_name}</option>)}</select></Input>
          </div>
          {message && <p role="alert" className="mt-3 text-sm text-rose-700">{message}</p>}
          <div className="mt-4 flex gap-2">
            <button type="submit" disabled={isPending} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{isPending && <Loader2 className="h-4 w-4 animate-spin" />}{isPending ? "Saving…" : editing ? "Save property" : "Create property"}</button>
            <button type="button" onClick={() => { setAdding(false); setEditing(null); setMessage(""); }} className="min-h-11 rounded-xl border border-line px-4 text-sm font-semibold">Cancel</button>
          </div>
        </form>
      )}
      {locationPickerOpen && (
        <MapLocationPicker
          onCancel={() => setLocationPickerOpen(false)}
          onConfirm={(location) => {
            form.setValue("location", location, { shouldDirty: true, shouldValidate: true });
            setLocationPickerOpen(false);
          }}
        />
      )}
      {message && !adding && !editing && <p role="status" className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink-secondary">{message}</p>}

      <ul id="room-units" className="scroll-mt-24 space-y-4">
        {visibleProperties.length ? visibleProperties.map((property) => (
          <li key={property.id} className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
            <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent"><Building2 className="h-5 w-5" /></span><div className="min-w-0"><h3 className="font-bold text-ink">{property.name}{!property.isActive && <span className="ml-2 rounded-full bg-surface-secondary px-2 py-1 text-xs font-semibold text-ink-secondary">Suspended</span>}</h3><p className="mt-1 text-sm text-ink-secondary">{property.location}</p><p className="mt-1 text-xs text-ink-secondary">{property.roomCount} rooms · {property.floorCount} floors/sections · {property.managerName ?? "No manager assigned"}</p><p className="mt-1 truncate font-mono text-[10px] text-ink-muted" title={property.id}>Property ID: {property.id}</p></div></div>
              <div className="flex shrink-0 gap-2"><button type="button" onClick={() => beginEdit(property)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line px-3 text-sm font-semibold"><Pencil className="h-4 w-4" /> Edit</button><button type="button" onClick={() => archive(property)} disabled={isPending} className="min-h-10 rounded-lg border border-amber-200 px-3 text-sm font-semibold text-amber-800 disabled:opacity-50">Archive</button></div>
            </div>
            <PropertyRoomManager property={property} />
            <PropertyServiceCatalog property={property} anchorId={property === visibleProperties[0] ? "service-catalog" : undefined} />
          </li>
        )) : <li className="rounded-2xl border border-dashed border-line bg-surface px-5 py-10 text-center text-sm text-ink-secondary">{properties.length ? "No properties match your search." : "No properties have been created yet. Add a property to configure its services and rates."}</li>}
      </ul>
      {filteredProperties.length > 0 && <div className="flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-secondary">Showing {(currentPage - 1) * PROPERTY_PAGE_SIZE + 1}-{Math.min(currentPage * PROPERTY_PAGE_SIZE, filteredProperties.length)} of {filteredProperties.length} properties</p>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={currentPage === 1} aria-label="Previous properties page" className="grid h-10 w-10 place-items-center rounded-lg border border-line text-ink-secondary disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
          {pageNumbers.map((pageNumber, index) => pageNumber === "ellipsis"
            ? <span key={`ellipsis-${index}`} className="px-1 text-ink-muted" aria-hidden="true">…</span>
            : <button key={pageNumber} type="button" onClick={() => setPage(pageNumber)} aria-label={`Go to properties page ${pageNumber}`} aria-current={pageNumber === currentPage ? "page" : undefined} className={`grid h-10 min-w-10 place-items-center rounded-lg border px-2 text-sm font-medium ${pageNumber === currentPage ? "border-accent bg-accent text-white" : "border-line text-ink-secondary hover:bg-surface-secondary"}`}>{pageNumber}</button>)}
          <span className="px-2 text-sm text-ink-secondary">Page {currentPage} of {pageCount}</span>
          <button type="button" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={currentPage === pageCount} aria-label="Next properties page" className="grid h-10 w-10 place-items-center rounded-lg border border-line text-ink-secondary disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>}
    </section>
  );
}

type RoomEditorValues = {
  roomName: string;
  floorSection: string;
  category: string;
  maxCapacity: number;
  adultsCapacity: number;
  childrenCapacity: number;
  bedroomCount: number;
  bedConfiguration: string;
  amenities: string[];
  housekeepingStatus: ManagedRoom["housekeeping_status"];
  availabilityStatus: ManagedRoom["availability_status"];
};

const emptyRoom: RoomEditorValues = {
  roomName: "",
  floorSection: "",
  category: "Standard",
  maxCapacity: 2,
  adultsCapacity: 2,
  childrenCapacity: 0,
  bedroomCount: 1,
  bedConfiguration: "",
  amenities: [],
  housekeepingStatus: "clean",
  availabilityStatus: "vacant",
};

function PropertyRoomManager({ property }: { property: Property }) {
  const [open, setOpen] = useState(false);
  const [rooms, setRooms] = useState<ManagedRoom[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<ManagedRoom | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState(false);
  const [floorFilter, setFloorFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [batchStart, setBatchStart] = useState("101");
  const [batchEnd, setBatchEnd] = useState("115");
  const [batchFloor, setBatchFloor] = useState("");
  const [batchPrefix, setBatchPrefix] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const refreshRooms = async () => {
    setLoading(true);
    try {
      const result = await listPropertyRooms(property.id);
      if (result.success) setRooms(result.rooms);
      else {
        setMessage(result.error ?? "Unable to load rooms.");
        setErrorMessage(true);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load rooms.");
      setErrorMessage(true);
    } finally {
      setLoading(false);
    }
  };
  const startEdit = (room: ManagedRoom) => {
    setEditing(room);
    setShowForm(true);
    setMessage("");
  };
  const startCreate = () => {
    setEditing(null);
    setShowForm(true);
    setMessage("");
  };
  const saveRoom = (values: RoomEditorValues) => startTransition(async () => {
    setMessage("");
    try {
      const result = editing
        ? await updatePropertyRoom(editing.id, property.id, values)
        : await createPropertyRoom(property.id, values);
      if (!result.success) {
        setMessage(result.error ?? "Unable to save this room.");
        setErrorMessage(true);
        showActionToast("error", result.error ?? "Unable to save this room.");
        return;
      }
      setMessage(editing ? "Room details updated." : "Room created.");
      showActionToast("success", editing ? "Room details updated." : "Room created.");
      setErrorMessage(false);
      setShowForm(false);
      setEditing(null);
      await refreshRooms();
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save this room.";
      setMessage(message);
      setErrorMessage(true);
      showActionToast("error", message);
    }
  });
  const archive = (room: ManagedRoom) => {
    if (!window.confirm(`Archive ${room.room_name}? This preserves work history and room evidence.`)) return;
    startTransition(async () => {
      try {
        const result = await archivePropertyRoom(room.id, property.id);
        setMessage(result.success ? `${result.roomName ?? "Room"} archived.` : result.error ?? "Unable to archive this room.");
        setErrorMessage(!result.success);
        if (result.success) {
          showActionToast("success", `${result.roomName ?? "Room"} archived.`);
          await refreshRooms();
          router.refresh();
        } else showActionToast("error", result.error ?? "Unable to archive this room.");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to archive this room.";
        setMessage(message);
        setErrorMessage(true);
        showActionToast("error", message);
      }
    });
  };
  const addBatch = () => startTransition(async () => {
    try {
      const result = await createPropertyRoomBatch(property.id, {
        ...emptyRoom,
        floorSection: batchFloor,
        prefix: batchPrefix,
        start: Number(batchStart),
        end: Number(batchEnd),
        padding: Math.max(batchStart.length, batchEnd.length),
      });
      if (!result.success) {
        setMessage(result.error ?? "Unable to create the room range.");
        setErrorMessage(true);
        showActionToast("error", result.error ?? "Unable to create the room range.");
        return;
      }
      setMessage(`${result.count} rooms added.`);
      showActionToast("success", `${result.count} rooms added.`);
      setErrorMessage(false);
      await refreshRooms();
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create the room range.";
      setMessage(message);
      setErrorMessage(true);
      showActionToast("error", message);
    }
  });
  const uploadPhoto = (room: ManagedRoom, file: File) => startTransition(async () => {
    try {
      const formData = new FormData();
      formData.set("hotelId", property.id);
      formData.set("roomId", room.id);
      formData.set("file", file);
      const response = await fetch("/api/admin/rooms/photo", { method: "POST", body: formData });
      const result = await response.json() as { error?: string };
      setMessage(response.ok ? `Photo added to ${room.room_name}.` : result.error ?? "Unable to upload photo.");
      setErrorMessage(!response.ok);
      showActionToast(response.ok ? "success" : "error", response.ok ? `Photo added to ${room.room_name}.` : result.error ?? "Unable to upload photo.");
      if (response.ok) await refreshRooms();
    } catch (error) {
      const message = error instanceof Error ? `Unable to upload photo: ${error.message}` : "Unable to upload photo.";
      setMessage(message);
      setErrorMessage(true);
      showActionToast("error", message);
    }
  });

  const activeRooms = rooms.filter((room) => room.status === "active");
  const floors = [...new Set(rooms.map((room) => room.floor_section).filter((floor): floor is string => Boolean(floor)))].sort();
  const categories = [...new Set(rooms.map((room) => room.category).filter(Boolean))].sort();
  const filteredRooms = rooms.filter((room) =>
    (floorFilter === "all" || (room.floor_section ?? "") === floorFilter) &&
    (statusFilter === "all" || room.housekeeping_status === statusFilter || room.availability_status === statusFilter || room.status === statusFilter) &&
    (categoryFilter === "all" || room.category === categoryFilter)
  );

  return (
    <details open={open} onToggle={(event) => {
      const isOpen = event.currentTarget.open;
      setOpen(isOpen);
      if (isOpen) void refreshRooms();
    }} className="border-t border-line">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-sm font-bold text-ink">
        <span>Manage Rooms / Units <span className="ml-1 rounded-full bg-surface-secondary px-2 py-1 text-xs font-semibold text-ink-secondary">{activeRooms.length} active</span></span>
        <ChevronDown className="h-4 w-4" />
      </summary>
      <div className="space-y-4 border-t border-line bg-surface-secondary/70 p-4 sm:p-5">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={startCreate} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-ink px-3 text-sm font-semibold text-white"><Plus className="h-4 w-4" /> Add room / unit</button>
          <button type="button" onClick={() => void refreshRooms()} disabled={loading} className="min-h-10 rounded-lg border border-line bg-surface px-3 text-sm font-semibold text-ink-secondary">{loading ? "Refreshing…" : "Refresh rooms"}</button>
        </div>
        {showForm && <RoomEditor key={editing?.id ?? "new-room"} initial={editing ? {
          roomName: editing.room_name,
          floorSection: editing.floor_section ?? "",
          category: editing.category,
          maxCapacity: editing.max_capacity,
          adultsCapacity: editing.adults_capacity,
          childrenCapacity: editing.children_capacity,
          bedroomCount: editing.bedroom_count,
          bedConfiguration: editing.bed_configuration,
          amenities: editing.room_amenities,
          housekeepingStatus: editing.housekeeping_status,
          availabilityStatus: editing.availability_status,
        } : emptyRoom} isPending={isPending} onSave={saveRoom} onCancel={() => { setShowForm(false); setEditing(null); }} />}
        <section className="rounded-xl border border-line bg-surface p-4">
          <h4 className="font-bold text-ink">Batch room generator</h4>
          <p className="mt-1 text-xs text-ink-secondary">Create up to 100 rooms at once. The batch is saved atomically, so name conflicts add no rooms.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="text-xs font-semibold text-ink-secondary">Room numbers from<input value={batchStart} onChange={(event) => setBatchStart(event.target.value)} type="number" min="0" className={`${fieldClass} mt-1`} /></label>
            <label className="text-xs font-semibold text-ink-secondary">To<input value={batchEnd} onChange={(event) => setBatchEnd(event.target.value)} type="number" min="0" className={`${fieldClass} mt-1`} /></label>
            <label className="text-xs font-semibold text-ink-secondary">Name prefix<input value={batchPrefix} onChange={(event) => setBatchPrefix(event.target.value)} placeholder="e.g. Room " className={`${fieldClass} mt-1`} /></label>
            <label className="text-xs font-semibold text-ink-secondary">Floor / section<input value={batchFloor} onChange={(event) => setBatchFloor(event.target.value)} placeholder="e.g. Floor 1" className={`${fieldClass} mt-1`} /></label>
            <button type="button" onClick={addBatch} disabled={isPending} className="mt-auto inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-3 text-sm font-semibold text-white disabled:opacity-50">{isPending && <Loader2 className="h-4 w-4 animate-spin" />}{isPending ? "Generating…" : "Generate rooms"}</button>
          </div>
        </section>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs font-semibold text-ink-secondary">Floor / section<select value={floorFilter} onChange={(event) => setFloorFilter(event.target.value)} className={`${fieldClass} mt-1`}><option value="all">All floors</option>{floors.map((floor) => <option key={floor} value={floor}>{floor}</option>)}</select></label>
          <label className="text-xs font-semibold text-ink-secondary">Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={`${fieldClass} mt-1`}><option value="all">All statuses</option><optgroup label="Housekeeping">{["dirty", "in_progress", "inspect_ready", "clean"].map((status) => <option key={status} value={status}>{status.replace("_", " ")}</option>)}</optgroup><optgroup label="Availability">{["vacant", "occupied", "maintenance", "out_of_order"].map((status) => <option key={status} value={status}>{status.replace("_", " ")}</option>)}</optgroup><option value="inactive">Archived</option></select></label>
          <label className="text-xs font-semibold text-ink-secondary">Category<select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className={`${fieldClass} mt-1`}><option value="all">All categories</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
        </div>
        {message && <p role={errorMessage ? "alert" : "status"} className={`rounded-lg px-3 py-2 text-sm ${errorMessage ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800"}`}>{message}</p>}
        {loading ? <p className="text-sm text-ink-secondary">Loading rooms…</p> : filteredRooms.length ? <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {filteredRooms.map((room) => <li key={room.id} className="space-y-3 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0"><p className="font-bold text-ink">{room.room_name} <span className="font-normal text-ink-secondary">· {room.category || "Uncategorized"}</span></p><p className="mt-1 text-xs text-ink-secondary">{room.floor_section || "No floor assigned"} · {room.max_capacity} capacity ({room.adults_capacity} adults, {room.children_capacity} children) · {room.bedroom_count} bedrooms{room.bed_configuration ? ` · ${room.bed_configuration}` : ""}</p><p className="mt-1 text-xs text-ink-secondary">Housekeeping: {room.housekeeping_status.replace("_", " ")} · Availability: {room.availability_status.replace("_", " ")}{room.status !== "active" ? " · Archived" : ""}</p>{room.room_amenities.length > 0 && <p className="mt-1 text-xs text-ink-secondary">Amenities: {room.room_amenities.join(", ")}</p>}</div>
              <div className="flex shrink-0 gap-2">{room.status === "active" && <button type="button" onClick={() => startEdit(room)} className="min-h-9 rounded-lg border border-line px-3 text-xs font-semibold">Edit</button>}{room.status === "active" && <button type="button" onClick={() => archive(room)} disabled={isPending} className="min-h-9 rounded-lg border border-amber-200 px-3 text-xs font-semibold text-amber-800">Archive</button>}</div>
            </div>
            {room.room_photos.length > 0 && <div className="flex flex-wrap gap-2">{room.room_photos.map((photo) => photo.url ? <a key={photo.path} href={photo.url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-accent underline">View room photo</a> : <span key={photo.path} className="text-xs text-ink-secondary">Photo unavailable</span>)}</div>}
            {room.status === "active" && <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border border-line px-3 text-xs font-semibold text-ink-secondary"><Upload className="h-3.5 w-3.5" /> Add photo<input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/avif" disabled={isPending} onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadPhoto(room, file); event.currentTarget.value = ""; }} /></label>}
          </li>)}
        </ul> : <p className="rounded-xl border border-dashed border-line bg-surface px-4 py-8 text-center text-sm text-ink-secondary">{rooms.length ? "No rooms match the selected filters." : "No rooms configured for this property yet."}</p>}
      </div>
    </details>
  );
}

function RoomEditor({ initial, isPending, onSave, onCancel }: {
  initial: RoomEditorValues;
  isPending: boolean;
  onSave: (values: RoomEditorValues) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState(initial);
  const [amenities, setAmenities] = useState(initial.amenities.join(", "));
  const [error, setError] = useState("");
  const set = <K extends keyof RoomEditorValues>(key: K, value: RoomEditorValues[K]) => setValues((current) => ({ ...current, [key]: value }));
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!values.roomName.trim()) {
      setError("Enter a room name.");
      return;
    }
    setError("");
    onSave({ ...values, amenities: amenities.split(",").map((item) => item.trim()).filter(Boolean) });
  };
  return (
    <form onSubmit={submit} className="rounded-xl border border-accent/30 bg-surface p-4">
      <h4 className="font-bold text-ink">{initial.roomName ? "Edit room / unit" : "Add room / unit"}</h4>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs font-semibold text-ink-secondary">Room name / number<input required maxLength={120} value={values.roomName} onChange={(event) => set("roomName", event.target.value)} className={`${fieldClass} mt-1`} /></label>
        <label className="text-xs font-semibold text-ink-secondary">Floor / section<input maxLength={120} value={values.floorSection} onChange={(event) => set("floorSection", event.target.value)} className={`${fieldClass} mt-1`} placeholder="e.g. Floor 2 - Suites" /></label>
        <label className="text-xs font-semibold text-ink-secondary">Category<input maxLength={120} value={values.category} onChange={(event) => set("category", event.target.value)} className={`${fieldClass} mt-1`} placeholder="Standard, Suite, Hall…" /></label>
        <label className="text-xs font-semibold text-ink-secondary">Max capacity<input type="number" min="0" max="1000" value={values.maxCapacity} onChange={(event) => set("maxCapacity", Number(event.target.value))} className={`${fieldClass} mt-1`} /></label>
        <label className="text-xs font-semibold text-ink-secondary">Adults<input type="number" min="0" max="1000" value={values.adultsCapacity} onChange={(event) => set("adultsCapacity", Number(event.target.value))} className={`${fieldClass} mt-1`} /></label>
        <label className="text-xs font-semibold text-ink-secondary">Children<input type="number" min="0" max="1000" value={values.childrenCapacity} onChange={(event) => set("childrenCapacity", Number(event.target.value))} className={`${fieldClass} mt-1`} /></label>
        <label className="text-xs font-semibold text-ink-secondary">Bedrooms<input type="number" min="0" max="1000" value={values.bedroomCount} onChange={(event) => set("bedroomCount", Number(event.target.value))} className={`${fieldClass} mt-1`} /></label>
        <label className="text-xs font-semibold text-ink-secondary">Bed configuration<input maxLength={240} value={values.bedConfiguration} onChange={(event) => set("bedConfiguration", event.target.value)} className={`${fieldClass} mt-1`} placeholder="e.g. 1 king, 2 twins" /></label>
        <label className="text-xs font-semibold text-ink-secondary">Housekeeping status<select value={values.housekeepingStatus} onChange={(event) => set("housekeepingStatus", event.target.value as RoomEditorValues["housekeepingStatus"])} className={`${fieldClass} mt-1`}>{[["dirty", "Dirty"], ["in_progress", "In Progress"], ["inspect_ready", "Inspect / Ready"], ["clean", "Clean"]].map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select></label>
        <label className="text-xs font-semibold text-ink-secondary">Availability<select value={values.availabilityStatus} onChange={(event) => set("availabilityStatus", event.target.value as RoomEditorValues["availabilityStatus"])} className={`${fieldClass} mt-1`}>{[["vacant", "Vacant"], ["occupied", "Occupied"], ["maintenance", "Maintenance"], ["out_of_order", "Out of order"]].map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select></label>
        <label className="text-xs font-semibold text-ink-secondary sm:col-span-2">Amenities (comma separated)<input value={amenities} onChange={(event) => setAmenities(event.target.value)} className={`${fieldClass} mt-1`} placeholder="Wi-Fi, minibar, balcony" /></label>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
      <div className="mt-4 flex gap-2"><button type="submit" disabled={isPending} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{isPending && <Loader2 className="h-4 w-4 animate-spin" />}{isPending ? "Saving…" : "Save room"}</button><button type="button" onClick={onCancel} className="min-h-10 rounded-lg border border-line px-4 text-sm font-semibold">Cancel</button></div>
    </form>
  );
}

function PropertyServiceCatalog({ property, anchorId }: { property: Property; anchorId?: string }) {
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
    try {
      const result = await (editing
        ? updateServiceConfiguration(editing.id, { hotelId: property.id, ...values, defaultRate: Number(values.rate) })
        : createServiceConfiguration({ hotelId: property.id, ...values, defaultRate: Number(values.rate) }));
      if (!result.success) {
        setMessage(result.error);
        setMessageError(true);
        showActionToast("error", result.error);
        return;
      }
      setMessage(editing ? "Service updated." : "Service added.");
      showActionToast("success", editing ? "Service updated." : "Service added.");
      setEditing(null);
      setShowForm(false);
      form.reset({ name: "", description: "", unit: "per_room", rate: "0", isActive: true });
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save this service.";
      setMessage(message);
      setMessageError(true);
      showActionToast("error", message);
    }
  }));
  const toggleActive = (service: Service) => startTransition(async () => {
    try {
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
      if (result.success) {
        showActionToast("success", `${service.name} ${service.is_active ? "deactivated" : "activated"}.`);
        router.refresh();
      } else showActionToast("error", result.error);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update this service.";
      setMessage(message);
      setMessageError(true);
      showActionToast("error", message);
    }
  });
  const remove = (service: Service) => {
    if (!window.confirm(`Delete ${service.name}? It will be deactivated so existing work history is preserved.`)) return;
    startTransition(async () => {
      try {
        const result = await archiveServiceConfiguration(service.id, property.id);
        setMessage(result.success ? `${service.name} deleted from active services.` : result.error);
        setMessageError(!result.success);
        if (result.success) {
          showActionToast("success", `${service.name} deleted from active services.`);
          router.refresh();
        } else showActionToast("error", result.error);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to archive this service.";
        setMessage(message);
        setMessageError(true);
        showActionToast("error", message);
      }
    });
  };

  return (
    <details id={anchorId} open={isOpen} onToggle={(event) => setIsOpen(event.currentTarget.open)} className="scroll-mt-24 border-t border-line">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-sm font-bold text-ink"><span>Services & Rates <span className="ml-1 rounded-full bg-surface-secondary px-2 py-1 text-xs font-semibold text-ink-secondary">{services.filter((service) => service.hotel_id === property.id).length}</span></span><ChevronDown className="h-4 w-4" /></summary>
      <div className="space-y-4 border-t border-line bg-surface-secondary/70 p-4 sm:p-5">
        <p className="text-sm text-ink-secondary">Create property-specific task types and rates. Shared catalog entries remain available to this property.</p>
        {services.length > 0 && <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {services.map((service) => <li key={service.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div><p className="font-semibold text-ink">{service.name}{!service.is_active && <span className="ml-2 text-xs text-ink-secondary">Inactive</span>}{service.hotel_id === null && <span className="ml-2 text-xs text-accent">Shared catalog</span>}</p><p className="text-xs text-ink-secondary">{service.description || service.unit.replace("_", " ")} · {service.unit.replace("_", " ")} · £{Number(service.default_rate).toFixed(2)}</p></div>
            {service.hotel_id === property.id && <div className="flex items-center gap-2"><label className="inline-flex items-center gap-2 text-xs font-semibold text-ink-secondary"><input type="checkbox" checked={service.is_active} onChange={() => toggleActive(service)} disabled={isPending} />Active</label><button type="button" onClick={() => edit(service)} className="min-h-9 rounded-lg border border-line px-2.5 text-xs font-semibold">Edit</button><button type="button" onClick={() => remove(service)} disabled={isPending} aria-label={`Delete ${service.name}`} className="grid h-9 w-9 place-items-center rounded-lg border border-rose-200 text-rose-700"><Trash2 className="h-4 w-4" /></button></div>}
          </li>)}
        </ul>}
        <button type="button" onClick={() => { beginNew(); setIsOpen(true); }} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-semibold text-ink"><Plus className="h-4 w-4" /> Add custom service</button>
        {showForm && (
          <form onSubmit={save} noValidate className="rounded-xl border border-line bg-surface p-4">
            <h4 className="font-bold text-ink">{editing ? "Edit service" : "Add custom service"}</h4>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Input label="Service name" error={form.formState.errors.name?.message}><input {...form.register("name")} className={fieldClass} placeholder="Cleaning Per Room" /></Input>
              <Input label="Billing mode"><select {...form.register("unit")} className={fieldClass}><option value="per_room">Per Room</option><option value="hourly">Hourly</option><option value="fixed">Fixed</option></select></Input>
              <Input label="Rate / cost (£)" error={form.formState.errors.rate?.message}><input {...form.register("rate")} type="number" min="0" step="0.01" className={fieldClass} /></Input>
              <Input label="Description"><input {...form.register("description")} className={fieldClass} placeholder="Optional task details" /></Input>
            </div>
            <label className="mt-3 inline-flex min-h-9 items-center gap-2 text-sm font-medium text-ink-secondary"><input type="checkbox" {...form.register("isActive")} />Active service</label>
            <div className="mt-3 flex gap-2"><button type="submit" disabled={isPending} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-ink px-4 text-sm font-semibold text-white">{isPending && <Loader2 className="h-4 w-4 animate-spin" />}{isPending ? "Saving…" : editing ? "Save service" : "Add service"}</button><button type="button" onClick={() => { setEditing(null); setShowForm(false); setMessage(""); setMessageError(false); }} className="min-h-10 rounded-lg border border-line px-4 text-sm font-semibold">Cancel</button></div>
          </form>
        )}
        {message && <p role={messageError ? "alert" : "status"} className={`text-sm ${messageError ? "text-rose-700" : "text-ink-secondary"}`}>{message}</p>}
      </div>
    </details>
  );
}

function Input({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return <label className="block text-sm font-medium text-ink-secondary">{label}{children}{error && <span role="alert" className="mt-1 block text-xs text-rose-700">{error}</span>}</label>;
}
