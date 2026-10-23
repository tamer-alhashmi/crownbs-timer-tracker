"use server";

import { revalidatePath } from "next/cache";
import { requireFeatureAccess } from "@/lib/featureAccess";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/roles";

export type PropertyRecord = {
  id: string;
  name: string;
  location: string | null;
  owner_id: string | null;
  manager_id: string | null;
  created_at: string;
  is_active: boolean;
  latitude: number | null;
  longitude: number | null;
  floors_sections: string[];
  total_rooms: number;
};

export type RoomSetupInput = {
  room_name: string;
  floor_section: string;
  category: string;
  max_capacity: number;
  adults_capacity: number;
  children_capacity: number;
  bedroom_count: number;
  bed_configuration: string;
  amenities: string[];
  status: "active" | "inactive" | "maintenance" | "cleaning";
};
export type ConfiguredRoom = RoomSetupInput & { id: string; photos: string[] };

type PropertyInput = {
  name: string;
  location: string;
  owner_id: string;
  manager_id: string;
  latitude?: number | null;
  longitude?: number | null;
  floors_sections?: string[];
  total_rooms?: number;
  rooms?: RoomSetupInput[];
};

const PROPERTY_COLUMNS = "id, name, location, owner_id, manager_id, created_at, is_active, latitude, longitude, floors_sections, total_rooms";

async function requireAdmin(action: "create" | "edit") {
  const user = await requireFeatureAccess("settings", action);
  if (!isPlatformAdmin(user.role)) throw new Error("Only administrators can manage properties.");
  return createPrivilegedServerSupabaseClient();
}

async function validateProperty(supabase: Awaited<ReturnType<typeof requireAdmin>>, input: PropertyInput) {
  const name = input.name.trim();
  const location = input.location.trim();
  const ownerId = input.owner_id || null;
  const managerId = input.manager_id || null;
  if (!name || name.length > 120) throw new Error("Property name is required and must be 120 characters or fewer.");
  if (!location || location.length > 240) throw new Error("Property location is required and must be 240 characters or fewer.");
  if ((input.latitude !== undefined && input.latitude !== null && (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90))
    || (input.longitude !== undefined && input.longitude !== null && (!Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180))) {
    throw new Error("Property coordinates must be valid numbers.");
  }
  const floors = [...new Set((input.floors_sections ?? []).map((floor) => floor.trim()).filter(Boolean))];
  if (floors.some((floor) => floor.length > 80)) throw new Error("Floor names must be 80 characters or fewer.");
  const totalRooms = input.total_rooms ?? input.rooms?.length ?? 0;
  if (!Number.isInteger(totalRooms) || totalRooms < 0 || totalRooms > 2000) {
    throw new Error("Total rooms must be between 0 and 2,000.");
  }
  if ((input.rooms ?? []).some((room) => room.floor_section && !floors.includes(room.floor_section))) {
    throw new Error("Every room floor/section must be defined in the property floor list.");
  }

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

  return {
    values: {
      name,
      location,
      owner_id: ownerId,
      manager_id: managerId,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      floors_sections: floors,
      total_rooms: totalRooms,
    },
    rooms: input.rooms ?? [],
  };
}

