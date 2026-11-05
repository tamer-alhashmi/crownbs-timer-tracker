"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock3, LocateFixed, Loader2 } from "lucide-react";
import { showActionToast } from "@/components/ui/ActionToast";
import { formatUserMessage } from "@/lib/userMessages";
import { clockInToAssignedProperty, clockOutWorkforceShift, getCurrentWorkforceShift } from "@/app/actions/shiftActions";
import type { UserRole } from "@/lib/roles";

type PropertyOption = { id: string; name: string; latitude: number | null; longitude: number | null };
export type WorkforceShift = { id: string; hotel_id: string | null; start_time: string };
type Shift = WorkforceShift | null;

function getDeviceLocation(): Promise<{ latitude: number; longitude: number; accuracy: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Location services are not available in this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy }),
      (error) => {
        const message = error.code === error.PERMISSION_DENIED
          ? "Allow location access in your browser to clock in."
          : error.code === error.TIMEOUT
            ? "Could not get a GPS lock in time. Move to a clearer area and try again."
            : "Your location is unavailable. Check location services and try again.";
        reject(new Error(message));
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  });
}

export function ShiftDock({
  role,
  properties,
  hasActiveTask = false,
  initialShift,
  visible = true,
  onShiftChange,
}: {
  role: UserRole | string;
  properties: PropertyOption[];
  hasActiveTask?: boolean;
  initialShift?: Shift;
  visible?: boolean;
  onShiftChange?: (shift: Shift) => void;
}) {
  const router = useRouter();
  const [shift, setShift] = useState<Shift>(initialShift ?? null);
  const [propertyId, setPropertyId] = useState(initialShift?.hotel_id ?? properties[0]?.id ?? "");
  const [isLoading, setIsLoading] = useState(!initialShift);
  const [isPending, setIsPending] = useState(false);
  const onShiftChangeRef = useRef(onShiftChange);

  useEffect(() => {
    onShiftChangeRef.current = onShiftChange;
  }, [onShiftChange]);

  useEffect(() => {
    if (initialShift) return;
    let active = true;
    getCurrentWorkforceShift().then((result) => {
      if (active) {
        setShift(result);
        onShiftChangeRef.current?.(result);
        if (result?.hotel_id) setPropertyId(result.hotel_id);
      }
    }).catch((error: unknown) => {
      if (active) showActionToast("error", formatUserMessage(error, "Unable to load your active shift."));
    }).finally(() => {
      if (active) setIsLoading(false);
    });
    return () => { active = false; };
  }, [initialShift]);

  const clockIn = async () => {
    if (isPending) return;
    if (!propertyId) {
      showActionToast("error", "Select an assigned property before clocking in.");
      return;
    }
    const property = properties.find((item) => item.id === propertyId);
    if (!property || property.latitude === null || property.longitude === null) {
      showActionToast("error", "This property needs a saved map location before staff can clock in.");
      return;
    }
    setIsPending(true);
    try {
      const location = await getDeviceLocation();
      const started = await clockInToAssignedProperty(propertyId, location);
      setShift(started);
      onShiftChangeRef.current?.(started);
      showActionToast("success", `Clocked in at ${property.name}.`);
      router.refresh();
    } catch (error) {
      showActionToast("error", formatUserMessage(error, "Unable to clock in."));
    } finally {
      setIsPending(false);
    }
  };

  const clockOut = async () => {
    if (isPending) return;
    setIsPending(true);
    try {
      await clockOutWorkforceShift();
      setShift(null);
      onShiftChangeRef.current?.(null);
      showActionToast("success", "Your shift has ended.");
      router.refresh();
    } catch (error) {
      showActionToast("error", formatUserMessage(error, "Unable to clock out."));
    } finally {
      setIsPending(false);
    }
  };

  if (!visible) return null;
  const selectedProperty = properties.find((item) => item.id === propertyId);
  const propertySelect = <label className="min-w-0 flex-1 text-xs font-semibold text-ink-secondary">
    Property for this shift
    <select value={propertyId} disabled={Boolean(shift) || isPending || isLoading} onChange={(event) => setPropertyId(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-line bg-surface-secondary px-3 text-sm text-ink">
      {!properties.length && <option value="">No assigned properties</option>}
      {properties.map((property) => <option key={property.id} value={property.id}>{property.name}{property.latitude === null || property.longitude === null ? " · Location required" : ""}</option>)}
    </select>
  </label>;
  const clockInButton = <button type="button" disabled={isLoading || isPending || Boolean(shift) || !properties.length || hasActiveTask} onClick={clockIn} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-600/20 px-4 text-sm font-semibold text-emerald-700 hover:bg-emerald-600/30 disabled:cursor-not-allowed disabled:opacity-50 dark:text-emerald-400">
    {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}Clock in
  </button>;
  const clockOutButton = <button type="button" disabled={isLoading || isPending || !shift || hasActiveTask} onClick={clockOut} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-rose-500/30 bg-rose-600/20 px-4 text-sm font-semibold text-rose-700 hover:bg-rose-600/30 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-400">
    {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock3 className="h-4 w-4" />}Clock out
  </button>;

  return <section aria-label={`${role.replaceAll("_", " ")} shift controls`} className="rounded-2xl border border-line bg-surface p-4 text-ink shadow-sm">
    <div className="hidden items-end gap-3 md:flex">
      {!shift && propertySelect}
      {shift && <p className="min-w-0 flex-1 text-sm text-ink-secondary">{selectedProperty?.name ?? "Active property"} · Shift started {new Date(shift.start_time).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</p>}
      {clockInButton}{clockOutButton}
    </div>
    <div className="md:hidden">
      {!shift && propertySelect}
      {shift && <p className="mb-2 text-xs font-medium text-ink-secondary">{selectedProperty?.name ?? "Active property"} · On shift</p>}
      <div className="mt-2 flex gap-2">{clockInButton}{clockOutButton}</div>
    </div>
    {hasActiveTask && <p className="mt-2 text-xs text-ink-muted">Finish your active task before clocking out.</p>}
  </section>;
}
