"use server";

import { revalidatePath } from "next/cache";
import { requireFeatureAccess, type FeatureAction } from "@/lib/featureAccess";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";
import { isPlatformAdmin, normalizeUserRole, type UserRole } from "@/lib/roles";

export type ManagedRoom = {
  id: string;
  hotel_id: string;
  room_name: string;
  floor_section: string | null;
  category: string;
  max_capacity: number;
  adults_capacity: number;
  children_capacity: number;
  bedroom_count: number;
  bed_configuration: string;
  room_amenities: string[];
  room_photos: { path: string; url: string | null }[];
  housekeeping_status: "dirty" | "in_progress" | "inspect_ready" | "clean";
  availability_status: "vacant" | "occupied" | "maintenance" | "out_of_order";
  status: string;
};

type RoomInput = {
  roomName: string;
  floorSection: string;
  category: string;
  maxCapacity: number;
  adultsCapacity: number;
  childrenCapacity: number;
  bedroomCount: number;
  bedConfiguration: string;
  amenities: string[];
  housekeepingStatus: ManagedRoom["housekeeping_status"];
  availabilityStatus: ManagedRoom["availability_status"];
};

async function getRoomContext(action: FeatureAction = "view") {
  const session = await requireFeatureAccess("settings", action);
  if (!isPlatformAdmin(session.role) && !["owner", "manager"].includes(session.role)) {
    throw new Error("Property management access is required.");
  }
  const supabase = createPrivilegedServerSupabaseClient();
  const { data: profile, error: profileError } = await supabase.from("users")
    .select("id, role")
    .eq("id", session.userId)
    .maybeSingle();
  if (profileError) throw new Error(`Unable to verify property access: ${profileError.message}`);
  if (!profile || normalizeUserRole(profile.role as UserRole) !== session.role) throw new Error("Your role could not be verified. Sign in again.");
  const { data: hotels, error } = await supabase.from("hotels")
    .select("id, owner_id, manager_id")
    .order("id");
  if (error) throw new Error(`Unable to load property access: ${error.message}`);
  const visibleHotels = (hotels ?? []).filter((hotel) =>
    isPlatformAdmin(session.role) ||
    (profile.role === "owner" ? hotel.owner_id === profile.id : hotel.manager_id === profile.id)
  );
  return { supabase, visibleHotels };
}

function roomPayload(input: RoomInput) {
  const roomName = typeof input.roomName === "string" ? input.roomName.trim() : "";
  if (!roomName || roomName.length > 120) return { error: "Enter a room name up to 120 characters." } as const;
  const capacities = [input.maxCapacity, input.adultsCapacity, input.childrenCapacity, input.bedroomCount];
  if (capacities.some((value) => !Number.isInteger(value) || value < 0 || value > 1000)) {
    return { error: "Capacity and bedroom values must be whole numbers between 0 and 1,000." } as const;
  }
  if (!["dirty", "in_progress", "inspect_ready", "clean"].includes(input.housekeepingStatus)
    || !["vacant", "occupied", "maintenance", "out_of_order"].includes(input.availabilityStatus)) {
    return { error: "Choose valid room and availability statuses." } as const;
  }
  const rawAmenities = Array.isArray(input.amenities) ? input.amenities : [];
  const amenities = [...new Set(rawAmenities.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))];
  if (amenities.some((amenity) => amenity.length > 80)) return { error: "Amenity names must be 80 characters or fewer." } as const;
  return {
    value: {
      room_name: roomName,
      floor_section: typeof input.floorSection === "string" ? input.floorSection.trim().slice(0, 120) || null : null,
      category: typeof input.category === "string" ? input.category.trim().slice(0, 120) : "",
      max_capacity: input.maxCapacity,
      adults_capacity: input.adultsCapacity,
      children_capacity: input.childrenCapacity,
      bedroom_count: input.bedroomCount,
      bed_configuration: typeof input.bedConfiguration === "string" ? input.bedConfiguration.trim().slice(0, 240) : "",
      room_amenities: amenities,
      housekeeping_status: input.housekeepingStatus,
      availability_status: input.availabilityStatus,
    },
  } as const;
}

async function assertHotelScope(hotelId: string, context: Awaited<ReturnType<typeof getRoomContext>>) {
  if (!context.visibleHotels.some((hotel) => hotel.id === hotelId)) {
    throw new Error("That property is outside your management scope.");
  }
}

function revalidateRoomViews() {
  ["/settings", "/admin", "/owner", "/manager", "/hk-admin", "/dashboard"].forEach((path) => revalidatePath(path));
}

