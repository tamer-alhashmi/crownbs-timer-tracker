"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L, { type LeafletEvent, type LeafletMouseEvent, type LatLng } from "leaflet";
import { Crosshair, LoaderCircle, MapPin, X } from "lucide-react";

type Coordinates = { lat: number; lng: number };

type Props = {
  onCancel: () => void;
  onConfirm: (location: string) => void;
};

const DEFAULT_CENTER: Coordinates = { lat: 51.5074, lng: -0.1278 };

const locationPin = L.divIcon({
  className: "",
  html: '<div class="location-picker-marker"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg></div>',
  iconSize: [36, 44],
  iconAnchor: [18, 42],
});

function MapInteractions({
  position,
  onPositionChange,
  onTileLoad,
  onTileError,
}: {
  position: Coordinates;
  onPositionChange: (position: Coordinates) => void;
  onTileLoad: () => void;
  onTileError: () => void;
}) {
  const map = useMap();
  useEffect(() => {
    map.setView(position, map.getZoom(), { animate: true });
  }, [map, position]);

  useMapEvents({
    click(event: LeafletMouseEvent) {
      onPositionChange({ lat: event.latlng.lat, lng: event.latlng.lng });
    },
  });

  const handleMarkerDrag = useCallback((event: LeafletEvent) => {
    const marker = event.target as L.Marker;
    const point: LatLng = marker.getLatLng();
    onPositionChange({ lat: point.lat, lng: point.lng });
  }, [onPositionChange]);

  return (
    <>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        eventHandlers={{ load: onTileLoad, tileerror: onTileError }}
      />
      <Marker
        position={position}
        icon={locationPin}
        draggable
        eventHandlers={{ dragend: handleMarkerDrag }}
      />
    </>
  );
}

function LocateMeControl({ onLocate }: { onLocate: () => void }) {
  return (
    <button
      type="button"
      onClick={onLocate}
      className="absolute right-3 top-3 z-[500] inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-md hover:bg-slate-50"
    >
      <Crosshair className="h-4 w-4 text-sky-700" />
      Locate Me
    </button>
  );
}

function formatAddress(address: Record<string, string>, displayName?: string) {
  const street = [address.house_number, address.road].filter(Boolean).join(" ");
  const locality =
    address.neighbourhood ||
    address.suburb ||
    address.city_district ||
    address.city ||
    address.town ||
    address.village ||
    address.municipality;
  const city = address.city || address.town || address.village || address.municipality;
  const parts = [street, locality && locality !== street ? locality : "", city, address.state, address.postcode, address.country]
    .filter((part, index, all): part is string => Boolean(part) && all.indexOf(part) === index);
  return parts.length ? parts.join(", ") : displayName?.trim() || "";
}

export default function MapLocationPicker({ onCancel, onConfirm }: Props) {
  const [position, setPosition] = useState(DEFAULT_CENTER);
  const [gpsStatus, setGpsStatus] = useState("");
  const [tileLoading, setTileLoading] = useState(true);
  const [geocoding, setGeocoding] = useState(false);
  const [error, setError] = useState("");
  const [mapReady, setMapReady] = useState(false);

  const locateMe = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsStatus("Location services are not available. The map is centered on London.");
      return;
    }
    setGpsStatus("Finding your location...");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const current = { lat: coords.latitude, lng: coords.longitude };
        setPosition(current);
        setGpsStatus("Your location is selected. You can adjust the pin on the map.");
      },
      () => setGpsStatus("Unable to access your location. You can choose a location on the map."),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }, []);

  const mapEventCallbacks = useMemo(() => ({
    onPositionChange: (next: Coordinates) => {
      setPosition(next);
      setGpsStatus("Pin selected. Drag it or click the map to adjust the location.");
      setError("");
    },
    onTileLoad: () => setTileLoading(false),
    onTileError: () => setTileLoading(false),
  }), []);

  const confirmLocation = async () => {
    setGeocoding(true);
    setError("");
    try {
      const params = new URLSearchParams({
        format: "jsonv2",
        lat: String(position.lat),
        lon: String(position.lng),
        addressdetails: "1",
      });
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, {
        headers: { "Accept-Language": "en" },
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) throw new Error("The address lookup service is unavailable.");
      const result: { address?: Record<string, string>; display_name?: string } = await response.json();
      const address = formatAddress(result.address ?? {}, result.display_name);
      if (!address) throw new Error("No address was found for this pin. Try moving it to a nearby street.");
      onConfirm(address);
    } catch (lookupError) {
      console.error("[Property Location Picker]:", lookupError);
      setError(lookupError instanceof Error && lookupError.message.startsWith("No address")
        ? lookupError.message
        : "Unable to find an address for this location. Please try again or enter the address manually.");
    } finally {
      setGeocoding(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/55 p-3 sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !geocoding) onCancel();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="location-picker-title"
        className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-sky-50 text-sky-700"><MapPin className="h-5 w-5" /></span>
            <div>
              <h2 id="location-picker-title" className="font-bold text-slate-950">Pick Property Location</h2>
              <p className="text-xs text-slate-500">Click the map or drag the pin to the property.</p>
            </div>
          </div>
          <button type="button" onClick={onCancel} disabled={geocoding} aria-label="Close location picker" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-slate-500 hover:bg-slate-100 disabled:opacity-50">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="relative min-h-64 flex-1">
          <MapContainer
            center={DEFAULT_CENTER}
            zoom={13}
            scrollWheelZoom
            className="h-full min-h-[320px] w-full sm:min-h-[440px]"
            whenReady={() => {
              setMapReady(true);
              locateMe();
            }}
          >
            <MapInteractions
              position={position}
              onPositionChange={mapEventCallbacks.onPositionChange}
              onTileLoad={mapEventCallbacks.onTileLoad}
              onTileError={mapEventCallbacks.onTileError}
            />
          </MapContainer>
          {mapReady && <LocateMeControl onLocate={locateMe} />}
          {tileLoading && (
            <div className="pointer-events-none absolute inset-0 z-[400] flex items-center justify-center bg-white/65">
              <span className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow">
                <LoaderCircle className="h-4 w-4 animate-spin" /> Loading map…
              </span>
            </div>
          )}
        </div>

        <footer className="space-y-2 border-t border-slate-200 px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p aria-live="polite" className="text-xs text-slate-500">{gpsStatus || "Select the property location on the map."}</p>
            <p className="text-xs tabular-nums text-slate-400">{position.lat.toFixed(5)}, {position.lng.toFixed(5)}</p>
          </div>
          {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onCancel} disabled={geocoding} className="min-h-10 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
            <button type="button" onClick={confirmLocation} disabled={geocoding} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-sky-700 px-4 text-sm font-semibold text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-60">
              {geocoding && <LoaderCircle className="h-4 w-4 animate-spin" />}
              {geocoding ? "Finding address…" : "Confirm Location"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
