import "server-only";

export type PropertyCoordinates = { latitude: number; longitude: number };

function parseCoordinates(latitude: unknown, longitude: unknown): PropertyCoordinates | null {
  if ((typeof latitude !== "number" && typeof latitude !== "string")
    || (typeof longitude !== "number" && typeof longitude !== "string")
    || (typeof latitude === "string" && !latitude.trim())
    || (typeof longitude === "string" && !longitude.trim())) return null;
  const parsedLatitude = Number(latitude);
  const parsedLongitude = Number(longitude);
  if (!Number.isFinite(parsedLatitude) || parsedLatitude < -90 || parsedLatitude > 90
    || !Number.isFinite(parsedLongitude) || parsedLongitude < -180 || parsedLongitude > 180) return null;
  return { latitude: parsedLatitude, longitude: parsedLongitude };
}

export async function geocodePropertyAddress(address: string): Promise<PropertyCoordinates | null> {
  const query = address.trim();
  if (!query) return null;

  const googleApiKey = process.env.GOOGLE_GEOCODING_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY;
  if (googleApiKey) {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("address", query);
    url.searchParams.set("key", googleApiKey);
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
    if (!response.ok) throw new Error(`Google Geocoding request failed with status ${response.status}.`);
    const result: {
      status?: string;
      error_message?: string;
      results?: { geometry?: { location?: { lat?: unknown; lng?: unknown } } }[];
    } = await response.json();
    if (result.status === "ZERO_RESULTS") return null;
    if (result.status !== "OK") {
      throw new Error(`Google Geocoding failed: ${result.error_message ?? result.status ?? "unknown error"}.`);
    }
    const location = result.results?.[0]?.geometry?.location;
    const coordinates = location ? parseCoordinates(location.lat, location.lng) : null;
    if (!coordinates) {
      throw new Error("Google Geocoding returned invalid property coordinates.");
    }
    return coordinates;
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  const response = await fetch(url, {
    headers: {
      "Accept-Language": "en",
      "User-Agent": "CrownOperations/1.0",
    },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Address lookup failed with status ${response.status}.`);
  const results: { lat?: string; lon?: string }[] = await response.json();
  if (!results.length) return null;
  const coordinates = parseCoordinates(results[0].lat, results[0].lon);
  if (!coordinates) {
    throw new Error("Address lookup returned invalid property coordinates.");
  }
  return coordinates;
}
