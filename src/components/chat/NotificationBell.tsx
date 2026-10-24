"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Bell, Clock, Loader2, MapPin, MessageCircle, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { fetchTaskNotifications, fetchUnread, type OverdueTaskNotice, type TaskNotice } from "./chatApi";
import { useChatStore } from "./chatStore";
import { roleLabel } from "@/lib/chat/types";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { startAssignedTask } from "@/app/settings/taskActions";
import { useSoundSettings } from "./ChatProviders";
import { playChatSound } from "./chatSound";
import { showActionToast } from "@/components/ui/ActionToast";
import { safeChatError } from "./chatErrors";
import { usePushPermission } from "@/lib/pushPermission";

function relativeDispatchTime(value: string | null) {
  if (!value) return "Time unavailable";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Time unavailable";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(timestamp).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function priorityStyle(priority: TaskNotice["priority"]) {
  if (priority === "urgent") return "bg-red-50 text-red-800";
  if (priority === "high") return "bg-amber-50 text-amber-900";
  if (priority === "medium") return "bg-blue-50 text-blue-800";
  return "bg-slate-100 text-slate-700";
}

export function NotificationBell() {
  const containerRef = useRef<HTMLDivElement>(null);
  const seenTaskIds = useRef<Set<string> | null>(null);
  const taskToastTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskToast, setTaskToast] = useState<TaskNotice | null>(null);
  const [taskError, setTaskError] = useState("");
  const [activeTaskWarning, setActiveTaskWarning] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [showPushHelp, setShowPushHelp] = useState(false);
  const pushPermission = usePushPermission();
  const { soundNotificationsEnabled } = useSoundSettings();
  const { data, error } = useQuery({
    queryKey: ["chat", "unread"],
    queryFn: fetchUnread,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const taskQuery = useQuery({
    queryKey: ["tasks", "notifications"],
    queryFn: fetchTaskNotifications,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: 60_000,
  });
  const openChat = useChatStore((state) => state.openChat);
  const incoming = taskQuery.data?.incoming ?? [];
  const outgoing = taskQuery.data?.outgoing ?? [];
  const overdue = taskQuery.data?.overdue ?? [];
  const unreadCount = (data?.count ?? 0) + incoming.length + overdue.length;

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
    const newlyAssigned = taskQuery.data.incoming.find((task) => !seenTaskIds.current?.has(task.id));
    seenTaskIds.current = ids;
    if (!newlyAssigned) return;
    setTaskToast(newlyAssigned);
    if (taskToastTimeout.current) clearTimeout(taskToastTimeout.current);
    taskToastTimeout.current = setTimeout(() => setTaskToast(null), 6000);
    if (soundNotificationsEnabled) playChatSound("alert");
  }, [soundNotificationsEnabled, taskQuery.data]);

  useEffect(() => () => {
    if (taskToastTimeout.current) clearTimeout(taskToastTimeout.current);
  }, []);

  const startTask = async (taskId: string) => {
    setTaskError("");
    setIsStarting(true);
    try {
      const result = await startAssignedTask(taskId);
      if (!result.success) {
        const message = safeChatError(new Error(result.error), "Unable to start the assigned task. Please try again.");
        if (result.error.includes("already have an active running task")) setActiveTaskWarning(true);
        else setTaskError(message);
        showActionToast("error", message);
        return;
      }
      setSelectedTaskId(null);
      showActionToast("success", "Task started.");
    } catch (error) {
      const message = safeChatError(error, "Unable to start the assigned task. Please try again.");
      setTaskError(message);
      showActionToast("error", message);
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      {taskToast && (
        <div role="status" aria-live="polite" className="fixed right-4 top-20 z-[80] w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-emerald-200 bg-white p-3 shadow-xl shadow-slate-900/15">
          <button type="button" onClick={() => { setSelectedTaskId(taskToast.id); setIsOpen(true); setTaskToast(null); }} className="w-full text-left">
            <span className="block text-xs font-bold uppercase tracking-wide text-emerald-700">New task assigned</span>
            <span className="mt-1 block truncate text-sm font-semibold text-slate-900">{taskToast.service_name_snapshot ?? "Assigned task"}</span>
            <span className="mt-0.5 block truncate text-xs text-slate-600">{taskToast.notes || taskToast.dispatch_metadata?.issueDescription || "Open notifications to review."}</span>
          </button>
        </div>
      )}
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
        <div data-back-button-overlay="true" className="fixed left-1/2 top-[calc(env(safe-area-inset-top)+0.75rem)] z-50 w-[92vw] max-w-[calc(100vw-1.5rem)] -translate-x-1/2 overflow-x-hidden overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/15 max-h-[calc(85dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1rem)] sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96 sm:max-w-sm sm:translate-x-0 sm:max-h-[85dvh]">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Notifications</p>
              <p className="text-xs text-slate-500">
                {unreadCount} pending {unreadCount === 1 ? "notification" : "notifications"}
              </p>
            </div>
            <MessageCircle className="h-4 w-4 text-emerald-700" />
          </div>
          {pushPermission === "denied" && (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-xs leading-5 text-amber-950">⚠️ Push notifications are turned off on your device. Turn them on to get instant task alerts directly on your lock screen.</p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => setShowPushHelp((visible) => !visible)} className="text-xs font-bold text-amber-900 underline underline-offset-2">How to turn them on</button>
                <Link href="/settings" className="text-xs font-bold text-amber-900 underline underline-offset-2">Notification settings</Link>
              </div>
              {showPushHelp && <p className="mt-2 text-xs leading-5 text-amber-900">Open this site&apos;s permissions from your browser&apos;s address-bar or site-settings menu, allow notifications, then return to Settings and enable push alerts.</p>}
            </div>
          )}
          {error ? (
            <p role="alert" className="px-4 py-5 text-sm text-rose-600">
              {safeChatError(error, "Notifications could not be loaded. Please try again.")}
            </p>
          ) : (
            <>
            {taskQuery.error && <p role="alert" className="px-4 py-3 text-sm text-rose-600">{safeChatError(taskQuery.error, "Task notifications could not be loaded. Please try again.")}</p>}
            {taskError && <p role="alert" className="mx-2 mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{taskError}</p>}
            {overdue.length > 0 && (
              <div className="border-b border-rose-100 bg-rose-50/40 p-2">
                <p className="px-2 py-1 text-xs font-bold uppercase tracking-wide text-rose-800">Overdue task alerts</p>
                {overdue.map((alert: OverdueTaskNotice) => (
                  <article key={alert.id} className="mb-2 rounded-lg border border-rose-200 bg-white p-3 shadow-sm">
                    <h3 className="text-sm font-bold text-rose-800">⚠️ {alert.title}</h3>
                    <p className="mt-1 text-xs font-semibold text-slate-900">{alert.hotel_name} · {alert.task_title}</p>
                    <p className="mt-1 text-xs text-slate-600">Assigned staff: {alert.assignee_name}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-rose-700"><Clock className="h-3.5 w-3.5" />Open for {alert.open_duration}</p>
                    <div className="mt-2 flex justify-end">
                      <a href={alert.href} className="inline-flex min-h-9 items-center rounded-lg bg-rose-700 px-3 text-xs font-semibold text-white hover:bg-rose-800">View task · {alert.task_id.slice(0, 8)}</a>
                    </div>
                  </article>
                ))}
              </div>
            )}
            {incoming.length > 0 && (
              <div className="border-b border-slate-100 p-2">
                <p className="px-2 py-1 text-xs font-bold uppercase tracking-wide text-slate-500">Assigned tasks</p>
                {incoming.map((task) => (
                  <article key={task.id} className="mb-2 rounded-lg border border-slate-100 bg-white p-3 transition hover:bg-slate-50">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="min-w-0 text-sm font-semibold text-slate-900">{task.service_name_snapshot ?? "Assigned task"}</h3>
                      <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold capitalize ${priorityStyle(task.priority)}`}><AlertCircle className="h-3.5 w-3.5" />{task.priority === "low" ? "Standard" : task.priority}</span>
                    </div>
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-600"><User className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="min-w-0 truncate">From: {task.sender_name ?? "Team member"}{task.sender_role ? ` · ${roleLabel(task.sender_role)}` : ""}</span></p>
                    <p className="mt-1 flex items-start gap-1.5 text-xs text-slate-600"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" /><span>{task.hotel_name ?? "Property"}{task.room_label ? ` · ${task.room_label}` : task.floor_section ? ` · ${task.floor_section}` : ""}</span></p>
                    <p className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500"><Clock className="h-3.5 w-3.5 text-slate-400" />{relativeDispatchTime(task.assigned_at)}</p>
                    {(task.notes || task.dispatch_metadata?.issueDescription) && <p className="mt-2 rounded-md border border-slate-100 bg-slate-50 px-2.5 py-2 text-xs leading-5 text-slate-700">{task.notes || task.dispatch_metadata?.issueDescription}</p>}
                    <div className="mt-3 flex items-center justify-end gap-2">
                      <button type="button" aria-expanded={selectedTaskId === task.id} onClick={() => { setSelectedTaskId(selectedTaskId === task.id ? null : task.id); setTaskError(""); }} className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-white">{selectedTaskId === task.id ? "Hide details" : "View task"}</button>
                      <button type="button" onClick={() => void startTask(task.id)} disabled={isStarting} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-emerald-700 px-3 text-xs font-semibold text-white disabled:opacity-50">
                        {isStarting ? <><Loader2 className="h-4 w-4 animate-spin" />Starting...</> : "Accept / Start"}
                      </button>
                    </div>
                    {selectedTaskId === task.id && (
                      <div className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-xs text-slate-700">
                        {task.due_at && <p>Due {new Date(task.due_at).toLocaleString()}</p>}
                        {task.floor_section && <p>Section: {task.floor_section}</p>}
                        {task.dispatch_metadata?.linenChecklist?.length ? <p>Linen: {task.dispatch_metadata.linenChecklist.join(", ")}</p> : null}
                        {task.dispatch_metadata?.durationHours && <p>Estimated duration: {task.dispatch_metadata.durationHours} hours</p>}
                        {task.dispatch_metadata?.assetId && <p>Asset: {task.dispatch_metadata.assetId}</p>}
                        {task.dispatch_metadata?.photoPath && <a href={`/api/tasks/attachment?taskId=${encodeURIComponent(task.id)}&path=${encodeURIComponent(task.dispatch_metadata.photoPath)}`} target="_blank" rel="noreferrer" className="mt-1 inline-block font-semibold text-sky-700 underline">View attached photo</a>}
                      </div>
                    )}
                  </article>
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
                  <article key={task.id} className="mb-2 rounded-lg border border-slate-100 bg-white p-3 text-sm text-slate-700 hover:bg-slate-50">
                    <div className="flex items-start justify-between gap-2"><h3 className="min-w-0 font-semibold text-slate-900">{task.service_name_snapshot ?? "Assigned task"}</h3><span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold capitalize ${priorityStyle(task.priority)}`}><AlertCircle className="h-3.5 w-3.5" />{task.priority === "low" ? "Standard" : task.priority}</span></div>
                    <p className="mt-2 flex items-center gap-1.5 text-xs"><User className="h-3.5 w-3.5 text-slate-400" />Started by: {task.assignee_name ?? "Team member"}{task.assignee_role ? ` · ${roleLabel(task.assignee_role)}` : ""}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs"><MapPin className="h-3.5 w-3.5 text-slate-400" />{task.hotel_name ?? "Property"}{task.room_label ? ` · ${task.room_label}` : ""}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500"><Clock className="h-3.5 w-3.5 text-slate-400" />{relativeDispatchTime(task.start_time)}</p>
                    {(task.notes || task.dispatch_metadata?.issueDescription) && <p className="mt-2 rounded-md border border-slate-100 bg-slate-50 px-2.5 py-2 text-xs leading-5">{task.notes || task.dispatch_metadata?.issueDescription}</p>}
                  </article>
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
