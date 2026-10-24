import { Resend } from "resend";
import { render } from "@react-email/render";
import { BrandedEmail } from "@/components/email/BrandedEmail";
import { isUserRole, normalizeUserRole, type UserRole } from "@/lib/roles";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";

type Cadence = "weekly" | "monthly";
type Metric = { label: string; value: string };
type DigestUser = {
  id: string;
  full_name: string;
  email: string | null;
  role: string;
  email_verified: boolean;
  weekly_digest_enabled: boolean;
  monthly_digest_enabled: boolean;
  primary_hotel_id: string | null;
  created_at: string;
};
type DigestWorkLog = {
  id: string;
  user_id: string;
  assigned_to: string | null;
  assigned_by: string | null;
  hotel_id: string;
  status: string;
  start_time: string;
  end_time: string | null;
  due_at: string | null;
  rooms_completed: number | null;
  room_ids: string[] | null;
  manager_approved: boolean;
  owner_approved: boolean;
  deleted_at: string | null;
  cancelled_at: string | null;
};
type DigestHotel = {
  id: string;
  name: string;
  owner_id: string | null;
  manager_id: string | null;
  is_active: boolean;
};
type DigestAssignment = { user_id: string; hotel_id: string };
type DigestAudit = { work_log_id: string; actor_id: string; created_at: string };
type Period = { from: Date; to: Date; cycleKey: string };

