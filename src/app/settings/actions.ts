"use server";

import { revalidatePath } from "next/cache";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";
import { FEATURE_KEYS, type FeatureKey, type FeaturePermission } from "./permissionConfig";
import { requireFeatureAccess, type FeatureAction } from "@/lib/featureAccess";
import { USER_ROLES, type UserRole } from "@/lib/roles";

export type ManagedUser = {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  phone_number: string | null;
  avatar_url: string | null;
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
  hotelId: string | null;
  phoneNumber: string;
  password?: string;
};

async function requireSettingsAccess(action: FeatureAction = "view") {
  const session = await requireFeatureAccess("settings", action);
  const supabase = createPrivilegedServerSupabaseClient();
  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("role")
    .eq("id", session.userId)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);
  if (!profile || !USER_ROLES.includes(profile.role as UserRole) || profile.role !== session.role) {
    throw new Error("Your session role could not be verified. Sign in again.");
  }
  const actor = { ...session, role: profile.role as UserRole };
  if (!["admin", "owner", "manager"].includes(actor.role)) throw new Error("Management settings access required.");
  const { data: hotels, error } = await supabase.from("hotels").select("id, name, location, room_count, floor_count, is_active, owner_id, manager_id").order("name");
  if (error) throw new Error(error.message);
  const visibleHotels = actor.role === "admin" ? hotels ?? [] : (hotels ?? []).filter((hotel) => actor.role === "owner" ? hotel.owner_id === actor.userId : hotel.manager_id === actor.userId);
  return { actor, supabase, visibleHotels };
}

function roleAllowed(actorRole: string, targetRole: ManagedUser["role"]) {
  if (actorRole === "admin") return true;
  if (actorRole === "owner") return targetRole === "manager" || targetRole === "hk_admin" || targetRole === "cleaner";
  if (actorRole === "manager") return targetRole === "hk_admin" || targetRole === "cleaner";
  return false;
}

