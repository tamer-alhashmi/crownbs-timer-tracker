"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { RATE_PER_COMPLETED_TASK, getCurrentBillingCycle, getOwnerBillingUsage } from "@/lib/ownerBilling";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";

const PAGE_SIZE = 10;

export type TenantAccount = {
  id: string;
  name: string;
  email: string;
  joinedAt: string;
  completedTasks: number;
  activeShifts: number;
  amountDue: number;
  settledAmount: number;
  settledAt: string | null;
  properties: {
    id: string;
    name: string;
    totalRooms: number;
    isActive: boolean;
    completedTasks: number;
  }[];
};

export type TenantAccountsPage = {
  tenants: TenantAccount[];
  total: number;
  page: number;
  pageSize: number;
  monthLabel: string;
};

async function requireSuperAdmin() {
  const session = await getSessionUser();
  if (!session || session.role !== "super_admin") {
    throw new Error("Only a super administrator can manage tenant accounts and settlements.");
  }
  const supabase = createPrivilegedServerSupabaseClient();
  const { data: profile, error } = await supabase.from("users").select("role").eq("id", session.userId).maybeSingle();
  if (error) throw new Error(`Unable to verify administrator access: ${error.message}`);
  if (!profile || profile.role !== "super_admin") throw new Error("Your super administrator access is no longer active.");
  return { session, supabase };
}

function normalizeSearch(value: string) {
  return value
    .trim()
    .slice(0, 80)
    .replace(/[%_,()\\]/g, " ")
    .replace(/\s+/g, " ");
}

async function getMatchingOwnerIds(
  supabase: Awaited<ReturnType<typeof createPrivilegedServerSupabaseClient>>,
  search: string
) {
  const [nameMatches, emailMatches, hotelMatches] = await Promise.all([
    supabase.from("users").select("id").eq("role", "owner").ilike("full_name", `%${search}%`),
    supabase.from("users").select("id").eq("role", "owner").ilike("email", `%${search}%`),
    supabase.from("hotels").select("owner_id").not("owner_id", "is", null).ilike("name", `%${search}%`),
  ]);
  const queryError = nameMatches.error ?? emailMatches.error ?? hotelMatches.error;
  if (queryError) throw new Error(`Unable to search tenant accounts: ${queryError.message}`);
  return [...new Set([
    ...(nameMatches.data ?? []).map((row) => row.id),
    ...(emailMatches.data ?? []).map((row) => row.id),
    ...(hotelMatches.data ?? []).map((row) => row.owner_id).filter((id): id is string => Boolean(id)),
  ])];
}

