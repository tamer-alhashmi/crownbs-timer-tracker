"use server";

import { revalidatePath } from "next/cache";
import { requireFeatureAccess } from "@/lib/featureAccess";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";

export type PropertyRecord = {
  id: string;
  name: string;
  location: string | null;
  owner_id: string | null;
  manager_id: string | null;
  created_at: string;
  is_active: boolean;
};

type PropertyInput = {
  name: string;
  location: string;
  owner_id: string;
  manager_id: string;
};

const PROPERTY_COLUMNS = "id, name, location, owner_id, manager_id, created_at, is_active";

async function requireAdmin(action: "create" | "edit") {
  const user = await requireFeatureAccess("settings", action);
  if (user.role !== "admin") throw new Error("Only administrators can manage properties.");
  return createPrivilegedServerSupabaseClient();
}

async function validateProperty(supabase: Awaited<ReturnType<typeof requireAdmin>>, input: PropertyInput) {
  const name = input.name.trim();
  const location = input.location.trim();
  const ownerId = input.owner_id || null;
  const managerId = input.manager_id || null;
  if (!name || name.length > 120) throw new Error("Property name is required and must be 120 characters or fewer.");
  if (!location || location.length > 240) throw new Error("Property location is required and must be 240 characters or fewer.");

  const assigneeIds = [ownerId, managerId].filter((id): id is string => Boolean(id));
  if (assigneeIds.length) {
    const { data: assignees, error } = await supabase.from("users").select("id, role").in("id", assigneeIds);
    if (error) throw new Error(error.message);
    if (ownerId && !assignees?.some((assignee) => assignee.id === ownerId && assignee.role === "owner")) {
      throw new Error("Choose a valid owner account.");
    }
    if (managerId && !assignees?.some((assignee) => assignee.id === managerId && assignee.role === "manager")) {
      throw new Error("Choose a valid manager account.");
    }
  }

  return { name, location, owner_id: ownerId, manager_id: managerId };
}

function revalidatePropertyViews() {
  for (const path of ["/admin", "/dashboard", "/settings", "/manager", "/owner"]) revalidatePath(path);
}

export async function createProperty(input: PropertyInput): Promise<PropertyRecord> {
  const supabase = await requireAdmin("create");
  const values = await validateProperty(supabase, input);
  const { data, error } = await supabase.from("hotels").insert(values).select(PROPERTY_COLUMNS).single();
  if (error || !data) throw new Error(error?.message ?? "Unable to create property.");
  revalidatePropertyViews();
  return data as PropertyRecord;
}

export async function updateProperty(id: string, updates: PropertyInput & { is_active?: boolean }): Promise<PropertyRecord> {
  const supabase = await requireAdmin("edit");
  if (!id) throw new Error("Property id is required.");
  if (updates.is_active !== undefined && typeof updates.is_active !== "boolean") {
    throw new Error("Property active status must be true or false.");
  }
  const values = await validateProperty(supabase, updates);
  const { data, error } = await supabase.from("hotels").update({
    ...values,
    ...(updates.is_active === undefined ? {} : { is_active: updates.is_active }),
  }).eq("id", id).select(PROPERTY_COLUMNS).maybeSingle();
  if (error || !data) throw new Error(error?.message ?? "Property was not found.");
  revalidatePropertyViews();
  return data as PropertyRecord;
}
