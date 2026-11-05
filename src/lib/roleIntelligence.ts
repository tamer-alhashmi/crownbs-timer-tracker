import "server-only";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/roles";
import { isPlatformAdmin } from "@/lib/roles";
import { calculateWorkforceEfficiency } from "@/lib/workforceEfficiency";

export type IntelligenceViewer = {
  userId: string;
  role: Extract<UserRole, "super_admin" | "admin" | "owner" | "manager" | "housekeeping_admin" | "hk_admin">;
  assignedHotelIds: string[];
};

export type IntelligenceKpi = {
  label: string;
  value: string;
  detail: string;
};

export type IntelligencePerformer = {
  id: string;
  name: string;
  role: string;
  completedTasks: number;
  efficiencyScore: number | null;
  efficiencyTaskCount: number;
  shifts: number;
  lastActiveAt: string | null;
};

export type IntelligenceTenant = {
  id: string;
  name: string;
  email: string | null;
  propertyCount: number;
  roomCount: number;
  managerCount: number;
  cleanerCount: number;
  completedTasks: number;
  efficiencyScore: number | null;
  efficiencyTaskCount: number;
  lastActiveAt: string | null;
  isActive: boolean;
};

export type RoleIntelligenceData = {
  title: string;
  subtitle: string;
  periodLabel: string;
  kpis: IntelligenceKpi[];
  performers: IntelligencePerformer[];
  tenants?: IntelligenceTenant[];
};

type Hotel = {
  id: string;
  name: string;
  owner_id: string | null;
  manager_id: string | null;
  room_count: number | null;
  floors_sections: string[] | null;
  is_active: boolean;
};
type User = { id: string; full_name: string; role: string };
type TenantUser = { id: string; full_name: string; email: string | null };
type Assignment = { user_id: string; hotel_id: string };
type WorkLog = {
  id: string;
  user_id: string;
  hotel_id: string;
  status: string;
  created_at: string;
  updated_at: string | null;
  start_time: string | null;
  end_time: string | null;
  rooms_completed: number | null;
  service_name_snapshot: string | null;
  dispatch_metadata: Record<string, unknown> | null;
  services_config: { unit: string | null } | { unit: string | null }[] | null;
};
type Shift = { user_id: string; start_time: string; status: string; end_time: string | null };
type PageResult<T> = { data: T[] | null; error: { message: string } | null };

function calculateLogEfficiency(logs: WorkLog[], now: number) {
  return calculateWorkforceEfficiency(logs.map((log) => ({
    status: log.status,
    start_time: log.start_time,
    end_time: log.end_time,
    rooms_completed: log.rooms_completed,
    service_name_snapshot: log.service_name_snapshot,
    service_unit: Array.isArray(log.services_config) ? log.services_config[0]?.unit ?? null : log.services_config?.unit ?? null,
    dispatch_metadata: log.dispatch_metadata,
  })), now);
}

