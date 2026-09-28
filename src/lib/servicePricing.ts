export type BillingUnit = "hourly" | "per_room" | "fixed";

export type ServicePricing = {
  name?: string | null;
  unit?: string | null;
  default_rate?: number | string | null;
};

const SERVICE_DEFAULTS: Record<string, { unit: BillingUnit; rate: number }> = {
  "cleaning (hourly)": { unit: "hourly", rate: 15 },
  "cleaning (per room)": { unit: "per_room", rate: 8.5 },
  "linen distribution": { unit: "per_room", rate: 10 },
  maintenance: { unit: "hourly", rate: 18 },
  "night shift": { unit: "hourly", rate: 20 },
  "product delivery": { unit: "fixed", rate: 9.5 },
  reception: { unit: "hourly", rate: 16 },
};

export function resolveBillingUnit(unit: string | null | undefined, name = ""): BillingUnit {
  if (unit === "hourly" || unit === "per_room" || unit === "fixed") return unit;
  const fallback = SERVICE_DEFAULTS[name.trim().toLowerCase()]?.unit;
  if (fallback) return fallback;
  return /per room/i.test(name) ? "per_room" : "hourly";
}

export function resolveServiceRate(service: ServicePricing): number {
  const configuredRate = Number(service.default_rate);
  if (Number.isFinite(configuredRate) && configuredRate > 0) return configuredRate;
  return SERVICE_DEFAULTS[service.name?.trim().toLowerCase() ?? ""]?.rate ?? 12;
}

export function calculateServiceCost(hours: number, rooms: number, service: ServicePricing): number {
  const rate = resolveServiceRate(service);
  const unit = resolveBillingUnit(service.unit, service.name ?? "");
  if (unit === "per_room") return Math.max(0, rooms) * rate;
  if (unit === "fixed") return rate;
  return Math.max(0, hours) * rate;
}