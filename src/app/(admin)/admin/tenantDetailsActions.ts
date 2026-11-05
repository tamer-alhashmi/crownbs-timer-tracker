"use server";

import { revalidatePath } from "next/cache";
import type { ServicePricing } from "@/lib/servicePricing";
import { getSessionUser } from "@/lib/auth";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentBillingCycle, getOwnerBillingUsage, RATE_PER_COMPLETED_TASK } from "@/lib/ownerBilling";

const LOGS_PAGE_SIZE = 15;
const EXPORT_PAGE_SIZE = 500;

export type TenantLog = {
  id: string;
  start_time: string;
  end_time: string | null;
  task_date: string | null;
  status: string;
  rooms_completed: number;
  room_number: string | null;
  room_numbers: string[];
  room_ids: string[];
  shift_id: string | null;
  service_description_snapshot: string | null;
  notes: string | null;
  travel_time_included: boolean;
  owner_id: string | null;
  owner_name: string | null;
  manager_id: string | null;
  manager_name: string | null;
  assigned_by: string | null;
  assigned_to: string | null;
  assigned_at: string | null;
  created_at: string;
  updated_at: string;
  due_at: string | null;
  priority: string;
  dispatch_metadata: Record<string, unknown>;
  responsibility_recorded_at: string | null;
  import_key: string | null;
  is_locked: boolean;
  manager_approved: boolean;
  owner_approved: boolean;
  manager_approved_at: string | null;
  owner_approved_at: string | null;
  manager_rejected: boolean;
  owner_rejected: boolean;
  manager_rejected_at: string | null;
  owner_rejected_at: string | null;
  rejection_notes: string | null;
  cleanerName: string;
  hotelName: string;
  serviceName: string;
  service: ServicePricing;
  cost_override: number | string | null;
};

export type TenantDetails = {
  owner: {
    id: string;
    fullName: string;
    email: string;
    phoneNumber: string | null;
    avatarUrl: string | null;
    hourlyRate: number;
    languagePreference: string;
    primaryHotelId: string | null;
    updatedAt: string;
    role: string;
    createdAt: string;
    isActive: boolean;
    deactivatedAt: string | null;
  };
  properties: {
    id: string;
    managerId: string | null;
    name: string;
    location: string;
    createdAt: string;
    roomCount: number;
    storedTotalRooms: number;
    totalRooms: number;
    floorCount: number;
    isActive: boolean;
    archivedAt: string | null;
    managerName: string | null;
    managerEmail: string | null;
  }[];
  workforce: {
    id: string;
    name: string;
    email: string;
    role: string;
    isActive: boolean;
    propertyIds: string[];
    propertyNames: string[];
  }[];
  assignmentCandidates: {
    id: string;
    name: string;
    email: string;
    role: string;
    isActive: boolean;
  }[];
  tenantCandidates: {
    id: string;
    name: string;
    email: string;
  }[];
  settlements: {
    id: string;
    cycleStart: string;
    cycleEnd: string;
    settledTaskCount: number;
    settledAmount: number;
    settledAt: string;
  }[];
  metrics: {
    taskCount: number;
    completedTasks: number;
    completedHours: number;
    laborCost: number;
    currentCycleAmountDue: number;
    currentCycleSettledAmount: number;
    ratePerTask: number;
    currency: "USD";
  };
  logs: TenantLog[];
  logCount: number;
  page: number;
  pageSize: number;
};

type DateFilter = { from: string | null; to: string | null };

async function requireSuperAdmin() {
  const session = await getSessionUser();
  if (!session || session.role !== "super_admin") {
    throw new Error("Only a super administrator can view or manage tenant details.");
  }
  const supabase = createPrivilegedServerSupabaseClient();
  const { data: profile, error } = await supabase.from("users")
    .select("role, is_active")
    .eq("id", session.userId)
    .maybeSingle();
  if (error) throw new Error(`Unable to verify administrator access: ${error.message}`);
  if (!profile || profile.role !== "super_admin" || profile.is_active === false) {
    throw new Error("Your super administrator access is no longer active.");
  }
  return { session, supabase };
}

