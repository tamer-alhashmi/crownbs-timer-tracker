"use server";

import { revalidatePath } from "next/cache";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";
import { FEATURE_KEYS, type FeatureKey, type FeaturePermission } from "./permissionConfig";
import { requireFeatureAccess, type FeatureAction } from "@/lib/featureAccess";
import { isPlatformAdmin, isSuperAdmin, isUserRole, normalizeUserRole, USER_ROLES, type UserRole } from "@/lib/roles";
import { geocodePropertyAddress } from "@/lib/propertyGeocoding";
import { getManagerPropertyIds, getOwnerPropertyIds, getPropertyOwnerIds } from "@/lib/propertyOwnership";
import type { BillingModel, ChecklistBlueprint, SpatialMode } from "@/lib/serviceBlueprint";

export type ManagedUser = {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  phone_number: string | null;
  avatar_url: string | null;
  hasPin: boolean;
  primary_hotel_id: string | null;
  is_active: boolean;
  deactivated_at: string | null;
  is_clocked_in?: boolean;
  hotelName: string;
  assignedHotels: { id: string; name: string }[];
  partnerHotels: { id: string; name: string }[];
};

type UserInput = {
  fullName: string;
  email: string;
  role: ManagedUser["role"];
  pinCode: string;
  hotelIds: string[];
  primaryHotelId: string | null;
  phoneNumber: string;
  password?: string;
};

async function requireSettingsAccess(action: FeatureAction = "view") {
  const session = await requireFeatureAccess("settings", action);
  const supabase = createPrivilegedServerSupabaseClient();
  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("role, is_active")
    .eq("id", session.userId)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);
  if (!profile || profile.is_active !== true || !isUserRole(profile.role) || normalizeUserRole(profile.role) !== session.role) {
    throw new Error("Your session role could not be verified. Sign in again.");
  }
  const actor = { ...session, role: normalizeUserRole(profile.role as UserRole) };
  if (!isPlatformAdmin(actor.role) && !["owner", "manager"].includes(actor.role)) throw new Error("Management settings access required.");
  const { data: hotels, error } = await supabase.from("hotels").select("id, name, location, latitude, longitude, room_count, total_rooms, floor_count, is_active, owner_id, manager_id").is("archived_at", null).order("name");
  if (error) throw new Error(error.message);
  const ownerHotelIds = actor.role === "owner" ? new Set(await getOwnerPropertyIds(supabase, actor.userId)) : null;
  const managerHotelIds = actor.role === "manager" ? new Set(await getManagerPropertyIds(supabase, actor.userId)) : null;
  const visibleHotels = isPlatformAdmin(actor.role) ? hotels ?? [] : (hotels ?? []).filter((hotel) =>
    ownerHotelIds ? ownerHotelIds.has(hotel.id) : managerHotelIds?.has(hotel.id)
  );
  return { actor, supabase, visibleHotels };
}

async function getActiveRoomStats(
  supabase: ReturnType<typeof createPrivilegedServerSupabaseClient>,
  hotelId: string
) {
  const { data: rooms, count, error } = await supabase
    .from("rooms")
    .select("floor_section", { count: "exact" })
    .eq("hotel_id", hotelId)
    .eq("status", "active");
  if (error) throw new Error(`Unable to load active rooms for property ${hotelId}: ${error.message}`);
  const floors = new Set(
    (rooms ?? [])
      .map((room) => room.floor_section?.trim())
      .filter((floor): floor is string => Boolean(floor))
  );
  return { roomCount: count ?? 0, floorCount: floors.size };
}

function roleAllowed(actorRole: string, targetRole: ManagedUser["role"]) {
  if (actorRole === "super_admin") return true;
  if (actorRole === "admin") return targetRole !== "super_admin";
  if (actorRole === "owner") return targetRole === "manager" || targetRole === "housekeeping_admin" || targetRole === "hk_admin" || targetRole === "cleaner";
  if (actorRole === "manager") return targetRole === "housekeeping_admin" || targetRole === "hk_admin" || targetRole === "cleaner";
  return false;
}

function databaseRole(role: ManagedUser["role"]): ManagedUser["role"] {
  return role === "housekeeping_admin" ? "hk_admin" : role;
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
  const hotelIds = Array.isArray(input.hotelIds)
    ? [...new Set(input.hotelIds.filter((hotelId) => typeof hotelId === "string").map((hotelId) => hotelId.trim()).filter(Boolean))]
    : [];
  const primaryHotelId = typeof input.primaryHotelId === "string" ? input.primaryHotelId.trim() || null : null;
  if (primaryHotelId && !hotelIds.includes(primaryHotelId)) {
    throw new Error("The primary property must also be selected in the property assignments.");
  }
  if (hotelIds.length > 1 && !primaryHotelId) {
    throw new Error("Choose one of the assigned properties as the primary property.");
  }
  return { ...input, role: normalizeUserRole(input.role), hotelIds, primaryHotelId: primaryHotelId ?? hotelIds[0] ?? null, fullName, email, pinCode, phoneNumber };
}

async function assertTargetScope(targetId: string, targetRole: ManagedUser["role"], hotelIds: string[], actor: Awaited<ReturnType<typeof requireSettingsAccess>>) {
  if (targetId !== "new" && targetId === actor.actor.userId) throw new Error("You cannot manage your own account here.");
  if (!roleAllowed(actor.actor.role, targetRole)) throw new Error("Your role cannot manage this user type.");
  if (!isPlatformAdmin(actor.actor.role) && (!hotelIds.length || hotelIds.some((hotelId) => !actor.visibleHotels.some((hotel) => hotel.id === hotelId)))) {
    throw new Error("Every assigned property must be within your management scope.");
  }
}