function validateInput(input: UserInput) {
  if (!USER_ROLES.some((role) => role === input.role)) throw new Error("Choose a valid account role.");
  const fullName = input.fullName.trim();
  const email = input.email.trim().toLowerCase();
  const pinCode = input.pinCode.trim();
  const phoneNumber = input.phoneNumber.trim();
  if (!fullName || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid name and email.");
  if (pinCode && !/^\d{4}$/.test(pinCode)) throw new Error("PIN must be exactly 4 digits.");
  if (phoneNumber.length > 32 || (phoneNumber && !/^[+()\d\s.-]{5,32}$/.test(phoneNumber))) throw new Error("Enter a valid phone number or leave it blank.");
  return { ...input, hotelId: typeof input.hotelId === "string" ? input.hotelId.trim() : null, fullName, email, pinCode, phoneNumber };
}

async function assertTargetScope(targetId: string, targetRole: ManagedUser["role"], hotelId: string | null, actor: Awaited<ReturnType<typeof requireSettingsAccess>>) {
  if (targetId !== "new" && targetId === actor.actor.userId) throw new Error("You cannot manage your own account here.");
  if (!roleAllowed(actor.actor.role, targetRole)) throw new Error("Your role cannot manage this user type.");
  if (actor.actor.role !== "admin" && (!hotelId || !actor.visibleHotels.some((hotel) => hotel.id === hotelId))) throw new Error("That hotel is outside your management scope.");
}

export async function getSettingsData() {
  const context = await requireSettingsAccess();
  const { data: users, error } = await context.supabase.from("users").select("id, full_name, email, phone_number, avatar_url, role, pin_code, primary_hotel_id").order("full_name");
  if (error) throw new Error(error.message);
  const { data: userHotelAssignments, error: assignmentsError } = await context.supabase
    .from("user_hotel_assignments")
    .select("user_id, hotel_id");
  if (assignmentsError) throw new Error(assignmentsError.message);
  const { data: permissions, error: permissionsError } = await context.supabase.from("user_feature_permissions").select("user_id, feature_key, can_view, can_create, can_edit, can_delete");
  if (permissionsError && permissionsError.code !== "PGRST205") throw new Error(permissionsError.message);
  const { data: services, error: servicesError } = await context.supabase
    .from("services_config")
    .select("id, hotel_id, name, description, unit, default_rate, is_active, owner_id")
    .order("name");
  if (servicesError) throw new Error(servicesError.message);
  const hotelsById = new Map(context.visibleHotels.map((hotel) => [hotel.id, hotel.name]));
  const managerNames = new Map((users ?? []).filter((user) => user.role === "manager").map((user) => [user.id, user.full_name]));
  const visibleUsers = (users ?? []).filter((user) => context.actor.role === "admin" || (roleAllowed(context.actor.role, user.role) && (user.primary_hotel_id !== null && hotelsById.has(user.primary_hotel_id) || context.visibleHotels.some((hotel) => user.role === "owner" ? hotel.owner_id === user.id : user.role === "manager" ? hotel.manager_id === user.id : false) || (user.role === "hk_admin" && (userHotelAssignments ?? []).some((assignment) => assignment.user_id === user.id && hotelsById.has(assignment.hotel_id))))));
  return {
    actorRole: context.actor.role,
    actorName: (users ?? []).find((user) => user.id === context.actor.userId)?.full_name ?? context.actor.email,
    actorEmail: context.actor.email,
    actorPhoneNumber: (users ?? []).find((user) => user.id === context.actor.userId)?.phone_number ?? null,
    actorAvatarUrl: (users ?? []).find((user) => user.id === context.actor.userId)?.avatar_url ?? null,
    hotels: context.visibleHotels.filter((hotel) => hotel.is_active).map((hotel) => ({ id: hotel.id, name: hotel.name })),
    properties: context.visibleHotels.map((hotel) => ({
      id: hotel.id,
      name: hotel.name,
      location: hotel.location,
      roomCount: hotel.room_count,
      floorCount: hotel.floor_count,
      isActive: hotel.is_active,
      managerId: hotel.manager_id,
      managerName: hotel.manager_id ? managerNames.get(hotel.manager_id) ?? "Assigned manager" : null,
      services: (services ?? []).filter((service) => service.hotel_id === hotel.id || (service.hotel_id === null && (service.owner_id === null || service.owner_id === hotel.owner_id))),
    })),
    services: (services ?? []).filter((service) => context.actor.role === "admin" || service.owner_id === context.actor.userId),
    managers: (users ?? []).filter((candidate) => candidate.role === "manager" && (
      context.actor.role === "admin" ||
      context.visibleHotels.some((hotel) => hotel.manager_id === candidate.id || hotel.id === candidate.primary_hotel_id)
    )).map(({ id, full_name }) => ({ id, full_name })),
    users: visibleUsers.map((user) => {
      const assignedHotelIds = user.role === "hk_admin"
        ? (userHotelAssignments ?? []).filter((assignment) => assignment.user_id === user.id).map((assignment) => assignment.hotel_id)
        : [];
      const assignedHotels = context.visibleHotels.filter((hotel) =>
        user.role === "owner"
          ? hotel.owner_id === user.id
          : user.role === "manager"
            ? hotel.manager_id === user.id
            : user.role === "hk_admin"
              ? assignedHotelIds.includes(hotel.id) || hotel.id === user.primary_hotel_id
              : user.role === "cleaner" && hotel.id === user.primary_hotel_id
      ).map((hotel) => ({ id: hotel.id, name: hotel.name }));
      return { ...user, role: user.role as ManagedUser["role"], hotelName: assignedHotels[0]?.name ?? "Unassigned", assignedHotels };
    }),
    permissions: (permissions ?? []).filter((permission) => visibleUsers.some((user) => user.id === permission.user_id)).map((permission) => ({ ...permission, feature_key: permission.feature_key as FeatureKey })),
  };
}

export async function updateUserFeaturePermissions(userId: string, permissions: Array<Omit<FeaturePermission, "user_id">>) {
  const context = await requireSettingsAccess("edit");
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

export type ActionResult = { success: true } | { success: false; error: string };

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function createManagedUser(input: UserInput): Promise<ActionResult> {
  let createdUserId: string | null = null;
  let cleanupClient: ReturnType<typeof createPrivilegedServerSupabaseClient> | null = null;
  try {
  const context = await requireSettingsAccess("create");
  cleanupClient = context.supabase;
  const values = validateInput(input);
  await assertTargetScope("new", values.role, values.hotelId || null, context);
  if (context.actor.role !== "admin" && !context.visibleHotels.find((hotel) => hotel.id === values.hotelId)?.is_active) {
    throw new Error("Staff must be assigned to an active property.");
  }
  if (!values.password && !values.pinCode) throw new Error("Provide a password or a 4-digit PIN.");
  const password = values.password?.trim() || `${crypto.randomUUID()}Aa1!`;
  const { data: authUser, error: authError } = await context.supabase.auth.admin.createUser({ email: values.email, password, email_confirm: true });
  if (authError || !authUser.user) throw new Error(authError?.message ?? "Unable to create login account.");
  createdUserId = authUser.user.id;
  const { error: profileError } = await context.supabase.from("users").insert({ id: authUser.user.id, full_name: values.fullName, email: values.email, phone_number: values.phoneNumber || null, role: values.role, pin_code: values.pinCode || null, primary_hotel_id: values.hotelId || null });
  if (profileError) throw new Error(profileError.message);
  if ((values.role === "owner" || values.role === "manager") && values.hotelId) {
    const column = values.role === "owner" ? "owner_id" : "manager_id";
    const { data: hotel, error: hotelError } = await context.supabase.from("hotels").select("id, owner_id, manager_id").eq("id", values.hotelId).maybeSingle();
    const currentAssignee = column === "owner_id" ? hotel?.owner_id : hotel?.manager_id;
    if (hotelError || !hotel || (currentAssignee && currentAssignee !== authUser.user.id)) {
      throw new Error("That hotel is already assigned to another user.");
    }
    const { error: assignmentError } = await context.supabase.from("hotels").update({ [column]: authUser.user.id }).eq("id", values.hotelId);
    if (assignmentError) throw new Error(assignmentError.message);
  }
  if (values.role === "hk_admin" && values.hotelId) {
    const { error: assignmentError } = await context.supabase
      .from("user_hotel_assignments")
      .upsert({ user_id: authUser.user.id, hotel_id: values.hotelId, assigned_by: context.actor.userId });
    if (assignmentError) throw new Error(assignmentError.message);
  }
  revalidatePath("/settings");
  return { success: true };
  } catch (error) {
    if (createdUserId && cleanupClient) {
      const { error: profileCleanupError } = await cleanupClient.from("users").delete().eq("id", createdUserId);
      const { error: authCleanupError } = await cleanupClient.auth.admin.deleteUser(createdUserId);
      if (profileCleanupError || authCleanupError) {
        console.error("Managed user creation cleanup failed:", profileCleanupError ?? authCleanupError);
      }
    }
    console.error("Managed user creation failed:", error);
    return { success: false, error: errorMessage(error, "Unable to create user.") };
  }
}

export async function updateManagedUser(userId: string, input: UserInput): Promise<ActionResult> {
  try {
  const context = await requireSettingsAccess("edit");
  const values = validateInput(input);
  const { data: current, error: readError } = await context.supabase.from("users").select("id, role, primary_hotel_id").eq("id", userId).maybeSingle();
  if (readError || !current) throw new Error("User was not found.");
  const currentRole = current.role as ManagedUser["role"];
  const currentHotelInScope = current.primary_hotel_id ?? context.visibleHotels.find((hotel) => currentRole === "owner" ? hotel.owner_id === userId : currentRole === "manager" ? hotel.manager_id === userId : false)?.id ?? null;
  await assertTargetScope(userId, currentRole, currentHotelInScope, context);
  await assertTargetScope(userId, values.role, values.hotelId || null, context);
  if (context.actor.role !== "admin" && !context.visibleHotels.find((hotel) => hotel.id === values.hotelId)?.is_active) {
    throw new Error("Staff must be assigned to an active property.");
  }
  const { error: authError } = await context.supabase.auth.admin.updateUserById(userId, { email: values.email, ...(values.password?.trim() ? { password: values.password.trim() } : {}) });
  if (authError) throw new Error(authError.message);
  if (currentRole === "hk_admin" && values.role !== "hk_admin") {
    const { error: assignmentError } = await context.supabase.from("user_hotel_assignments").delete().eq("user_id", userId);
    if (assignmentError) throw new Error(assignmentError.message);
  }
  const { error } = await context.supabase.from("users").update({ full_name: values.fullName, email: values.email, phone_number: values.phoneNumber || null, role: values.role, pin_code: values.pinCode || null, primary_hotel_id: values.hotelId || null, updated_at: new Date().toISOString() }).eq("id", userId);
  if (error) throw new Error(error.message);
  if ((values.role === "owner" || values.role === "manager" || values.role === "hk_admin") && values.hotelId) await assignManagedUserToHotel(userId, values.hotelId);
  revalidatePath("/settings");
  return { success: true };
  } catch (error) {
    console.error("Managed user update failed:", error);
    return { success: false, error: errorMessage(error, "Unable to update user.") };
  }
}

export async function deleteManagedUser(userId: string) {
  const context = await requireSettingsAccess("delete");
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
  const context = await requireSettingsAccess("edit");
  const { data: target, error: targetError } = await context.supabase.from("users").select("id, role, primary_hotel_id").eq("id", userId).maybeSingle();
  if (targetError || !target) throw new Error("User was not found.");
  const targetRole = target.role as ManagedUser["role"];
  await assertTargetScope(userId, targetRole, hotelId, context);
  const hotel = context.visibleHotels.find((item) => item.id === hotelId);
  if (!hotel) throw new Error("That hotel is outside your management scope.");
  if (!hotel.is_active) throw new Error("You cannot assign staff to an archived property.");
  if (targetRole === "hk_admin") {
    const { error } = await context.supabase
      .from("user_hotel_assignments")
      .upsert({ user_id: userId, hotel_id: hotelId, assigned_by: context.actor.userId });
    if (error) throw new Error(error.message);
    if (!target.primary_hotel_id) {
      const { error: primaryError } = await context.supabase.from("users").update({ primary_hotel_id: hotelId }).eq("id", userId);
      if (primaryError) throw new Error(primaryError.message);
    }
  } else if (targetRole === "cleaner") {
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
  const context = await requireSettingsAccess("edit");
  const { data: target, error: targetError } = await context.supabase.from("users").select("id, role, primary_hotel_id").eq("id", userId).maybeSingle();
  if (targetError || !target) throw new Error("User was not found.");
  const targetRole = target.role as ManagedUser["role"];
  await assertTargetScope(userId, targetRole, hotelId, context);
  const hotel = context.visibleHotels.find((item) => item.id === hotelId);
  if (!hotel) throw new Error("That hotel is outside your management scope.");
  if (targetRole === "hk_admin") {
    const { data: assignment, error: assignmentError } = await context.supabase
      .from("user_hotel_assignments")
      .delete()
      .eq("user_id", userId)
      .eq("hotel_id", hotelId)
      .select("hotel_id")
      .maybeSingle();
    if (assignmentError) throw new Error(assignmentError.message);
    if (!assignment && target.primary_hotel_id !== hotelId) throw new Error("This hotel is not assigned to that housekeeping admin.");
    if (target.primary_hotel_id === hotelId) {
      const { data: remaining, error: remainingError } = await context.supabase
        .from("user_hotel_assignments")
        .select("hotel_id")
        .eq("user_id", userId)
        .order("created_at")
        .limit(1)
        .maybeSingle();
      if (remainingError) throw new Error(remainingError.message);
      const { error } = await context.supabase.from("users").update({ primary_hotel_id: remaining?.hotel_id ?? null }).eq("id", userId);
      if (error) throw new Error(error.message);
    }
  } else if (targetRole === "cleaner") {
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

export type PropertyInput = { name: string; location: string; roomCount: number; floorCount: number; managerId: string | null };
export type ServiceInput = {
  hotelId: string;
  name: string;
  description: string;
  unit: "hourly" | "per_room" | "fixed";
  defaultRate: number;
  isActive: boolean;
};

async function requireTenantAssetAccess(action: FeatureAction) {
  const context = await requireSettingsAccess(action);
  if (context.actor.role !== "admin" && context.actor.role !== "owner") {
    throw new Error("Only owners and administrators can manage properties and service rates.");
  }
  return context;
}

function validateProperty(input: PropertyInput) {
  const name = input.name.trim();
  const location = input.location.trim();
  if (!name || name.length > 120) throw new Error("Enter a property name up to 120 characters.");
  if (!location || location.length > 240) throw new Error("Enter a property location up to 240 characters.");
  if (!Number.isInteger(input.roomCount) || input.roomCount < 0 || input.roomCount > 100_000) {
    throw new Error("Room count must be a whole number between 0 and 100,000.");
  }
  if (!Number.isInteger(input.floorCount) || input.floorCount < 0 || input.floorCount > 1000) {
    throw new Error("Floor count must be a whole number between 0 and 1,000.");
  }
  return { name, location, roomCount: input.roomCount, floorCount: input.floorCount, managerId: input.managerId || null };
}

async function validateManagerAssignment(
  managerId: string | null,
  context: Awaited<ReturnType<typeof requireTenantAssetAccess>>
) {
  if (!managerId || context.actor.role === "admin") return;
  const { data: manager, error } = await context.supabase
    .from("users")
    .select("id, primary_hotel_id")
    .eq("id", managerId)
    .eq("role", "manager")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!manager || !context.visibleHotels.some((hotel) =>
    hotel.manager_id === manager.id || hotel.id === manager.primary_hotel_id
  )) {
    throw new Error("Select a manager assigned to one of your properties.");
  }
}

function validateService(input: ServiceInput) {
  const name = input.name.trim();
  const description = input.description.trim();
  if (!name || name.length > 120) throw new Error("Enter a service name up to 120 characters.");
  if (description.length > 1000) throw new Error("Service description must be 1,000 characters or fewer.");
  if (!["hourly", "per_room", "fixed"].includes(input.unit)) throw new Error("Choose a valid service unit.");
  if (!Number.isFinite(input.defaultRate) || input.defaultRate < 0 || input.defaultRate > 1_000_000) {
    throw new Error("Enter a valid non-negative service rate.");
  }
  if (typeof input.hotelId !== "string" || !input.hotelId) throw new Error("Choose a property for this service.");
  if (typeof input.isActive !== "boolean") throw new Error("Choose whether this service is active.");
  return { hotelId: input.hotelId, name, description, unit: input.unit, defaultRate: input.defaultRate, isActive: input.isActive };
}

export async function createOwnedProperty(input: PropertyInput): Promise<ActionResult> {
  try {
    const context = await requireTenantAssetAccess("create");
    const values = validateProperty(input);
    await validateManagerAssignment(values.managerId, context);
    const { error } = await context.supabase.from("hotels").insert({
      name: values.name,
      location: values.location,
      room_count: values.roomCount,
      floor_count: values.floorCount,
      manager_id: values.managerId,
      owner_id: context.actor.userId,
    });
    if (error) throw new Error(error.message);
    revalidatePath("/settings");
    return { success: true };
  } catch (error) {
    console.error("Property creation failed:", error);
    return { success: false, error: errorMessage(error, "Unable to create property.") };
  }
}

export async function updateOwnedProperty(propertyId: string, input: PropertyInput): Promise<ActionResult> {
  try {
    const context = await requireTenantAssetAccess("edit");
    const values = validateProperty(input);
    await validateManagerAssignment(values.managerId, context);
    let query = context.supabase
      .from("hotels")
      .update({ name: values.name, location: values.location, room_count: values.roomCount, floor_count: values.floorCount, manager_id: values.managerId })
      .eq("id", propertyId);
    if (context.actor.role !== "admin") query = query.eq("owner_id", context.actor.userId);
    const { data, error } = await query.select("id").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Property not found in your account.");
    revalidatePath("/settings");
    return { success: true };
  } catch (error) {
    console.error("Property update failed:", error);
    return { success: false, error: errorMessage(error, "Unable to update property.") };
  }
}

export async function archiveOwnedProperty(propertyId: string): Promise<ActionResult> {
  try {
    const context = await requireTenantAssetAccess("delete");
    let query = context.supabase.from("hotels").update({ is_active: false }).eq("id", propertyId);
    if (context.actor.role !== "admin") query = query.eq("owner_id", context.actor.userId);
    const { data, error } = await query.select("id").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Property not found in your account.");
    revalidatePath("/settings");
    return { success: true };
  } catch (error) {
    console.error("Property archive failed:", error);
    return { success: false, error: errorMessage(error, "Unable to archive property.") };
  }
}

export async function createServiceConfiguration(input: ServiceInput): Promise<ActionResult> {
  try {
    const context = await requireTenantAssetAccess("create");
    const values = validateService(input);
    const { data: hotel, error: hotelError } = await context.supabase.from("hotels").select("id, owner_id").eq("id", values.hotelId).maybeSingle();
    if (hotelError) throw new Error(hotelError.message);
    if (!hotel || (context.actor.role !== "admin" && hotel.owner_id !== context.actor.userId)) throw new Error("Property not found in your account.");
    const { error } = await context.supabase.from("services_config").insert({
      hotel_id: hotel.id,
      name: values.name,
      description: values.description,
      unit: values.unit,
      default_rate: values.defaultRate,
      is_active: values.isActive,
      owner_id: hotel.owner_id,
    });
    if (error) throw new Error(error.message);
    revalidatePath("/settings");
    return { success: true };
  } catch (error) {
    console.error("Service configuration creation failed:", error);
    return { success: false, error: errorMessage(error, "Unable to create service.") };
  }
}

export async function updateServiceConfiguration(serviceId: string, input: ServiceInput): Promise<ActionResult> {
  try {
    const context = await requireTenantAssetAccess("edit");
    const values = validateService(input);
    const { data: hotel, error: hotelError } = await context.supabase.from("hotels").select("id, owner_id").eq("id", values.hotelId).maybeSingle();
    if (hotelError) throw new Error(hotelError.message);
    if (!hotel || (context.actor.role !== "admin" && hotel.owner_id !== context.actor.userId)) throw new Error("Property not found in your account.");
    let query = context.supabase
      .from("services_config")
      .update({ hotel_id: hotel.id, name: values.name, description: values.description, unit: values.unit, default_rate: values.defaultRate, is_active: values.isActive, updated_at: new Date().toISOString() })
      .eq("id", serviceId);
    if (context.actor.role !== "admin") query = query.eq("owner_id", context.actor.userId);
    query = query.eq("hotel_id", values.hotelId);
    const { data, error } = await query.select("id").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Service not found in your account.");
    revalidatePath("/settings");
    return { success: true };
  } catch (error) {
    console.error("Service configuration update failed:", error);
    return { success: false, error: errorMessage(error, "Unable to update service.") };
  }
}

export async function archiveServiceConfiguration(serviceId: string, hotelId: string): Promise<ActionResult> {
  try {
    const context = await requireTenantAssetAccess("delete");
    let query = context.supabase
      .from("services_config")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", serviceId)
      .eq("hotel_id", hotelId);
    if (context.actor.role !== "admin") query = query.eq("owner_id", context.actor.userId);
    const { data, error } = await query.select("id").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Service not found in your account.");
    revalidatePath("/settings");
    return { success: true };
  } catch (error) {
    console.error("Service configuration archive failed:", error);
    return { success: false, error: errorMessage(error, "Unable to archive service.") };
  }
}
