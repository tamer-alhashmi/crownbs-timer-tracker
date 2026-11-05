"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";
import { isHousekeepingAdmin, normalizeUserRole } from "@/lib/roles";
import { dispatchPushNotification } from "@/lib/notifications/notificationDispatcher";

type WorkforceRole = "cleaner" | "manager" | "housekeeping_admin";
type Location = { latitude: number; longitude: number; accuracy: number };

async function dispatchStoredShiftNotifications(supabase: ReturnType<typeof createPrivilegedServerSupabaseClient>, eventId: string) {
  const { data: notifications, error } = await supabase.from("workforce_shift_notifications")
    .select("recipient_id, severity, title, body")
    .eq("shift_event_id", eventId);
  if (error) {
    console.error("Shift event was recorded, but notification recipients could not be loaded:", error.message);
    return;
  }
  await Promise.all((notifications ?? []).map(async (notification) => {
    try {
      await dispatchPushNotification({
        userId: notification.recipient_id,
        title: notification.title,
        body: notification.body,
        url: "/",
        tag: `shift-${eventId}-${notification.recipient_id}`,
        urgency: notification.severity === "high" ? "high" : "normal",
      });
    } catch (error) {
      console.error("Shift event was recorded, but push delivery failed:", error);
    }
  }));
}

function isWorkforceRole(role: string): role is WorkforceRole | "hk_admin" {
  return role === "cleaner" || role === "manager" || role === "housekeeping_admin" || role === "hk_admin";
}

async function getActiveWorkforceUser() {
  const session = await getSessionUser();
  if (!session) throw new Error("Sign in to manage your shift.");
  const supabase = createPrivilegedServerSupabaseClient();
  const { data: profile, error } = await supabase
    .from("users")
    .select("id, role, is_active")
    .eq("id", session.userId)
    .maybeSingle();
  if (error) throw new Error(`Unable to verify your workforce account: ${error.message}`);
  if (!profile || profile.is_active !== true || !isWorkforceRole(profile.role) || normalizeUserRole(profile.role) !== normalizeUserRole(session.role)) {
    throw new Error("Only active Cleaners, Managers, and Housekeeping Admins can manage on-site shifts.");
  }
  return { session, profile, supabase };
}

export async function getCurrentWorkforceShift() {
  const { session, supabase } = await getActiveWorkforceUser();
  const { data: shift, error } = await supabase
    .from("master_shifts")
    .select("id, hotel_id, role_at_shift, start_time")
    .eq("user_id", session.userId)
    .eq("status", "active")
    .is("end_time", null)
    .order("start_time", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Unable to load your active shift: ${error.message}`);
  return shift;
}

export async function clockInToAssignedProperty(propertyId: string, location: Location) {
  if (typeof propertyId !== "string" || !propertyId) throw new Error("Select an assigned property before clocking in.");
  if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude) || !Number.isFinite(location.accuracy)) {
    throw new Error("Your device did not return a valid location. Enable location services and try again.");
  }
  const { session, profile, supabase } = await getActiveWorkforceUser();
  const { data, error } = await supabase.rpc("record_workforce_clock_in", {
    p_user_id: session.userId,
    p_property_id: propertyId,
    p_lat: location.latitude,
    p_lng: location.longitude,
    p_accuracy: location.accuracy,
  });
  if (error) throw new Error(error.message);
  const eventId = data && typeof data === "object" && "eventId" in data && typeof data.eventId === "string"
    ? data.eventId
    : null;
  if (eventId) await dispatchStoredShiftNotifications(supabase, eventId);
  if (!data || typeof data !== "object" || !("success" in data) || data.success !== true || !("shiftId" in data) || typeof data.shiftId !== "string") {
    const message = data && typeof data === "object" && "error" in data && typeof data.error === "string"
      ? data.error
      : "The shift was not started. Please try again.";
    throw new Error(message);
  }

  revalidateWorkforcePaths(profile.role);
  return { id: data.shiftId, hotel_id: propertyId, start_time: new Date().toISOString() };
}

export async function clockOutWorkforceShift() {
  const { session, profile, supabase } = await getActiveWorkforceUser();
  const { data, error } = await supabase.rpc("record_workforce_clock_out", { p_user_id: session.userId });
  if (error) throw new Error(`Unable to clock out: ${error.message}`);
  const eventId = data && typeof data === "object" && "eventId" in data && typeof data.eventId === "string"
    ? data.eventId
    : null;
  if (eventId) await dispatchStoredShiftNotifications(supabase, eventId);
  if (!data || typeof data !== "object" || !("success" in data) || data.success !== true) {
    const message = data && typeof data === "object" && "error" in data && typeof data.error === "string"
      ? data.error
      : "Unable to clock out.";
    throw new Error(message);
  }
  revalidateWorkforcePaths(profile.role);
}

function revalidateWorkforcePaths(role: string) {
  const paths = role === "cleaner"
    ? ["/dashboard"]
    : isHousekeepingAdmin(role)
      ? ["/hk-admin"]
      : ["/manager"];
  for (const path of paths) revalidatePath(path);
}
