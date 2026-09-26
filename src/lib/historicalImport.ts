import { readFile } from "node:fs/promises";
import path from "node:path";
import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";

type HistoricalFile = {
  hotels?: Array<{ id?: string; name: string; location?: string }>;
  cleaners?: Array<{ id?: string; email: string; full_name?: string; primary_hotel_name?: string }>;
  services?: Array<{ id?: string; name: string; default_rate?: number }>;
  rooms?: Array<{ id?: string; hotel_name: string; room_name: string; category?: string }>;
  shifts?: Array<{ external_key: string; cleaner_email: string; start_time: string; end_time?: string | null; status?: "active" | "completed" }>;
  work_logs?: Array<{
    external_key: string;
    shift_external_key?: string;
    cleaner_email: string;
    hotel_name: string;
    service_name: string;
    start_time: string;
    end_time?: string | null;
    status?: "active" | "completed";
    rooms_completed?: number;
    room_numbers?: string[];
    notes?: string;
    travel_time_included?: boolean;
    approval?: {
      manager?: { status?: "approved" | "rejected" | "pending"; approved_at?: string; rejected_at?: string };
      owner?: { status?: "approved" | "rejected" | "pending"; approved_at?: string; rejected_at?: string };
      rejection_notes?: string | null;
      locked?: boolean;
    };
  }>;
  hotel_aliases?: Record<string, string>;
};

export type HistoricalImportResult = {
  hotelsCreated: number;
  cleanersCreated: number;
  servicesCreated: number;
  roomsUpserted: number;
  shiftsCreated: number;
  logsInserted: number;
  logsSkipped: number;
  errors: string[];
};

