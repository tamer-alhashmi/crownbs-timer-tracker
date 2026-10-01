import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";
import type { AppUserSession } from "@/lib/auth";
import { calculateTaskCost, resolveBillingUnit, resolveServiceRate } from "@/lib/servicePricing";

export type CleanerBrief = {
  kind: "cleaner";
  periodLabel: string;
  fallbackUsed: boolean;
  hours: number;
  rooms: number;
  services: { name: string; count: number }[];
  tasks: BriefTask[];
};

export type BriefTask = {
  id: string;
  cleaner: string;
  hotel: string;
  service: string;
  serviceDescription: string;
  taskDate: string;
  status: string;
  startTime: string;
  endTime: string | null;
  ownerId: string | null;
  ownerName: string;
  managerId: string | null;
  managerName: string;
  responsibilityRecordedAt: string;
  room: string;
  rooms: number;
  hours: number;
  rate: number;
  cost: number;
  notes: string;
  managerApproved?: boolean;
  ownerApproved?: boolean;
  managerRejected?: boolean;
  ownerRejected?: boolean;
  isLocked?: boolean;
  rejectionNotes?: string;
};

export type ManagementBriefHotel = {
  hotelId: string;
  hotelName: string;
  activeCleanerCount: number;
  activeCleaners: string[];
  hours: number;
  rooms: number;
  cost: number;
  services: { name: string; count: number }[];
  tasks: BriefTask[];
};

export type ManagementBrief = {
  kind: "management";
  periodLabel: string;
  hotels: ManagementBriefHotel[];
};

export type ManagementBriefPeriod = { from: string; to: string };

function hoursBetween(start: string, end: string | null) {
  return Math.max(0, ((end ? new Date(end) : new Date()).getTime() - new Date(start).getTime()) / 3_600_000);
}

