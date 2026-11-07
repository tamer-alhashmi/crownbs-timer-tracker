import "server-only";
import type { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";

type SupabaseClient = ReturnType<typeof createPrivilegedServerSupabaseClient>;

export async function getPropertyWorkforceIds(
  supabase: SupabaseClient,
  propertyIds: string[],
  roles: string[],
  requireVerifiedEmail = false,
): Promise<Map<string, string[]>> {
  if (!propertyIds.length || !roles.length) return new Map();
  const [{ data: properties, error: propertiesError }, { data: assignments, error: assignmentsError }, { data: primaryUsers, error: primaryUsersError }] = await Promise.all([
    supabase.from("hotels").select("id, manager_id").in("id", propertyIds),
    supabase.from("user_hotel_assignments").select("user_id, hotel_id").in("hotel_id", propertyIds),
    supabase.from("users")
      .select("id")
      .in("role", roles)
      .eq("is_active", true)
      .in("primary_hotel_id", propertyIds),
  ]);
  if (propertiesError || assignmentsError || primaryUsersError) {
    throw new Error(`Unable to load property workforce assignments: ${propertiesError?.message ?? assignmentsError?.message ?? primaryUsersError?.message}`);
  }
  const userIds = [...new Set([
    ...(assignments ?? []).map((assignment) => assignment.user_id),
    ...(properties ?? []).map((property) => property.manager_id).filter((id): id is string => Boolean(id)),
    ...(primaryUsers ?? []).map((user) => user.id),
  ])];
  let activeUsersQuery = supabase.from("users")
    .select("id, role, primary_hotel_id")
    .in("id", userIds)
    .in("role", roles)
    .eq("is_active", true);
  if (requireVerifiedEmail) activeUsersQuery = activeUsersQuery.eq("email_verified", true);
  const { data: activeUsers, error: activeUsersError } = userIds.length
    ? await activeUsersQuery
    : { data: [], error: null };
  if (activeUsersError) throw new Error(`Unable to verify property workforce assignments: ${activeUsersError.message}`);
  const eligibleUserIds = new Set((activeUsers ?? []).map((user) => user.id));
  const result = new Map<string, Set<string>>();
  for (const assignment of assignments ?? []) {
    if (!eligibleUserIds.has(assignment.user_id)) continue;
    const ids = result.get(assignment.hotel_id) ?? new Set<string>();
    ids.add(assignment.user_id);
    result.set(assignment.hotel_id, ids);
  }
  for (const property of properties ?? []) {
    if (!property.manager_id || !eligibleUserIds.has(property.manager_id)) continue;
    const ids = result.get(property.id) ?? new Set<string>();
    ids.add(property.manager_id);
    result.set(property.id, ids);
  }
  for (const user of activeUsers ?? []) {
    if (!user.primary_hotel_id || !propertyIds.includes(user.primary_hotel_id)) continue;
    const ids = result.get(user.primary_hotel_id) ?? new Set<string>();
    ids.add(user.id);
    result.set(user.primary_hotel_id, ids);
  }
  return new Map([...result].map(([propertyId, ids]) => [propertyId, [...ids]]));
}

export async function getManagerPropertyIds(supabase: SupabaseClient, managerId: string): Promise<string[]> {
  const { data: properties, error } = await supabase.from("hotels").select("id").is("archived_at", null);
  if (error) throw new Error(`Unable to load managed properties: ${error.message}`);
  const staffByProperty = await getPropertyWorkforceIds(
    supabase,
    (properties ?? []).map((property) => property.id),
    ["manager"],
  );
  return [...staffByProperty]
    .filter(([, managerIds]) => managerIds.includes(managerId))
    .map(([propertyId]) => propertyId);
}

export async function getOwnerPropertyIds(supabase: SupabaseClient, ownerId: string): Promise<string[]> {
  const [{ data: primaryProperties, error: primaryError }, { data: partnerProperties, error: partnerError }] = await Promise.all([
    supabase.from("hotels").select("id").eq("owner_id", ownerId).eq("is_active", true).is("archived_at", null),
    supabase.from("property_co_owners").select("property_id").eq("owner_id", ownerId).is("removed_at", null),
  ]);
  if (primaryError || partnerError) {
    throw new Error(`Unable to load co-owned properties: ${primaryError?.message ?? partnerError?.message}`);
  }
  const candidatePropertyIds = [...new Set((partnerProperties ?? []).map((property) => property.property_id))];
  if (!candidatePropertyIds.length) return [...new Set((primaryProperties ?? []).map((property) => property.id))];
  const [{ data: owner, error: ownerError }, { data: activeProperties, error: propertiesError }] = await Promise.all([
    supabase.from("users").select("id").eq("id", ownerId).eq("role", "owner").eq("is_active", true).eq("email_verified", true).maybeSingle(),
    supabase.from("hotels").select("id").in("id", candidatePropertyIds).eq("is_active", true).is("archived_at", null),
  ]);
  if (ownerError || propertiesError) {
    throw new Error(`Unable to verify co-owned properties: ${ownerError?.message ?? propertiesError?.message}`);
  }
  const verifiedPropertyIds = owner ? new Set((activeProperties ?? []).map((property) => property.id)) : new Set<string>();
  return [...new Set([
    ...(primaryProperties ?? []).map((property) => property.id),
    ...candidatePropertyIds.filter((propertyId) => verifiedPropertyIds.has(propertyId)),
  ])];
}

export async function getPropertyOwnerIds(
  supabase: SupabaseClient,
  propertyIds: string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, Set<string>>();
  if (!propertyIds.length) return new Map();
  const [{ data: properties, error: propertiesError }, { data: partners, error: partnersError }] = await Promise.all([
    supabase.from("hotels").select("id, owner_id").in("id", propertyIds),
    supabase.from("property_co_owners").select("property_id, owner_id").in("property_id", propertyIds).is("removed_at", null),
  ]);
  if (propertiesError || partnersError) {
    throw new Error(`Unable to load property owners: ${propertiesError?.message ?? partnersError?.message}`);
  }

  const partnerIds = [...new Set((partners ?? []).map((partner) => partner.owner_id))];
  const { data: verifiedPartners, error: verifiedPartnersError } = partnerIds.length
    ? await supabase.from("users")
        .select("id")
        .in("id", partnerIds)
        .eq("role", "owner")
        .eq("is_active", true)
        .eq("email_verified", true)
    : { data: [], error: null };
  if (verifiedPartnersError) throw new Error(`Unable to verify property partners: ${verifiedPartnersError.message}`);
  const verifiedPartnerIds = new Set((verifiedPartners ?? []).map((partner) => partner.id));

  for (const property of properties ?? []) {
    if (property.owner_id) {
      const owners = result.get(property.id) ?? new Set<string>();
      owners.add(property.owner_id);
      result.set(property.id, owners);
    }
  }
  for (const partner of partners ?? []) {
    if (!verifiedPartnerIds.has(partner.owner_id)) continue;
    const owners = result.get(partner.property_id) ?? new Set<string>();
    owners.add(partner.owner_id);
    result.set(partner.property_id, owners);
  }
  return new Map([...result].map(([propertyId, owners]) => [propertyId, [...owners]]));
}

export async function getVerifiedPropertyPartnerIds(
  supabase: SupabaseClient,
  propertyIds: string[],
): Promise<Set<string>> {
  if (!propertyIds.length) return new Set();
  const { data, error } = await supabase.from("property_co_owners")
    .select("owner_id, users!inner(role, is_active, email_verified)")
    .in("property_id", propertyIds)
    .is("removed_at", null)
    .eq("users.role", "owner")
    .eq("users.is_active", true)
    .eq("users.email_verified", true);
  if (error) throw new Error(`Unable to load verified property partners: ${error.message}`);
  return new Set((data ?? []).map((partner) => partner.owner_id));
}

export async function hasPropertyOwnerAccess(supabase: SupabaseClient, propertyId: string, ownerId: string): Promise<boolean> {
  const { data: property, error: propertyError } = await supabase.from("hotels")
    .select("owner_id, is_active, archived_at")
    .eq("id", propertyId)
    .maybeSingle();
  if (propertyError) throw new Error(`Unable to verify property ownership: ${propertyError.message}`);
  if (!property || !property.is_active || property.archived_at || !ownerId) return false;
  if (property.owner_id === ownerId) return true;

  const [{ data: partner, error: partnerError }, { data: owner, error: ownerError }] = await Promise.all([
    supabase.from("property_co_owners").select("owner_id").eq("property_id", propertyId).eq("owner_id", ownerId).is("removed_at", null).maybeSingle(),
    supabase.from("users").select("id").eq("id", ownerId).eq("role", "owner").eq("is_active", true).eq("email_verified", true).maybeSingle(),
  ]);
  if (partnerError || ownerError) {
    throw new Error(`Unable to verify property partner access: ${partnerError?.message ?? ownerError?.message}`);
  }
  return Boolean(partner && owner);
}