function key(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function validDate(value: string | null | undefined, field: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${field} is not a valid timestamp.`);
  return date.toISOString();
}

function status(value: string | undefined) {
  return value === "active" ? "active" : "completed";
}

export async function importHistoricalWorkLogs(): Promise<HistoricalImportResult> {
  const filePath = path.join(process.cwd(), "data", "historical_work_logs.json");
  let source: HistoricalFile;
  try {
    source = JSON.parse(await readFile(filePath, "utf8")) as HistoricalFile;
  } catch (error) {
    throw new Error(`Unable to read data/historical_work_logs.json: ${error instanceof Error ? error.message : "invalid JSON"}`);
  }

  const result: HistoricalImportResult = { hotelsCreated: 0, cleanersCreated: 0, servicesCreated: 0, roomsUpserted: 0, shiftsCreated: 0, logsInserted: 0, logsSkipped: 0, errors: [] };
  const supabase = createPrivilegedServerSupabaseClient();
  const aliases = new Map(Object.entries(source.hotel_aliases ?? {}).map(([alias, canonical]) => [key(alias), canonical.trim()]));
  const hotelName = (name: string) => aliases.get(key(name)) ?? name.trim();
  const hotelNames = new Map<string, { name: string; location: string }>();
  for (const hotel of source.hotels ?? []) hotelNames.set(key(hotelName(hotel.name)), { name: hotelName(hotel.name), location: hotel.location?.trim() || "Imported historical property" });
  for (const cleaner of source.cleaners ?? []) if (cleaner.primary_hotel_name) { const name = hotelName(cleaner.primary_hotel_name); hotelNames.set(key(name), { name, location: "Imported historical property" }); }
  for (const log of source.work_logs ?? []) { const name = hotelName(log.hotel_name); hotelNames.set(key(name), { name, location: "Imported historical property" }); }
  for (const room of source.rooms ?? []) { const name = hotelName(room.hotel_name); hotelNames.set(key(name), { name, location: "Imported historical property" }); }

  const { data: existingHotels, error: hotelError } = await supabase.from("hotels").select("id, name");
  if (hotelError) throw new Error(hotelError.message);
  const hotels = new Map((existingHotels ?? []).map((hotel) => [key(hotel.name), hotel.id]));
  for (const hotel of hotelNames.values()) {
    if (hotels.has(key(hotel.name))) continue;
    const { data, error } = await supabase.from("hotels").insert({ name: hotel.name, location: hotel.location, is_active: true }).select("id").single();
    if (error || !data) throw new Error(`Unable to create hotel ${hotel.name}: ${error?.message ?? "unknown error"}`);
    hotels.set(key(hotel.name), data.id);
    result.hotelsCreated += 1;
  }

  const { data: existingServices, error: serviceError } = await supabase.from("services_config").select("id, name, default_rate");
  if (serviceError) throw new Error(serviceError.message);
  const services = new Map((existingServices ?? []).map((service) => [key(service.name), { id: service.id, rate: Number(service.default_rate) }]));
  for (const service of source.services ?? []) {
    if (services.has(key(service.name))) continue;
    const { data, error } = await supabase.from("services_config").insert({ name: service.name.trim(), default_rate: Number(service.default_rate ?? 0), is_active: true }).select("id, default_rate").single();
    if (error || !data) throw new Error(`Unable to create service ${service.name}: ${error?.message ?? "unknown error"}`);
    services.set(key(service.name), { id: data.id, rate: Number(data.default_rate) });
    result.servicesCreated += 1;
  }

  const { data: existingUsers, error: userError } = await supabase.from("users").select("id, email, full_name, role, primary_hotel_id");
  if (userError) throw new Error(userError.message);
  const users = new Map((existingUsers ?? []).map((user) => [key(user.email), user.id]));
  const cleanerDefinitions = new Map((source.cleaners ?? []).map((cleaner) => [key(cleaner.email), cleaner]));
  for (const log of source.work_logs ?? []) if (!cleanerDefinitions.has(key(log.cleaner_email))) cleanerDefinitions.set(key(log.cleaner_email), { email: log.cleaner_email, full_name: log.cleaner_email.split("@")[0] });
  for (const shift of source.shifts ?? []) if (!cleanerDefinitions.has(key(shift.cleaner_email))) cleanerDefinitions.set(key(shift.cleaner_email), { email: shift.cleaner_email, full_name: shift.cleaner_email.split("@")[0] });
  for (const cleaner of cleanerDefinitions.values()) {
    if (users.has(key(cleaner.email))) continue;
    const hotelId = cleaner.primary_hotel_name ? hotels.get(key(hotelName(cleaner.primary_hotel_name))) ?? null : null;
    const password = `${crypto.randomUUID()}Aa1!`;
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({ email: cleaner.email.trim().toLowerCase(), password, email_confirm: true });
    if (authError || !authData.user) throw new Error(`Unable to create cleaner ${cleaner.email}: ${authError?.message ?? "unknown error"}`);
    const { error: profileError } = await supabase.from("users").insert({ id: authData.user.id, email: cleaner.email.trim().toLowerCase(), full_name: cleaner.full_name?.trim() || cleaner.email.split("@")[0], role: "cleaner", primary_hotel_id: hotelId });
    if (profileError) throw new Error(`Unable to create cleaner profile ${cleaner.email}: ${profileError.message}`);
    users.set(key(cleaner.email), authData.user.id);
    result.cleanersCreated += 1;
  }

  for (const room of source.rooms ?? []) {
    const hotelId = hotels.get(key(hotelName(room.hotel_name)));
    if (!hotelId) { result.errors.push(`Room ${room.room_name}: hotel ${room.hotel_name} was not resolved.`); continue; }
    const { error } = await supabase.from("rooms").upsert({ hotel_id: hotelId, room_name: room.room_name.trim(), category: room.category?.trim() ?? "", status: "active", updated_at: new Date().toISOString() }, { onConflict: "hotel_id,room_name,category" });
    if (error) result.errors.push(`Room ${room.room_name}: ${error.message}`); else result.roomsUpserted += 1;
  }

  const shifts = new Map<string, string>();
  for (const shift of source.shifts ?? []) {
    try {
      const userId = users.get(key(shift.cleaner_email));
      if (!userId) throw new Error(`cleaner ${shift.cleaner_email} was not resolved`);
      const start = validDate(shift.start_time, "shift start_time");
      const end = validDate(shift.end_time, "shift end_time");
      if (!start) throw new Error("shift start_time is required");
      const { data: existing } = await supabase.from("master_shifts").select("id").eq("user_id", userId).eq("start_time", start).maybeSingle();
      if (existing) { shifts.set(shift.external_key, existing.id); continue; }
      const { data, error } = await supabase.from("master_shifts").insert({ user_id: userId, start_time: start, end_time: end, status: status(shift.status) }).select("id").single();
      if (error || !data) throw new Error(error?.message ?? "unable to create shift");
      shifts.set(shift.external_key, data.id);
      result.shiftsCreated += 1;
    } catch (error) { result.errors.push(`Shift ${shift.external_key}: ${error instanceof Error ? error.message : "invalid shift"}`); }
  }

  for (const log of source.work_logs ?? []) {
    try {
      if (!log.external_key) throw new Error("external_key is required");
      const { data: duplicate, error: duplicateError } = await supabase.from("work_logs").select("id").eq("import_key", log.external_key).maybeSingle();
      if (duplicateError) throw new Error(duplicateError.message);
      if (duplicate) { result.logsSkipped += 1; continue; }
      const userId = users.get(key(log.cleaner_email));
      const hotelId = hotels.get(key(hotelName(log.hotel_name)));
      const service = services.get(key(log.service_name));
      if (!userId) throw new Error(`cleaner ${log.cleaner_email} was not resolved`);
      if (!hotelId) throw new Error(`hotel ${log.hotel_name} was not resolved`);
      if (!service) throw new Error(`service ${log.service_name} was not resolved`);
      const start = validDate(log.start_time, "start_time");
      const end = validDate(log.end_time, "end_time");
      if (!start) throw new Error("start_time is required");
      const managerApproved = log.approval?.manager?.status === "approved";
      const ownerApproved = log.approval?.owner?.status === "approved";
      const managerRejected = log.approval?.manager?.status === "rejected";
      const ownerRejected = log.approval?.owner?.status === "rejected";
      const completed = status(log.status) === "completed";
      const locked = Boolean(log.approval?.locked) && completed && Boolean(end) && managerApproved && ownerApproved;
      const { error } = await supabase.from("work_logs").insert({ import_key: log.external_key, user_id: userId, hotel_id: hotelId, service_id: service.id, shift_id: log.shift_external_key ? shifts.get(log.shift_external_key) ?? null : null, start_time: start, end_time: end, status: status(log.status), rooms_completed: Math.max(0, Number(log.rooms_completed ?? 0)), room_number: (log.room_numbers ?? []).join(", "), notes: log.notes?.trim() ?? "", travel_time_included: Boolean(log.travel_time_included), manager_approved: managerApproved, owner_approved: ownerApproved, manager_approved_at: log.approval?.manager?.approved_at ?? null, owner_approved_at: log.approval?.owner?.approved_at ?? null, manager_rejected: managerRejected, owner_rejected: ownerRejected, manager_rejected_at: log.approval?.manager?.rejected_at ?? null, owner_rejected_at: log.approval?.owner?.rejected_at ?? null, rejection_notes: log.approval?.rejection_notes ?? null, is_locked: locked });
      if (error) throw new Error(error.message);
      result.logsInserted += 1;
    } catch (error) { result.errors.push(`Log ${log.external_key}: ${error instanceof Error ? error.message : "invalid work log"}`); }
  }
  return result;
}
