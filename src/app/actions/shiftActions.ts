"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";
import { isHousekeepingAdmin, normalizeUserRole } from "@/lib/roles";

type WorkforceRole = "cleaner" | "manager" | "housekeeping_admin";
type Location = { latitude: number; longitude: number; accuracy: number };

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
  if (profile.role === "manager" || isHousekeepingAdmin(profile.role)) {
    const { data: assignedProperties, error: assignmentError } = await supabase
      .from("hotels")
      .select("id")
      .eq("id", propertyId)
      .eq("is_active", true)
      .is("archived_at", null)
      .limit(1);
    if (assignmentError) throw new Error(`Unable to verify the selected property: ${assignmentError.message}`);
    const property = assignedProperties?.[0];
    if (!property) throw new Error("Choose an active property assigned to your workforce account.");
    if (profile.role === "manager") {
      const { data: managerProperty, error } = await supabase
        .from("hotels")
        .select("id")
        .eq("id", propertyId)
        .eq("manager_id", session.userId)
        .maybeSingle();
      if (error) throw new Error(`Unable to verify your Manager assignment: ${error.message}`);
      if (!managerProperty) throw new Error("Choose a property assigned to your Manager account.");
    } else {
      const [{ data: primary }, { data: assignment, error: assignmentError }] = await Promise.all([
        supabase.from("users").select("primary_hotel_id").eq("id", session.userId).maybeSingle(),
        supabase.from("user_hotel_assignments").select("hotel_id").eq("user_id", session.userId).eq("hotel_id", propertyId).maybeSingle(),
      ]);
      if (assignmentError) throw new Error(`Unable to verify your Housekeeping Admin assignment: ${assignmentError.message}`);
      if (primary?.primary_hotel_id !== propertyId && !assignment) {
        throw new Error("Choose a property assigned to your Housekeeping Admin account.");
      }
    }
  } else {
    const [{ data: primary, error: profileError }, { data: assignment, error: assignmentError }] = await Promise.all([
      supabase.from("users").select("primary_hotel_id").eq("id", session.userId).maybeSingle(),
      supabase.from("user_hotel_assignments").select("hotel_id").eq("user_id", session.userId).eq("hotel_id", propertyId).maybeSingle(),
    ]);
    if (profileError || assignmentError) throw new Error(`Unable to verify your property assignment: ${profileError?.message ?? assignmentError?.message}`);
    if (primary?.primary_hotel_id !== propertyId && !assignment) {
      throw new Error("Choose a property assigned to your Cleaner account.");
    }
  }

  const { data: shiftId, error } = await supabase.rpc("start_geofenced_workforce_shift", {
    p_user_id: session.userId,
    p_property_id: propertyId,
    p_lat: location.latitude,
    p_lng: location.longitude,
    p_accuracy: location.accuracy,
  });
  if (error) throw new Error(error.message);
  if (typeof shiftId !== "string") throw new Error("The shift was not started. Please try again.");

  revalidateWorkforcePaths(profile.role);
  return { id: shiftId, hotel_id: propertyId, start_time: new Date().toISOString() };
}

export async function clockOutWorkforceShift() {
  const { session, profile, supabase } = await getActiveWorkforceUser();
  const { data: activeTask, error: taskError } = await supabase
    .from("work_logs")
    .select("id")
    .eq("user_id", session.userId)
    .eq("status", "active")
    .is("end_time", null)
    .is("deleted_at", null)
    .is("cancelled_at", null)
    .limit(1)
    .maybeSingle();
  if (taskError) throw new Error(`Unable to verify your active tasks: ${taskError.message}`);
  if (activeTask) throw new Error("End your active task before clocking out.");

  const { data: shift, error: shiftError } = await supabase
    .from("master_shifts")
    .select("id")
    .eq("user_id", session.userId)
    .eq("status", "active")
    .is("end_time", null)
    .order("start_time", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (shiftError) throw new Error(`Unable to find your active shift: ${shiftError.message}`);
  if (!shift) throw new Error("There is no active shift to clock out from.");

  const endedAt = new Date().toISOString();
  const { error } = await supabase
    .from("master_shifts")
    .update({ end_time: endedAt, status: "completed", updated_at: endedAt })
    .eq("id", shift.id)
    .eq("user_id", session.userId)
    .eq("status", "active")
    .is("end_time", null);
  if (error) throw new Error(`Unable to clock out: ${error.message}`);
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