function assertHotelSlotsAvailable(role: ManagedUser["role"], hotelIds: string[], actor: Awaited<ReturnType<typeof requireSettingsAccess>>, userId?: string) {
  const propertyColumn = role === "owner" ? "owner_id" : null;
  if (!propertyColumn) return;
  for (const hotelId of hotelIds) {
    const property = actor.visibleHotels.find((hotel) => hotel.id === hotelId);
    if (!property) throw new Error("A selected property is outside your management scope.");
    const currentAssignee = property.owner_id;
    if (currentAssignee && currentAssignee !== userId) {
      throw new Error(`${property.name} is already assigned to another ${role}.`);
    }
  }
}

export async function getSettingsData() {
  const context = await requireSettingsAccess();
  const [{ data: users, error }, { data: activeShifts, error: shiftsError }] = await Promise.all([
    context.supabase.from("users").select("id, full_name, email, phone_number, avatar_url, role, has_pin, primary_hotel_id, is_active, deactivated_at, email_verified").order("full_name"),
    context.supabase.from("master_shifts").select("user_id").eq("status", "active").is("end_time", null),
  ]);
  if (error) throw new Error(error.message);
  if (shiftsError) throw new Error(shiftsError.message);
  const { data: userHotelAssignments, error: assignmentsError } = await context.supabase
    .from("user_hotel_assignments")
    .select("user_id, hotel_id, is_primary");
  if (assignmentsError) throw new Error(assignmentsError.message);
  const { data: permissions, error: permissionsError } = await context.supabase.from("user_feature_permissions").select("user_id, feature_key, can_view, can_create, can_edit, can_delete");
  if (permissionsError && permissionsError.code !== "PGRST205") throw new Error(permissionsError.message);
  const { data: services, error: servicesError } = await context.supabase
    .from("services_config")
    .select("id, hotel_id, name, description, unit, default_rate, is_active, owner_id, service_category, billing_model, billing_unit_label, benchmark_quantity, spatial_mode, requires_asset_reference, checklist_blueprint")
    .order("name");
  if (servicesError) throw new Error(servicesError.message);
  const hotelsById = new Map(context.visibleHotels.map((hotel) => [hotel.id, hotel.name]));
  const propertyOwners = await getPropertyOwnerIds(context.supabase, context.visibleHotels.map((hotel) => hotel.id));
  const activeUserIds = new Set((activeShifts ?? []).map((shift) => shift.user_id));
  const managerNames = new Map((users ?? []).filter((user) => user.role === "manager").map((user) => [user.id, user.full_name]));
  const visibleUsers = (users ?? []).filter((user) => isPlatformAdmin(context.actor.role) || (roleAllowed(context.actor.role, user.role) && (user.primary_hotel_id !== null && hotelsById.has(user.primary_hotel_id) || context.visibleHotels.some((hotel) => user.role === "owner" ? (propertyOwners.get(hotel.id) ?? []).includes(user.id) : user.role === "manager" ? hotel.manager_id === user.id : false) || (userHotelAssignments ?? []).some((assignment) => assignment.user_id === user.id && hotelsById.has(assignment.hotel_id)))));
  const properties = await Promise.all(context.visibleHotels.map(async (hotel) => {
    const roomStats = await getActiveRoomStats(context.supabase, hotel.id);
    return {
      id: hotel.id,
      name: hotel.name,
      location: hotel.location,
      latitude: hotel.latitude,
      longitude: hotel.longitude,
      roomCount: roomStats.roomCount || Math.max(hotel.room_count ?? 0, hotel.total_rooms ?? 0),
      floorCount: roomStats.floorCount || hotel.floor_count || 0,
      isActive: hotel.is_active,
      managerId: hotel.manager_id,
      managerName: hotel.manager_id ? managerNames.get(hotel.manager_id) ?? "Assigned manager" : null,
      ownerId: hotel.owner_id,
      ownerName: hotel.owner_id ? (users ?? []).find((user) => user.id === hotel.owner_id)?.full_name ?? "Assigned owner" : null,
      coOwners: (propertyOwners.get(hotel.id) ?? [])
        .filter((ownerId) => ownerId !== hotel.owner_id)
        .map((ownerId) => ({
          id: ownerId,
          name: (users ?? []).find((user) => user.id === ownerId)?.full_name ?? "Owner account",
        })),
      services: (services ?? []).filter((service) => service.hotel_id === hotel.id || (service.hotel_id === null && (service.owner_id === null || (propertyOwners.get(hotel.id) ?? []).includes(service.owner_id)))),
    };
  }));
  const ownerCandidates = (users ?? [])
    .filter((candidate) => candidate.role === "owner" && candidate.is_active)
    .map(({ id, full_name, email_verified }) => ({ id, full_name, email_verified }));
  return {
    actorRole: context.actor.role,
    actorName: (users ?? []).find((user) => user.id === context.actor.userId)?.full_name ?? context.actor.email,
    actorEmail: context.actor.email,
    actorPhoneNumber: (users ?? []).find((user) => user.id === context.actor.userId)?.phone_number ?? null,
    actorAvatarUrl: (users ?? []).find((user) => user.id === context.actor.userId)?.avatar_url ?? null,
    hotels: context.visibleHotels.filter((hotel) => hotel.is_active).map((hotel) => ({
      id: hotel.id,
      name: hotel.name,
      ownerId: hotel.owner_id,
    })),
    properties,
    ownerCandidates,
    services: (services ?? []).filter((service) => isPlatformAdmin(context.actor.role)
      || Boolean(service.hotel_id && hotelsById.has(service.hotel_id))
      || Boolean(service.hotel_id === null && service.owner_id && [...propertyOwners.values()].some((ownerIds) => ownerIds.includes(service.owner_id!)))),
    managers: (users ?? []).filter((candidate) => candidate.role === "manager" && candidate.is_active && (
      isPlatformAdmin(context.actor.role) ||
      context.visibleHotels.some((hotel) => hotel.id === candidate.primary_hotel_id || hotel.manager_id === candidate.id)
      || (userHotelAssignments ?? []).some((assignment) => assignment.user_id === candidate.id && hotelsById.has(assignment.hotel_id))
    )).map(({ id, full_name }) => ({ id, full_name })),
    users: visibleUsers.map((user) => {
      const assignedHotelIds = (userHotelAssignments ?? [])
        .filter((assignment) => assignment.user_id === user.id)
        .map((assignment) => assignment.hotel_id);
      const assignedHotels = context.visibleHotels.filter((hotel) =>
        assignedHotelIds.includes(hotel.id) ||
        (user.role === "owner"
          ? hotel.owner_id === user.id
          : hotel.id === user.primary_hotel_id) ||
        (user.role === "manager" && hotel.manager_id === user.id)
      ).map((hotel) => ({ id: hotel.id, name: hotel.name }));
      const partnerHotels = user.role === "owner"
        ? context.visibleHotels
          .filter((hotel) => hotel.owner_id !== user.id && (propertyOwners.get(hotel.id) ?? []).includes(user.id))
          .map((hotel) => ({ id: hotel.id, name: hotel.name }))
        : [];
      const { has_pin: hasPin, ...safeUser } = user;
      return {
        ...safeUser,
        hasPin,
        role: normalizeUserRole(user.role as UserRole),
        is_clocked_in: activeUserIds.has(user.id),
        hotelName: assignedHotels[0]?.name ?? partnerHotels[0]?.name ?? "Unassigned",
        assignedHotels,
        partnerHotels,
      };
    }),
    permissions: (permissions ?? []).filter((permission) => visibleUsers.some((user) => user.id === permission.user_id)).map((permission) => ({ ...permission, feature_key: permission.feature_key as FeatureKey })),
  };
}

