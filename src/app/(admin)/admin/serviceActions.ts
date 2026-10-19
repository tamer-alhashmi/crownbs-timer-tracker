"use server";

import { revalidatePath } from "next/cache";
import { requireFeatureAccess } from "@/lib/featureAccess";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";
import type { BillingUnit } from "@/lib/servicePricing";
import type { UserRole } from "@/lib/roles";

export type ServiceRecord = {
  id: string;
  name: string;
  description: string;
  unit: BillingUnit;
  default_rate: number;
  is_active: boolean;
  owner_id: string | null;
  created_at: string;
};

type ServiceInput = {
  name: string;
  default_rate: number;
  unit?: BillingUnit;
  description?: string;
};

type ServiceUpdates = Partial<ServiceInput> & { is_active?: boolean };

const SERVICE_COLUMNS = "id, name, description, unit, default_rate, is_active, owner_id, created_at";
const BILLING_UNITS: BillingUnit[] = ["hourly", "per_room", "fixed"];

async function requireAdmin(action: "view" | "create" | "edit" | "delete") {
  const user = await requireFeatureAccess("settings", action);
  if (!["admin", "owner"].includes(user.role)) throw new Error("Only owners and administrators can manage service pricing.");
  const supabase = createPrivilegedServerSupabaseClient();
  const { data: profile, error } = await supabase.from("users").select("role").eq("id", user.userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!profile || profile.role !== user.role) throw new Error("Your account role could not be verified.");
  return { supabase, user: { ...user, role: profile.role as UserRole } };
}

function validateService(input: ServiceInput) {
  const name = input.name.trim();
  const defaultRate = Number(input.default_rate);
  const unit = input.unit ?? "hourly";
  if (!name || name.length > 120) throw new Error("Service name is required and must be 120 characters or fewer.");
  if (!Number.isFinite(defaultRate) || defaultRate <= 0) throw new Error("Rate must be greater than zero.");
  if (!BILLING_UNITS.includes(unit)) throw new Error("Choose a valid billing unit.");
  return { name, default_rate: Math.round(defaultRate * 100) / 100, unit, description: input.description?.trim() ?? "" };
}

function revalidateServiceViews() {
  for (const path of ["/admin", "/dashboard", "/settings", "/manager", "/owner"]) revalidatePath(path);
}

export async function getServices(): Promise<ServiceRecord[]> {
  const { supabase, user } = await requireAdmin("view");
  let query = supabase.from("services_config").select(SERVICE_COLUMNS);
  if (user.role !== "admin") query = query.eq("owner_id", user.userId);
  const { data, error } = await query.order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as ServiceRecord[];
}

export async function createService(input: ServiceInput): Promise<ServiceRecord> {
  const { supabase, user } = await requireAdmin("create");
  const values = validateService(input);
  const { data, error } = await supabase.from("services_config").insert({ ...values, owner_id: user.role === "admin" ? null : user.userId }).select(SERVICE_COLUMNS).single();
  if (error || !data) throw new Error(error?.message ?? "Unable to create service.");
  revalidateServiceViews();
  return data as ServiceRecord;
}

export async function updateService(id: string, updates: ServiceUpdates): Promise<ServiceRecord> {
  const { supabase, user } = await requireAdmin("edit");
  if (!id) throw new Error("Service id is required.");
  if (updates.is_active !== undefined && typeof updates.is_active !== "boolean") throw new Error("Active status must be true or false.");
  const values: Record<string, string | number | boolean> = {};
  if (updates.name !== undefined) {
    const name = updates.name.trim();
    if (!name || name.length > 120) throw new Error("Service name is required and must be 120 characters or fewer.");
    values.name = name;
  }
  if (updates.default_rate !== undefined) {
    const defaultRate = Number(updates.default_rate);
    if (!Number.isFinite(defaultRate) || defaultRate <= 0) throw new Error("Rate must be greater than zero.");
    values.default_rate = Math.round(defaultRate * 100) / 100;
  }
  if (updates.unit !== undefined) {
    if (!BILLING_UNITS.includes(updates.unit)) throw new Error("Choose a valid billing unit.");
    values.unit = updates.unit;
  }
  if (updates.description !== undefined) values.description = updates.description.trim();
  if (updates.is_active !== undefined) values.is_active = updates.is_active;
  if (!Object.keys(values).length) throw new Error("No service changes were provided.");
  let query = supabase.from("services_config").update({ ...values, updated_at: new Date().toISOString() }).eq("id", id);
  if (user.role !== "admin") query = query.eq("owner_id", user.userId);
  const { data, error } = await query.select(SERVICE_COLUMNS).maybeSingle();
  if (error || !data) throw new Error(error?.message ?? "Service was not found.");
  revalidateServiceViews();
  return data as ServiceRecord;
}

export async function deleteService(id: string): Promise<ServiceRecord> {
  const { supabase, user } = await requireAdmin("delete");
  if (!id) throw new Error("Service id is required.");
  let query = supabase.from("services_config").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", id);
  if (user.role !== "admin") query = query.eq("owner_id", user.userId);
  const { data, error } = await query.select(SERVICE_COLUMNS).maybeSingle();
  if (error || !data) throw new Error(error?.message ?? "Service was not found.");
  revalidateServiceViews();
  return data as ServiceRecord;
}