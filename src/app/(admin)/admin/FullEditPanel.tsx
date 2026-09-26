"use client";

import { X } from "lucide-react";

type Draft = { hotelId: string; serviceId: string; roomId: string; roomsCompleted: string; roomNumber: string; notes: string; startTime: string; endTime: string };
type Room = { id: string; hotel_id: string; room_name: string; category: string };

function durationHours(startTime: string, endTime: string) {
  if (!startTime || !endTime) return 0;
  return Math.max(0, (new Date(endTime).getTime() - new Date(startTime).getTime()) / 3_600_000);
}

export function FullEditPanel({ draft, setDraft, services, hotels, rooms, saving, onCancel, onSave }: { draft: Draft; setDraft: (draft: Draft) => void; services: { id: string; name: string }[]; hotels: { id: string; name: string }[]; rooms: Room[]; saving: boolean; onCancel: () => void; onSave: () => void }) {
  const hotelRooms = rooms.filter((room) => room.hotel_id === draft.hotelId);
  const update = (changes: Partial<Draft>) => setDraft({ ...draft, ...changes });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="max-h-[95vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 text-slate-900 shadow-xl">
        <div className="flex items-center justify-between"><h2 className="text-xl font-bold">Full work-log details</h2><button type="button" onClick={onCancel} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        <p className="mt-1 text-sm text-slate-500">Management override is audited and reflected across all dashboards.</p>
        <div className="mt-4 grid gap-3">
          <label className="text-xs font-semibold text-slate-600">Hotel<select value={draft.hotelId} onChange={(event) => update({ hotelId: event.target.value, roomId: "", roomNumber: "" })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-900">{hotels.map((hotel) => <option key={hotel.id} value={hotel.id}>{hotel.name}</option>)}</select></label>
          <label className="text-xs font-semibold text-slate-600">Service<select value={draft.serviceId} onChange={(event) => update({ serviceId: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-900">{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
          <label className="text-xs font-semibold text-slate-600">Room<select value={draft.roomId} onChange={(event) => update({ roomId: event.target.value, roomNumber: hotelRooms.find((room) => room.id === event.target.value)?.room_name ?? "" })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-900"><option value="">No room selected</option>{hotelRooms.map((room) => <option key={room.id} value={room.id}>{room.room_name}{room.category ? ` - ${room.category}` : ""}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-slate-600">Start time<input type="datetime-local" value={draft.startTime} onChange={(event) => update({ startTime: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-900" /></label><label className="text-xs font-semibold text-slate-600">End time<input type="datetime-local" value={draft.endTime} onChange={(event) => update({ endTime: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-900" /></label></div>
          <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Calculated duration: <strong>{durationHours(draft.startTime, draft.endTime).toFixed(2)} hours</strong></div>
          <label className="text-xs font-semibold text-slate-600">Rooms completed<input type="number" min="0" value={draft.roomsCompleted} onChange={(event) => update({ roomsCompleted: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-900" /></label>
          <label className="text-xs font-semibold text-slate-600">Selected room number<input value={draft.roomNumber} readOnly className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-100 p-2 text-sm text-slate-700" /></label>
          <label className="text-xs font-semibold text-slate-600">Full notes<textarea value={draft.notes} onChange={(event) => update({ notes: event.target.value })} rows={5} className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-900" /></label>
        </div>
        <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={onCancel} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700">Cancel</button><button type="button" disabled={saving} onClick={onSave} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Save all changes</button></div>
      </div>
    </div>
  );
}