export async function listPropertyRooms(hotelId: string): Promise<{ success: true; rooms: ManagedRoom[] } | { success: false; error: string }> {
  const context = await getRoomContext();
  await assertHotelScope(hotelId, context);
  const { data, error } = await context.supabase.from("rooms")
    .select("id, hotel_id, room_name, floor_section, category, max_capacity, adults_capacity, children_capacity, bedroom_count, bed_configuration, room_amenities, room_photos, housekeeping_status, availability_status, status")
    .eq("hotel_id", hotelId)
    .order("floor_section")
    .order("room_name");
  if (error) return { success: false, error: `Unable to load rooms: ${error.message}` };
  const rooms = await Promise.all((data ?? []).map(async (room) => {
    const photos = Array.isArray(room.room_photos) ? room.room_photos.filter((path): path is string => typeof path === "string") : [];
    const signedPhotos = await Promise.all(photos.map(async (path) => {
      const { data: signed, error: signError } = await context.supabase.storage.from("rooms").createSignedUrl(path, 3600);
      if (signError) return { path, url: null };
      return { path, url: signed.signedUrl };
    }));
    return {
      ...room,
      room_amenities: Array.isArray(room.room_amenities) ? room.room_amenities.filter((item): item is string => typeof item === "string") : [],
      room_photos: signedPhotos,
      housekeeping_status: room.housekeeping_status as ManagedRoom["housekeeping_status"],
      availability_status: room.availability_status as ManagedRoom["availability_status"],
    };
  }));
  return { success: true, rooms };
}

export async function createPropertyRoom(hotelId: string, input: RoomInput) {
  const context = await getRoomContext("create");
  await assertHotelScope(hotelId, context);
  const parsed = roomPayload(input);
  if ("error" in parsed) return { success: false as const, error: parsed.error };
  const { error } = await context.supabase.from("rooms").insert({ ...parsed.value, hotel_id: hotelId, status: "active" });
  if (error) return { success: false as const, error: error.code === "23505" ? "A room with this name and category already exists at this property." : `Unable to create room: ${error.message}` };
  revalidateRoomViews();
  return { success: true as const };
}

export async function updatePropertyRoom(roomId: string, hotelId: string, input: RoomInput) {
  const context = await getRoomContext("edit");
  await assertHotelScope(hotelId, context);
  const parsed = roomPayload(input);
  if ("error" in parsed) return { success: false as const, error: parsed.error };
  const { data, error } = await context.supabase.from("rooms")
    .update(parsed.value)
    .eq("id", roomId)
    .eq("hotel_id", hotelId)
    .select("id")
    .maybeSingle();
  if (error) return { success: false as const, error: error.code === "23505" ? "A room with this name and category already exists at this property." : `Unable to update room: ${error.message}` };
  if (!data) return { success: false as const, error: "Room not found in this property." };
  revalidateRoomViews();
  return { success: true as const };
}

export async function archivePropertyRoom(roomId: string, hotelId: string) {
  const context = await getRoomContext("delete");
  await assertHotelScope(hotelId, context);
  const { data: room, error: roomError } = await context.supabase.from("rooms")
    .select("id, room_name")
    .eq("id", roomId)
    .eq("hotel_id", hotelId)
    .maybeSingle();
  if (roomError || !room) return { success: false as const, error: roomError?.message ?? "Room not found in this property." };
  const { data: activeLogs, error: logsError } = await context.supabase.from("work_logs")
    .select("id, room_ids")
    .eq("hotel_id", hotelId)
    .in("status", ["active", "assigned"])
    .is("end_time", null)
    .is("deleted_at", null)
    .is("cancelled_at", null);
  if (logsError) return { success: false as const, error: `Unable to verify active room work: ${logsError.message}` };
  if ((activeLogs ?? []).some((log) => Array.isArray(log.room_ids) && log.room_ids.includes(roomId))) {
    return { success: false as const, error: "Resolve or reassign active work for this room before archiving it. Historical work records will be preserved." };
  }
  const { error } = await context.supabase.from("rooms")
    .update({ status: "inactive", availability_status: "out_of_order" })
    .eq("id", roomId)
    .eq("hotel_id", hotelId);
  if (error) return { success: false as const, error: `Unable to archive room: ${error.message}` };
  revalidateRoomViews();
  return { success: true as const, roomName: room.room_name };
}

export async function createPropertyRoomBatch(hotelId: string, input: Omit<RoomInput, "roomName"> & { start: number; end: number; prefix: string; padding: number }) {
  const context = await getRoomContext("create");
  await assertHotelScope(hotelId, context);
  if (!Number.isInteger(input.start) || !Number.isInteger(input.end) || input.start < 0 || input.end < input.start || input.end - input.start > 99) {
    return { success: false as const, error: "Choose a valid room range of no more than 100 rooms." };
  }
  const names = Array.from({ length: input.end - input.start + 1 }, (_, index) => `${input.prefix.trim()}${String(input.start + index).padStart(Math.min(Math.max(input.padding, 1), 8), "0")}`);
  if (names.some((name) => !name.trim() || name.length > 120)) return { success: false as const, error: "Generated room names must be between 1 and 120 characters." };
  const parsed = names.map((roomName) => roomPayload({ ...input, roomName }));
  const invalid = parsed.find((result) => "error" in result);
  if (invalid && "error" in invalid) return { success: false as const, error: invalid.error };
  const { error } = await context.supabase.from("rooms").insert(parsed.map((result) => ({
    ...("value" in result ? result.value : {}),
    hotel_id: hotelId,
    status: "active",
  })));
  if (error) return { success: false as const, error: error.code === "23505" ? "At least one generated room name and category already exists. No rooms were added." : `Unable to create rooms: ${error.message}` };
  revalidateRoomViews();
  return { success: true as const, count: names.length };
}
