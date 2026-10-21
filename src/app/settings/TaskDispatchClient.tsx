"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { ClipboardCheck, Clock3, Plus, X } from "lucide-react";
import { dispatchTask, type getTaskDispatchData } from "./taskActions";
import type { UserRole } from "@/lib/roles";
import { useWorkLogRealtimeRefresh } from "@/lib/useWorkLogRealtimeRefresh";
import { TaskManagementDialog } from "./TaskManagementDialog";

type Service = {
  id: string;
  hotel_id: string | null;
  name: string;
  description: string;
  unit: "hourly" | "per_room" | "fixed";
  is_active: boolean;
  owner_id: string | null;
};
type Props = {
  role: UserRole;
  hotels: { id: string; name: string; ownerId?: string | null }[];
  users: { id: string; full_name: string; role: UserRole; assignedHotels: { id: string; name: string }[] }[];
  services: Service[];
  rooms: { id: string; hotel_id: string; room_name: string; category: string; floor_section: string | null }[];
  tasks: Awaited<ReturnType<typeof getTaskDispatchData>>["tasks"];
  stats: { pending: number; active: number; completedToday: number };
};

const schema = z.object({
  hotelId: z.string().min(1, "Choose a property."),
  serviceId: z.string().min(1, "Choose a task type."),
  assignedTo: z.string().min(1, "Choose a team member."),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  roomIds: z.array(z.string()).max(100, "Select no more than 100 rooms."),
  floorSection: z.string().max(120, "Use 120 characters or fewer."),
  linenChecklist: z.array(z.enum(["sheets", "towels", "robes"])),
  durationHours: z.string(),
  issueDescription: z.string().max(2000, "Use 2,000 characters or fewer."),
  assetId: z.string().max(120, "Use 120 characters or fewer."),
  dueAt: z.string(),
  notes: z.string().max(2000, "Use 2,000 characters or fewer."),
}).superRefine((value, context) => {
  if (value.durationHours && (!Number.isFinite(Number(value.durationHours)) || Number(value.durationHours) <= 0 || Number(value.durationHours) > 168)) {
    context.addIssue({ code: "custom", path: ["durationHours"], message: "Enter a duration between 0 and 168 hours." });
  }
  if (value.dueAt && (!Number.isFinite(Date.parse(value.dueAt)) || Date.parse(value.dueAt) <= Date.now())) {
    context.addIssue({ code: "custom", path: ["dueAt"], message: "Choose a due time in the future." });
  }
});
type DispatchValues = z.infer<typeof schema>;
const defaultValues: DispatchValues = {
  hotelId: "",
  serviceId: "",
  assignedTo: "",
  priority: "low",
  roomIds: [],
  floorSection: "",
  linenChecklist: [],
  durationHours: "",
  issueDescription: "",
  assetId: "",
  dueAt: "",
  notes: "",
};
const fieldClass = "min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900";
const priorities = [
  { value: "low", label: "Low", classes: "border-slate-300 bg-slate-100 text-slate-700" },
  { value: "medium", label: "Medium", classes: "border-blue-200 bg-blue-50 text-blue-800" },
  { value: "high", label: "High", classes: "border-amber-200 bg-amber-50 text-amber-900" },
  { value: "urgent", label: "Urgent / Critical", classes: "border-red-200 bg-red-50 text-red-800" },
] as const;

