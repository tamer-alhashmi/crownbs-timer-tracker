import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CalendarClock, MapPin } from "lucide-react";
import { getSessionUser } from "@/lib/auth";
import { isHousekeepingAdmin, isPlatformAdmin } from "@/lib/roles";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";

function dashboardHref(role: string) {
  if (role === "cleaner") return "/dashboard";
  if (role === "manager") return "/manager";
  if (role === "owner") return "/owner";
  if (role === "housekeeping_admin" || role === "hk_admin") return "/hk-admin";
  return "/admin";
}

export default async function TaskDeepLinkPage({ params }: { params: Promise<{ taskId: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { taskId } = await params;
  const supabase = createPrivilegedServerSupabaseClient();
  const { data: task, error: taskError } = await supabase.from("work_logs")
    .select("id, user_id, assigned_to, hotel_id, service_name_snapshot, service_description_snapshot, room_number, room_numbers, room_ids, start_time, due_at, status, priority, notes, dispatch_metadata, deleted_at, cancelled_at")
    .eq("id", taskId)
    .is("deleted_at", null)
    .is("cancelled_at", null)
    .maybeSingle();
  if (taskError) throw new Error(`Unable to load task details: ${taskError.message}`);
  if (!task) notFound();

  const { data: hotel, error: hotelError } = await supabase.from("hotels")
    .select("id, name, owner_id, manager_id")
    .eq("id", task.hotel_id)
    .maybeSingle();
  if (hotelError) throw new Error(`Unable to load the task property: ${hotelError.message}`);
  if (!hotel) notFound();

  let canView = isPlatformAdmin(user.role);
  if (user.role === "owner") canView = hotel.owner_id === user.userId;
  if (user.role === "cleaner") canView = (task.assigned_to ?? task.user_id) === user.userId;
  if (user.role === "manager" || isHousekeepingAdmin(user.role)) {
    const { data: assignment, error: assignmentError } = await supabase.from("user_hotel_assignments")
      .select("hotel_id")
      .eq("user_id", user.userId)
      .eq("hotel_id", hotel.id)
      .maybeSingle();
    if (assignmentError) throw new Error(`Unable to verify your property access: ${assignmentError.message}`);
    canView = user.role === "manager"
      ? hotel.manager_id === user.userId || user.hotelId === hotel.id || Boolean(assignment)
      : user.hotelId === hotel.id || Boolean(assignment);
  }
  if (!canView) notFound();

  const metadata = task.dispatch_metadata && typeof task.dispatch_metadata === "object"
    ? task.dispatch_metadata as { floorSection?: string }
    : null;
  const roomLabel = task.room_numbers?.join(", ") || task.room_number || metadata?.floorSection || "General area";
  const scheduledLabel = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(task.start_time));

  return (
    <main className="fixed inset-0 z-[150] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="task-details-title" className="w-full max-w-xl overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        <header className="border-b border-slate-200 bg-slate-50 p-5 sm:p-6">
          <Link href={dashboardHref(user.role)} className="inline-flex min-h-9 items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-950">
            <ArrowLeft className="h-4 w-4" /> Back to dashboard
          </Link>
          <p className="mt-5 text-xs font-bold uppercase tracking-[0.16em] text-sky-700">Task assignment · {task.priority}</p>
          <h1 id="task-details-title" className="mt-1 text-2xl font-bold text-slate-950">{task.service_name_snapshot || "Operations task"}</h1>
        </header>
        <div className="space-y-4 p-5 sm:p-6">
          <div className="flex items-start gap-3 rounded-xl border border-slate-200 p-3">
            <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-sky-700" />
            <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Property and location</p><p className="mt-1 font-semibold text-slate-900">{hotel.name} · {roomLabel}</p></div>
          </div>
          <div className="flex items-start gap-3 rounded-xl border border-slate-200 p-3">
            <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-sky-700" />
            <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Scheduled start</p><p className="mt-1 font-semibold text-slate-900">{scheduledLabel}</p>{task.due_at && <p className="mt-1 text-sm text-slate-600">Due {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(task.due_at))}</p>}</div>
          </div>
          <div className="rounded-xl border border-slate-200 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Task instructions</p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-800">{task.notes || task.service_description_snapshot || "No additional instructions."}</p>
          </div>
          <p className="text-xs text-slate-500">Status: {task.status}</p>
        </div>
      </section>
    </main>
  );
}
