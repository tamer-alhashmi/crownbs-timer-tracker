import "server-only";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";
import { dispatchPushNotification } from "@/lib/notifications/notificationDispatcher";
import { isHousekeepingAdmin, normalizeUserRole, type UserRole } from "@/lib/roles";
import { getManagerPropertyIds, getOwnerPropertyIds, getPropertyOwnerIds, getPropertyWorkforceIds } from "@/lib/propertyOwnership";

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
type TaskHotel = { id: string; name: string; owner_id: string | null; manager_id: string | null; is_active: boolean; archived_at: string | null };
type TaskUser = { id: string; full_name: string; role: string; is_active: boolean };
type ActiveShift = { id: string; user_id: string; hotel_id: string; role_at_shift: string | null; start_time: string };
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
  if (!["owner", "manager", "housekeeping_admin", "hk_admin", "cleaner", "super_admin"].includes(actorRole)) return;
  const supabase = createPrivilegedServerSupabaseClient();
  const cutoff = new Date(Date.now() - STALE_AFTER_HOURS * 60 * 60 * 1000).toISOString();

  const { data: actor, error: actorError } = await supabase
    .from("users")
    .select("id, role")
    .eq("id", actorId)
    .maybeSingle();
  if (actorError || !actor || normalizeUserRole(actor.role as UserRole) !== normalizeUserRole(actorRole)) {
    if (actorError) console.error("[Task Escalation]: Failed to verify actor.", actorError);
    throw new Error("Unable to verify account for overdue task alerts.");
  }

  let hotelIds: string[] = [];
  if (actorRole === "super_admin") {
    const { data: properties, error } = await supabase.from("hotels")
      .select("id").eq("is_active", true).is("archived_at", null);
    if (error) {
      console.error("[Task Escalation]: Failed to load platform property scope.", error);
      throw new Error("Unable to load property scope for overdue alerts.");
    }
    hotelIds = (properties ?? []).map((property) => property.id);
  } else if (actorRole !== "cleaner") {
    if (actorRole === "owner") {
      hotelIds = await getOwnerPropertyIds(supabase, actorId);
    } else {
      const [
        { data: assignments, error: assignmentsError },
        { data: profile, error: profileError },
      ] = await Promise.all([
        supabase.from("user_hotel_assignments").select("hotel_id").eq("user_id", actorId),
        supabase.from("users").select("primary_hotel_id").eq("id", actorId).maybeSingle(),
      ]);
      if (assignmentsError || profileError) {
        console.error("[Task Escalation]: Failed to load assigned property scope.", assignmentsError ?? profileError);
        throw new Error("Unable to load property scope for overdue task alerts.");
      }
      hotelIds = [...new Set([
        ...(assignments ?? []).map((assignment) => assignment.hotel_id),
        ...(profile?.primary_hotel_id ? [profile.primary_hotel_id] : []),
        ...(actorRole === "manager" ? await getManagerPropertyIds(supabase, actorId) : []),
      ])];
      if (hotelIds.length) {
        const { data: activeHotels, error } = await supabase.from("hotels").select("id").in("id", hotelIds).eq("is_active", true).is("archived_at", null);
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
  const shifts: ActiveShift[] = actorRole === "cleaner"
    ? await readAllRows<ActiveShift>("the cleaner's active shifts", (from, to) =>
        supabase.from("master_shifts")
          .select("id, user_id, hotel_id, role_at_shift, start_time")
          .eq("user_id", actorId)
          .eq("status", "active")
          .is("end_time", null)
          .lt("start_time", cutoff)
          .order("start_time")
          .range(from, to)
      )
    : hotelIds.length
      ? await readAllRows<ActiveShift>("active shifts at assigned properties", (from, to) =>
          supabase.from("master_shifts")
            .select("id, user_id, hotel_id, role_at_shift, start_time")
            .in("hotel_id", hotelIds)
            .eq("status", "active")
            .is("end_time", null)
            .lt("start_time", cutoff)
            .order("start_time")
            .range(from, to)
        )
      : [];
  if (!candidates.length && !shifts.length) return;

  const relevantHotelIds = [...new Set([...candidates.map((task) => task.hotel_id), ...shifts.map((shift) => shift.hotel_id)])];
  const assigneeIds = [...new Set([
    ...candidates.map((task) => task.assigned_to ?? task.user_id),
    ...shifts.map((shift) => shift.user_id),
  ])];
  const [{ data: hotels, error: hotelsError }, { data: assignees, error: assigneesError }, { data: superAdmins, error: superAdminsError }] = await Promise.all([
    supabase.from("hotels").select("id, name, owner_id, manager_id, is_active, archived_at").in("id", relevantHotelIds),
    supabase.from("users").select("id, full_name, role, is_active").in("id", assigneeIds),
    supabase.from("users").select("id").eq("role", "super_admin").eq("is_active", true),
  ]);
  if (hotelsError || assigneesError || superAdminsError) {
    console.error("[Task Escalation]: Failed to resolve recipients.", hotelsError ?? assigneesError ?? superAdminsError);
    throw new Error("Unable to resolve recipients for overdue task alerts.");
  }

  const hotelById = new Map((hotels ?? []).map((hotel) => [hotel.id, hotel as TaskHotel]));
  const userById = new Map((assignees ?? []).map((user) => [user.id, user as TaskUser]));
  const propertyOwners = await getPropertyOwnerIds(supabase, relevantHotelIds);
  const workforceByHotel = await getPropertyWorkforceIds(
    supabase,
    relevantHotelIds,
    ["manager", "housekeeping_admin", "hk_admin"],
    true,
  );
  const workforceIds = [...new Set([...workforceByHotel.values()].flat())];
  const { data: workforceUsers, error: workforceUsersError } = workforceIds.length
    ? await supabase.from("users").select("id, role").in("id", workforceIds)
    : { data: [], error: null };
  if (workforceUsersError) throw new Error(`Unable to load workforce notification roles: ${workforceUsersError.message}`);
  const workforceRoleById = new Map((workforceUsers ?? []).map((member) => [member.id, member.role]));
  const ownerIds = [...new Set([...propertyOwners.values()].flat())];
  const { data: verifiedOwners, error: verifiedOwnersError } = ownerIds.length
    ? await supabase.from("users").select("id").in("id", ownerIds).eq("is_active", true).eq("email_verified", true)
    : { data: [], error: null };
  if (verifiedOwnersError) throw new Error(`Unable to verify property owners for overdue alerts: ${verifiedOwnersError.message}`);
  const verifiedOwnerIds = new Set((verifiedOwners ?? []).map((owner) => owner.id));

  const superAdminIds = (superAdmins ?? []).map((admin) => admin.id);
  const activeUserIds = new Set((assignees ?? []).filter((user) => user.is_active).map((user) => user.id));
  const alertRows: { task_id: string; incident_started_at: string; recipient_id: string }[] = [];
  const overtimeRows: {
    source_type: "shift";
    source_id: string;
    incident_started_at: string;
    worker_id: string;
    property_id: string;
    recipient_id: string;
    title: string;
    body: string;
  }[] = [];
  const recipientsFor = (role: string, hotel: TaskHotel, workerId: string) => {
    const recipients = new Set<string>([workerId, ...superAdminIds]);
    const workforceIds = workforceByHotel.get(hotel.id) ?? [];
    if (role === "cleaner") {
      workforceIds.filter((id) => isHousekeepingAdmin(workforceRoleById.get(id) ?? "")).forEach((id) => recipients.add(id));
    }
    if (role === "cleaner" || isHousekeepingAdmin(role) || role === "manager") {
      workforceIds.filter((id) => workforceRoleById.get(id) === "manager").forEach((id) => recipients.add(id));
    }
    if (["cleaner", "housekeeping_admin", "hk_admin", "manager"].includes(role)) {
      (propertyOwners.get(hotel.id) ?? []).filter((ownerId) => verifiedOwnerIds.has(ownerId)).forEach((ownerId) => recipients.add(ownerId));
    }
    return [...recipients].filter((id) => id !== workerId || activeUserIds.has(id));
  };

  for (const task of candidates) {
    const hotel = hotelById.get(task.hotel_id);
    const workerId = task.assigned_to ?? task.user_id;
    const worker = userById.get(workerId);
    if (!hotel || !hotel.is_active || hotel.archived_at || !worker?.is_active) continue;
    for (const recipientId of recipientsFor(worker.role, hotel, workerId)) {
      alertRows.push({ task_id: task.id, incident_started_at: task.start_time, recipient_id: recipientId });
    }
  }

  for (const shift of shifts) {
    const hotel = hotelById.get(shift.hotel_id);
    const worker = userById.get(shift.user_id);
    if (!hotel || !hotel.is_active || hotel.archived_at || !worker?.is_active) continue;
    const role = shift.role_at_shift ?? worker.role;
    const durationHours = Math.max(12, Math.floor((Date.now() - Date.parse(shift.start_time)) / 3_600_000));
    const recipients = recipientsFor(role, hotel, shift.user_id);
    for (const recipientId of recipients) {
      overtimeRows.push({
        source_type: "shift",
        source_id: shift.id,
        incident_started_at: shift.start_time,
        worker_id: shift.user_id,
        property_id: hotel.id,
        recipient_id: recipientId,
        title: "12-hour shift overtime",
        body: `${worker.full_name || "A team member"} has been on shift at ${hotel.name} for ${durationHours} hours. Shift started ${new Date(shift.start_time).toLocaleString("en-GB")}.`,
      });
    }
  }

  const [taskInsert, shiftInsert] = await Promise.all([
    alertRows.length
      ? supabase.from("task_overdue_alerts").upsert(alertRows, {
          onConflict: "task_id,incident_started_at,recipient_id",
          ignoreDuplicates: true,
        }).select("task_id, recipient_id")
      : Promise.resolve({ data: [], error: null }),
    overtimeRows.length
      ? supabase.from("workforce_overtime_notifications").upsert(overtimeRows, {
          onConflict: "source_type,source_id,incident_started_at,recipient_id",
          ignoreDuplicates: true,
        }).select("id, recipient_id")
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (taskInsert.error || shiftInsert.error) {
    console.error("[Task Escalation]: Failed to record overtime alerts.", taskInsert.error ?? shiftInsert.error);
    throw new Error("Unable to record overtime alerts.");
  }

  const newRecipients = new Set([
    ...(taskInsert.data ?? []).map((row) => row.recipient_id),
    ...(shiftInsert.data ?? []).map((row) => row.recipient_id),
  ]);
  await Promise.all([...newRecipients].map(async (recipientId) => {
    try {
      await dispatchPushNotification({
        userId: recipientId,
        title: "Workforce overtime alert",
        body: "A work task or shift has exceeded 12 hours. Open Crown Operations to review.",
        url: "/",
        tag: `overtime-${recipientId}-${Date.now()}`,
        urgency: "high",
      });
    } catch (error) {
      console.error("[Task Escalation]: Overtime alert push delivery failed.", error);
    }
  }));
}
