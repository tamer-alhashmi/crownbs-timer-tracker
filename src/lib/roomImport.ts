import { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";

const spreadsheetId = "1rJp7Jza0By3cIz4XwrniaQGxHuM4T6gqwPQTUDktu20";
const sheetName = "Rooms_Categories";
const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&sheet=${encodeURIComponent(sheetName)}`;

export type RoomImportResult = {
  rowsRead: number;
  hotelsCreated: number;
  roomsUpserted: number;
  skippedRows: number;
};

type RoomRow = {
  property: string;
  roomName: string;
  category: string;
  maxCapacity: number;
  adult: number;
  children: number;
  bedroom: number;
  bedConfigs: string;
  photos: string;
  amenities: string;
  status: string;
};

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    const next = csv[index + 1];
    if (character === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    if (row.some((value) => value.trim())) rows.push(row);
  }
  return rows;
}

function numberValue(value: string | undefined) {
  const parsed = Number.parseInt((value ?? "").replace(/[^0-9-]/g, ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeRow(values: string[]): RoomRow | null {
  const [property, roomName, category, maxCapacity, adult, children, bedroom, bedConfigs, photos, amenities, status] = values.map((value) => value.trim());
  if (!property || !roomName) return null;
  return {
    property,
    roomName,
    category: category ?? "",
    maxCapacity: numberValue(maxCapacity),
    adult: numberValue(adult),
    children: numberValue(children),
    bedroom: numberValue(bedroom),
    bedConfigs: bedConfigs ?? "",
    photos: photos ?? "",
    amenities: amenities ?? "",
    status: status || "active",
  };
}

export async function syncRoomsFromGoogleSheet(): Promise<RoomImportResult> {
  const response = await fetch(csvUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`Google Sheets export failed with HTTP ${response.status}.`);

  const rows = parseCsv(await response.text());
  if (rows.length < 2) throw new Error("The Rooms_Categories sheet has no data rows.");

  const header = rows[0].map((value) => value.toLowerCase());
  const expected = ["property", "room", "category", "max capacity", "adult", "children", "bedroom", "bed configs", "photos", "amenities", "status"];
  if (expected.some((name, index) => header[index] !== name)) {
    throw new Error("Rooms_Categories columns A-K do not match the expected sheet layout.");
  }

  const normalizedRows = rows.slice(1).map(normalizeRow);
  const validRows = normalizedRows.filter((row): row is RoomRow => row !== null);
  const skippedRows = normalizedRows.length - validRows.length;
  const supabase = createPrivilegedServerSupabaseClient();
  const propertyNames = [...new Set(validRows.map((row) => row.property))];
  const { data: existingHotels, error: hotelReadError } = await supabase.from("hotels").select("id, name").in("name", propertyNames);
  if (hotelReadError) throw new Error(hotelReadError.message);

  const hotelsByName = new Map((existingHotels ?? []).map((hotel) => [hotel.name.trim().toLowerCase(), hotel.id]));
  let hotelsCreated = 0;
  for (const property of propertyNames) {
    const key = property.toLowerCase();
    if (hotelsByName.has(key)) continue;
    const { data: createdHotel, error } = await supabase.from("hotels").insert({ name: property, location: "UK - Default Location", is_active: true }).select("id").single();
    if (error || !createdHotel) throw new Error(error?.message ?? `Unable to create hotel ${property}.`);
    hotelsByName.set(key, createdHotel.id);
    hotelsCreated += 1;
  }

  const roomPayload = validRows.map((row) => ({
    hotel_id: hotelsByName.get(row.property.toLowerCase()),
    room_name: row.roomName,
    category: row.category,
    max_capacity: row.maxCapacity,
    adult: row.adult,
    children: row.children,
    bedroom: row.bedroom,
    bed_configs: row.bedConfigs,
    photos: row.photos,
    amenities: row.amenities,
    status: row.status,
    updated_at: new Date().toISOString(),
  }));
  const { error: roomError } = await supabase.from("rooms").upsert(roomPayload, { onConflict: "hotel_id,room_name,category" });
  if (roomError) throw new Error(roomError.message);
  return { rowsRead: validRows.length, hotelsCreated, roomsUpserted: roomPayload.length, skippedRows };
}