async function saveRooms(supabase: Awaited<ReturnType<typeof requireAdmin>>, hotelId: string, rooms: RoomSetupInput[]) {
  const seenNames = new Set<string>();
  for (const room of rooms) {
    const name = room.room_name.trim();
    if (!name || name.length > 80 || seenNames.has(name.toLowerCase())) {
      throw new Error("Room names must be unique, non-empty, and 80 characters or fewer.");
    }
    if (!["Standard", "Suite", "Deluxe", "Studio"].includes(room.category)) throw new Error("Choose a valid room category.");
    if (!["active", "inactive", "maintenance", "cleaning"].includes(room.status)) throw new Error("Choose a valid room status.");
    seenNames.add(name.toLowerCase());
    for (const capacity of [room.max_capacity, room.adults_capacity, room.children_capacity, room.bedroom_count]) {
      if (!Number.isInteger(capacity) || capacity < 0 || capacity > 100) throw new Error("Room capacities must be whole numbers between 0 and 100.");
    }
  }
  if (!rooms.length) return;
  const rows = rooms.map((room) => ({
    hotel_id: hotelId,
    room_name: room.room_name.trim(),
    category: room.category,
    floor_section: room.floor_section || null,
    max_capacity: room.max_capacity,
    adult: room.adults_capacity,
    children: room.children_capacity,
    bedroom: room.bedroom_count,
    bed_configs: room.bed_configuration.trim(),
    amenities: room.amenities.join(", "),
    status: room.status,
    adults_capacity: room.adults_capacity,
    children_capacity: room.children_capacity,
    bedroom_count: room.bedroom_count,
    bed_configuration: room.bed_configuration.trim(),
    room_amenities: room.amenities,
  }));
  const { error } = await supabase.from("rooms").upsert(rows, { onConflict: "hotel_id,room_name,category" });
  if (error) throw new Error(`Property was saved, but room setup failed: ${error.message}`);
}

export async function getPropertyRooms(hotelId: string): Promise<ConfiguredRoom[]> {
  const supabase = await requireAdmin("edit");
  const { data, error } = await supabase.from("rooms")
    .select("id, room_name, floor_section, category, max_capacity, adult, children, bedroom, bed_configs, amenities, status, room_amenities, room_photos")
    .eq("hotel_id", hotelId)
    .order("room_name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((room) => ({
    id: room.id,
    room_name: room.room_name,
    floor_section: room.floor_section ?? "",
    category: room.category ?? "Standard",
    max_capacity: room.max_capacity,
    adults_capacity: room.adult,
    children_capacity: room.children,
    bedroom_count: room.bedroom,
    bed_configuration: room.bed_configs ?? "",
    amenities: Array.isArray(room.room_amenities)
      ? room.room_amenities.filter((amenity: unknown): amenity is string => typeof amenity === "string")
      : (room.amenities ?? "").split(",").map((amenity: string) => amenity.trim()).filter(Boolean),
    status: room.status === "inactive" || room.status === "maintenance" || room.status === "cleaning" ? room.status : "active",
    photos: Array.isArray(room.room_photos)
      ? room.room_photos.filter((photo: unknown): photo is string => typeof photo === "string")
      : [],
  }));
}

function revalidatePropertyViews() {
  for (const path of ["/admin", "/dashboard", "/settings", "/manager", "/owner"]) revalidatePath(path);
}

export async function createProperty(input: PropertyInput): Promise<PropertyRecord> {
  const supabase = await requireAdmin("create");
  const { values, rooms } = await validateProperty(supabase, input);
  const { data, error } = await supabase.from("hotels").insert(values).select(PROPERTY_COLUMNS).single();
  if (error || !data) throw new Error(error?.message ?? "Unable to create property.");
  await saveRooms(supabase, data.id, rooms);
  revalidatePropertyViews();
  return data as PropertyRecord;
}

export async function updateProperty(id: string, updates: PropertyInput & { is_active?: boolean }): Promise<PropertyRecord> {
  const supabase = await requireAdmin("edit");
  if (!id) throw new Error("Property id is required.");
  if (updates.is_active !== undefined && typeof updates.is_active !== "boolean") {
    throw new Error("Property active status must be true or false.");
  }
  const { values, rooms } = await validateProperty(supabase, updates);
  const { data, error } = await supabase.from("hotels").update({
    ...values,
    ...(updates.is_active === undefined ? {} : { is_active: updates.is_active }),
  }).eq("id", id).select(PROPERTY_COLUMNS).maybeSingle();
  if (error || !data) throw new Error(error?.message ?? "Property was not found.");
  await saveRooms(supabase, id, rooms);
  revalidatePropertyViews();
  return data as PropertyRecord;
}
