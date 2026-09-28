"use server";

import { revalidatePath } from "next/cache";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";
import { FEATURE_KEYS, type FeatureKey, type FeaturePermission } from "./permissionConfig";
import { requireFeatureAccess } from "@/lib/featureAccess";

export type ManagedUser = {
  id: string;
  full_name: string;
  email: string;
  role: "admin" | "owner" | "manager" | "cleaner";
  pin_code: string | null;
  primary_hotel_id: string | null;
  hotelName: string;
  assignedHotels: { id: string; name: string }[];
};

type UserInput = {
  fullName: string;
  email: string;
  role: ManagedUser["role"];
  pinCode: string;
  hotelId: string;
  password?: string;
};

async function requireSettingsAccess() {
  const actor = await requireFeatureAccess("settings");
  if (!actor || actor.role !== "admin") throw new Error("Administrator access required.");
  const supabase = createPrivilegedServerSupabaseClient();
  const { data: hotels, error } = await supabase.from("hotels").select("id, name, owner_id, manager_id").order("name");
  if (error) throw new Error(error.message);
  const visibleHotels = actor.role === "admin" ? hotels ?? [] : (hotels ?? []).filter((hotel) => actor.role === "owner" ? hotel.owner_id === actor.userId : hotel.manager_id === actor.userId);
  return { actor, supabase, visibleHotels };
}

function roleAllowed(actorRole: string, targetRole: ManagedUser["role"]) {
  if (actorRole === "admin") return true;
  if (actorRole === "owner") return targetRole === "manager" || targetRole === "cleaner";
  return targetRole === "cleaner";
}

