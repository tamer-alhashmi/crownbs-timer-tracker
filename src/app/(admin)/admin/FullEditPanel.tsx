"use client";

import { X } from "lucide-react";

type Draft = { hotelId: string; serviceId: string; roomId: string; roomsCompleted: string; roomNumber: string; notes: string; startTime: string; endTime: string; status: "assigned" | "active" | "completed" };
type Room = { id: string; hotel_id: string; room_name: string; category: string };

function durationHours(startTime: string, endTime: string) {
  if (!startTime || !endTime) return 0;
  return Math.max(0, (new Date(endTime).getTime() - new Date(startTime).getTime()) / 3_600_000);
}

export function FullEditPanel({ draft, setDraft, services, hotels, rooms, saving, canEditStatus, statusDisabled, onCancel, onSave }: { draft: Draft; setDraft: (draft: Draft) => void; services: { id: string; name: string }[]; hotels: { id: string; name: string }[]; rooms: Room[]; saving: boolean; canEditStatus: boolean; statusDisabled: boolean; onCancel: () => void; onSave: () => void }) {
  const hotelRooms = rooms.filter((room) => room.hotel_id === draft.hotelId);
  const update = (changes: Partial<Draft>) => setDraft({ ...draft, ...changes });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="max-h-[95vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface p-5 text-ink shadow-xl">
        <div className="flex items-center justify-between"><h2 className="text-xl font-bold">Full work-log details</h2><button type="button" onClick={onCancel} className="rounded-lg p-2 text-ink-muted hover:bg-surface-secondary"><X className="h-5 w-5" /></button></div>
        <p className="mt-1 text-sm text-ink-muted">Management override is audited and reflected across all dashboards.</p>
        <div className="mt-4 grid gap-3">
          <label className="text-xs font-semibold text-ink-secondary">Hotel<select value={draft.hotelId} onChange={(event) => update({ hotelId: event.target.value, roomId: "", roomNumber: "" })} className="mt-1 w-full rounded-lg border border-line bg-surface p-2 text-sm text-ink">{hotels.map((hotel) => <option key={hotel.id} value={hotel.id}>{hotel.name}</option>)}</select></label>
          <label className="text-xs font-semibold text-ink-secondary">Service<select value={draft.serviceId} onChange={(event) => update({ serviceId: event.target.value })} className="mt-1 w-full rounded-lg border border-line bg-surface p-2 text-sm text-ink">{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
          <label className="text-xs font-semibold text-ink-secondary">Room<select value={draft.roomId} onChange={(event) => update({ roomId: event.target.value, roomNumber: hotelRooms.find((room) => room.id === event.target.value)?.room_name ?? "" })} className="mt-1 w-full rounded-lg border border-line bg-surface p-2 text-sm text-ink"><option value="">No room selected</option>{hotelRooms.map((room) => <option key={room.id} value={room.id}>{room.room_name}{room.category ? ` - ${room.category}` : ""}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-ink-secondary">Start time<input type="datetime-local" value={draft.startTime} onChange={(event) => update({ startTime: event.target.value })} className="mt-1 w-full rounded-lg border border-line bg-surface p-2 text-sm text-ink" /></label><label className="text-xs font-semibold text-ink-secondary">End time<input type="datetime-local" value={draft.endTime} onChange={(event) => update({ endTime: event.target.value })} className="mt-1 w-full rounded-lg border border-line bg-surface p-2 text-sm text-ink" /></label></div>
          <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Calculated duration: <strong>{durationHours(draft.startTime, draft.endTime).toFixed(2)} hours</strong></div>
          {canEditStatus && <label className="text-xs font-semibold text-ink-secondary">Lifecycle status<select value={draft.status} disabled={statusDisabled} onChange={(event) => update({ status: event.target.value as Draft["status"] })} className="mt-1 w-full rounded-lg border border-line bg-surface p-2 text-sm text-ink disabled:bg-surface-secondary"><option value="assigned">Pending</option><option value="active">Active</option><option value="completed">Completed</option></select>{statusDisabled && <span className="mt-1 block font-normal">Cancelled records keep their cancellation state.</span>}</label>}
          <label className="text-xs font-semibold text-ink-secondary">Rooms completed<input type="number" min="0" value={draft.roomsCompleted} onChange={(event) => update({ roomsCompleted: event.target.value })} className="mt-1 w-full rounded-lg border border-line bg-surface p-2 text-sm text-ink" /></label>
          <label className="text-xs font-semibold text-ink-secondary">Selected room number<input value={draft.roomNumber} readOnly className="mt-1 w-full rounded-lg border border-line bg-surface-secondary p-2 text-sm text-ink-secondary" /></label>
          <label className="text-xs font-semibold text-ink-secondary">Full notes<textarea value={draft.notes} onChange={(event) => update({ notes: event.target.value })} rows={5} className="mt-1 w-full rounded-lg border border-line bg-surface p-2 text-sm text-ink" /></label>
        </div>
        <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={onCancel} className="rounded-lg border border-line px-4 py-2 text-sm text-ink-secondary">Cancel</button><button type="button" disabled={saving} onClick={onSave} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Save all changes</button></div>
      </div>
    </div>
  );
}