function validateDateFilter(filter: DateFilter) {
  const validDate = (value: string | null) => {
    if (value === null) return true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  if (!validDate(filter.from) || !validDate(filter.to)) throw new Error("Choose a valid date range.");
  if (filter.from && filter.to && filter.from > filter.to) throw new Error("The start date must be before the end date.");
}

function endOfDateFilter(to: string) {
  const exclusiveEnd = new Date(`${to}T00:00:00.000Z`);
  exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
  return exclusiveEnd.toISOString();
}

function toTenantLog(row: {
  id: string;
  start_time: string;
  end_time: string | null;
  task_date: string | null;
  status: string;
  rooms_completed: number;
  room_number: string | null;
  room_numbers: string[];
  room_ids: string[];
  shift_id: string | null;
  service_description_snapshot: string | null;
  notes: string | null;
  travel_time_included: boolean;
  owner_id: string | null;
  owner_name: string | null;
  manager_id: string | null;
  manager_name: string | null;
  assigned_by: string | null;
  assigned_to: string | null;
  assigned_at: string | null;
  created_at: string;
  updated_at: string;
  due_at: string | null;
  priority: string;
  dispatch_metadata: Record<string, unknown>;
  responsibility_recorded_at: string | null;
  import_key: string | null;
  is_locked: boolean;
  manager_approved: boolean;
  owner_approved: boolean;
  manager_approved_at: string | null;
  owner_approved_at: string | null;
  manager_rejected: boolean;
  owner_rejected: boolean;
  manager_rejected_at: string | null;
  owner_rejected_at: string | null;
  rejection_notes: string | null;
  cost_override: number | string | null;
  service_name_snapshot: string | null;
  users: { full_name: string | null; email: string } | { full_name: string | null; email: string }[] | null;
  hotels: { name: string } | { name: string }[] | null;
  services_config: ServicePricing | ServicePricing[] | null;
}): TenantLog {
  const user = Array.isArray(row.users) ? row.users[0] : row.users;
  const hotel = Array.isArray(row.hotels) ? row.hotels[0] : row.hotels;
  const service = Array.isArray(row.services_config) ? row.services_config[0] : row.services_config;
  return {
    id: row.id,
    start_time: row.start_time,
    end_time: row.end_time,
    task_date: row.task_date,
    status: row.status,
    rooms_completed: row.rooms_completed,
    room_number: row.room_number,
    room_numbers: row.room_numbers ?? [],
    room_ids: row.room_ids ?? [],
    shift_id: row.shift_id,
    service_description_snapshot: row.service_description_snapshot,
    notes: row.notes,
    travel_time_included: row.travel_time_included,
    owner_id: row.owner_id,
    owner_name: row.owner_name,
    manager_id: row.manager_id,
    manager_name: row.manager_name,
    assigned_by: row.assigned_by,
    assigned_to: row.assigned_to,
    assigned_at: row.assigned_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    due_at: row.due_at,
    priority: row.priority,
    dispatch_metadata: row.dispatch_metadata ?? {},
    responsibility_recorded_at: row.responsibility_recorded_at,
    import_key: row.import_key,
    is_locked: row.is_locked,
    manager_approved: row.manager_approved,
    owner_approved: row.owner_approved,
    manager_approved_at: row.manager_approved_at,
    owner_approved_at: row.owner_approved_at,
    manager_rejected: row.manager_rejected,
    owner_rejected: row.owner_rejected,
    manager_rejected_at: row.manager_rejected_at,
    owner_rejected_at: row.owner_rejected_at,
    rejection_notes: row.rejection_notes,
    cleanerName: user?.full_name || user?.email || "Unknown worker",
    hotelName: hotel?.name ?? "Unknown property",
    serviceName: service?.name ?? row.service_name_snapshot ?? "Service",
    service: service ?? { name: row.service_name_snapshot },
    cost_override: row.cost_override,
  };
}

export async function getTenantDetails(
  ownerId: string,
  filter: DateFilter = { from: null, to: null },
  page = 1,
): Promise<TenantDetails> {
  if (!ownerId) throw new Error("Tenant owner is required.");
  validateDateFilter(filter);
  const { supabase } = await requireSuperAdmin();
  const safePage = Number.isInteger(page) ? Math.max(1, page) : 1;
  const [{ data: owner, error: ownerError }, usage] = await Promise.all([
    supabase.from("users")
      .select("id, full_name, email, phone_number, avatar_url, hourly_rate, language_preference, primary_hotel_id, role, created_at, updated_at, is_active, deactivated_at")
      .eq("id", ownerId)
      .eq("role", "owner")
      .maybeSingle(),
    getOwnerBillingUsage(ownerId),
  ]);
  if (ownerError) throw new Error(`Unable to load tenant profile: ${ownerError.message}`);
  if (!owner) throw new Error("The requested tenant was not found.");

  const { data: hotelRows, error: hotelsError } = await supabase.from("hotels")
    .select("id, name, location, created_at, total_rooms, room_count, floor_count, is_active, archived_at, manager_id")
    .eq("owner_id", ownerId)
    .order("name")
    .order("id");
  if (hotelsError) throw new Error(`Unable to load tenant properties: ${hotelsError.message}`);
  const hotels = hotelRows ?? [];
  const hotelIds = hotels.map((hotel) => hotel.id);
  const managerIds = [...new Set(hotels.map((hotel) => hotel.manager_id).filter((id): id is string => Boolean(id)))];
  const [assignmentResult, roomResult, settlementResult, managerResult, candidateResult, ownerCandidateResult] = await Promise.all([
    hotelIds.length
      ? supabase.from("user_hotel_assignments").select("user_id, hotel_id").in("hotel_id", hotelIds)
      : Promise.resolve({ data: [], error: null }),
    hotelIds.length
      ? supabase.from("rooms").select("hotel_id, status").in("hotel_id", hotelIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("tenant_settlements")
      .select("id, cycle_start, cycle_end, settled_task_count, settled_amount, settled_at")
      .eq("owner_id", ownerId)
      .order("cycle_start", { ascending: false }),
    managerIds.length
      ? supabase.from("users").select("id, full_name, email, role, is_active").in("id", managerIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("users")
      .select("id, full_name, email, role, is_active")
      .in("role", ["manager", "housekeeping_admin", "hk_admin", "cleaner"])
      .order("full_name"),
    supabase.from("users").select("id, full_name, email")
      .eq("role", "owner")
      .eq("is_active", true)
      .neq("id", ownerId)
      .order("full_name")
      .limit(500),
  ]);
  const relatedError = assignmentResult.error ?? roomResult.error ?? settlementResult.error ?? managerResult.error ?? candidateResult.error ?? ownerCandidateResult.error;
  if (relatedError) throw new Error(`Unable to load tenant details: ${relatedError.message}`);
  const assignments = assignmentResult.data ?? [];
  const assignmentIds = assignments.map((assignment) => assignment.user_id);
  const managerById = new Map((managerResult.data ?? []).map((manager) => [manager.id, manager]));
  const roomCounts = new Map<string, number>();
  (roomResult.data ?? []).forEach((room) => {
    if (room.status === "active") roomCounts.set(room.hotel_id, (roomCounts.get(room.hotel_id) ?? 0) + 1);
  });

  const workforceIds = [...new Set([...assignmentIds, ...managerIds])];
  const [{ data: assignedProfiles, error: assignedProfilesError }, { data: primaryProfiles, error: primaryProfilesError }] = await Promise.all([
    workforceIds.length
      ? supabase.from("users").select("id, full_name, email, role, is_active, primary_hotel_id").in("id", workforceIds)
      : Promise.resolve({ data: [], error: null }),
    hotelIds.length
      ? supabase.from("users").select("id, full_name, email, role, is_active, primary_hotel_id").in("primary_hotel_id", hotelIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (assignedProfilesError || primaryProfilesError) {
    throw new Error(`Unable to load assigned workforce: ${assignedProfilesError?.message ?? primaryProfilesError?.message}`);
  }
  const profilesById = new Map([...(assignedProfiles ?? []), ...(primaryProfiles ?? [])].map((profile) => [profile.id, profile]));
  const propertyIdsByUser = new Map<string, Set<string>>();
  assignments.forEach((assignment) => {
    const assigned = propertyIdsByUser.get(assignment.user_id) ?? new Set<string>();
    assigned.add(assignment.hotel_id);
    propertyIdsByUser.set(assignment.user_id, assigned);
  });
  hotels.forEach((hotel) => {
    if (!hotel.manager_id) return;
    const assigned = propertyIdsByUser.get(hotel.manager_id) ?? new Set<string>();
    assigned.add(hotel.id);
    propertyIdsByUser.set(hotel.manager_id, assigned);
  });

  let logsQuery = hotelIds.length
    ? supabase.from("work_logs")
      .select("id, start_time, end_time, task_date, status, rooms_completed, room_number, room_numbers, room_ids, shift_id, service_description_snapshot, notes, travel_time_included, owner_id, owner_name, manager_id, manager_name, assigned_by, assigned_to, assigned_at, created_at, updated_at, due_at, priority, dispatch_metadata, responsibility_recorded_at, import_key, is_locked, manager_approved, owner_approved, manager_approved_at, owner_approved_at, manager_rejected, owner_rejected, manager_rejected_at, owner_rejected_at, rejection_notes, cost_override, service_name_snapshot, users!work_logs_user_id_fkey(full_name, email), hotels(name), services_config(name, description, unit, default_rate)", { count: "exact" })
      .in("hotel_id", hotelIds)
      .is("deleted_at", null)
      .is("cancelled_at", null)
    : null;
  if (logsQuery && filter.from) {
    logsQuery = logsQuery.or(`task_date.gte.${filter.from},and(task_date.is.null,start_time.gte.${filter.from}T00:00:00.000Z)`);
  }
  if (logsQuery && filter.to) {
    logsQuery = logsQuery.or(`task_date.lte.${filter.to},and(task_date.is.null,start_time.lt.${endOfDateFilter(filter.to)})`);
  }
  const [{ data: logRows, count: logCount, error: logsError }, { data: summary, error: summaryError }, currentSettlementResult] = await Promise.all([
    logsQuery
      ? logsQuery.order("start_time", { ascending: false }).order("id").range((safePage - 1) * LOGS_PAGE_SIZE, safePage * LOGS_PAGE_SIZE - 1)
      : Promise.resolve({ data: [], count: 0, error: null }),
    supabase.rpc("get_tenant_performance_summary", {
      p_owner_id: ownerId,
      p_from: filter.from,
      p_to: filter.to,
    }),
    (async () => {
      const { cycleStart, cycleEnd } = getCurrentBillingCycle();
      return supabase.from("tenant_settlements").select("settled_amount")
        .eq("owner_id", ownerId)
        .eq("cycle_start", cycleStart)
        .eq("cycle_end", cycleEnd)
        .maybeSingle();
    })(),
  ]);
  if (logsError || summaryError || currentSettlementResult.error) {
    throw new Error(`Unable to load tenant history or financials: ${logsError?.message ?? summaryError?.message ?? currentSettlementResult.error?.message}`);
  }
  const summaryRow = Array.isArray(summary) ? summary[0] : summary;

  return {
    owner: {
      id: owner.id,
      fullName: owner.full_name,
      email: owner.email,
      phoneNumber: owner.phone_number,
      avatarUrl: owner.avatar_url,
      hourlyRate: Number(owner.hourly_rate),
      languagePreference: owner.language_preference,
      primaryHotelId: owner.primary_hotel_id,
      updatedAt: owner.updated_at,
      role: owner.role,
      createdAt: owner.created_at,
      isActive: owner.is_active,
      deactivatedAt: owner.deactivated_at,
    },
    properties: hotels.map((hotel) => {
      const manager = hotel.manager_id ? managerById.get(hotel.manager_id) : null;
      return {
        id: hotel.id,
        managerId: hotel.manager_id,
        name: hotel.name,
        location: hotel.location,
        createdAt: hotel.created_at,
        roomCount: hotel.room_count ?? 0,
        storedTotalRooms: hotel.total_rooms ?? 0,
        totalRooms: Math.max(hotel.total_rooms ?? 0, hotel.room_count ?? 0, roomCounts.get(hotel.id) ?? 0),
        floorCount: hotel.floor_count ?? 0,
        isActive: hotel.is_active,
        archivedAt: hotel.archived_at,
        managerName: manager?.full_name ?? null,
        managerEmail: manager?.email ?? null,
      };
    }),
    workforce: [...profilesById.values()].map((profile) => ({
      id: profile.id,
      name: profile.full_name || profile.email,
      email: profile.email,
      role: profile.role,
      isActive: profile.is_active,
      propertyIds: hotels.filter((hotel) => propertyIdsByUser.get(profile.id)?.has(hotel.id) || profile.primary_hotel_id === hotel.id).map((hotel) => hotel.id),
      propertyNames: hotels.filter((hotel) => propertyIdsByUser.get(profile.id)?.has(hotel.id) || profile.primary_hotel_id === hotel.id).map((hotel) => hotel.name),
    })),
    assignmentCandidates: (candidateResult.data ?? []).map((profile) => ({
      id: profile.id,
      name: profile.full_name || profile.email,
      email: profile.email,
      role: profile.role,
      isActive: profile.is_active,
    })),
    tenantCandidates: (ownerCandidateResult.data ?? []).map((profile) => ({
      id: profile.id,
      name: profile.full_name || profile.email,
      email: profile.email,
    })),
    settlements: (settlementResult.data ?? []).map((settlement) => ({
      id: settlement.id,
      cycleStart: settlement.cycle_start,
      cycleEnd: settlement.cycle_end,
      settledTaskCount: settlement.settled_task_count,
      settledAmount: Number(settlement.settled_amount),
      settledAt: settlement.settled_at,
    })),
    metrics: {
      taskCount: Number(summaryRow?.task_count ?? 0),
      completedTasks: Number(summaryRow?.completed_tasks ?? 0),
      completedHours: Number(summaryRow?.completed_hours ?? 0),
      laborCost: Number(summaryRow?.labor_cost ?? 0),
      currentCycleAmountDue: usage.amountDue,
      currentCycleSettledAmount: Number(currentSettlementResult.data?.settled_amount ?? 0),
      ratePerTask: RATE_PER_COMPLETED_TASK,
      currency: usage.currency,
    },
    logs: (logRows ?? []).map((row) => toTenantLog(row)),
    logCount: logCount ?? 0,
    page: safePage,
    pageSize: LOGS_PAGE_SIZE,
  };
}

export async function getTenantWorkLogExport(ownerId: string, filter: DateFilter): Promise<TenantLog[]> {
  if (!ownerId) throw new Error("Tenant owner is required.");
  validateDateFilter(filter);
  const { supabase } = await requireSuperAdmin();
  const { data: hotels, error: hotelsError } = await supabase.from("hotels").select("id").eq("owner_id", ownerId);
  if (hotelsError) throw new Error(`Unable to load tenant properties: ${hotelsError.message}`);
  const hotelIds = (hotels ?? []).map((hotel) => hotel.id);
  if (!hotelIds.length) return [];

  const exported: TenantLog[] = [];
  for (let from = 0; ; from += EXPORT_PAGE_SIZE) {
    let query = supabase.from("work_logs")
      .select("id, start_time, end_time, task_date, status, rooms_completed, room_number, room_numbers, room_ids, shift_id, service_description_snapshot, notes, travel_time_included, owner_id, owner_name, manager_id, manager_name, assigned_by, assigned_to, assigned_at, created_at, updated_at, due_at, priority, dispatch_metadata, responsibility_recorded_at, import_key, is_locked, manager_approved, owner_approved, manager_approved_at, owner_approved_at, manager_rejected, owner_rejected, manager_rejected_at, owner_rejected_at, rejection_notes, cost_override, service_name_snapshot, users!work_logs_user_id_fkey(full_name, email), hotels(name), services_config(name, description, unit, default_rate)")
      .in("hotel_id", hotelIds)
      .is("deleted_at", null)
      .is("cancelled_at", null);
    if (filter.from) {
      query = query.or(`task_date.gte.${filter.from},and(task_date.is.null,start_time.gte.${filter.from}T00:00:00.000Z)`);
    }
    if (filter.to) {
      query = query.or(`task_date.lte.${filter.to},and(task_date.is.null,start_time.lt.${endOfDateFilter(filter.to)})`);
    }
    const { data, error } = await query.order("start_time", { ascending: false }).order("id").range(from, from + EXPORT_PAGE_SIZE - 1);
    if (error) throw new Error(`Unable to export tenant work logs: ${error.message}`);
    const rows = data ?? [];
    exported.push(...rows.map((row) => toTenantLog(row)));
    if (rows.length < EXPORT_PAGE_SIZE) return exported;
  }
}

export async function updateTenantProfile(ownerId: string, input: { fullName: string; email: string; phoneNumber: string }) {
  if (!ownerId) throw new Error("Tenant owner is required.");
  const fullName = input.fullName.trim();
  const email = input.email.trim().toLowerCase();
  const phoneNumber = input.phoneNumber.trim();
  if (!fullName) throw new Error("Tenant name is required.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid contact email.");
  if (phoneNumber.length > 32 || (phoneNumber && !/^[+()\d\s.-]{5,32}$/.test(phoneNumber))) {
    throw new Error("Enter a valid phone number or leave it blank.");
  }

  const { supabase } = await requireSuperAdmin();
  const { data: owner, error: ownerError } = await supabase.from("users")
    .select("id, email")
    .eq("id", ownerId)
    .eq("role", "owner")
    .maybeSingle();
  if (ownerError) throw new Error(`Unable to verify tenant: ${ownerError.message}`);
  if (!owner) throw new Error("The requested tenant was not found.");

  if (email !== owner.email) {
    const { error: authError } = await supabase.auth.admin.updateUserById(ownerId, { email });
    if (authError) throw new Error(`Unable to update the tenant login email: ${authError.message}`);
  }
  const { data: updatedProfile, error } = await supabase.from("users")
    .update({ full_name: fullName, email, phone_number: phoneNumber || null, updated_at: new Date().toISOString() })
    .eq("id", ownerId)
    .eq("role", "owner")
    .select("id")
    .maybeSingle();
  if (error || !updatedProfile) {
    if (email !== owner.email) {
      const { error: rollbackError } = await supabase.auth.admin.updateUserById(ownerId, { email: owner.email });
      if (rollbackError) console.error("Tenant auth email rollback failed after profile update error:", rollbackError);
    }
    if (error) throw new Error(`Unable to save tenant profile: ${error.message}`);
    throw new Error("The requested tenant was no longer available to update.");
  }
  revalidatePath("/admin/tenant-accounts");
  revalidatePath("/settings");
}

export async function setTenantActive(ownerId: string, isActive: boolean) {
  if (!ownerId) throw new Error("Tenant owner is required.");
  if (typeof isActive !== "boolean") throw new Error("Choose a valid tenant account status.");
  const { supabase } = await requireSuperAdmin();
  const { data, error } = await supabase.from("users")
    .update({
      is_active: isActive,
      deactivated_at: isActive ? null : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", ownerId)
    .eq("role", "owner")
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Unable to update tenant status: ${error.message}`);
  if (!data) throw new Error("The requested tenant was not found.");
  revalidatePath("/admin/tenant-accounts");
  revalidatePath("/settings");
}

export async function updateTenantPropertyDetails(
  ownerId: string,
  propertyId: string,
  input: { name: string; location: string; rooms: number; floors: number },
) {
  const name = input.name.trim();
  const location = input.location.trim();
  if (!ownerId || !propertyId) throw new Error("Tenant and property are required.");
  if (!name || name.length > 120) throw new Error("Property name is required and must be 120 characters or fewer.");
  if (!location || location.length > 240) throw new Error("Property address/location is required and must be 240 characters or fewer.");
  if (!Number.isInteger(input.rooms) || input.rooms < 0 || input.rooms > 2000) throw new Error("Rooms/units must be a whole number between 0 and 2,000.");
  if (!Number.isInteger(input.floors) || input.floors < 0 || input.floors > 200) throw new Error("Floors must be a whole number between 0 and 200.");

  const { supabase } = await requireSuperAdmin();
  const { data, error } = await supabase.from("hotels")
    .update({
      name,
      location,
      room_count: input.rooms,
      total_rooms: input.rooms,
      floor_count: input.floors,
    })
    .eq("id", propertyId)
    .eq("owner_id", ownerId)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Unable to update property details: ${error.message}`);
  if (!data) throw new Error("The property is no longer available for editing.");
  revalidateTenantPropertyViews();
}

export async function setTenantPropertyArchived(ownerId: string, propertyId: string, archive: boolean) {
  if (!ownerId || !propertyId || typeof archive !== "boolean") throw new Error("Choose a valid property archive action.");
  const { supabase } = await requireSuperAdmin();
  const { data, error } = await supabase.from("hotels")
    .update({
      archived_at: archive ? new Date().toISOString() : null,
      is_active: false,
    })
    .eq("id", propertyId)
    .eq("owner_id", ownerId)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Unable to ${archive ? "archive" : "restore"} property: ${error.message}`);
  if (!data) throw new Error("The property does not belong to this tenant.");
  revalidateTenantPropertyViews();
}

export async function setTenantPropertyActive(ownerId: string, propertyId: string, isActive: boolean) {
  if (!ownerId || !propertyId || typeof isActive !== "boolean") throw new Error("Choose a valid property status.");
  const { supabase } = await requireSuperAdmin();
  const { data, error } = await supabase.from("hotels")
    .update({ is_active: isActive })
    .eq("id", propertyId)
    .eq("owner_id", ownerId)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Unable to update property status: ${error.message}`);
  if (!data) throw new Error("Archived properties must be restored before activation.");
  revalidateTenantPropertyViews();
}

export async function transferTenantProperty(ownerId: string, propertyId: string, targetOwnerId: string) {
  if (!ownerId || !propertyId || !targetOwnerId || targetOwnerId === ownerId) {
    throw new Error("Choose a different tenant account for the transfer.");
  }
  const { supabase } = await requireSuperAdmin();
  const { data: target, error: targetError } = await supabase.from("users")
    .select("id")
    .eq("id", targetOwnerId)
    .eq("role", "owner")
    .eq("is_active", true)
    .maybeSingle();
  if (targetError) throw new Error(`Unable to verify target tenant: ${targetError.message}`);
  if (!target) throw new Error("Choose an active tenant owner account.");
  const { data, error } = await supabase.from("hotels")
    .update({ owner_id: targetOwnerId })
    .eq("id", propertyId)
    .eq("owner_id", ownerId)
    .eq("is_active", true)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Unable to transfer property ownership: ${error.message}`);
  if (!data) throw new Error("The property is no longer available to transfer.");
  revalidateTenantPropertyViews();
}

export async function setTenantWorkerActive(ownerId: string, workerId: string, isActive: boolean) {
  if (!ownerId || !workerId || typeof isActive !== "boolean") throw new Error("Choose a valid workforce status.");
  const { supabase } = await requireSuperAdmin();
  const { data: properties, error: propertyError } = await supabase.from("hotels")
    .select("id")
    .eq("owner_id", ownerId);
  if (propertyError) throw new Error(`Unable to verify tenant properties: ${propertyError.message}`);
  const propertyIds = (properties ?? []).map((property) => property.id);
  if (!propertyIds.length) throw new Error("This tenant has no active properties.");
  const [{ data: worker, error: workerError }, { data: assignments, error: assignmentsError }] = await Promise.all([
    supabase.from("users").select("id, role").eq("id", workerId).in("role", ["manager", "housekeeping_admin", "hk_admin", "cleaner"]).maybeSingle(),
    supabase.from("user_hotel_assignments").select("user_id").eq("user_id", workerId).in("hotel_id", propertyIds),
  ]);
  if (workerError || assignmentsError) throw new Error(`Unable to verify workforce member: ${workerError?.message ?? assignmentsError?.message}`);
  const { data: managedProperty, error: managedPropertyError } = await supabase.from("hotels").select("id")
    .eq("owner_id", ownerId).eq("manager_id", workerId).limit(1).maybeSingle();
  if (managedPropertyError) throw new Error(`Unable to verify workforce assignment: ${managedPropertyError.message}`);
  if (!worker || (!assignments?.length && !managedProperty)) throw new Error("The workforce member is not assigned to this tenant.");
  const { data, error } = await supabase.from("users").update({
    is_active: isActive,
    deactivated_at: isActive ? null : new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", workerId).select("id").maybeSingle();
  if (error) throw new Error(`Unable to update workforce status: ${error.message}`);
  if (!data) throw new Error("The workforce member could not be updated.");
  revalidateTenantPropertyViews();
}

export async function reassignTenantWorker(ownerId: string, workerId: string, propertyId: string) {
  if (!ownerId || !workerId || !propertyId) throw new Error("Choose a worker and property.");
  const { session, supabase } = await requireSuperAdmin();
  const { error } = await supabase.rpc("reassign_tenant_worker", {
    p_owner_id: ownerId,
    p_worker_id: workerId,
    p_property_id: propertyId,
    p_assigned_by: session.userId,
  });
  if (error) throw new Error(`Unable to reassign workforce member: ${error.message}`);
  revalidateTenantPropertyViews();
}

function revalidateTenantPropertyViews() {
  for (const path of ["/admin", "/admin/tenant-accounts", "/settings", "/dashboard", "/manager", "/owner", "/hk-admin"]) {
    revalidatePath(path);
  }
}

export async function updateTenantPropertyAssignments(
  ownerId: string,
  propertyId: string,
  managerId: string | null,
  housekeepingAdminId: string | null,
  cleanerIds: string[],
) {
  if (!ownerId || !propertyId) throw new Error("Tenant and property are required.");
  if (managerId !== null && typeof managerId !== "string") throw new Error("Choose a valid property manager.");
  if (housekeepingAdminId !== null && typeof housekeepingAdminId !== "string") throw new Error("Choose a valid Housekeeping Admin.");
  if (!Array.isArray(cleanerIds) || cleanerIds.length > 500 || cleanerIds.some((id) => typeof id !== "string" || !id)) {
    throw new Error("Choose a valid set of cleaners.");
  }
  const uniqueCleanerIds = [...new Set(cleanerIds)];
  if (managerId && (uniqueCleanerIds.includes(managerId) || managerId === housekeepingAdminId)) {
    throw new Error("A Property Manager cannot also be assigned to another workforce role.");
  }
  if (housekeepingAdminId && uniqueCleanerIds.includes(housekeepingAdminId)) {
    throw new Error("A Housekeeping Admin cannot also be assigned as a cleaner.");
  }
  if (new Set([managerId, housekeepingAdminId].filter((id): id is string => Boolean(id))).size !== [managerId, housekeepingAdminId].filter(Boolean).length) {
    throw new Error("Choose different people for each workforce role.");
  }

  const { session, supabase } = await requireSuperAdmin();
  const { error } = await supabase.rpc("update_tenant_property_assignments", {
    p_owner_id: ownerId,
    p_property_id: propertyId,
    p_manager_id: managerId,
    p_housekeeping_admin_id: housekeepingAdminId,
    p_cleaner_ids: uniqueCleanerIds,
    p_assigned_by: session.userId,
  });
  if (error) throw new Error(`Unable to update property assignments: ${error.message}`);
  revalidatePath("/admin/tenant-accounts");
  revalidatePath("/admin");
  revalidatePath("/manager");
  revalidatePath("/owner");
}
