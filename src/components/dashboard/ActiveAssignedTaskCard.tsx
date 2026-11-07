"use client";

import { useEffect, useState, useTransition } from "react";
import { endOwnManagementTask } from "@/app/settings/taskActions";
import { showActionToast } from "@/components/ui/ActionToast";
import { ActionErrorMessage } from "@/components/ui/ActionErrorMessage";
import { formatUserMessage } from "@/lib/userMessages";
import { Loader2 } from "lucide-react";

export type ActiveAssignedTaskDetails = {
  id: string;
  name: string;
  hotelName: string;
  roomLabel: string;
  startTime: string;
  status: "active" | "paused";
  pausedAt: string | null;
};

function elapsed(startTime: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(startTime)) / 60_000));
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function ActiveAssignedTaskCard({ task }: { task: ActiveAssignedTaskDetails }) {
  const [now, setNow] = useState(0);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

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
      await endOwnManagementTask(task.id);
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
        {message && <ActionErrorMessage error={message} className="mt-2" />}
      </div>
      {task.status === "active" && <button type="button" onClick={endTask} disabled={isPending} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-wait disabled:opacity-60">
        {isPending && <Loader2 className="h-4 w-4 animate-spin" />}{isPending ? "Ending task…" : "End task"}
      </button>}
    </div>
  </section>;
}
