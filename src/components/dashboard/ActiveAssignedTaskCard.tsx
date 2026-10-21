"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { endOwnManagementTask } from "@/app/settings/taskActions";
import { showActionToast } from "@/components/ui/ActionToast";
import { Loader2 } from "lucide-react";

export type ActiveAssignedTaskDetails = {
  id: string;
  name: string;
  hotelName: string;
  roomLabel: string;
  startTime: string;
};

function elapsed(startTime: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(startTime)) / 60_000));
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function ActiveAssignedTaskCard({ task }: { task: ActiveAssignedTaskDetails }) {
  const router = useRouter();
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
      router.refresh();
    } catch (error) {
      const text = error instanceof Error ? error.message : "Unable to end this task.";
      setMessage(text);
      showActionToast("error", text);
    }
  });

  return <section aria-label="Active task" className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-700">Active task</p>
        <h2 className="mt-1 text-lg font-bold text-emerald-950">{task.name}</h2>
        <p className="mt-1 text-sm text-emerald-800">{task.hotelName}{task.roomLabel ? ` · ${task.roomLabel}` : ""}</p>
        <p className="mt-1 text-xs font-medium text-emerald-800">Running · {elapsed(task.startTime, now)}</p>
        {message && <p role="alert" className="mt-2 text-sm font-medium text-rose-700">{message}</p>}
      </div>
      <button type="button" onClick={endTask} disabled={isPending} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-wait disabled:opacity-60">
        {isPending && <Loader2 className="h-4 w-4 animate-spin" />}{isPending ? "Ending task…" : "End task"}
      </button>
    </div>
  </section>;
}
