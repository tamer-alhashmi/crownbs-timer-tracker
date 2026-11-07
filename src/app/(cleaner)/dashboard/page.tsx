import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";
import CleanerDashboard from "./CleanerDashboard";
import type { RoomMediaItem } from "./roomMediaActions";
import { getCleanerOperationalBrief } from "@/lib/operationalBrief";
import { getPropertyOwnerIds } from "@/lib/propertyOwnership";

export default async function CleanerDashboardPage() {
  const user = await getSessionUser();

  if (!user || user.role !== "cleaner") {
    redirect("/login");
  }

  const supabase = createPrivilegedServerSupabaseClient();
  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("full_name, avatar_url, primary_hotel_id")
    .eq("id", user.userId)
    .maybeSingle();
  if (profileError || !profile) {
    throw new Error(profileError?.message ?? "Your account does not have an assigned property.");
  }
  const { data: assignments, error: assignmentsError } = await supabase
    .from("user_hotel_assignments")
    .select("hotel_id")
    .eq("user_id", user.userId);
  if (assignmentsError) throw new Error(assignmentsError.message);
  const assignedHotelIds = [...new Set([
    ...(assignments ?? []).map((assignment) => assignment.hotel_id),
    ...(profile.primary_hotel_id ? [profile.primary_hotel_id] : []),
  ])];
  if (!assignedHotelIds.length) throw new Error("Your account does not have an assigned property.");
  const { data: shift, error: shiftError } = await supabase.from("master_shifts")
    .select("id, hotel_id, role_at_shift, start_time, end_time, status")
    .eq("user_id", user.userId)
    .eq("status", "active")
    .is("end_time", null)
    .order("start_time", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (shiftError) throw new Error(shiftError.message);
  const { data: hotels, error: hotelError } = await supabase
    .from("hotels")
    .select("id, name, location, owner_id, latitude, longitude")
    .in("id", assignedHotelIds)
    .eq("is_active", true)
    .is("archived_at", null)
    .order("name");
  if (hotelError || !hotels?.length) throw new Error(hotelError?.message ?? "Your assigned properties are unavailable.");
  const hotel = hotels.find((item) => item.id === shift?.hotel_id)
    ?? hotels.find((item) => item.id === user.hotelId)
    ?? hotels.find((item) => item.id === profile.primary_hotel_id)
    ?? hotels[0];
  const propertyOwners = await getPropertyOwnerIds(supabase, assignedHotelIds);
  const serviceOwnerIds = propertyOwners.get(hotel.id) ?? [];
  let servicesQuery = supabase.from("services_config").select("id, hotel_id, name, description, default_rate, unit, service_category, billing_model, billing_unit_label, benchmark_quantity, spatial_mode, requires_asset_reference, checklist_blueprint").eq("is_active", true);
  const serviceFilters = [`hotel_id.eq.${hotel.id}`, "and(hotel_id.is.null,owner_id.is.null)"];
  if (serviceOwnerIds.length) serviceFilters.push(`and(hotel_id.is.null,owner_id.in.(${serviceOwnerIds.join(",")}))`);
  servicesQuery = servicesQuery.or(serviceFilters.join(","));
  const [{ data: services, error: servicesError }, { data: rooms, error: roomsError }, { data: levels, error: levelsError }, { data: logs }, brief] = await Promise.all([
    servicesQuery.order("name"),
    supabase.from("rooms").select("id, hotel_id, room_name, category, floor_section, level_id").in("hotel_id", assignedHotelIds).eq("status", "active").order("floor_section").order("room_name"),
    supabase.from("property_levels").select("id, hotel_id, name, sort_order").in("hotel_id", assignedHotelIds).order("sort_order").order("name"),
    supabase
      .from("work_logs")
      .select("id, shift_id, hotel_id, service_id, start_time, end_time, task_date, status, rooms_completed, room_ids, room_number, room_numbers, notes, cost_override, manager_approved, owner_approved, is_locked, owner_id, owner_name, manager_id, manager_name, responsibility_recorded_at, service_name_snapshot, service_description_snapshot, dispatch_metadata, service_blueprint_snapshot, billable_quantity, execution_checklist")
      .eq("user_id", user.userId)
      .is("deleted_at", null)
      .is("cancelled_at", null)
      .order("task_date", { ascending: false })
      .order("start_time", { ascending: false }),
    getCleanerOperationalBrief(user.userId),
  ]);
  if (servicesError) throw new Error(servicesError.message);
  if (roomsError) throw new Error(roomsError.message);
  if (levelsError && levelsError.code !== "PGRST205") throw new Error(levelsError.message);

  const activeLog = (logs ?? []).find((log) => log.status === "active");
  let roomMediaConfigured = true;
  let roomMedia: RoomMediaItem[] = [];
  if (activeLog) {
    const { data: mediaRows, error: mediaError } = await supabase
      .from("room_media")
      .select("id, work_log_id, room_id, bucket_id, storage_path, media_type, content_type, original_name, file_size_bytes, uploaded_by, created_at")
      .eq("work_log_id", activeLog.id)
      .order("created_at", { ascending: false });
    if (mediaError) {
      roomMediaConfigured = false;
    } else {
      const signedItems = await Promise.all((mediaRows ?? []).map(async (item) => {
        const { data: signed, error } = await supabase.storage.from(item.bucket_id).createSignedUrl(item.storage_path, 86_400);
        if (error || !signed) return null;
        return { ...item, signed_url: signed.signedUrl } as RoomMediaItem;
      }));
      roomMedia = signedItems.filter((item): item is RoomMediaItem => item !== null);
    }
  }

  const hotelById = new Map<string, string>(hotels.map((assignedHotel) => [assignedHotel.id, assignedHotel.name]));
  const serviceById = new Map((services ?? []).map((service) => [service.id, service.name]));
  const logsWithNames = (logs ?? []).map((log) => ({
    ...log,
    hotelName: hotelById.get(log.hotel_id) ?? "Hotel",
    serviceName: log.service_name_snapshot ?? serviceById.get(log.service_id) ?? "Service",
    serviceDescription: log.service_description_snapshot ?? log.service_name_snapshot ?? serviceById.get(log.service_id) ?? "Service",
    serviceRate: Number(services?.find((service) => service.id === log.service_id)?.default_rate ?? 0),
    serviceUnit: services?.find((service) => service.id === log.service_id)?.unit ?? "hourly",
  }));

  return (
    <CleanerDashboard
      user={{ fullName: profile.full_name ?? user.email, email: user.email, hotelId: hotel.id, avatarUrl: profile.avatar_url ?? null }}
      hotels={hotels}
      services={services ?? []}
      rooms={rooms ?? []}
      levels={levels ?? []}
      shift={shift}
      logs={logsWithNames}
      brief={brief}
      roomMedia={roomMedia}
      roomMediaConfigured={roomMediaConfigured}
    />
  );
}