export async function updateUserFeaturePermissions(userId: string, permissions: Array<Omit<FeaturePermission, "user_id">>) {
  const context = await requireSettingsAccess("edit");
  if (!isPlatformAdmin(context.actor.role)) throw new Error("Only administrators can change feature permissions.");
  if (!permissions.every((permission) => FEATURE_KEYS.includes(permission.feature_key))) throw new Error("An invalid feature permission was submitted.");
  const { data: target, error: targetError } = await context.supabase.from("users").select("id, role").eq("id", userId).maybeSingle();
  if (targetError || !target) throw new Error("User was not found.");
  if (target.role === "admin" || target.role === "super_admin") throw new Error("Administrator accounts always have full system access.");
  const rows = permissions.map((permission) => ({ user_id: userId, ...permission, updated_at: new Date().toISOString() }));
  const { error } = await context.supabase.from("user_feature_permissions").upsert(rows, { onConflict: "user_id,feature_key" });
  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}

export type ActionResult = { success: true } | { success: false; error: string };

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function isEmailConflict(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code === "23505") return true;
  if (typeof candidate.message !== "string") return false;
  const message = candidate.message.toLowerCase();
  return message.includes("users_email_unique") ||
    message.includes("email") && /(unique|duplicate|already exists|already registered)/.test(message) ||
    /already registered|already exists/.test(message);
}

function isAuthEmailAlreadyRegistered(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { message?: unknown };
  return typeof candidate.message === "string" &&
    /already\s+(been\s+)?(registered|exists)/i.test(candidate.message);
}

async function findAuthUserByEmail(
  supabase: ReturnType<typeof createPrivilegedServerSupabaseClient>,
  email: string
) {
  const normalizedEmail = email.trim().toLowerCase();
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Unable to look up the existing login account: ${error.message}`);
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === normalizedEmail);
    if (user) return user;
    if (data.users.length < 1000) return null;
  }
}

async function emailAlreadyInUse(
  supabase: ReturnType<typeof createPrivilegedServerSupabaseClient>,
  email: string,
  excludeUserId?: string
) {
  let query = supabase.from("users").select("id, email").ilike("email", email);
  if (excludeUserId) query = query.neq("id", excludeUserId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Unable to verify email availability: ${error.message}`);
  return Boolean(data);
}