function digestPeriod(cadence: Cadence, now: Date): Period {
  if (cadence === "weekly") {
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const from = new Date(monday);
    from.setUTCDate(from.getUTCDate() - 7);
    const to = new Date(monday.getTime() - 1);
    return { from, to, cycleKey: from.toISOString().slice(0, 10) };
  }
  const currentMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(currentMonth.getTime() - 1);
  const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  return {
    from,
    to,
    cycleKey: `${from.getUTCFullYear()}-${String(from.getUTCMonth() + 1).padStart(2, "0")}`,
  };
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

function hoursFor(logs: DigestWorkLog[]) {
  return logs.reduce((total, log) => {
    if (!log.end_time) return total;
    const hours = (Date.parse(log.end_time) - Date.parse(log.start_time)) / 3_600_000;
    return Number.isFinite(hours) && hours > 0 ? total + hours : total;
  }, 0);
}

function generateRoleScopedDigest(
  user: DigestUser,
  period: Period,
  logs: DigestWorkLog[],
  hotels: DigestHotel[],
  assignments: DigestAssignment[],
  audits: DigestAudit[],
  allUsers: DigestUser[],
): Metric[] {
  const role = normalizeUserRole(user.role as UserRole);
  const ownedHotelIds = hotels.filter((hotel) => hotel.owner_id === user.id).map((hotel) => hotel.id);
  const assignedHotelIds = new Set([
    ...hotels.filter((hotel) => hotel.manager_id === user.id).map((hotel) => hotel.id),
    ...assignments.filter((assignment) => assignment.user_id === user.id).map((assignment) => assignment.hotel_id),
    ...(user.primary_hotel_id ? [user.primary_hotel_id] : []),
  ]);
  const liveLogs = logs.filter((log) => !log.deleted_at && !log.cancelled_at);
  const userLogs = role === "cleaner"
    ? liveLogs.filter((log) => (log.assigned_to ?? log.user_id) === user.id)
    : role === "owner"
      ? liveLogs.filter((log) => ownedHotelIds.includes(log.hotel_id))
      : role === "manager" || role === "housekeeping_admin"
        ? liveLogs.filter((log) => assignedHotelIds.has(log.hotel_id))
        : liveLogs;
  const completed = userLogs.filter((log) => log.status === "completed");
  const verified = completed.filter((log) => log.manager_approved && log.owner_approved);
  const roomCount = completed.reduce((total, log) => total + Math.max(0, log.rooms_completed ?? 0), 0);
  const roomsAssigned = userLogs.reduce((total, log) => total + (log.room_ids?.length ?? 0), 0);
  const overdue = userLogs.filter((log) =>
    log.status !== "completed" && log.due_at !== null && Date.parse(log.due_at) < period.to.getTime()
  ).length;
  const totalHours = hoursFor(completed);
  const verifiedHours = hoursFor(verified);
  const completionRate = userLogs.length ? Math.round(completed.length / userLogs.length * 100) : 0;

  if (role === "super_admin") {
    const activeTenantIds = new Set(hotels.filter((hotel) => hotel.is_active && hotel.owner_id).map((hotel) => hotel.owner_id));
    const newTenants = allUsers.filter((candidate) =>
      candidate.role === "owner"
      && Date.parse(candidate.created_at) >= period.from.getTime()
      && Date.parse(candidate.created_at) <= period.to.getTime()
    ).length;
    return [
      { label: "New tenant accounts", value: String(newTenants) },
      { label: "Active tenant accounts", value: String(activeTenantIds.size) },
      { label: "Completed platform tasks", value: String(completed.length) },
      { label: "Accrued task revenue", value: `$${(completed.length * 0.08).toFixed(2)}` },
    ];
  }
  if (role === "admin") {
    const platformOwnerIds = new Set(allUsers.filter((candidate) => candidate.role === "super_admin").map((candidate) => candidate.id));
    const assignedByPlatformOwner = liveLogs.filter((log) => log.assigned_by !== null && platformOwnerIds.has(log.assigned_by));
    const platformAssignedTaskIds = new Set(assignedByPlatformOwner.map((log) => log.id));
    const handledTaskIds = new Set(audits
      .filter((audit) => audit.actor_id === user.id && platformAssignedTaskIds.has(audit.work_log_id))
      .map((audit) => audit.work_log_id));
    return [
      { label: "Tasks assigned by Super Admin", value: String(assignedByPlatformOwner.length) },
      { label: "Platform tasks handled by you", value: String(handledTaskIds.size) },
      { label: "Platform tasks completed", value: String(completed.length) },
    ];
  }
  if (role === "owner") {
    const propertyUsage = hotels
      .filter((hotel) => hotel.owner_id === user.id)
      .map((hotel) => {
        const taskCount = completed.filter((log) => log.hotel_id === hotel.id).length;
        return {
          label: hotel.name,
          value: `${taskCount} tasks · $${(taskCount * 0.08).toFixed(2)}`,
        };
      });
    return [
      { label: "Rooms turned", value: String(roomCount) },
      { label: "Verified cleaner shifts (approved work records)", value: String(verified.length) },
      { label: "Billing task usage", value: `${completed.length} tasks · $${(completed.length * 0.08).toFixed(2)}` },
      ...propertyUsage,
    ];
  }
  if (role === "manager") {
    return [
      { label: "Assigned-property completion", value: `${completionRate}%` },
      { label: "Manager-approved work hours", value: `${hoursFor(completed.filter((log) => log.manager_approved)).toFixed(1)} hrs` },
      { label: "Overdue tasks", value: String(overdue) },
    ];
  }
  if (role === "housekeeping_admin") {
    const verifiedChecks = completed.filter((log) => log.manager_approved).length;
    const readiness = roomsAssigned ? Math.round(roomCount / roomsAssigned * 100) : 0;
    return [
      { label: "Approved shift inspections (approved task records)", value: String(verifiedChecks) },
      { label: "Team tasks completed", value: String(completed.length) },
      { label: "Room readiness (rooms turned / assigned)", value: `${readiness}%` },
    ];
  }
  return [
    { label: "Completed rooms", value: String(roomCount) },
    { label: "Verified hours", value: `${verifiedHours.toFixed(1)} hrs` },
    { label: "Productivity badge", value: totalHours > 0 && roomCount / totalHours >= 2 ? "Fast turn" : "Consistent" },
  ];
}

async function fetchAllDigestUsers(supabase: ReturnType<typeof createPrivilegedServerSupabaseClient>) {
  const users: DigestUser[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from("users")
      .select("id, full_name, email, role, email_verified, weekly_digest_enabled, monthly_digest_enabled, primary_hotel_id, created_at")
      .range(offset, offset + 999);
    if (error) throw new Error(`Unable to load digest recipients: ${error.message}`);
    const page = (data ?? []) as DigestUser[];
    users.push(...page);
    if (page.length < 1000) return users;
  }
}

async function fetchAllRows<T>(
  loadPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  label: string,
) {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await loadPage(offset, offset + 999);
    if (error) throw new Error(`Unable to load ${label}: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

export async function dispatchRoleScopedDigests(cadence: Cadence) {
  const supabase = createPrivilegedServerSupabaseClient();
  const period = digestPeriod(cadence, new Date());
  const fromDate = period.from.toISOString().slice(0, 10);
  const toDate = period.to.toISOString().slice(0, 10);
  const [allUsers, hotels, assignments, workLogs, audits] = await Promise.all([
    fetchAllDigestUsers(supabase),
    fetchAllRows<DigestHotel>((from, to) => supabase.from("hotels")
      .select("id, name, owner_id, manager_id, is_active")
      .range(from, to), "properties"),
    fetchAllRows<DigestAssignment>((from, to) => supabase.from("user_hotel_assignments")
      .select("user_id, hotel_id")
      .range(from, to), "property assignments"),
    fetchAllRows<DigestWorkLog>((from, to) => supabase.from("work_logs")
      .select("id, user_id, assigned_to, assigned_by, hotel_id, status, start_time, end_time, due_at, rooms_completed, room_ids, manager_approved, owner_approved, deleted_at, cancelled_at")
      .gte("task_date", fromDate)
      .lte("task_date", toDate)
      .range(from, to), "work records"),
    fetchAllRows<DigestAudit>((from, to) => supabase.from("work_log_audit")
      .select("work_log_id, actor_id, created_at")
      .gte("created_at", period.from.toISOString())
      .lte("created_at", period.to.toISOString())
      .range(from, to), "task audit records"),
  ]);

  const { error: staleCodesError } = await supabase.from("email_verification_codes")
    .delete()
    .lte("expires_at", new Date().toISOString());
  if (staleCodesError) throw new Error(`Unable to remove expired verification codes: ${staleCodesError.message}`);

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !fromEmail) throw new Error("Digest email is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL.");
  const resend = new Resend(apiKey);
  const recipients = allUsers.filter((user) =>
    cadence === "weekly" ? user.weekly_digest_enabled : user.monthly_digest_enabled
  );

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const user of recipients) {
    const result = await sendDigestToUser({
      user,
      cadence,
      period,
      allUsers,
      hotels,
      assignments,
      workLogs,
      audits,
      supabase,
      resend,
      fromEmail,
    });
    if (result === "sent") sent += 1;
    else if (result === "skipped") skipped += 1;
    else failed += 1;
  }
  return { cadence, cycleKey: period.cycleKey, sent, skipped, failed };
}

async function sendDigestToUser({
  user,
  cadence,
  period,
  allUsers,
  hotels,
  assignments,
  workLogs,
  audits,
  supabase,
  resend,
  fromEmail,
}: {
  user: DigestUser;
  cadence: Cadence;
  period: Period;
  allUsers: DigestUser[];
  hotels: DigestHotel[];
  assignments: DigestAssignment[];
  workLogs: DigestWorkLog[];
  audits: DigestAudit[];
  supabase: ReturnType<typeof createPrivilegedServerSupabaseClient>;
  resend: Resend;
  fromEmail: string;
}): Promise<"sent" | "skipped" | "failed"> {
  if (!user.email || !user.email_verified) return "skipped";
  if (!isUserRole(user.role)) return "skipped";

  const { error: claimError } = await supabase.from("digest_dispatches").insert({
    user_id: user.id,
    cadence,
    cycle_key: period.cycleKey,
  });
  if (claimError?.code === "23505") return "skipped";
  if (claimError) {
    console.error("Unable to reserve a digest delivery:", claimError.message);
    return "failed";
  }

  const title = cadence === "weekly" ? "Weekly Executive Summary" : "Monthly Operations Closure";
  const metrics = generateRoleScopedDigest(user, period, workLogs, hotels, assignments, audits, allUsers);
  let sendFailure: string | null = null;
  try {
    const { error: sendError } = await resend.emails.send({
      from: fromEmail,
      to: user.email,
      subject: `${title} · ${formatDate(period.from)} – ${formatDate(period.to)}`,
      html: await render(BrandedEmail({
        preview: `${title} for ${formatDate(period.from)} through ${formatDate(period.to)}.`,
        title,
        greeting: `Hello ${user.full_name || "there"},`,
        description: `Here is your role-scoped operations report for ${formatDate(period.from)} through ${formatDate(period.to)}.`,
        metrics,
      })),
    });
    sendFailure = sendError?.message ?? null;
  } catch (error) {
    sendFailure = error instanceof Error ? error.message : "Unknown Resend delivery error.";
  }
  if (sendFailure) {
    const { error: releaseError } = await supabase.from("digest_dispatches")
      .delete()
      .eq("user_id", user.id)
      .eq("cadence", cadence)
      .eq("cycle_key", period.cycleKey);
    if (releaseError) console.error("Unable to release a failed digest reservation:", releaseError.message);
    console.error(`Digest send failed for user ${user.id}:`, sendFailure);
    return "failed";
  }
  return "sent";
}
