"use client";

import { useQuery } from "@tanstack/react-query";
import { Bell, MessageCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchTaskNotifications, fetchUnread } from "./chatApi";
import { useChatStore } from "./chatStore";
import { roleLabel } from "@/lib/chat/types";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { startAssignedTask } from "@/app/settings/taskActions";
import { useSoundSettings } from "./ChatProviders";
import { playChatSound } from "./chatSound";

export function NotificationBell() {
  const containerRef = useRef<HTMLDivElement>(null);
  const seenTaskIds = useRef<Set<string> | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskError, setTaskError] = useState("");
  const [activeTaskWarning, setActiveTaskWarning] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const router = useRouter();
  const { soundNotificationsEnabled } = useSoundSettings();
  const { data, error } = useQuery({
    queryKey: ["chat", "unread"],
    queryFn: fetchUnread,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const taskQuery = useQuery({
    queryKey: ["tasks", "notifications"],
    queryFn: fetchTaskNotifications,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const openChat = useChatStore((state) => state.openChat);
  const incoming = taskQuery.data?.incoming ?? [];
  const outgoing = taskQuery.data?.outgoing ?? [];
  const unreadCount = (data?.count ?? 0) + incoming.length;

  useEffect(() => {
    if (!isOpen) return;
    const dismissOutside = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const dismissEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissEscape);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!taskQuery.data) return;
    const ids = new Set(taskQuery.data.incoming.map((task) => task.id));
    if (!seenTaskIds.current) {
      seenTaskIds.current = ids;
      return;
    }
    const newlyAssignedUrgent = taskQuery.data.incoming.find(
      (task) => !seenTaskIds.current?.has(task.id) && (task.priority === "high" || task.priority === "urgent")
    );
    seenTaskIds.current = ids;
    if (newlyAssignedUrgent && soundNotificationsEnabled) playChatSound("alert");
  }, [soundNotificationsEnabled, taskQuery.data]);

  const startTask = async (taskId: string) => {
    setTaskError("");
    setIsStarting(true);
    try {
      const result = await startAssignedTask(taskId);
      if (!result.success) {
        if (result.error.includes("already have an active running task")) setActiveTaskWarning(true);
        else setTaskError(result.error);
        return;
      }
      setSelectedTaskId(null);
      await taskQuery.refetch();
      router.refresh();
    } catch (error) {
      setTaskError(error instanceof Error ? error.message : "Unable to start the assigned task.");
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} pending notifications` : ""}`}
        aria-expanded={isOpen}
        title={error ? "Notifications could not be loaded" : undefined}
        onClick={() => setIsOpen((open) => !open)}
        className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="chat-unread-badge absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white ring-2 ring-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
      {isOpen && (
        <div data-back-button-overlay="true" className="absolute right-0 top-12 z-[70] w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/15">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Notifications</p>
              <p className="text-xs text-slate-500">
                {unreadCount} pending {unreadCount === 1 ? "notification" : "notifications"}
              </p>
            </div>
            <MessageCircle className="h-4 w-4 text-emerald-700" />
          </div>
          {error ? (
            <p role="alert" className="px-4 py-5 text-sm text-rose-600">
              {error.message}
            </p>
          ) : (
            <>
            {taskQuery.error && <p role="alert" className="px-4 py-3 text-sm text-rose-600">{taskQuery.error.message}</p>}
            {taskError && <p role="alert" className="mx-2 mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{taskError}</p>}
            {incoming.length > 0 && (
              <div className="border-b border-slate-100 p-2">
                <p className="px-2 py-1 text-xs font-bold uppercase tracking-wide text-slate-500">Assigned tasks</p>
                {incoming.map((task) => (
                  <div key={task.id} className="rounded-xl p-2 hover:bg-slate-50">
                    <button type="button" onClick={() => { setSelectedTaskId(selectedTaskId === task.id ? null : task.id); setTaskError(""); }} className="w-full text-left">
                      <span className="block text-sm font-semibold text-slate-900">{task.service_name_snapshot ?? "Assigned task"}</span>
                      <span className="block text-xs text-slate-600">{task.notes || task.dispatch_metadata?.issueDescription || "Tap to review task details"}</span>
                    </button>
                    {selectedTaskId === task.id && (
                      <div className="mt-2 rounded-lg bg-slate-100 p-3">
                        <p className="text-xs text-slate-600">Property task · assigned {task.assigned_at ? new Date(task.assigned_at).toLocaleString() : "recently"}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${task.priority === "urgent" ? "bg-red-100 text-red-800" : task.priority === "high" ? "bg-amber-100 text-amber-900" : task.priority === "medium" ? "bg-blue-100 text-blue-800" : "bg-slate-200 text-slate-700"}`}>{task.priority} priority</span>
                          {task.due_at && <span className="text-xs text-slate-600">Due {new Date(task.due_at).toLocaleString()}</span>}
                        </div>
                        {task.notes && <p className="mt-2 text-sm text-slate-800">{task.notes}</p>}
                        {task.dispatch_metadata?.floorSection && <p className="mt-1 text-xs text-slate-700">Section: {task.dispatch_metadata.floorSection}</p>}
                        {task.dispatch_metadata?.roomIds?.length ? <p className="mt-1 text-xs text-slate-700">{task.dispatch_metadata.roomIds.length} room{task.dispatch_metadata.roomIds.length === 1 ? "" : "s"} assigned</p> : null}
                        {task.dispatch_metadata?.linenChecklist?.length ? <p className="mt-1 text-xs text-slate-700">Linen: {task.dispatch_metadata.linenChecklist.join(", ")}</p> : null}
                        {task.dispatch_metadata?.durationHours && <p className="mt-1 text-xs text-slate-700">Estimated duration: {task.dispatch_metadata.durationHours} hours</p>}
                        {task.dispatch_metadata?.issueDescription && <p className="mt-1 text-xs text-slate-700">{task.dispatch_metadata.issueDescription}</p>}
                        {task.dispatch_metadata?.assetId && <p className="mt-1 text-xs text-slate-700">Asset: {task.dispatch_metadata.assetId}</p>}
                        {task.dispatch_metadata?.photoPath && <a href={`/api/tasks/attachment?taskId=${encodeURIComponent(task.id)}&path=${encodeURIComponent(task.dispatch_metadata.photoPath)}`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-semibold text-sky-700 underline">View attached photo</a>}
                        <button type="button" onClick={() => void startTask(task.id)} disabled={isStarting} className="mt-3 min-h-10 rounded-lg bg-emerald-700 px-3 text-sm font-semibold text-white disabled:opacity-50">
                          {isStarting ? "Starting..." : "Start Task"}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {activeTaskWarning && (
              <div className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/50 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setActiveTaskWarning(false); }}>
                <section role="alertdialog" aria-modal="true" aria-labelledby="active-task-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
                  <div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-800">!</span><div><h2 id="active-task-title" className="font-bold text-slate-950">Task not started</h2><p className="mt-2 text-sm leading-6 text-slate-700">You already have an active running task. Please complete or pause your current task before starting a new one.</p></div></div>
                  <button type="button" onClick={() => setActiveTaskWarning(false)} className="mt-5 min-h-11 w-full rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white">Understood</button>
                </section>
              </div>
            )}
            {outgoing.length > 0 && (
              <div className="border-b border-slate-100 p-2">
                <p className="px-2 py-1 text-xs font-bold uppercase tracking-wide text-slate-500">Task updates</p>
                {outgoing.map((task) => (
                  <p key={task.id} className="rounded-xl px-3 py-2 text-sm text-slate-700">
                    <span className="font-semibold">{task.assignee_name}</span> started {task.service_name_snapshot ?? "an assigned task"}.
                  </p>
                ))}
              </div>
            )}
            {data?.messages.length ? (
            <div className="max-h-80 overflow-y-auto p-2">
              {data.messages.map((message) => (
                <button
                  type="button"
                  key={message.id}
                  onClick={() => {
                    openChat(message.sender);
                    setIsOpen(false);
                  }}
                  className="flex w-full gap-3 rounded-xl p-3 text-left transition hover:bg-slate-50"
                >
                  <UserAvatar name={message.sender.full_name} avatarUrl={message.sender.avatar_url} role={message.sender.role} className="h-9 w-9 bg-[#d9fdd3] text-sm font-semibold text-emerald-900" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-slate-800">
                        {message.sender.full_name}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {new Date(message.created_at).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    </span>
                    <span className="block truncate text-xs text-slate-600">
                      {message.content || (message.attachment_type === "image" ? "Photo" : "Attachment")}
                      <span className="ml-1 text-slate-500">· {roleLabel(message.sender.role)}</span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
            ) : incoming.length === 0 && outgoing.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-600">You’re all caught up.</p>
            ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}