export async function createManagedUser(input: UserInput): Promise<ActionResult> {
  let createdUserId: string | null = null;
  let createdAuthUser = false;
  let createdProfile = false;
  let cleanupClient: ReturnType<typeof createPrivilegedServerSupabaseClient> | null = null;
  try {
  const context = await requireSettingsAccess("create");
  cleanupClient = context.supabase;
  const values = validateInput(input);
  await assertTargetScope("new", values.role, values.hotelIds, context);
  assertHotelSlotsAvailable(values.role, values.hotelIds, context);
  if (await emailAlreadyInUse(context.supabase, values.email)) {
    return { success: false, error: "This email address is already in use. Please enter a different email address." };
  }
  if (values.role !== "admin" && values.role !== "super_admin" && !isPlatformAdmin(context.actor.role) && !values.hotelIds.length) throw new Error("Staff must be assigned to an active property.");
  const unavailableHotel = values.hotelIds.find((hotelId) => !context.visibleHotels.find((hotel) => hotel.id === hotelId)?.is_active);
  if (unavailableHotel) throw new Error("Staff must be assigned only to active properties.");
  if (!values.password && !values.pinCode) throw new Error("Provide a password or a 4-digit PIN.");
  const password = values.password?.trim() || `${crypto.randomUUID()}Aa1!`;
  let authUser: Awaited<ReturnType<typeof context.supabase.auth.admin.createUser>>["data"]["user"] = null;
  let createUserError: unknown = null;
  try {
    const result = await context.supabase.auth.admin.createUser({
      email: values.email,
      password,
      email_confirm: true,
    });
    authUser = result.data.user;
    createUserError = result.error;
  } catch (error) {
    createUserError = error;
  }

  if (createUserError || !authUser) {
    if (!isAuthEmailAlreadyRegistered(createUserError)) {
      throw new Error(createUserError instanceof Error ? createUserError.message : "Unable to create login account.");
    }
    authUser = await findAuthUserByEmail(context.supabase, values.email);
    if (!authUser) {
      throw new Error("An existing login account was reported, but could not be found by email.");
    }
  } else {
    createdAuthUser = true;
  }

  createdUserId = authUser.id;
  const { error: profileError } = await context.supabase.from("users").upsert({
    id: authUser.id,
    full_name: values.fullName,
    email: values.email,
    phone_number: values.phoneNumber || null,
    role: databaseRole(values.role),
    pin_code: values.pinCode || null,
    primary_hotel_id: values.primaryHotelId,
  }, { onConflict: "id" });
  if (profileError) throw new Error(profileError.message);
  createdProfile = true;
  if (["manager", "housekeeping_admin", "hk_admin", "cleaner"].includes(values.role) && values.hotelIds.length) {
    const { error: assignmentError } = await context.supabase
      .from("user_hotel_assignments")
      .upsert(values.hotelIds.map((hotelId) => ({
        user_id: authUser.id,
        hotel_id: hotelId,
        is_primary: hotelId === values.primaryHotelId,
        assigned_by: context.actor.userId,
      })), { onConflict: "user_id,hotel_id" });
    if (assignmentError) throw new Error(assignmentError.message);
  }
  if (values.role === "owner" && values.hotelIds.length) {
    for (const hotelId of values.hotelIds) {
      const { error: assignmentError } = await context.supabase.from("hotels").update({ owner_id: authUser.id }).eq("id", hotelId);
      if (assignmentError) throw new Error(assignmentError.message);
    }
  }
  if (values.role === "manager" && values.hotelIds.length) {
    for (const hotelId of values.hotelIds) {
      const { data: hotel, error: hotelError } = await context.supabase.from("hotels").select("manager_id").eq("id", hotelId).maybeSingle();
      if (hotelError || !hotel) throw new Error(hotelError?.message ?? "A selected property could not be loaded.");
      if (!hotel.manager_id) {
        const { error: managerError } = await context.supabase.from("hotels").update({ manager_id: authUser.id }).eq("id", hotelId);
        if (managerError) throw new Error(managerError.message);
      }
    }
  }
  revalidatePath("/settings");
  return { success: true };
  } catch (error) {
    if (createdUserId && cleanupClient) {
      const profileCleanup = createdProfile
        ? await cleanupClient.from("users").delete().eq("id", createdUserId)
        : { error: null };
      const authCleanup = createdAuthUser
        ? await cleanupClient.auth.admin.deleteUser(createdUserId)
        : { error: null };
      if (profileCleanup.error || authCleanup.error) {
        console.error("Managed user creation cleanup failed:", profileCleanup.error ?? authCleanup.error);
      }
    }
    if (isEmailConflict(error)) {
      return { success: false, error: "An account with this email already exists." };
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
  const { data: currentAssignments, error: currentAssignmentsError } = await context.supabase.from("user_hotel_assignments").select("hotel_id").eq("user_id", userId);
  if (currentAssignmentsError) throw new Error(currentAssignmentsError.message);
  const propertyOwners = currentRole === "owner"
  ? await getPropertyOwnerIds(context.supabase, context.visibleHotels.map((hotel) => hotel.id))
  : new Map<string, string[]>();
  const relatedHotelIds = currentRole === "manager"
    ? await getManagerPropertyIds(context.supabase, userId)
    : currentRole === "owner"
      ? context.visibleHotels.filter((hotel) => (propertyOwners.get(hotel.id) ?? []).includes(userId)).map((hotel) => hotel.id)
      : [];
  const currentHotelIds = [...new Set([...(currentAssignments ?? []).map((row) => row.hotel_id), current.primary_hotel_id, ...relatedHotelIds].filter((id): id is string => Boolean(id)))];
  await assertTargetScope(userId, currentRole, currentHotelIds, context);
  await assertTargetScope(userId, values.role, values.hotelIds, context);
  assertHotelSlotsAvailable(values.role, values.hotelIds, context, userId);
  if (await emailAlreadyInUse(context.supabase, values.email, userId)) {
    return { success: false, error: "This email address is already in use. Please enter a different email address." };
  }
  if (!isPlatformAdmin(context.actor.role) && values.hotelIds.some((hotelId) => !context.visibleHotels.find((hotel) => hotel.id === hotelId)?.is_active)) {
    throw new Error("Staff must be assigned only to active properties.");
  }
  const { error: authError } = await context.supabase.auth.admin.updateUserById(userId, { email: values.email, ...(values.password?.trim() ? { password: values.password.trim() } : {}) });
  if (authError) throw new Error(authError.message);
  const { error: assignmentDeleteError } = await context.supabase.from("user_hotel_assignments").delete().eq("user_id", userId);
  if (assignmentDeleteError) throw new Error(assignmentDeleteError.message);
  const { error } = await context.supabase.from("users").update({
    full_name: values.fullName,
    email: values.email,
    phone_number: values.phoneNumber || null,
    role: databaseRole(values.role),
    ...(values.pinCode ? { pin_code: values.pinCode } : {}),
    primary_hotel_id: values.primaryHotelId,
    updated_at: new Date().toISOString(),
  }).eq("id", userId);
  if (error) throw new Error(error.message);
  if (["manager", "housekeeping_admin", "hk_admin", "cleaner"].includes(values.role) && values.hotelIds.length) {
    const { error: assignmentError } = await context.supabase.from("user_hotel_assignments").insert(values.hotelIds.map((hotelId) => ({
      user_id: userId,
      hotel_id: hotelId,
      is_primary: hotelId === values.primaryHotelId,
      assigned_by: context.actor.userId,
    })));
    if (assignmentError) throw new Error(assignmentError.message);
  }
  if (currentRole === "manager") {
    const managerHotelIds = currentHotelIds.filter((hotelId) =>
      context.visibleHotels.some((hotel) => hotel.id === hotelId)
    );
    let clearManagersQuery = context.supabase.from("hotels").update({ manager_id: null }).eq("manager_id", userId);
    if (managerHotelIds.length) clearManagersQuery = clearManagersQuery.in("id", managerHotelIds);
    const { error: clearManagersError } = await clearManagersQuery;
    if (clearManagersError) throw new Error(clearManagersError.message);
  }
  if (currentRole === "owner" && values.role === "owner") {
    const ownerHotelIds = currentHotelIds.filter((hotelId) => context.visibleHotels.some((hotel) => hotel.id === hotelId));
    const unselectedHotelIds = ownerHotelIds.filter((hotelId) => !values.hotelIds.includes(hotelId));
    if (unselectedHotelIds.length) {
      const { error: clearOwnersError } = await context.supabase.from("hotels").update({ owner_id: null }).eq("owner_id", userId).in("id", unselectedHotelIds);
      if (clearOwnersError) throw new Error(clearOwnersError.message);
    }
  }
  if (currentRole === "owner" && values.role !== "owner") {
    const ownerHotelIds = currentHotelIds.filter((hotelId) => context.visibleHotels.some((hotel) => hotel.id === hotelId));
    if (ownerHotelIds.length) {
      const { error: clearOwnersError } = await context.supabase.from("hotels").update({ owner_id: null }).eq("owner_id", userId).in("id", ownerHotelIds);
      if (clearOwnersError) throw new Error(clearOwnersError.message);
    }
  }
  if (values.role === "manager") {
    for (const hotelId of values.hotelIds) {
      const { data: hotel, error: hotelError } = await context.supabase.from("hotels").select("manager_id").eq("id", hotelId).maybeSingle();
      if (hotelError || !hotel) throw new Error(hotelError?.message ?? "A selected property could not be loaded.");
      if (!hotel.manager_id || hotel.manager_id === userId) {
        const { error: managerError } = await context.supabase.from("hotels").update({ manager_id: userId }).eq("id", hotelId);
        if (managerError) throw new Error(managerError.message);
      }
    }
  }
  if (values.role === "owner" && values.hotelIds.length) {
    for (const hotelId of values.hotelIds) {
      const { error: ownerError } = await context.supabase.from("hotels").update({ owner_id: userId }).eq("id", hotelId);
      if (ownerError) throw new Error(ownerError.message);
    }
  }
  revalidatePath("/settings");
  return { success: true };
  } catch (error) {
    if (isEmailConflict(error)) {
      return { success: false, error: "An account with this email already exists." };
    }
    console.error("Managed user update failed:", error);
    return { success: false, error: errorMessage(error, "Unable to update user.") };
  }
}

export async function setManagedUserPin(userId: string, pinCode: string | null) {
  if (!userId || (pinCode !== null && !/^\d{4}$/.test(pinCode))) {
    throw new Error("Provide a user and either a 4-digit PIN or null to remove it.");
  }
  const context = await requireSettingsAccess("edit");
  const { data: target, error: targetError } = await context.supabase
    .from("users")
    .select("id, role, primary_hotel_id")
    .eq("id", userId)
    .maybeSingle();
  if (targetError) throw new Error(targetError.message);
  if (!target || !isUserRole(target.role)) throw new Error("User was not found.");
  const targetRole = normalizeUserRole(target.role);
  const { data: assignments, error: assignmentsError } = await context.supabase
    .from("user_hotel_assignments")
    .select("hotel_id")
    .eq("user_id", userId);
  if (assignmentsError) throw new Error(assignmentsError.message);
  const managerHotelIds = targetRole === "manager" ? await getManagerPropertyIds(context.supabase, userId) : [];
  const assignedHotelIds = [
    ...(assignments ?? []).map((assignment) => assignment.hotel_id),
    ...(target.primary_hotel_id ? [target.primary_hotel_id] : []),
    ...context.visibleHotels
      .filter((hotel) => targetRole === "owner" ? hotel.owner_id === userId : false)
      .map((hotel) => hotel.id),
    ...managerHotelIds,
  ];
  await assertTargetScope(userId, targetRole, [...new Set(assignedHotelIds)], context);
  const { error } = await context.supabase
    .from("users")
    .update({ pin_code: pinCode, updated_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}

export async function deleteManagedUser(userId: string) {
  const context = await requireSettingsAccess("delete");
  if (!isSuperAdmin(context.actor.role)) throw new Error("Only a super administrator can deactivate user accounts.");
  const { data: target, error: readError } = await context.supabase.from("users").select("id, role, primary_hotel_id, is_active").eq("id", userId).maybeSingle();
  if (readError || !target) throw new Error("User was not found.");
  const targetRole = target.role as ManagedUser["role"];
  const managerHotelIds = targetRole === "manager" ? await getManagerPropertyIds(context.supabase, userId) : [];
  const targetHotelIds = [...new Set([
    ...(target.primary_hotel_id ? [target.primary_hotel_id] : []),
    ...context.visibleHotels.filter((hotel) => targetRole === "owner" ? hotel.owner_id === userId : false).map((hotel) => hotel.id),
    ...managerHotelIds,
  ])];
  await assertTargetScope(userId, targetRole, targetHotelIds, context);
  if (target.is_active) {
    const { error: profileError } = await context.supabase
      .from("users")
      .update({ is_active: false, deactivated_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", userId)
      .eq("is_active", true);
    if (profileError) throw new Error(profileError.message);
  }
  revalidatePath("/settings");
}

export async function assignManagedUserToHotel(
  userId: string,
  hotelId: string,
  assignmentType: "primary" | "co_owner" | "transfer" = "primary",
  expectedOwnerId?: string | null,
): Promise<ActionResult> {
  try {
    const context = await requireSettingsAccess("edit");
    const { data: target, error: targetError } = await context.supabase
      .from("users")
      .select("id, role, primary_hotel_id")
      .eq("id", userId)
      .maybeSingle();
    if (targetError) throw new Error(targetError.message);
    if (!target) throw new Error("User was not found.");

    const targetRole = normalizeUserRole(target.role as ManagedUser["role"]);
    if (!["owner", "manager", "housekeeping_admin", "hk_admin", "cleaner"].includes(targetRole)) {
      throw new Error("This account type cannot be assigned to a property.");
    }
    await assertTargetScope(userId, targetRole, [hotelId], context);
    const hotel = context.visibleHotels.find((item) => item.id === hotelId);
    if (!hotel) throw new Error("That hotel is outside your management scope.");
    if (!hotel.is_active) throw new Error("You cannot assign staff to an archived property.");
    const ownershipAssignment = ["primary", "co_owner", "transfer"].includes(assignmentType)
      ? assignmentType
      : null;
    if (!ownershipAssignment) throw new Error("Choose a valid owner assignment.");
    if (targetRole !== "owner" && ownershipAssignment !== "primary") {
      throw new Error("Only Owner accounts can be linked to or transferred between property owners.");
    }
    if (targetRole === "owner" && !isPlatformAdmin(context.actor.role)) {
      throw new Error("Only a Platform Admin can manage property owner assignments.");
    }
    if (ownershipAssignment === "transfer" && !isPlatformAdmin(context.actor.role)) {
      throw new Error("Only a Platform Admin can transfer primary property ownership.");
    }
    if (ownershipAssignment === "transfer" && expectedOwnerId !== hotel.owner_id) {
      throw new Error(`${hotel.name} ownership changed. Refresh and try again.`);
    }
    if (targetRole !== "owner") assertHotelSlotsAvailable(targetRole, [hotelId], context, userId);

    if (["manager", "hk_admin", "housekeeping_admin", "cleaner"].includes(targetRole)) {
      const { error } = await context.supabase
        .from("user_hotel_assignments")
        .upsert({
          user_id: userId,
          hotel_id: hotelId,
          is_primary: !target.primary_hotel_id,
          assigned_by: context.actor.userId,
        }, { onConflict: "user_id,hotel_id" });
      if (error) {
        if (error.code !== "23505") throw new Error(error.message);
        const { data: existing } = await context.supabase.from("user_hotel_assignments")
          .select("hotel_id")
          .eq("user_id", userId)
          .eq("hotel_id", hotelId)
          .maybeSingle();
        if (!existing) throw new Error("This property could not be assigned to the user.");
      }
      if (!target.primary_hotel_id) {
        const { error: primaryError } = await context.supabase.from("users")
          .update({ primary_hotel_id: hotelId })
          .eq("id", userId);
        if (primaryError) throw new Error(primaryError.message);
      }
      if (targetRole === "manager" && hotel.manager_id !== userId) {
        const { data: updated, error: managerError } = await context.supabase.from("hotels")
          .update({ manager_id: userId })
          .eq("id", hotelId)
          .is("manager_id", null)
          .select("id")
          .maybeSingle();
        if (managerError) throw new Error(managerError.message);
        if (!updated) {
          const { data: current, error: currentError } = await context.supabase.from("hotels")
            .select("manager_id")
            .eq("id", hotelId)
            .maybeSingle();
          if (currentError) throw new Error(currentError.message);
          if (current?.manager_id !== userId) throw new Error(`${hotel.name} is already assigned to another manager.`);
        }
      }
    } else {
      const { error: ownerAssignmentError } = await context.supabase.rpc("manage_property_owner_assignment", {
        p_property_id: hotelId,
        p_owner_id: userId,
        p_actor_id: context.actor.userId,
        p_assignment: ownershipAssignment === "co_owner" ? "co_owner_add" : ownershipAssignment,
        p_expected_owner_id: ownershipAssignment === "transfer" ? expectedOwnerId : null,
      });
      if (ownerAssignmentError) throw new Error(ownerAssignmentError.message);
      if (!target.primary_hotel_id) {
        const { error: primaryError } = ownershipAssignment === "co_owner"
          ? { error: null }
          : await context.supabase.from("users")
          .update({ primary_hotel_id: hotelId, updated_at: new Date().toISOString() })
          .eq("id", userId);
        if (primaryError) throw new Error(primaryError.message);
      }
    }

    revalidatePath("/settings");
    revalidatePath("/admin");
    revalidatePath("/owner");
    revalidatePath("/manager");
    return { success: true };
  } catch (error) {
    console.error("Managed user property assignment failed:", error);
    return { success: false, error: errorMessage(error, "Unable to assign property.") };
  }
}

export async function unassignManagedUserFromHotel(userId: string, hotelId: string) {
  const context = await requireSettingsAccess("edit");
  const { data: target, error: targetError } = await context.supabase.from("users").select("id, role, primary_hotel_id").eq("id", userId).maybeSingle();
  if (targetError || !target) throw new Error("User was not found.");
  const targetRole = normalizeUserRole(target.role as ManagedUser["role"]);
  if (!["owner", "manager", "housekeeping_admin", "cleaner"].includes(targetRole)) {
    throw new Error("This account type cannot be unassigned from a property.");
  }
  await assertTargetScope(userId, targetRole, [hotelId], context);
  const hotel = context.visibleHotels.find((item) => item.id === hotelId);
  if (!hotel) throw new Error("That hotel is outside your management scope.");
  if (["manager", "housekeeping_admin", "hk_admin", "cleaner"].includes(targetRole)) {
    const { data: assignment, error: assignmentError } = await context.supabase
      .from("user_hotel_assignments")
      .delete()
      .eq("user_id", userId)
      .eq("hotel_id", hotelId)
      .select("hotel_id")
      .maybeSingle();
    if (assignmentError) throw new Error(assignmentError.message);
    if (!assignment && target.primary_hotel_id !== hotelId) throw new Error("This hotel is not assigned to that user.");
    if (target.primary_hotel_id === hotelId) {
      const { data: remaining, error: remainingError } = await context.supabase
        .from("user_hotel_assignments")
        .select("hotel_id")
        .eq("user_id", userId)
        .order("is_primary", { ascending: false })
        .order("created_at")
        .limit(1)
        .maybeSingle();
      if (remainingError) throw new Error(remainingError.message);
      const { error } = await context.supabase.from("users").update({ primary_hotel_id: remaining?.hotel_id ?? null }).eq("id", userId);
      if (error) throw new Error(error.message);
      if (remaining) {
        const { error: primaryError } = await context.supabase.from("user_hotel_assignments")
          .update({ is_primary: true })
          .eq("user_id", userId)
          .eq("hotel_id", remaining.hotel_id);
        if (primaryError) throw new Error(primaryError.message);
      }
    }
    if (targetRole === "manager" && hotel.manager_id === userId) {
      const { error } = await context.supabase.from("hotels").update({ manager_id: null }).eq("id", hotelId);
      if (error) throw new Error(error.message);
    }
  } else if (targetRole === "owner") {
    if (!isPlatformAdmin(context.actor.role)) throw new Error("Only a Platform Admin can manage property owner assignments.");
    const assignment = hotel.owner_id === userId ? "primary_remove" : "co_owner_remove";
    const { error } = await context.supabase.rpc("manage_property_owner_assignment", {
      p_property_id: hotelId,
      p_owner_id: userId,
      p_actor_id: context.actor.userId,
      p_assignment: assignment,
      p_expected_owner_id: null,
    });
    if (error) throw new Error(error.message);
  } else {
    const currentAssignee = hotel.manager_id;
    if (currentAssignee !== userId) throw new Error("This hotel is not assigned to that user.");
    const { error } = await context.supabase.from("hotels").update({ manager_id: null }).eq("id", hotelId);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/settings");
  revalidatePath("/admin");
  revalidatePath("/owner");
  revalidatePath("/manager");
}

export type PropertyInput = { name: string; location: string; latitude: number | null; longitude: number | null; roomCount: number; floorCount: number; managerId: string | null };
export type ServiceInput = {
  hotelId: string;
  name: string;
  description: string;
  serviceCategory: string;
  billingModel: BillingModel;
  billingUnitLabel: string;
  defaultRate: number;
  benchmarkQuantity: number | null;
  spatialMode: SpatialMode;
  requiresAssetReference: boolean;
  checklist: ChecklistBlueprint;
  isActive: boolean;
};

async function requireTenantAssetAccess(action: FeatureAction) {
  const context = await requireSettingsAccess(action);
  if (!isPlatformAdmin(context.actor.role) && context.actor.role !== "owner") {
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
  const latitude = input.latitude === null ? null : Number(input.latitude);
  const longitude = input.longitude === null ? null : Number(input.longitude);
  if ((latitude === null) !== (longitude === null)
    || (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90))
    || (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))) {
    throw new Error("Choose a valid map location or clear both GPS coordinates.");
  }
  return { name, location, latitude, longitude, roomCount: input.roomCount, floorCount: input.floorCount, managerId: input.managerId || null };
}

async function resolveRequiredPropertyCoordinates(values: ReturnType<typeof validateProperty>) {
  if (values.latitude !== null && values.longitude !== null) return values;
  const coordinates = await geocodePropertyAddress(values.location);
  if (!coordinates) {
    throw new Error("We couldn't find coordinates for this address. Use the map picker to set the property's exact location.");
  }
  return { ...values, ...coordinates };
}

export async function resolveOwnedPropertyCoordinates(propertyId: string): Promise<
  { success: true; latitude: number; longitude: number } | { success: false; error: string }
> {
  try {
    const context = await requireTenantAssetAccess("edit");
    const hotel = context.visibleHotels.find((item) => item.id === propertyId);
    if (!hotel) throw new Error("Property not found in your account.");
    if (hotel.latitude !== null && hotel.longitude !== null) {
      return { success: true, latitude: hotel.latitude, longitude: hotel.longitude };
    }
    const coordinates = await geocodePropertyAddress(hotel.location);
    if (!coordinates) {
      throw new Error("We couldn't find coordinates for this address. Use the map picker to set the property's exact location.");
    }
    const query = context.supabase.from("hotels")
      .update({ latitude: coordinates.latitude, longitude: coordinates.longitude })
      .eq("id", propertyId)
      .is("archived_at", null)
      .or("latitude.is.null,longitude.is.null")
      .select("id");
    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Property was not found or its location was already updated.");
    revalidatePath("/settings");
    return { success: true, ...coordinates };
  } catch (error) {
    console.error("Property coordinate recovery failed:", error);
    return { success: false, error: errorMessage(error, "Unable to resolve this property's map location.") };
  }
}

async function validateManagerAssignment(
  managerId: string | null,
  context: Awaited<ReturnType<typeof requireTenantAssetAccess>>
) {
  if (!managerId) return;
  const { data: manager, error } = await context.supabase
    .from("users")
    .select("id, primary_hotel_id, is_active")
    .eq("id", managerId)
    .eq("role", "manager")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!manager || !manager.is_active) throw new Error("Select an active manager account.");
  if (!isPlatformAdmin(context.actor.role) && !context.visibleHotels.some((hotel) =>
    hotel.manager_id === manager.id || hotel.id === manager.primary_hotel_id
  )) {
    throw new Error("Select a manager assigned to one of your properties.");
  }
}

function validateService(input: ServiceInput) {
  const name = input.name.trim();
  const description = input.description.trim();
  const serviceCategory = input.serviceCategory.trim();
  const billingUnitLabel = input.billingUnitLabel.trim();
  if (!name || name.length > 120) throw new Error("Enter a service name up to 120 characters.");
  if (description.length > 1000) throw new Error("Service description must be 1,000 characters or fewer.");
  if (serviceCategory.length > 80) throw new Error("Service category must be 80 characters or fewer.");
  if (!["duration", "quantity", "fixed"].includes(input.billingModel)) throw new Error("Choose a valid billing model.");
  if (!["units", "open_zone", "general"].includes(input.spatialMode)) throw new Error("Choose a valid work area mode.");
  if (billingUnitLabel.length > 40 || (input.billingModel === "quantity" && !billingUnitLabel)) {
    throw new Error("Enter a unit label of 1 to 40 characters for quantity-based services.");
  }
  if (input.benchmarkQuantity !== null
    && (!Number.isFinite(input.benchmarkQuantity) || input.benchmarkQuantity < 0 || input.benchmarkQuantity > 1_000_000_000)) {
    throw new Error("Enter a valid non-negative benchmark quantity.");
  }
  if (typeof input.requiresAssetReference !== "boolean" || typeof input.isActive !== "boolean") {
    throw new Error("Choose valid service options.");
  }
  if (!input.checklist || !Array.isArray(input.checklist.items) || input.checklist.items.length > 20
    || input.checklist.items.some((item) => typeof item !== "string" || !item.trim() || item.trim().length > 160)
    || typeof input.checklist.requirePhoto !== "boolean") {
    throw new Error("Checklist blueprints allow up to 20 items of 160 characters each.");
  }
  if (!Number.isFinite(input.defaultRate) || input.defaultRate < 0 || input.defaultRate > 1_000_000) {
    throw new Error("Enter a valid non-negative service rate.");
  }
  if (typeof input.hotelId !== "string" || !input.hotelId) throw new Error("Choose a property for this service.");
  return {
    hotelId: input.hotelId,
    name,
    description,
    serviceCategory: serviceCategory || null,
    billingModel: input.billingModel,
    billingUnitLabel: billingUnitLabel || null,
    defaultRate: input.defaultRate,
    benchmarkQuantity: input.benchmarkQuantity,
    spatialMode: input.spatialMode,
    requiresAssetReference: input.requiresAssetReference,
    checklist: {
      items: [...new Set(input.checklist.items.map((item) => item.trim()).filter(Boolean))],
      requirePhoto: input.checklist.requirePhoto,
    },
    isActive: input.isActive,
    unit: input.billingModel === "duration" ? "hourly" : input.billingModel === "fixed" ? "fixed" : "per_room",
  };
}

export async function createOwnedProperty(input: PropertyInput): Promise<ActionResult> {
  try {
    const context = await requireTenantAssetAccess("create");
    const values = await resolveRequiredPropertyCoordinates(validateProperty(input));
    await validateManagerAssignment(values.managerId, context);
    const { error } = await context.supabase.from("hotels").insert({
      name: values.name,
      location: values.location,
      latitude: values.latitude,
      longitude: values.longitude,
      room_count: values.roomCount,
      total_rooms: values.roomCount,
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
    const values = await resolveRequiredPropertyCoordinates(validateProperty(input));
    await validateManagerAssignment(values.managerId, context);
    if (!context.visibleHotels.some((hotel) => hotel.id === propertyId)) {
      throw new Error("Property not found in your account.");
    }
    const roomStats = await getActiveRoomStats(context.supabase, propertyId);
    const roomCount = roomStats.roomCount || values.roomCount;
    const floorCount = roomStats.floorCount || values.floorCount;
    const query = context.supabase
      .from("hotels")
      .update({ name: values.name, location: values.location, latitude: values.latitude, longitude: values.longitude, room_count: roomCount, total_rooms: roomCount, floor_count: floorCount, manager_id: values.managerId })
      .eq("id", propertyId)
      .is("archived_at", null);
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
    if (!isPlatformAdmin(context.actor.role) && !context.visibleHotels.some((hotel) => hotel.id === propertyId)) {
      throw new Error("Property not found in your account.");
    }
    const query = context.supabase.from("hotels")
      .update({ is_active: false, archived_at: new Date().toISOString() })
      .eq("id", propertyId)
      .is("archived_at", null);
    const { data, error } = await query.select("id").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Property not found in your account.");
    for (const path of ["/settings", "/admin", "/owner", "/manager", "/dashboard", "/hk-admin"]) revalidatePath(path);
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
    if (!hotel || (!isPlatformAdmin(context.actor.role) && !context.visibleHotels.some((property) => property.id === hotel.id))) throw new Error("Property not found in your account.");
    const { error } = await context.supabase.from("services_config").insert({
      hotel_id: hotel.id,
      name: values.name,
      description: values.description,
      unit: values.unit,
      default_rate: values.defaultRate,
      service_category: values.serviceCategory,
      billing_model: values.billingModel,
      billing_unit_label: values.billingUnitLabel,
      benchmark_quantity: values.benchmarkQuantity,
      spatial_mode: values.spatialMode,
      requires_asset_reference: values.requiresAssetReference,
      checklist_blueprint: values.checklist.items.length || values.checklist.requirePhoto ? values.checklist : null,
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
    if (!hotel || (!isPlatformAdmin(context.actor.role) && !context.visibleHotels.some((property) => property.id === hotel.id))) throw new Error("Property not found in your account.");
    let query = context.supabase
      .from("services_config")
      .update({
        hotel_id: hotel.id,
        name: values.name,
        description: values.description,
        unit: values.unit,
        default_rate: values.defaultRate,
        service_category: values.serviceCategory,
        billing_model: values.billingModel,
        billing_unit_label: values.billingUnitLabel,
        benchmark_quantity: values.benchmarkQuantity,
        spatial_mode: values.spatialMode,
        requires_asset_reference: values.requiresAssetReference,
        checklist_blueprint: values.checklist.items.length || values.checklist.requirePhoto ? values.checklist : null,
        is_active: values.isActive,
        updated_at: new Date().toISOString(),
      })
      .eq("id", serviceId);
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
    if (!isPlatformAdmin(context.actor.role) && !context.visibleHotels.some((hotel) => hotel.id === hotelId)) {
      throw new Error("Service not found in your account.");
    }
    const query = context.supabase
      .from("services_config")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", serviceId)
      .eq("hotel_id", hotelId);
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
