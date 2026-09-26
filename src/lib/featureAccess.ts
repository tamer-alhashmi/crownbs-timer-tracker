import { getSessionUser, type AppUserSession } from "@/lib/auth";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";
import type { FeatureKey } from "@/app/settings/permissionConfig";

export type FeatureAction = "view" | "create" | "edit" | "delete";

export async function requireFeatureAccess(feature: FeatureKey, action: FeatureAction = "view"): Promise<AppUserSession> {
  const user = await getSessionUser();
  if (!user) throw new Error("Authentication required.");
  if (user.role === "admin") return user;

  const supabase = createPrivilegedServerSupabaseClient();
  const { data: permission, error } = await supabase
    .from("user_feature_permissions")
    .select("can_view, can_create, can_edit, can_delete")
    .eq("user_id", user.userId)
    .eq("feature_key", feature)
    .maybeSingle();

  if (error && error.code !== "PGRST205") throw new Error(error.message);
  const permissionKey = `can_${action}` as "can_view" | "can_create" | "can_edit" | "can_delete";
  if (permission && permission[permissionKey] !== true) {
    throw new Error(`You do not have ${action} access to ${feature.replaceAll("_", " ")}.`);
  }

  return user;
}