function periodStart(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export async function getCleanerOperationalBrief(userId: string): Promise<CleanerBrief> {
  const supabase = createPrivilegedServerSupabaseClient();
  const { data: logs, error } = await supabase
    .from("work_logs")
    .select("id, start_time, end_time, task_date, rooms_completed, room_number, room_numbers, service_name_snapshot, service_description_snapshot, notes, cost_override, owner_id, owner_name, manager_id, manager_name, responsibility_recorded_at, manager_approved, owner_approved, manager_rejected, owner_rejected, is_locked, rejection_notes, hotels(name), services_config(name, description, default_rate, unit)")
    .eq("user_id", userId)
    .eq("status", "completed")
    .is("deleted_at", null)
    .is("cancelled_at", null)
    .gte("start_time", periodStart(8))
    .order("start_time", { ascending: false });
  if (error) throw new Error(error.message);

  const yesterdayKey = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const yesterdayLogs = (logs ?? []).filter((log) => log.start_time.slice(0, 10) === yesterdayKey);
  const selectedLogs = yesterdayLogs.length ? yesterdayLogs : (logs ?? []);
  const serviceCounts = new Map<string, number>();
  const tasks: BriefTask[] = [];
  for (const log of selectedLogs) {
    const serviceConfig = Array.isArray(log.services_config) ? log.services_config[0] : log.services_config;
    const serviceName = log.service_name_snapshot ?? serviceConfig?.name ?? "Unknown service";
    const serviceDescription = log.service_description_snapshot ?? serviceConfig?.description ?? serviceName;
    const rate = resolveServiceRate({ name: serviceName, default_rate: serviceConfig?.default_rate });
    const unit = resolveBillingUnit(serviceConfig?.unit, serviceName);
    const hours = hoursBetween(log.start_time, log.end_time);
    const rooms = log.rooms_completed ?? 0;
    serviceCounts.set(serviceName, (serviceCounts.get(serviceName) ?? 0) + 1);
    tasks.push({ id: log.id, cleaner: "You", hotel: log.hotels?.[0]?.name ?? "Hotel", service: serviceName, serviceDescription, taskDate: log.task_date ?? log.start_time.slice(0, 10), status: "completed", startTime: log.start_time, endTime: log.end_time, ownerId: log.owner_id, ownerName: log.owner_name ?? "Unassigned owner", managerId: log.manager_id, managerName: log.manager_name ?? "Unassigned manager", responsibilityRecordedAt: log.responsibility_recorded_at ?? log.start_time, room: (log.room_numbers ?? []).join(", ") || log.room_number || "", rooms, hours, rate, cost: calculateTaskCost(hours, rooms, { name: serviceName, unit, default_rate: rate }, log.cost_override), notes: log.notes ?? "", managerApproved: log.manager_approved, ownerApproved: log.owner_approved, managerRejected: log.manager_rejected, ownerRejected: log.owner_rejected, isLocked: log.is_locked, rejectionNotes: log.rejection_notes ?? "" });
  }
  return {
    kind: "cleaner",
    periodLabel: yesterdayLogs.length ? "Yesterday" : "Last 7 days",
    fallbackUsed: yesterdayLogs.length === 0,
    hours: selectedLogs.reduce((total, log) => total + hoursBetween(log.start_time, log.end_time), 0),
    rooms: selectedLogs.reduce((total, log) => total + (log.rooms_completed ?? 0), 0),
    services: [...serviceCounts.entries()].map(([name, count]) => ({ name, count })),
    tasks,
  };
}

export async function getManagementOperationalBrief(user: AppUserSession, period?: ManagementBriefPeriod): Promise<ManagementBrief> {
  const supabase = createPrivilegedServerSupabaseClient();
  const { data: authUsers } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const matchingAuthUser = (authUsers?.users ?? []).find((authUser) => authUser.email?.toLowerCase() === user.email.toLowerCase());
  const identityIds = new Set([user.userId, matchingAuthUser?.id].filter((id): id is string => Boolean(id)));
  let hotelsQuery = supabase.from("hotels").select("id, name, owner_id, manager_id").order("name");
  if (user.role === "owner") hotelsQuery = hotelsQuery.eq("owner_id", user.userId);
  if (user.role === "manager") hotelsQuery = hotelsQuery.eq("manager_id", user.userId);
  let logQuery = supabase
    .from("work_logs")
    .select("id, hotel_id, user_id, start_time, end_time, task_date, status, rooms_completed, room_number, room_numbers, service_name_snapshot, service_description_snapshot, notes, cost_override, owner_id, owner_name, manager_id, manager_name, responsibility_recorded_at, manager_approved, owner_approved, manager_rejected, owner_rejected, is_locked, rejection_notes, hotels(name), users!work_logs_user_id_fkey(full_name, email), services_config(name, description, default_rate, unit)")
    .is("deleted_at", null)
    .is("cancelled_at", null)
    .order("start_time", { ascending: false });
  if (period) {
    logQuery = logQuery.gte("start_time", period.from).lt("start_time", period.to);
  } else {
    logQuery = logQuery
      .or(`status.eq.active,start_time.gte.${periodStart(1)}`)
      .lt("start_time", new Date().toISOString());
  }
  const [{ data: hotels, error: hotelError }, { data: logs, error: logError }] = await Promise.all([
    hotelsQuery,
    logQuery,
  ]);
  if (hotelError) throw new Error(hotelError.message);
  if (logError) throw new Error(logError.message);

  const visibleHotels = (hotels ?? []).filter((hotel) => user.role === "admin" || identityIds.has(hotel[`${user.role}_id` as "owner_id" | "manager_id"] ?? "") || hotel.id === (user.hotelId ?? null));
  const visibleIds = new Set(visibleHotels.map((hotel) => hotel.id));
  const grouped = new Map<string, ManagementBriefHotel>();
  for (const hotel of visibleHotels) {
    grouped.set(hotel.id, { hotelId: hotel.id, hotelName: hotel.name, activeCleanerCount: 0, activeCleaners: [], hours: 0, rooms: 0, cost: 0, services: [], tasks: [] });
  }
  const serviceCounts = new Map<string, Map<string, number>>();
  const activeCleanerIds = new Map<string, Set<string>>();
  for (const log of logs ?? []) {
    if (!visibleIds.has(log.hotel_id)) continue;
    const hotel = grouped.get(log.hotel_id)!;
    const userProfile = Array.isArray(log.users) ? log.users[0] : log.users;
    const cleaner = userProfile?.full_name ?? userProfile?.email ?? "Cleaner";
    const serviceConfig = Array.isArray(log.services_config) ? log.services_config[0] : log.services_config;
    const service = log.service_name_snapshot ?? serviceConfig?.name ?? "Unknown service";
    const serviceDescription = log.service_description_snapshot ?? serviceConfig?.description ?? service;
    if (log.status === "active") {
      const cleanerIds = activeCleanerIds.get(log.hotel_id) ?? new Set<string>();
      if (!cleanerIds.has(log.user_id)) {
        cleanerIds.add(log.user_id);
        hotel.activeCleaners.push(cleaner);
        hotel.activeCleanerCount += 1;
      }
      activeCleanerIds.set(log.hotel_id, cleanerIds);
    }
    const counts = serviceCounts.get(log.hotel_id) ?? new Map<string, number>();
    counts.set(service, (counts.get(service) ?? 0) + 1);
    serviceCounts.set(log.hotel_id, counts);
    const hours = hoursBetween(log.start_time, log.end_time);
    const rooms = log.rooms_completed ?? 0;
    const rate = resolveServiceRate({ name: service, default_rate: serviceConfig?.default_rate });
    const unit = resolveBillingUnit(serviceConfig?.unit, service);
    const cost = calculateTaskCost(hours, rooms, { name: service, unit, default_rate: rate }, log.cost_override);
    hotel.hours += hours;
    hotel.rooms += rooms;
    hotel.cost += cost;
    hotel.tasks.push({ id: log.id, cleaner, hotel: hotel.hotelName, service, serviceDescription, taskDate: log.task_date ?? log.start_time.slice(0, 10), room: (log.room_numbers ?? []).join(", ") || log.room_number || "", hours, rate, cost, status: log.status, notes: log.notes ?? "", startTime: log.start_time, endTime: log.end_time, ownerId: log.owner_id, ownerName: log.owner_name ?? "Unassigned owner", managerId: log.manager_id, managerName: log.manager_name ?? "Unassigned manager", responsibilityRecordedAt: log.responsibility_recorded_at ?? log.start_time, rooms, managerApproved: log.manager_approved, ownerApproved: log.owner_approved, managerRejected: log.manager_rejected, ownerRejected: log.owner_rejected, isLocked: log.is_locked, rejectionNotes: log.rejection_notes ?? "", });
  }
  for (const hotel of grouped.values()) {
    hotel.services = [...(serviceCounts.get(hotel.hotelId) ?? new Map()).entries()].map(([name, count]) => ({ name, count }));
  }
  return { kind: "management", periodLabel: period ? `${period.from.slice(0, 10)} to ${period.to.slice(0, 10)}` : "Last 24 hours plus active work", hotels: [...grouped.values()].filter((hotel) => hotel.tasks.length > 0) };
}
