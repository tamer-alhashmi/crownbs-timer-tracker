import "server-only";
import { getSessionUser } from "@/lib/auth";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";

export const RATE_PER_COMPLETED_TASK = 0.08;

export type OwnerBillingUsage = {
  monthLabel: string;
  completedTasks: number;
  activeShifts: number;
  amountDue: number;
  currency: "USD";
};

export async function getOwnerBillingUsage(ownerId: string): Promise<OwnerBillingUsage> {
  const session = await getSessionUser();
  if (!session || (session.role !== "admin" && (session.role !== "owner" || session.userId !== ownerId))) {
    throw new Error("You are not authorized to view this owner billing usage.");
  }

  const supabase = createPrivilegedServerSupabaseClient();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
  const { data: hotels, error: hotelsError } = await supabase
    .from("hotels")
    .select("id")
    .eq("owner_id", ownerId);
  if (hotelsError) {
    console.error("[Owner Billing]: Failed to load owner properties.", hotelsError);
    throw new Error("Unable to load current month usage.");
  }

  const hotelIds = (hotels ?? []).map((hotel) => hotel.id);
  const [completedTasks, activeShifts] = hotelIds.length
    ? await Promise.all([
        supabase.from("work_logs")
          .select("id", { count: "exact", head: true })
          .in("hotel_id", hotelIds)
          .eq("status", "completed")
          .gte("end_time", monthStart)
          .lt("end_time", nextMonth)
          .is("deleted_at", null)
          .is("cancelled_at", null),
        supabase.from("master_shifts")
          .select("id", { count: "exact", head: true })
          .in("user_id", await getOwnerWorkerIds(supabase, hotelIds))
          .eq("status", "active")
          .is("end_time", null)
          .gte("start_time", monthStart)
          .lt("start_time", nextMonth),
      ])
    : [
        { count: 0, error: null },
        { count: 0, error: null },
      ];

  if (completedTasks.error || activeShifts.error) {
    console.error("[Owner Billing]: Failed to aggregate monthly usage.", completedTasks.error ?? activeShifts.error);
    throw new Error("Unable to load current month usage.");
  }

  const taskCount = completedTasks.count ?? 0;
  return {
    monthLabel: new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(now),
    completedTasks: taskCount,
    activeShifts: activeShifts.count ?? 0,
    amountDue: Number((taskCount * RATE_PER_COMPLETED_TASK).toFixed(2)),
    currency: "USD",
  };
}

async function getOwnerWorkerIds(
  supabase: ReturnType<typeof createPrivilegedServerSupabaseClient>,
  hotelIds: string[]
) {
  if (!hotelIds.length) return [];
  const [{ data: assigned, error: assignmentsError }, { data: primaryAssignments, error: primaryError }, { data: managers, error: managersError }] = await Promise.all([
    supabase.from("user_hotel_assignments").select("user_id").in("hotel_id", hotelIds),
    supabase.from("users").select("id").in("primary_hotel_id", hotelIds).in("role", ["manager", "hk_admin", "cleaner"]),
    supabase.from("hotels").select("manager_id").in("id", hotelIds).not("manager_id", "is", null),
  ]);
  if (assignmentsError || primaryError || managersError) {
    console.error("[Owner Billing]: Failed to load assigned workforce.", assignmentsError ?? primaryError ?? managersError);
    throw new Error("Unable to load current month usage.");
  }
  return [...new Set([
    ...(assigned ?? []).map((row) => row.user_id),
    ...(primaryAssignments ?? []).map((row) => row.id),
    ...(managers ?? []).map((row) => row.manager_id).filter((id): id is string => Boolean(id)),
  ])];
}
