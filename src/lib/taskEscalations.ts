import "server-only";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/roles";

const STALE_AFTER_HOURS = 12;
const PAGE_SIZE = 500;

type ActiveTask = {
  id: string;
  user_id: string;
  assigned_to: string | null;
  hotel_id: string;
  start_time: string;
  status: string;
  end_time: string | null;
  deleted_at: string | null;
  cancelled_at: string | null;
};
type TaskHotel = { id: string; owner_id: string | null; manager_id: string | null };
type TaskUser = { id: string; full_name: string; role: string };
type PageResult<T> = { data: T[] | null; error: { message: string } | null };

async function readAllRows<T>(
  label: string,
  readPage: (from: number, to: number) => PromiseLike<PageResult<T>>
) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await readPage(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error(`[Task Escalation]: Failed to load ${label}.`, error);
      throw new Error(`Unable to process overdue task alerts (${label}).`);
    }
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

export async function createOverdueTaskAlerts(actorId: string, actorRole: UserRole) {
  if (!["owner", "manager", "hk_admin", "cleaner"].includes(actorRole)) return;
  const supabase = createPrivilegedServerSupabaseClient();
  const cutoff = new Date(Date.now() - STALE_AFTER_HOURS * 60 * 60 * 1000).toISOString();

  const { data: actor, error: actorError } = await supabase
    .from("users")
    .select("id, role")
    .eq("id", actorId)
    .maybeSingle();
  if (actorError || !actor || actor.role !== actorRole) {
    if (actorError) console.error("[Task Escalation]: Failed to verify actor.", actorError);
    throw new Error("Unable to verify account for overdue task alerts.");
  }

  let hotelIds: string[] = [];
  if (actorRole !== "cleaner") {
    if (actorRole === "owner") {
      const { data: hotels, error } = await supabase.from("hotels").select("id").eq("owner_id", actorId).eq("is_active", true);
      if (error) {
        console.error("[Task Escalation]: Failed to load owner properties.", error);
        throw new Error("Unable to load property scope for overdue task alerts.");
      }
      hotelIds = (hotels ?? []).map((hotel) => hotel.id);
    } else {
      const [
        { data: assignments, error: assignmentsError },
        { data: profile, error: profileError },
        { data: managedHotels, error: managedHotelsError },
      ] = await Promise.all([
        supabase.from("user_hotel_assignments").select("hotel_id").eq("user_id", actorId),
        supabase.from("users").select("primary_hotel_id").eq("id", actorId).maybeSingle(),
        actorRole === "manager"
          ? supabase.from("hotels").select("id").eq("manager_id", actorId).eq("is_active", true)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (assignmentsError || profileError || managedHotelsError) {
        console.error("[Task Escalation]: Failed to load assigned property scope.", assignmentsError ?? profileError ?? managedHotelsError);
        throw new Error("Unable to load property scope for overdue task alerts.");
      }
      hotelIds = [...new Set([
        ...(assignments ?? []).map((assignment) => assignment.hotel_id),
        ...(profile?.primary_hotel_id ? [profile.primary_hotel_id] : []),
        ...(managedHotels ?? []).map((hotel) => hotel.id),
      ])];
      if (hotelIds.length) {
        const { data: activeHotels, error } = await supabase.from("hotels").select("id").in("id", hotelIds).eq("is_active", true);
        if (error) {
          console.error("[Task Escalation]: Failed to verify assigned properties.", error);
          throw new Error("Unable to verify property scope for overdue task alerts.");
        }
        hotelIds = (activeHotels ?? []).map((hotel) => hotel.id);
      }
    }
  }

  let candidates: ActiveTask[];
  if (actorRole === "cleaner") {
    candidates = await readAllRows<ActiveTask>("the cleaner's active tasks", (from, to) =>
      supabase.from("work_logs")
        .select("id, user_id, assigned_to, hotel_id, start_time, status, end_time, deleted_at, cancelled_at")
        .eq("status", "active")
        .or(`assigned_to.eq.${actorId},user_id.eq.${actorId}`)
        .is("end_time", null)
        .is("deleted_at", null)
        .is("cancelled_at", null)
        .lt("start_time", cutoff)
        .order("start_time")
        .range(from, to)
    );
  } else {
    candidates = hotelIds.length
      ? await readAllRows<ActiveTask>("active tasks at assigned properties", (from, to) =>
          supabase.from("work_logs")
            .select("id, user_id, assigned_to, hotel_id, start_time, status, end_time, deleted_at, cancelled_at")
            .in("hotel_id", hotelIds)
            .eq("status", "active")
            .is("end_time", null)
            .is("deleted_at", null)
            .is("cancelled_at", null)
            .lt("start_time", cutoff)
            .order("start_time")
            .range(from, to)
        )
      : [];
  }
  if (!candidates.length) return;

  const relevantHotelIds = [...new Set(candidates.map((task) => task.hotel_id))];
  const assigneeIds = [...new Set(candidates.map((task) => task.assigned_to ?? task.user_id))];
  const [{ data: hotels, error: hotelsError }, { data: assignees, error: assigneesError }, { data: hkAssignments, error: hkError }] = await Promise.all([
    supabase.from("hotels").select("id, owner_id, manager_id").in("id", relevantHotelIds),
    supabase.from("users").select("id, full_name, role").in("id", assigneeIds),
    supabase.from("user_hotel_assignments").select("user_id, hotel_id").in("hotel_id", relevantHotelIds),
  ]);
  if (hotelsError || assigneesError || hkError) {
    console.error("[Task Escalation]: Failed to resolve recipients.", hotelsError ?? assigneesError ?? hkError);
    throw new Error("Unable to resolve recipients for overdue task alerts.");
  }

  const hotelById = new Map((hotels ?? []).map((hotel) => [hotel.id, hotel as TaskHotel]));
  const userById = new Map((assignees ?? []).map((user) => [user.id, user as TaskUser]));
  const hkAdminsByHotel = new Map<string, string[]>();
  const hkAdminIds = new Set((hkAssignments ?? []).map((assignment) => assignment.user_id));
  if (hkAdminIds.size) {
    const { data: hkAdmins, error } = await supabase.from("users").select("id, role").in("id", [...hkAdminIds]).eq("role", "hk_admin");
    if (error) {
      console.error("[Task Escalation]: Failed to resolve housekeeping administrators.", error);
      throw new Error("Unable to resolve recipients for overdue task alerts.");
    }
    const validHkAdminIds = new Set((hkAdmins ?? []).map((user) => user.id));
    for (const assignment of hkAssignments ?? []) {
      if (!validHkAdminIds.has(assignment.user_id)) continue;
      const ids = hkAdminsByHotel.get(assignment.hotel_id) ?? [];
      ids.push(assignment.user_id);
      hkAdminsByHotel.set(assignment.hotel_id, ids);
    }
  }

  const alertRows: { task_id: string; incident_started_at: string; recipient_id: string }[] = [];
  for (const task of candidates) {
    const hotel = hotelById.get(task.hotel_id);
    const assigneeId = task.assigned_to ?? task.user_id;
    const assignee = userById.get(assigneeId);
    if (!hotel || !assignee) continue;
    const recipientIds = new Set<string>();
    if (assignee.role === "cleaner") {
      (hkAdminsByHotel.get(hotel.id) ?? []).forEach((id) => recipientIds.add(id));
      if (hotel.manager_id) recipientIds.add(hotel.manager_id);
      if (hotel.owner_id) recipientIds.add(hotel.owner_id);
    } else if (assignee.role === "hk_admin") {
      if (hotel.manager_id) recipientIds.add(hotel.manager_id);
      if (hotel.owner_id) recipientIds.add(hotel.owner_id);
    } else if (assignee.role === "manager" && hotel.owner_id) {
      recipientIds.add(hotel.owner_id);
    }

    for (const recipientId of recipientIds) {
      if (recipientId === assigneeId) continue;
      alertRows.push({
        task_id: task.id,
        incident_started_at: task.start_time,
        recipient_id: recipientId,
      });
    }
  }

  if (!alertRows.length) return;
  const { error: insertError } = await supabase.from("task_overdue_alerts").upsert(alertRows, {
    onConflict: "task_id,incident_started_at,recipient_id",
    ignoreDuplicates: true,
  });
  if (insertError) {
    console.error("[Task Escalation]: Failed to record overdue alert delivery.", insertError);
    throw new Error("Unable to record overdue task alerts.");
  }
}