export function TaskDispatchClient({ role, hotels, users, services, rooms, tasks, stats }: Props) {
  useWorkLogRealtimeRefresh();
  const [isOpen, setIsOpen] = useState(false);
  const [taskListStatus, setTaskListStatus] = useState<"assigned" | "active" | "completed" | null>(null);
  const [notice, setNotice] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoError, setPhotoError] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const dialogRef = useRef<HTMLElement>(null);
  const form = useForm<DispatchValues>({
    resolver: zodResolver(schema),
    defaultValues: { ...defaultValues, hotelId: hotels.length === 1 ? hotels[0].id : "" },
  });
  const hotelId = useWatch({ control: form.control, name: "hotelId" });
  const serviceId = useWatch({ control: form.control, name: "serviceId" });
  const selectedHotel = hotels.find((hotel) => hotel.id === hotelId);
  const selectedService = services.find((service) => service.id === serviceId);
  const activeServices = useMemo(() => services.filter((service) =>
    service.is_active &&
    (service.hotel_id === hotelId || (service.hotel_id === null && (service.owner_id === null || service.owner_id === selectedHotel?.ownerId)))
  ), [hotelId, selectedHotel?.ownerId, services]);
  const allowedRoles: UserRole[] = role === "manager"
    ? ["hk_admin", "cleaner"]
    : role === "hk_admin"
      ? ["cleaner"]
      : ["manager", "hk_admin", "cleaner"];
  const assignees = users.filter((user) =>
    allowedRoles.includes(user.role) && user.assignedHotels.some((hotel) => hotel.id === hotelId)
  );
  const propertyRooms = rooms.filter((room) => room.hotel_id === hotelId);
  const perRoom = selectedService?.unit === "per_room";
  const hourly = selectedService?.unit === "hourly" || /shift|deep clean/i.test(selectedService?.name ?? "");
  const maintenance = selectedService?.unit === "fixed" || /maintenance|repair/i.test(selectedService?.name ?? "");
  const errors = form.formState.errors;

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("dispatch") === "1") {
      setIsOpen(true);
      url.searchParams.delete("dispatch");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    dialogRef.current?.querySelector<HTMLElement>("select, input, button")?.focus();
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      previouslyFocused?.focus();
    };
  }, [isOpen]);

  const submit = form.handleSubmit((values) => startTransition(async () => {
    try {
    setNotice("");
    if (photoError) {
      setNotice(photoError);
      return;
    }
    let photoPath: string | null = null;
    if (photo) {
      const data = new FormData();
      data.set("file", photo);
      data.set("hotelId", values.hotelId);
      const response = await fetch("/api/tasks/attachment", { method: "POST", body: data });
      const result = await response.json() as { path?: string; error?: string };
      if (!response.ok || !result.path) {
        setNotice(result.error ?? "The task photo could not be uploaded.");
        return;
      }
      photoPath = result.path;
    }
    const dueAt = values.dueAt ? new Date(values.dueAt).toISOString() : null;
    const result = await dispatchTask({
      hotelId: values.hotelId,
      serviceId: values.serviceId,
      assignedTo: values.assignedTo,
      priority: values.priority,
      dueAt,
      notes: values.notes,
      metadata: {
        roomIds: values.roomIds,
        floorSection: values.floorSection,
        linenChecklist: values.linenChecklist,
        durationHours: values.durationHours ? Number(values.durationHours) : null,
        issueDescription: values.issueDescription,
        assetId: values.assetId,
        photoPath,
      },
    });
    if (!result.success) {
      if (photoPath) {
        const cleanup = await fetch("/api/tasks/attachment", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: photoPath }),
        });
        if (!cleanup.ok) {
          const cleanupResult = await cleanup.json() as { error?: string };
          setNotice(`${result.error} ${cleanupResult.error ?? "The unused photo could not be removed."}`);
          return;
        }
      }
      setNotice(result.error);
      return;
    }
    setNotice("Task assigned. The assignee has been notified.");
    form.reset({ ...defaultValues, hotelId: hotels.length === 1 ? hotels[0].id : "" });
    setPhoto(null);
    setPhotoError("");
    setIsOpen(false);
    router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to assign this task.");
    }
  }));

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-sky-700">Quick task dispatch</p>
          <h2 className="mt-1 text-xl font-bold text-slate-950">Keep work moving</h2>
          <p className="mt-1 text-sm text-slate-600">Assign hotel work directly to the right person. New tasks stay pending until started.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Stat label="Pending" value={stats.pending} tone="amber" onClick={() => setTaskListStatus("assigned")} />
          <Stat label="Active" value={stats.active} tone="blue" onClick={() => setTaskListStatus("active")} />
          <Stat label="Completed today" value={stats.completedToday} tone="emerald" onClick={() => setTaskListStatus("completed")} />
          <button type="button" onClick={() => { setNotice(""); setIsOpen(true); }} disabled={!hotels.length} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
            <Plus className="h-4 w-4" /> Assign Task
          </button>
        </div>
      </div>
      {notice && <p role={notice.startsWith("Task assigned") ? "status" : "alert"} className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">{notice}</p>}
      {!hotels.length && <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">No active properties are available in your assignment scope.</p>}

      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setIsOpen(false); }}>
          <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="dispatch-title" className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-7">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-sky-700">New assignment</p><h2 id="dispatch-title" className="mt-1 text-xl font-bold text-slate-950">Assign a task</h2><p className="mt-1 text-sm text-slate-600">Choose a property, service, and assignee to get started.</p></div>
              <button type="button" onClick={() => setIsOpen(false)} aria-label="Close task assignment" className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50"><X className="h-4 w-4" /></button>
            </div>
            <form onSubmit={submit} className="space-y-5" noValidate>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Property" error={errors.hotelId?.message}><select {...form.register("hotelId", { onChange: () => { form.setValue("serviceId", ""); form.setValue("assignedTo", ""); form.setValue("roomIds", []); } })} className={fieldClass}><option value="">Select property</option>{hotels.map((hotel) => <option key={hotel.id} value={hotel.id}>{hotel.name}</option>)}</select></Field>
                <Field label="Assignee" error={errors.assignedTo?.message}><select {...form.register("assignedTo")} className={fieldClass}><option value="">Choose team member</option>{assignees.map((user) => <option key={user.id} value={user.id}>{user.full_name} · {user.role.replace("_", " ")}</option>)}</select></Field>
                <Field label="Task / service type" error={errors.serviceId?.message}><select {...form.register("serviceId", { onChange: () => { form.setValue("roomIds", []); } })} className={fieldClass}><option value="">Choose service</option>{activeServices.map((service) => <option key={service.id} value={service.id}>{service.name} · {service.unit.replace("_", " ")}</option>)}</select></Field>
                <Field label="Target due time" error={errors.dueAt?.message}><input {...form.register("dueAt")} type="datetime-local" min={new Date().toISOString().slice(0, 16)} className={fieldClass} /></Field>
              </div>

              <fieldset>
                <legend className="mb-2 text-sm font-semibold text-slate-800">Priority</legend>
                <div className="flex flex-wrap gap-2">{priorities.map((priority) => <label key={priority.value} className={`cursor-pointer rounded-full border px-3 py-2 text-xs font-bold ${priority.classes} has-[:checked]:ring-2 has-[:checked]:ring-offset-1 has-[:checked]:ring-slate-600`}><input type="radio" className="sr-only" value={priority.value} {...form.register("priority")} />{priority.label}</label>)}</div>
              </fieldset>

              {perRoom && (
                <section className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4">
                  <h3 className="text-sm font-bold text-slate-900">Room assignment</h3>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Field label="Floor / section" error={errors.floorSection?.message}><input {...form.register("floorSection")} className={fieldClass} placeholder="e.g. Floor 2, east wing" /></Field>
                    <div>
                      <p className="mb-2 text-sm font-medium text-slate-700">Rooms</p>
                      <div className="max-h-32 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2">
                        {propertyRooms.length ? propertyRooms.map((room) => <label key={room.id} className="flex min-h-9 items-center gap-2 px-2 text-sm text-slate-700"><input type="checkbox" value={room.id} {...form.register("roomIds")} /><span>{room.room_name}{room.category ? ` · ${room.category}` : ""}{room.floor_section ? <span className="ml-1 text-xs text-slate-500">({room.floor_section})</span> : ""}</span></label>) : <p className="px-2 py-2 text-sm text-slate-500">No rooms are configured for this property.</p>}
                      </div>
                      {errors.roomIds?.message && <p role="alert" className="mt-1 text-xs text-rose-700">{errors.roomIds.message}</p>}
                    </div>
                  </div>
                  <fieldset className="mt-3"><legend className="mb-2 text-sm font-medium text-slate-700">Linen checklist</legend><div className="flex flex-wrap gap-3">{(["sheets", "towels", "robes"] as const).map((item) => <label key={item} className="inline-flex items-center gap-2 text-sm capitalize text-slate-700"><input type="checkbox" value={item} {...form.register("linenChecklist")} />{item}</label>)}</div></fieldset>
                </section>
              )}

              {hourly && <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-4"><Field label="Estimated duration / target shift hours" error={errors.durationHours?.message}><input {...form.register("durationHours")} type="number" min="0.25" max="168" step="0.25" className={fieldClass} placeholder="e.g. 3.5 hours" /></Field></div>}

              {maintenance && (
                <section className="rounded-2xl border border-amber-100 bg-amber-50/50 p-4">
                  <h3 className="text-sm font-bold text-slate-900">Issue details</h3>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Field label="Issue description" error={errors.issueDescription?.message}><textarea {...form.register("issueDescription")} className={`${fieldClass} min-h-20`} placeholder="Describe the issue or repair needed" /></Field>
                    <div className="space-y-3">
                      <Field label="Fixture / asset ID" error={errors.assetId?.message}><input {...form.register("assetId")} className={fieldClass} placeholder="Optional asset reference" /></Field>
                      <label className="block text-sm font-medium text-slate-700">Photo attachment <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
                        const file = event.target.files?.[0] ?? null;
                        if (file && (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024)) {
                          setPhotoError("Choose a JPG, PNG, or WebP photo smaller than 8 MB.");
                          setNotice("");
                          setPhoto(null);
                          event.target.value = "";
                          return;
                        }
                        setPhotoError("");
                        setNotice("");
                        setPhoto(file);
                      }} className="mt-1 block w-full text-xs text-slate-600 file:mr-3 file:min-h-10 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:font-semibold" /></label>
                      {photo && <p className="text-xs text-slate-600">Selected: {photo.name}</p>}
                      {photoError && <p role="alert" className="text-xs text-rose-700">{photoError}</p>}
                    </div>
                  </div>
                </section>
              )}

              <Field label="Notes for the assignee" error={errors.notes?.message}><textarea {...form.register("notes")} className={`${fieldClass} min-h-20`} placeholder="Optional instructions or context" /></Field>
              {notice && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{notice}</p>}
              <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
                <button type="button" onClick={() => setIsOpen(false)} className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700">Cancel</button>
                <button type="submit" disabled={isPending} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-50">{isPending ? <><Clock3 className="h-4 w-4 animate-pulse" /> Assigning…</> : <><ClipboardCheck className="h-4 w-4" /> Assign task</>}</button>
              </div>
            </form>
          </section>
        </div>
      )}
      {taskListStatus && <TaskManagementDialog
        status={taskListStatus}
        tasks={tasks.filter((task) => task.status === taskListStatus)}
        users={users}
        rooms={rooms}
        onClose={() => setTaskListStatus(null)}
      />}
    </section>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return <label className="block text-sm font-medium text-slate-700">{label}{children}<span className="sr-only">{error}</span>{error && <span role="alert" className="mt-1 block text-xs text-rose-700">{error}</span>}</label>;
}

function Stat({ label, value, tone, onClick }: { label: string; value: number; tone: "amber" | "blue" | "emerald"; onClick: () => void }) {
  const colors = { amber: "bg-amber-50 text-amber-900 ring-amber-200", blue: "bg-blue-50 text-blue-900 ring-blue-200", emerald: "bg-emerald-50 text-emerald-900 ring-emerald-200" };
  return <button type="button" onClick={onClick} aria-label={`Open ${label} tasks`} className={`min-w-24 cursor-pointer rounded-xl px-3 py-2 text-center ring-1 transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 ${colors[tone]}`}><p className="text-lg font-bold leading-5">{value}</p><p className="mt-1 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide">{label}</p></button>;
}