function validateInput(input: UserInput) {
  const fullName = input.fullName.trim();
  const email = input.email.trim().toLowerCase();
  const pinCode = input.pinCode.trim();
  if (!fullName || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid name and email.");
  if (pinCode && !/^\d{4}$/.test(pinCode)) throw new Error("PIN must be exactly 4 digits.");
  return { ...input, fullName, email, pinCode };
}

async function assertTargetScope(targetId: string, targetRole: ManagedUser["role"], hotelId: string | null, actor: Awaited<ReturnType<typeof requireSettingsAccess>>) {
  if (targetId === actor.actor.userId) throw new Error("You cannot manage your own account here.");
  if (!roleAllowed(actor.actor.role, targetRole)) throw new Error("Your role cannot manage this user type.");
  if (actor.actor.role !== "admin" && (!hotelId || !actor.visibleHotels.some((hotel) => hotel.id === hotelId))) throw new Error("That hotel is outside your management scope.");
}

export async function getSettingsData() {
  const context = await requireSettingsAccess();
  const { data: users, error } = await context.supabase.from("users").select("id, full_name, email, role, pin_code, primary_hotel_id").order("full_name");
  if (error) throw new Error(error.message);
  const { data: permissions, error: permissionsError } = await context.supabase.from("user_feature_permissions").select("user_id, feature_key, can_view, can_create, can_edit, can_delete");
  if (permissionsError && permissionsError.code !== "PGRST205") throw new Error(permissionsError.message);
  const hotelsById = new Map(context.visibleHotels.map((hotel) => [hotel.id, hotel.name]));
  const visibleUsers = (users ?? []).filter((user) => context.actor.role === "admin" || (roleAllowed(context.actor.role, user.role) && (user.primary_hotel_id !== null && hotelsById.has(user.primary_hotel_id) || context.visibleHotels.some((hotel) => user.role === "owner" ? hotel.owner_id === user.id : user.role === "manager" ? hotel.manager_id === user.id : false))));
  return {
    actorRole: context.actor.role,
    actorName: (users ?? []).find((user) => user.id === context.actor.userId)?.full_name ?? context.actor.email,
    actorEmail: context.actor.email,
    hotels: context.visibleHotels.map((hotel) => ({ id: hotel.id, name: hotel.name })),
    users: visibleUsers.map((user) => {
      const assignedHotels = context.visibleHotels.filter((hotel) => user.role === "owner" ? hotel.owner_id === user.id : user.role === "manager" ? hotel.manager_id === user.id : user.role === "cleaner" && hotel.id === user.primary_hotel_id).map((hotel) => ({ id: hotel.id, name: hotel.name }));
      return { ...user, role: user.role as ManagedUser["role"], hotelName: assignedHotels[0]?.name ?? "Unassigned", assignedHotels };
    }),
    permissions: (permissions ?? []).filter((permission) => visibleUsers.some((user) => user.id === permission.user_id)).map((permission) => ({ ...permission, feature_key: permission.feature_key as FeatureKey })),
  };
}

export async function updateUserFeaturePermissions(userId: string, permissions: Array<Omit<FeaturePermission, "user_id">>) {
  const context = await requireSettingsAccess();
  if (context.actor.role !== "admin") throw new Error("Only administrators can change feature permissions.");
  if (!permissions.every((permission) => FEATURE_KEYS.includes(permission.feature_key))) throw new Error("An invalid feature permission was submitted.");
  const { data: target, error: targetError } = await context.supabase.from("users").select("id, role").eq("id", userId).maybeSingle();
  if (targetError || !target) throw new Error("User was not found.");
  if (target.role === "admin") throw new Error("Administrator accounts always have full system access.");
  const rows = permissions.map((permission) => ({ user_id: userId, ...permission, updated_at: new Date().toISOString() }));
  const { error } = await context.supabase.from("user_feature_permissions").upsert(rows, { onConflict: "user_id,feature_key" });
  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}

export async function createManagedUser(input: UserInput) {
  const context = await requireSettingsAccess();
  const values = validateInput(input);
  await assertTargetScope("new", values.role, values.hotelId || null, { ...context, actor: { ...context.actor, userId: "new" } });
  if (!values.password && !values.pinCode) throw new Error("Provide a password or a 4-digit PIN.");
  const password = values.password?.trim() || `${crypto.randomUUID()}Aa1!`;
  const { data: authUser, error: authError } = await context.supabase.auth.admin.createUser({ email: values.email, password, email_confirm: true });
  if (authError || !authUser.user) throw new Error(authError?.message ?? "Unable to create login account.");
  const { error: profileError } = await context.supabase.from("users").insert({ id: authUser.user.id, full_name: values.fullName, email: values.email, role: values.role, pin_code: values.pinCode || null, primary_hotel_id: values.hotelId || null });
  if (profileError) {
    await context.supabase.auth.admin.deleteUser(authUser.user.id);
    throw new Error(profileError.message);
  }
  if ((values.role === "owner" || values.role === "manager") && values.hotelId) {
    const column = values.role === "owner" ? "owner_id" : "manager_id";
    const { data: hotel, error: hotelError } = await context.supabase.from("hotels").select("id, owner_id, manager_id").eq("id", values.hotelId).maybeSingle();
    const currentAssignee = column === "owner_id" ? hotel?.owner_id : hotel?.manager_id;
    if (hotelError || !hotel || (currentAssignee && currentAssignee !== authUser.user.id)) {
      await context.supabase.from("users").delete().eq("id", authUser.user.id);
      await context.supabase.auth.admin.deleteUser(authUser.user.id);
      throw new Error("That hotel is already assigned to another user.");
    }
    const { error: assignmentError } = await context.supabase.from("hotels").update({ [column]: authUser.user.id }).eq("id", values.hotelId);
    if (assignmentError) throw new Error(assignmentError.message);
  }
  revalidatePath("/settings");
}

export async function updateManagedUser(userId: string, input: UserInput) {
  const context = await requireSettingsAccess();
  const values = validateInput(input);
  const { data: current, error: readError } = await context.supabase.from("users").select("id, role, primary_hotel_id").eq("id", userId).maybeSingle();
  if (readError || !current) throw new Error("User was not found.");
  const currentRole = current.role as ManagedUser["role"];
  const currentHotelInScope = current.primary_hotel_id ?? context.visibleHotels.find((hotel) => currentRole === "owner" ? hotel.owner_id === userId : currentRole === "manager" ? hotel.manager_id === userId : false)?.id ?? null;
  await assertTargetScope(userId, currentRole, currentHotelInScope, context);
  await assertTargetScope(userId, values.role, values.hotelId || null, context);
  const { error: authError } = await context.supabase.auth.admin.updateUserById(userId, { email: values.email, ...(values.password?.trim() ? { password: values.password.trim() } : {}) });
  if (authError) throw new Error(authError.message);
  const { error } = await context.supabase.from("users").update({ full_name: values.fullName, email: values.email, role: values.role, pin_code: values.pinCode || null, primary_hotel_id: values.hotelId || null, updated_at: new Date().toISOString() }).eq("id", userId);
  if (error) throw new Error(error.message);
  if ((values.role === "owner" || values.role === "manager") && values.hotelId) await assignManagedUserToHotel(userId, values.hotelId);
  revalidatePath("/settings");
}

export async function deleteManagedUser(userId: string) {
  const context = await requireSettingsAccess();
  if (context.actor.role !== "admin") throw new Error("Only administrators can delete user accounts.");
  const { data: target, error: readError } = await context.supabase.from("users").select("id, role, primary_hotel_id").eq("id", userId).maybeSingle();
  if (readError || !target) throw new Error("User was not found.");
  const targetRole = target.role as ManagedUser["role"];
  const targetHotelInScope = target.primary_hotel_id ?? context.visibleHotels.find((hotel) => targetRole === "owner" ? hotel.owner_id === userId : targetRole === "manager" ? hotel.manager_id === userId : false)?.id ?? null;
  await assertTargetScope(userId, targetRole, targetHotelInScope, context);
  const { error: profileError } = await context.supabase.from("users").delete().eq("id", userId);
  if (profileError) throw new Error(profileError.message);
  const { error: authError } = await context.supabase.auth.admin.deleteUser(userId);
  if (authError) throw new Error(authError.message);
  revalidatePath("/settings");
}

export async function assignManagedUserToHotel(userId: string, hotelId: string) {
  const context = await requireSettingsAccess();
  const { data: target, error: targetError } = await context.supabase.from("users").select("id, role, primary_hotel_id").eq("id", userId).maybeSingle();
  if (targetError || !target) throw new Error("User was not found.");
  const targetRole = target.role as ManagedUser["role"];
  await assertTargetScope(userId, targetRole, hotelId, context);
  const hotel = context.visibleHotels.find((item) => item.id === hotelId);
  if (!hotel) throw new Error("That hotel is outside your management scope.");
  if (targetRole === "cleaner") {
    const { error } = await context.supabase.from("users").update({ primary_hotel_id: hotelId, updated_at: new Date().toISOString() }).eq("id", userId);
    if (error) throw new Error(error.message);
  } else {
    const column = targetRole === "owner" ? "owner_id" : "manager_id";
    const currentAssignee = column === "owner_id" ? hotel.owner_id : hotel.manager_id;
    if (currentAssignee && currentAssignee !== userId) throw new Error(`${hotel.name} is already assigned to another ${targetRole}.`);
    const { error } = await context.supabase.from("hotels").update({ [column]: userId }).eq("id", hotelId);
    if (error) throw new Error(error.message);
    if (!target.primary_hotel_id) await context.supabase.from("users").update({ primary_hotel_id: hotelId, updated_at: new Date().toISOString() }).eq("id", userId);
  }
  revalidatePath("/settings");
  revalidatePath("/admin");
  revalidatePath("/owner");
  revalidatePath("/manager");
}

export async function unassignManagedUserFromHotel(userId: string, hotelId: string) {
  const context = await requireSettingsAccess();
  const { data: target, error: targetError } = await context.supabase.from("users").select("id, role, primary_hotel_id").eq("id", userId).maybeSingle();
  if (targetError || !target) throw new Error("User was not found.");
  const targetRole = target.role as ManagedUser["role"];
  await assertTargetScope(userId, targetRole, hotelId, context);
  const hotel = context.visibleHotels.find((item) => item.id === hotelId);
  if (!hotel) throw new Error("That hotel is outside your management scope.");
  if (targetRole === "cleaner") {
    if (target.primary_hotel_id !== hotelId) throw new Error("This hotel is not assigned to that cleaner.");
    const { error } = await context.supabase.from("users").update({ primary_hotel_id: null, updated_at: new Date().toISOString() }).eq("id", userId);
    if (error) throw new Error(error.message);
  } else {
    const column = targetRole === "owner" ? "owner_id" : "manager_id";
    const currentAssignee = column === "owner_id" ? hotel.owner_id : hotel.manager_id;
    if (currentAssignee !== userId) throw new Error("This hotel is not assigned to that user.");
    const { error } = await context.supabase.from("hotels").update({ [column]: null }).eq("id", hotelId);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/settings");
  revalidatePath("/admin");
  revalidatePath("/owner");
  revalidatePath("/manager");
}
