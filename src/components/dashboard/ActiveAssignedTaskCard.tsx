"use client";

import { useEffect, useState, useTransition, type SetStateAction } from "react";
import { endOwnManagementTask } from "@/app/settings/taskActions";
import { showActionToast } from "@/components/ui/ActionToast";
import { ActionErrorMessage } from "@/components/ui/ActionErrorMessage";
import { formatUserMessage } from "@/lib/userMessages";
import { Loader2 } from "lucide-react";
import { resolveTaskChecklist } from "@/lib/serviceBlueprint";
import { RoomMediaCapture } from "@/app/(cleaner)/dashboard/RoomMediaCapture";
import { getWorkLogRoomMedia, type RoomMediaItem } from "@/app/(cleaner)/dashboard/roomMediaActions";

export type ActiveAssignedTaskDetails = {
  id: string;
  name: string;
  hotelName: string;
  roomLabel: string;
  startTime: string;
  status: "active" | "paused";
  pausedAt: string | null;
  serviceBlueprintSnapshot: unknown;
  executionChecklist: boolean[];
};

function elapsed(startTime: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(startTime)) / 60_000));
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function ActiveAssignedTaskCard({ task }: { task: ActiveAssignedTaskDetails }) {
  const [now, setNow] = useState(0);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const [checklistState, setChecklistState] = useState({ taskId: task.id, items: task.executionChecklist });
  const checklistProgress = checklistState.taskId === task.id ? checklistState.items : task.executionChecklist;
  const setChecklistProgress = (update: SetStateAction<boolean[]>) => {
    const items = checklistState.taskId === task.id ? checklistState.items : task.executionChecklist;
    setChecklistState({ taskId: task.id, items: typeof update === "function" ? update(items) : update });
  };
  const [media, setMedia] = useState<RoomMediaItem[]>([]);
  const [evidenceCount, setEvidenceCount] = useState(0);
  const [mediaError, setMediaError] = useState("");
  const checklist = resolveTaskChecklist(task.serviceBlueprintSnapshot);
  const photoMissing = checklist.requirePhoto && evidenceCount === 0;
  const checklistIncomplete = checklistProgress.length !== checklist.items.length || checklistProgress.some((checked) => checked !== true);

  useEffect(() => {
    if (!checklist.requirePhoto || task.status !== "active") return;
    let active = true;
    getWorkLogRoomMedia(task.id).then((items) => {
      if (active) {
        setMedia(items);
        setEvidenceCount(items.length);
      }
    }).catch((error: unknown) => {
      if (active) setMediaError(formatUserMessage(error, "Unable to load task evidence."));
    });
    return () => { active = false; };
  }, [checklist.requirePhoto, task.id, task.status]);

  useEffect(() => {
    const initial = window.setTimeout(() => setNow(Date.now()), 0);
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, []);

  const endTask = () => startTransition(async () => {
    setMessage("");
    try {
      await endOwnManagementTask(task.id, checklistProgress);
      showActionToast("success", "Task completed and sent for management review.");
    } catch (error) {
      const text = formatUserMessage(error, "Unable to end this task.");
      setMessage(text);
      showActionToast("error", text);
    }
  });

  const taskElapsed = elapsed(task.startTime, task.status === "paused" && task.pausedAt ? Date.parse(task.pausedAt) : now);

  return <section aria-label={task.status === "paused" ? "Suspended task" : "Active task"} className={`rounded-3xl border p-4 shadow-sm sm:p-5 ${task.status === "paused" ? "border-amber-500/25 bg-amber-500/5" : "border-emerald-500/25 bg-emerald-500/5"}`}>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <p className={`text-xs font-bold uppercase tracking-[0.2em] ${task.status === "paused" ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"}`}>{task.status === "paused" ? "Suspended task" : "Active task"}</p>
        <h2 className="mt-1 text-lg font-bold text-ink">{task.name}</h2>
        <p className="mt-1 text-sm text-ink-secondary">{task.hotelName}{task.roomLabel ? ` · ${task.roomLabel}` : ""}</p>
        <p className={`mt-1 text-xs font-medium ${task.status === "paused" ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"}`}>{task.status === "paused" ? `Paused · ${taskElapsed} active` : `Running · ${taskElapsed}`}</p>
        {task.status === "paused" && <p className="mt-1 text-xs text-ink-secondary">This task will resume automatically when the active task is completed.</p>}
        {task.status === "active" && checklist.items.length > 0 && <fieldset className="mt-3 space-y-2 rounded-xl border border-line bg-surface p-3">
          <legend className="px-1 text-xs font-semibold text-ink">Required inspection</legend>
          {checklist.items.map((item, index) => <label key={`${index}-${item}`} className="flex items-start gap-2 text-sm text-ink-secondary">
            <input type="checkbox" checked={checklistProgress[index] === true} onChange={(event) => setChecklistProgress((current) => checklist.items.map((_, itemIndex) => itemIndex === index ? event.target.checked : current[itemIndex] === true))} className="mt-0.5 h-4 w-4 rounded border-line text-emerald-700 focus:ring-emerald-600" />
            <span>{item}</span>
          </label>)}
        </fieldset>}
        {task.status === "active" && checklist.requirePhoto && <div className="mt-3">
          <RoomMediaCapture workLogId={task.id} rooms={[]} initialMedia={media} storageConfigured={!mediaError} taskEvidenceRequired onEvidenceChange={setEvidenceCount} />
          {mediaError && <ActionErrorMessage error={mediaError} className="mt-2" />}
          {photoMissing && <p className="mt-2 text-xs font-medium text-amber-700">Add at least one photo before ending this task.</p>}
        </div>}
        {message && <ActionErrorMessage error={message} className="mt-2" />}
      </div>
      {task.status === "active" && <button type="button" onClick={endTask} disabled={isPending || checklistIncomplete || photoMissing} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-wait disabled:opacity-60">
        {isPending && <Loader2 className="h-4 w-4 animate-spin" />}{isPending ? "Ending task…" : "End task"}
      </button>}
    </div>
  </section>;
}