export async function getTenantAccountsPage(page = 1, searchText = ""): Promise<TenantAccountsPage> {
  const { supabase } = await requireSuperAdmin();
  const safePage = Number.isInteger(page) ? Math.max(1, page) : 1;
  const search = normalizeSearch(searchText);
  const matchingOwnerIds = search ? await getMatchingOwnerIds(supabase, search) : null;
  const start = (safePage - 1) * PAGE_SIZE;
  let ownerQuery = supabase
    .from("users")
    .select("id, full_name, email, created_at", { count: "exact" })
    .eq("role", "owner")
    .order("full_name")
    .order("id");
  if (matchingOwnerIds) {
    if (!matchingOwnerIds.length) {
      return { tenants: [], total: 0, page: 1, pageSize: PAGE_SIZE, monthLabel: getCurrentBillingCycle().monthLabel };
    }
    ownerQuery = ownerQuery.in("id", matchingOwnerIds);
  }
  const { data: owners, count, error: ownersError } = await ownerQuery.range(start, start + PAGE_SIZE - 1);
  if (ownersError) throw new Error(`Unable to load tenant accounts: ${ownersError.message}`);

  const ownerRows = owners ?? [];
  const ownerIds = ownerRows.map((owner) => owner.id);
  const { cycleStart, cycleEnd, monthLabel } = getCurrentBillingCycle();
  const [hotelResult, settlementsResult] = await Promise.all([
    ownerIds.length
      ? supabase.from("hotels").select("id, owner_id, name, total_rooms, room_count, is_active").in("owner_id", ownerIds).order("name")
      : Promise.resolve({ data: [], error: null }),
    ownerIds.length
      ? supabase.from("tenant_settlements").select("owner_id, settled_amount, settled_at").in("owner_id", ownerIds).eq("cycle_start", cycleStart).eq("cycle_end", cycleEnd)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (hotelResult.error || settlementsResult.error) {
    throw new Error(`Unable to load tenant billing details: ${hotelResult.error?.message ?? settlementsResult.error?.message}`);
  }
  const hotels = hotelResult.data ?? [];
  const [usageRows, taskCounts] = await Promise.all([
    Promise.all(ownerRows.map((owner) => getOwnerBillingUsage(owner.id))),
    Promise.all(hotels.map(async (hotel) => {
      const { count: taskCount, error } = await supabase
        .from("work_logs")
        .select("id", { count: "exact", head: true })
        .eq("hotel_id", hotel.id)
        .eq("status", "completed")
        .gte("end_time", cycleStart)
        .lt("end_time", cycleEnd)
        .is("deleted_at", null)
        .is("cancelled_at", null);
      if (error) throw new Error(`Unable to load usage for ${hotel.name}: ${error.message}`);
      return [hotel.id, taskCount ?? 0] as const;
    })),
  ]);
  const usageByOwnerId = new Map(ownerRows.map((owner, index) => [owner.id, usageRows[index]]));
  const settledByOwnerId = new Map((settlementsResult.data ?? []).map((settlement) => [
    settlement.owner_id,
    { amount: Number(settlement.settled_amount), at: settlement.settled_at },
  ]));
  const tasksByHotelId = new Map(taskCounts);
  const hotelsByOwnerId = new Map<string, typeof hotels>();
  for (const hotel of hotels) {
    if (!hotel.owner_id) continue;
    const ownedHotels = hotelsByOwnerId.get(hotel.owner_id) ?? [];
    ownedHotels.push(hotel);
    hotelsByOwnerId.set(hotel.owner_id, ownedHotels);
  }

  return {
    tenants: ownerRows.map((owner) => {
      const usage = usageByOwnerId.get(owner.id);
      if (!usage) throw new Error(`Billing usage was unavailable for ${owner.email}.`);
      const settlement = settledByOwnerId.get(owner.id);
      return {
        id: owner.id,
        name: owner.full_name || owner.email,
        email: owner.email,
        joinedAt: owner.created_at,
        completedTasks: usage.completedTasks,
        activeShifts: usage.activeShifts,
        amountDue: usage.amountDue,
        settledAmount: settlement?.amount ?? 0,
        settledAt: settlement?.at ?? null,
        properties: (hotelsByOwnerId.get(owner.id) ?? []).map((hotel) => ({
          id: hotel.id,
          name: hotel.name,
          totalRooms: hotel.total_rooms ?? hotel.room_count ?? 0,
          isActive: hotel.is_active,
          completedTasks: tasksByHotelId.get(hotel.id) ?? 0,
        })),
      };
    }),
    total: count ?? 0,
    page: safePage,
    pageSize: PAGE_SIZE,
    monthLabel,
  };
}

export async function settleTenantCycle(ownerId: string) {
  if (!ownerId) throw new Error("Tenant owner is required.");
  const { session, supabase } = await requireSuperAdmin();
  const [{ data: owner, error: ownerError }, usage] = await Promise.all([
    supabase.from("users").select("id").eq("id", ownerId).eq("role", "owner").maybeSingle(),
    getOwnerBillingUsage(ownerId),
  ]);
  if (ownerError) throw new Error(`Unable to verify tenant account: ${ownerError.message}`);
  if (!owner) throw new Error("The requested tenant owner was not found.");
  const { cycleStart, cycleEnd } = getCurrentBillingCycle();
  const { error } = await supabase.from("tenant_settlements").upsert({
    owner_id: ownerId,
    cycle_start: cycleStart,
    cycle_end: cycleEnd,
    settled_task_count: usage.completedTasks,
    settled_amount: Number((usage.completedTasks * RATE_PER_COMPLETED_TASK).toFixed(2)),
    settled_at: new Date().toISOString(),
    settled_by: session.userId,
  }, { onConflict: "owner_id,cycle_start" });
  if (error) throw new Error(`Unable to record settlement: ${error.message}`);
  revalidatePath("/admin/tenant-accounts");
  revalidatePath("/settings");
}

export async function toggleTenantPropertyStatus(propertyId: string) {
  if (!propertyId) throw new Error("Property id is required.");
  const { supabase } = await requireSuperAdmin();
  const { data: property, error: readError } = await supabase
    .from("hotels")
    .select("id, is_active")
    .eq("id", propertyId)
    .maybeSingle();
  if (readError) throw new Error(`Unable to load property status: ${readError.message}`);
  if (!property) throw new Error("The requested property was not found.");
  const { error } = await supabase.from("hotels").update({ is_active: !property.is_active }).eq("id", propertyId);
  if (error) throw new Error(`Unable to update property status: ${error.message}`);
  revalidatePath("/admin/tenant-accounts");
  revalidatePath("/admin");
  revalidatePath("/settings");
  revalidatePath("/manager");
  revalidatePath("/owner");
}
