"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageCircle, Pencil, RotateCcw, UserRound, X } from "lucide-react";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { useChatStore } from "@/components/chat/chatStore";
import { showActionToast } from "@/components/ui/ActionToast";
import type { ChatContact } from "@/lib/chat/types";
import type { UserRole } from "@/lib/roles";
import {
  cancelDispatchTask,
  completeDispatchTask,
  reopenCompletedDispatchTask,
  updatePendingDispatchTask,
} from "./taskActions";

type DispatchTask = {
  id: string;
  status: string;
  name: string;
  description: string;
  hotelId: string;
  hotelName: string;
  staffId: string | null;
  staffName: string;
  staffEmail: string;
  staffRole: UserRole;
  staffAvatarUrl: string | null;
  roomLabel: string;
  roomIds: string[];
  startTime: string;
  endTime: string | null;
  taskDate: string;
  assignedAt: string | null;
  priority: string;
  dueAt: string | null;
  notes: string;
  dispatchMetadata: { floorSection?: string } | null;
  photos: { id: string; url: string; mediaType: string; name: string }[];
};

type Props = {
  status: "assigned" | "active" | "completed";
  tasks: DispatchTask[];
  users: { id: string; full_name: string; role: UserRole; assignedHotels: { id: string; name: string }[] }[];
  rooms: { id: string; hotel_id: string; room_name: string; floor_section: string | null }[];
  onClose: () => void;
};