async function readAllRows<T>(
  label: string,
  readPage: (from: number, to: number) => PromiseLike<PageResult<T>>
) {
  const rows: T[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await readPage(from, from + pageSize - 1);
    if (error) {
      console.error(`[Role Intelligence]: Failed to load ${label}.`, error);
      throw new Error(`Unable to load intelligence data (${label}).`);
    }
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

function rolePresentation(role: IntelligenceViewer["role"]) {
  if (isPlatformAdmin(role)) {
    return {
      title: "Platform & Tenant Intelligence",
      subtitle: "A global view of tenant setup, workforce, and operational activity.",
    };
  }
  if (role === "owner") {
    return {
      title: "Business & Staff Intelligence",
      subtitle: "Your properties, workforce, and organization activity at a glance.",
    };
  }
  if (role === "manager") {
    return {
      title: "Operations & Team Performance",
      subtitle: "Performance and staffing across your assigned properties.",
    };
  }
  return {
    title: "Floor Execution & Staff Activity",
    subtitle: "Room readiness, staff activity, and shifts across your assigned floors.",
  };
}

export async function getRoleScopedIntelligenceData(
  viewer: IntelligenceViewer
): Promise<RoleIntelligenceData> {
  const supabase = createPrivilegedServerSupabaseClient();
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const presentation = rolePresentation(viewer.role);
  const platformViewer = isPlatformAdmin(viewer.role);

  let hotels: Hotel[];
  if (platformViewer) {
    hotels = await readAllRows<Hotel>("all properties", (from, to) =>
      supabase.from("hotels")
        .select("id, name, owner_id, manager_id, room_count, floors_sections, is_active")
        .order("id")
        .range(from, to)
    );
  } else if (viewer.role === "owner") {
    hotels = await readAllRows<Hotel>("owned properties", (from, to) =>
      supabase.from("hotels")
        .select("id, name, owner_id, manager_id, room_count, floors_sections, is_active")
        .eq("owner_id", viewer.userId)
        .order("id")
        .range(from, to)
    );
  } else {
    const assignments = await readAllRows<Assignment>("viewer property assignments", (from, to) =>
      supabase.from("user_hotel_assignments")
        .select("user_id, hotel_id")
        .eq("user_id", viewer.userId)
        .order("hotel_id")
        .range(from, to)
    );
    let assignedIds = [...new Set(assignments.map((assignment) => assignment.hotel_id))];
    if (viewer.assignedHotelIds.length) {
      const permittedIds = new Set(viewer.assignedHotelIds);
      assignedIds = assignedIds.filter((hotelId) => permittedIds.has(hotelId));
    }
    hotels = assignedIds.length
      ? await readAllRows<Hotel>("assigned properties", (from, to) =>
          supabase.from("hotels")
            .select("id, name, owner_id, manager_id, room_count, floors_sections, is_active")
            .in("id", assignedIds)
            .eq("is_active", true)
            .order("id")
            .range(from, to)
        )
      : [];
  }

  const hotelIds = hotels.map((hotel) => hotel.id);
  const hotelIdSet = new Set(hotelIds);
  const assignments = hotelIds.length
    ? await readAllRows<Assignment>("property workforce assignments", (from, to) =>
        supabase.from("user_hotel_assignments")
          .select("user_id, hotel_id")
          .in("hotel_id", hotelIds)
          .order("user_id")
          .range(from, to)
      )
    : [];
  const assignedTeamIds = new Set(assignments.map((assignment) => assignment.user_id));
  for (const hotel of hotels) {
    if (hotel.manager_id) assignedTeamIds.add(hotel.manager_id);
  }
  const userIds = platformViewer ? null : [...assignedTeamIds];
  const users = platformViewer
    ? await readAllRows<User>("platform users", (from, to) =>
        supabase.from("users")
          .select("id, full_name, role")
          .in("role", ["owner", "super_admin", "admin", "manager", "housekeeping_admin", "hk_admin", "cleaner"])
          .order("id")
          .range(from, to)
      )
    : userIds?.length
      ? await readAllRows<User>("assigned team members", (from, to) =>
          supabase.from("users")
            .select("id, full_name, role")
            .in("id", userIds)
            .order("id")
            .range(from, to)
        )
      : [];
  const viewerWorksTasks = viewer.role === "manager" || viewer.role === "housekeeping_admin" || viewer.role === "hk_admin";
  const scopedWorkerIds = users
    .filter((user) => user.id === viewer.userId
      ? viewerWorksTasks
      : platformViewer
        ? ["manager", "housekeeping_admin", "hk_admin", "cleaner"].includes(user.role)
        : viewer.role === "owner"
          ? ["manager", "housekeeping_admin", "hk_admin", "cleaner"].includes(user.role)
          : viewer.role === "manager"
            ? ["housekeeping_admin", "hk_admin", "cleaner"].includes(user.role)
            : user.role === "cleaner")
    .map((user) => user.id);
  const [logs, shifts] = await Promise.all([
    hotelIds.length
      ? readAllRows<WorkLog>("recent work logs", (from, to) =>
          supabase.from("work_logs")
            .select("id, user_id, hotel_id, status, created_at, updated_at, start_time, end_time, rooms_completed, service_name_snapshot, dispatch_metadata, services_config(unit)")
            .in("hotel_id", hotelIds)
            .gte("created_at", thirtyDaysAgo)
            .is("deleted_at", null)
            .is("cancelled_at", null)
            .order("created_at", { ascending: false })
            .range(from, to)
        )
      : Promise.resolve([] as WorkLog[]),
    scopedWorkerIds.length
      ? readAllRows<Shift>("recent shifts", (from, to) =>
          supabase.from("master_shifts")
            .select("user_id, start_time, status, end_time")
            .in("user_id", scopedWorkerIds)
            .gte("start_time", thirtyDaysAgo)
            .order("start_time", { ascending: false })
            .range(from, to)
        )
      : Promise.resolve([] as Shift[]),
  ]);

  const tenants = platformViewer
    ? await readAllRows<TenantUser>("platform tenants", (from, to) =>
        supabase.from("users")
          .select("id, full_name, email")
          .eq("role", "owner")
          .order("id")
          .range(from, to)
      )
    : [];

  const usersById = new Map(users.map((user) => [user.id, user]));
  const scopedTeam = users.filter((user) => {
    if (user.id === viewer.userId) return viewerWorksTasks;
    if (platformViewer) return ["manager", "housekeeping_admin", "hk_admin", "cleaner"].includes(user.role) && assignedTeamIds.has(user.id);
    if (viewer.role === "owner") return ["manager", "housekeeping_admin", "hk_admin", "cleaner"].includes(user.role) && assignedTeamIds.has(user.id);
    if (viewer.role === "manager") return ["housekeeping_admin", "hk_admin", "cleaner"].includes(user.role) && assignedTeamIds.has(user.id);
    return user.role === "cleaner" && assignedTeamIds.has(user.id);
  });
  const teamIds = new Set(scopedTeam.map((user) => user.id));
  const scopedLogs = logs.filter((log) => hotelIdSet.has(log.hotel_id));
  const scopedShifts = shifts.filter((shift) => teamIds.has(shift.user_id));
  const performerStats = new Map<string, { completed: number; shifts: number; lastActiveAt: string | null; efficiencyLogs: WorkLog[] }>();

  for (const log of scopedLogs) {
    if (!teamIds.has(log.user_id)) continue;
    const stats = performerStats.get(log.user_id) ?? { completed: 0, shifts: 0, lastActiveAt: null, efficiencyLogs: [] };
    if (log.status === "completed") stats.completed += 1;
    stats.efficiencyLogs.push(log);
    if (!stats.lastActiveAt || log.created_at > stats.lastActiveAt) stats.lastActiveAt = log.created_at;
    performerStats.set(log.user_id, stats);
  }
  for (const shift of scopedShifts) {
    const stats = performerStats.get(shift.user_id) ?? { completed: 0, shifts: 0, lastActiveAt: null, efficiencyLogs: [] };
    stats.shifts += 1;
    if (!stats.lastActiveAt || shift.start_time > stats.lastActiveAt) stats.lastActiveAt = shift.start_time;
    performerStats.set(shift.user_id, stats);
  }
  if (viewerWorksTasks && !performerStats.has(viewer.userId)) {
    performerStats.set(viewer.userId, { completed: 0, shifts: 0, lastActiveAt: null, efficiencyLogs: [] });
  }

  const allPerformers = [...performerStats.entries()]
    .map(([id, stats]) => {
      const efficiency = calculateLogEfficiency(stats.efficiencyLogs, now.getTime());
      return {
        id,
        name: usersById.get(id)?.full_name ?? "Team member",
        role: usersById.get(id)?.role ?? "staff",
        completedTasks: stats.completed,
        efficiencyScore: efficiency.score,
        efficiencyTaskCount: efficiency.scoredTasks,
        shifts: stats.shifts,
        lastActiveAt: stats.lastActiveAt,
      };
    })
    .sort((first, second) => second.completedTasks - first.completedTasks || second.shifts - first.shifts || first.name.localeCompare(second.name))
    .slice(0, 5);
  const viewerPerformer = [...performerStats.entries()].find(([id]) => id === viewer.userId);
  const viewerEfficiency = viewerPerformer
    ? calculateLogEfficiency(viewerPerformer[1].efficiencyLogs, now.getTime())
    : null;
  const performers = viewerPerformer && !allPerformers.some((performer) => performer.id === viewer.userId)
    ? [...allPerformers.slice(0, 4), {
      id: viewerPerformer[0],
      name: usersById.get(viewerPerformer[0])?.full_name ?? "You",
      role: usersById.get(viewerPerformer[0])?.role ?? viewer.role,
      completedTasks: viewerPerformer[1].completed,
      efficiencyScore: viewerEfficiency?.score ?? null,
      efficiencyTaskCount: viewerEfficiency?.scoredTasks ?? 0,
      shifts: viewerPerformer[1].shifts,
      lastActiveAt: viewerPerformer[1].lastActiveAt,
    }]
    : allPerformers;

  const tenantRows: IntelligenceTenant[] = tenants.map((tenant) => {
    const ownedHotels = hotels.filter((hotel) => hotel.owner_id === tenant.id);
    const ownedHotelIds = new Set(ownedHotels.map((hotel) => hotel.id));
    const tenantTeamIds = new Set<string>();
    for (const hotel of ownedHotels) {
      if (hotel.manager_id && usersById.get(hotel.manager_id)?.role === "manager") {
        tenantTeamIds.add(hotel.manager_id);
      }
    }
    for (const assignment of assignments) {
      if (!ownedHotelIds.has(assignment.hotel_id)) continue;
      const assignedUser = usersById.get(assignment.user_id);
      if (assignedUser && ["manager", "housekeeping_admin", "hk_admin", "cleaner"].includes(assignedUser.role)) {
        tenantTeamIds.add(assignedUser.id);
      }
    }

    const tenantLogs = scopedLogs.filter((log) => ownedHotelIds.has(log.hotel_id));
    const completedTenantLogs = tenantLogs.filter((log) => log.status === "completed");
    const tenantEfficiency = calculateLogEfficiency(tenantLogs, now.getTime());
    const lastActiveAt = tenantLogs.reduce<string | null>(
      (latest, log) => {
        const activityAt = log.updated_at && log.updated_at > log.created_at ? log.updated_at : log.created_at;
        return !latest || activityAt > latest ? activityAt : latest;
      },
      null
    );
    const managerCount = [...tenantTeamIds].filter((id) => usersById.get(id)?.role === "manager").length;
    const cleanerCount = [...tenantTeamIds].filter((id) => usersById.get(id)?.role === "cleaner").length;
    const todayUtc = now.toISOString().slice(0, 10);
    const hasActivityToday = tenantLogs.some((log) => {
      const activityAt = log.updated_at && log.updated_at > log.created_at ? log.updated_at : log.created_at;
      return activityAt.slice(0, 10) === todayUtc;
    });
    const hasActiveWorkLog = tenantLogs.some((log) => log.status === "active");
    const hasActiveShift = scopedShifts.some((shift) =>
      tenantTeamIds.has(shift.user_id) && shift.status === "active" && !shift.end_time
    );

    return {
      id: tenant.id,
      name: tenant.full_name || "Owner",
      email: tenant.email,
      propertyCount: ownedHotels.length,
      roomCount: ownedHotels.reduce((total, hotel) => total + (hotel.room_count ?? 0), 0),
      managerCount,
      cleanerCount,
      completedTasks: completedTenantLogs.length,
      efficiencyScore: tenantEfficiency.score,
      efficiencyTaskCount: tenantEfficiency.scoredTasks,
      lastActiveAt,
      isActive: hasActivityToday || hasActiveWorkLog || hasActiveShift || (
        ownedHotels.some((hotel) => hotel.is_active) &&
        tenantTeamIds.size > 0 &&
        completedTenantLogs.length > 0
      ),
    };
  }).sort((first, second) =>
    second.completedTasks - first.completedTasks ||
    first.name.localeCompare(second.name)
  );

  const roomTotal = hotels.reduce((total, hotel) => total + (hotel.room_count ?? 0), 0);
  const completedTasks = scopedLogs.filter((log) => log.status === "completed").length;
  const activeShifts = scopedShifts.filter((shift) => shift.status === "active" && !shift.end_time).length;
  const activeBusinesses = platformViewer
    ? tenantRows.filter((tenant) => tenant.isActive).length
    : 0;
  const workforce = platformViewer
    ? scopedTeam.filter((user) => user.role === "manager" || user.role === "cleaner").length
    : scopedTeam.length;
  const floorCount = hotels.reduce((total, hotel) => total + (hotel.floors_sections?.length ?? 0), 0);
  const labels = platformViewer
    ? [
        { label: "Active Client Businesses", value: String(activeBusinesses), detail: "Owner or admin tenants with active properties, assigned team members, and recent operational logs." },
        { label: "Global Portfolio", value: `${hotelIds.length} properties`, detail: `${roomTotal.toLocaleString()} rooms across the platform.` },
        { label: "Active Workforce", value: String(workforce), detail: "Managers and cleaners assigned across tenant properties." },
        { label: "Operational Volume", value: String(scopedLogs.filter((log) => log.created_at >= monthStart).length), detail: "Non-deleted, non-cancelled work logs created this month." },
      ]
    : viewer.role === "owner"
      ? [
          { label: "Your Properties", value: String(hotelIds.length), detail: "Properties owned by your account." },
          { label: "Rooms in Portfolio", value: roomTotal.toLocaleString(), detail: "Configured room counts across your properties." },
          { label: "Team Members", value: String(workforce), detail: "Managers, housekeeping admins, and cleaners assigned to your properties." },
          { label: "Active Shifts", value: String(activeShifts), detail: "Team shifts currently in progress." },
        ]
      : viewer.role === "manager"
        ? [
            { label: "Assigned Properties", value: String(hotelIds.length), detail: "Active properties assigned to you." },
            { label: "Rooms in Scope", value: roomTotal.toLocaleString(), detail: "Configured rooms across your assigned properties." },
            { label: "Completed Tasks", value: String(completedTasks), detail: "Completed work logs across your team in the last 30 days." },
            { label: "Active Team Shifts", value: String(activeShifts), detail: "Assigned team shifts currently in progress." },
          ]
        : [
            { label: "Assigned Properties", value: String(hotelIds.length), detail: "Active properties assigned to your housekeeping role." },
            { label: "Floors / Sections", value: String(floorCount), detail: "Configured floors and sections across your assigned properties." },
            { label: "Rooms in Scope", value: roomTotal.toLocaleString(), detail: "Configured rooms across your assigned properties." },
            { label: "Team Shifts", value: String(activeShifts), detail: "Active shifts among staff assigned to your properties." },
          ];

  return {
    ...presentation,
    periodLabel: "Last 30 days",
    kpis: labels,
    performers,
    ...(platformViewer ? { tenants: tenantRows } : {}),
  };
}