function elapsed(start: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(start)) / 60_000));
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function TaskManagementDialog({ status, tasks, users, rooms, onClose }: Props) {
  const router = useRouter();
  const openChat = useChatStore((state) => state.openChat);
  const [now, setNow] = useState(0);
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState("");
  const [reasonTaskId, setReasonTaskId] = useState<string | null>(null);
  const [reasonAction, setReasonAction] = useState<"cancel" | "complete">("cancel");
  const [reason, setReason] = useState("");
  const [editingTask, setEditingTask] = useState<DispatchTask | null>(null);
  const [assigneeId, setAssigneeId] = useState("");
  const [roomIds, setRoomIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [floorSection, setFloorSection] = useState("");
  const titles = { assigned: "Pending Dispatch Tasks", active: "Active In-Progress Tasks", completed: "Tasks Completed Today" };
  const eligibleRooms = editingTask ? rooms.filter((room) => room.hotel_id === editingTask.hotelId) : [];
  const eligibleStaff = editingTask ? users.filter((user) => user.assignedHotels.some((hotel) => hotel.id === editingTask.hotelId)) : [];

  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const interval = window.setInterval(update, 60_000);
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", escape);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("keydown", escape);
    };
  }, [onClose]);

  const perform = (operation: () => Promise<void>, success: string) => startTransition(async () => {
    setNotice("");
    try {
      await operation();
      setNotice(success);
      showActionToast("success", success);
      setReasonTaskId(null);
      setEditingTask(null);
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update this task.";
      setNotice(message);
      showActionToast("error", message);
    }
  });

  const beginEdit = (task: DispatchTask) => {
    setEditingTask(task);
    setAssigneeId(task.staffId ?? "");
    setRoomIds(task.roomIds);
    setNotes(task.notes);
    setFloorSection(task.dispatchMetadata?.floorSection ?? "");
    setNotice("");
  };

  return <div className="fixed inset-0 z-[105] flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="task-management-title" className="flex max-h-[94dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
      <header className="flex items-start justify-between gap-4 border-b border-slate-200 p-5 sm:p-6">
        <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-sky-700">Task management</p><h2 id="task-management-title" className="mt-1 text-xl font-bold text-slate-950">{titles[status]}</h2><p className="mt-1 text-sm text-slate-600">{tasks.length} task{tasks.length === 1 ? "" : "s"} in this list</p></div>
        <button type="button" aria-label="Close task list" onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50"><X className="h-4 w-4" /></button>
      </header>
      {notice && <p role="status" className="mx-5 mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{notice}</p>}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-5 sm:p-6">
        {!tasks.length && <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No tasks in this category.</p>}
        {tasks.map((task) => <article key={task.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-3">
                <UserAvatar name={task.staffName} avatarUrl={task.staffAvatarUrl} role={task.staffRole} className="h-10 w-10 shrink-0 bg-sky-100 text-sm text-sky-800" />
                <div className="min-w-0 flex-1">
                  <h3 className="font-bold text-slate-950">{task.name}</h3>
                  <p className="mt-0.5 text-sm text-slate-600">{task.hotelName}{task.roomLabel ? ` · ${task.roomLabel}` : ""}{task.dispatchMetadata?.floorSection ? ` · ${task.dispatchMetadata.floorSection}` : ""}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500"><UserRound className="h-3.5 w-3.5" />{task.staffName} · {task.staffRole.replace("_", " ")}</p>
                </div>
              </div>
              {task.notes && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{task.notes}</p>}
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                {task.assignedAt && <span>Assigned {new Date(task.assignedAt).toLocaleString()}</span>}
                <span>Started {new Date(task.startTime).toLocaleString()}</span>
                {task.endTime && <span>Finished {new Date(task.endTime).toLocaleString()}</span>}
                {status === "active" && <span className="rounded-full bg-blue-50 px-2 py-0.5 font-semibold text-blue-800">Running · {elapsed(task.startTime, now)}</span>}
                {status === "completed" && <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-800">Duration · {elapsed(task.startTime, Date.parse(task.endTime ?? task.startTime))}</span>}
                <span className="capitalize">{task.priority} priority</span>
              </div>
              {status === "completed" && task.photos.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{task.photos.map((photo) => <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer" className="rounded-lg border border-sky-200 px-3 py-2 text-xs font-semibold text-sky-800 hover:bg-sky-50">{photo.mediaType === "image" ? "View inspection photo" : "View attachment"} · {photo.name}</a>)}</div>}
              {status === "completed" && !task.photos.length && <p className="mt-2 text-xs text-slate-500">No photo evidence attached.</p>}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {status === "assigned" && <button type="button" onClick={() => beginEdit(task)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold"><Pencil className="h-3.5 w-3.5" /> Edit / reassign</button>}
              {status === "active" && task.staffId && <button type="button" onClick={() => openChat({
                id: task.staffId!,
                full_name: task.staffName,
                email: task.staffEmail,
                role: task.staffRole,
                avatar_url: task.staffAvatarUrl,
              } satisfies ChatContact)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold"><MessageCircle className="h-3.5 w-3.5" /> Message</button>}
              {status === "active" && <button type="button" onClick={() => { setReasonTaskId(task.id); setReasonAction("complete"); setReason(""); }} className="min-h-9 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-800">End task</button>}
              {status === "assigned" && <button type="button" onClick={() => { setReasonTaskId(task.id); setReasonAction("cancel"); setReason(""); }} className="min-h-9 rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-800">Cancel</button>}
              {status === "active" && <button type="button" onClick={() => { setReasonTaskId(task.id); setReasonAction("cancel"); setReason(""); }} className="min-h-9 rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-800">Cancel</button>}
              {status === "completed" && <button type="button" onClick={() => {
                if (window.confirm(`Reopen “${task.name}” and resend it to ${task.staffName}?`)) perform(() => reopenCompletedDispatchTask(task.id), "Task reopened and re-dispatched.");
              }} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-900"><RotateCcw className="h-3.5 w-3.5" /> Reopen</button>}
            </div>
          </div>
          {editingTask?.id === task.id && <div className="mt-4 space-y-3 rounded-xl border border-sky-200 bg-sky-50/50 p-4">
            <label className="block text-xs font-semibold text-slate-700">Reassign to<select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm">{eligibleStaff.map((user) => <option key={user.id} value={user.id}>{user.full_name} · {user.role.replace("_", " ")}</option>)}</select></label>
            <label className="block text-xs font-semibold text-slate-700">Zone / instructions<input value={floorSection} onChange={(event) => setFloorSection(event.target.value)} maxLength={120} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" /></label>
            <label className="block text-xs font-semibold text-slate-700">Task instructions<textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} rows={3} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" /></label>
            <fieldset><legend className="text-xs font-semibold text-slate-700">Rooms / units</legend><div className="mt-1 max-h-32 overflow-y-auto overscroll-contain rounded-lg border border-slate-200 bg-white p-2">{eligibleRooms.map((room) => <label key={room.id} className="flex items-center gap-2 px-2 py-1.5 text-sm"><input type="checkbox" checked={roomIds.includes(room.id)} onChange={(event) => setRoomIds((current) => event.target.checked ? [...current, room.id] : current.filter((id) => id !== room.id))} />{room.room_name}{room.floor_section ? ` · ${room.floor_section}` : ""}</label>)}</div></fieldset>
            <div className="flex gap-2"><button type="button" disabled={isPending || !assigneeId} onClick={() => perform(() => updatePendingDispatchTask(task.id, { assignedTo: assigneeId, notes, roomIds, floorSection }), "Pending task updated.")} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-sky-700 px-3 text-xs font-semibold text-white disabled:opacity-50">{isPending && <Loader2 className="h-4 w-4 animate-spin" />}{isPending ? "Saving…" : "Save changes"}</button><button type="button" onClick={() => setEditingTask(null)} className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold">Close</button></div>
          </div>}
          {reasonTaskId === task.id && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
            <label className="block text-xs font-semibold text-slate-700">{reasonAction === "complete" ? "End-task audit reason" : "Cancellation reason"}<textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} minLength={5} rows={2} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" placeholder="Enter at least 5 characters" /></label>
            <div className="mt-2 flex gap-2"><button type="button" disabled={isPending || reason.trim().length < 5} onClick={() => perform(
              () => reasonAction === "complete" ? completeDispatchTask(task.id, reason) : cancelDispatchTask(task.id, reason),
              reasonAction === "complete" ? "Task completed and audited." : "Task cancelled and audited."
            )} className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white disabled:opacity-50">{isPending && <Loader2 className="h-4 w-4 animate-spin" />}{isPending ? "Saving…" : reasonAction === "complete" ? "Confirm end task" : "Confirm cancellation"}</button><button type="button" onClick={() => setReasonTaskId(null)} className="min-h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold">Keep task</button></div>
          </div>}
        </article>)}
      </div>
    </section>
  </div>;
}
