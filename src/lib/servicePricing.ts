import { resolveServiceBlueprint } from "@/lib/serviceBlueprint";

export type BillingUnit = "hourly" | "per_room" | "fixed";

export type ServicePricing = {
  name?: string | null;
  description?: string | null;
  unit?: string | null;
  default_rate?: number | string | null;
  billing_model?: string | null;
  billing_unit_label?: string | null;
  benchmark_quantity?: number | string | null;
};

export type WorkLogPricingContext = {
  service_blueprint_snapshot?: unknown;
  billable_quantity?: number | string | null;
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

export function calculateServiceCost(hours: number, rooms: number, service: ServicePricing, quantity = rooms): number {
  const rate = resolveServiceRate(service);
  const billingModel = service.billing_model === "duration" || service.billing_model === "quantity" || service.billing_model === "fixed"
    ? service.billing_model
    : resolveBillingUnit(service.unit, service.name ?? "") === "fixed"
      ? "fixed"
      : resolveBillingUnit(service.unit, service.name ?? "") === "per_room" ? "quantity" : "duration";
  if (billingModel === "quantity") return Math.max(0, quantity) * rate;
  if (billingModel === "fixed") return rate;
  return Math.max(0, hours) * rate;
}

export function calculateTaskCost(hours: number, rooms: number, service: ServicePricing, costOverride?: number | string | null, quantity = rooms): number {
  if (costOverride !== null && costOverride !== undefined && costOverride !== "") {
    const override = Number(costOverride);
    if (Number.isFinite(override) && override >= 0) return override;
  }
  return calculateServiceCost(hours, rooms, service, quantity);
}

export function calculateWorkLogCost(
  hours: number,
  rooms: number,
  service: ServicePricing,
  workLog: WorkLogPricingContext,
  costOverride?: number | string | null,
): number {
  const blueprint = workLog.service_blueprint_snapshot;
  const blueprintSource = typeof blueprint === "object" && blueprint !== null && !Array.isArray(blueprint)
    ? blueprint as Record<string, unknown>
    : null;
  const billingModel = blueprintSource?.billingModel;
  const defaultRate = blueprintSource?.defaultRate;
  const resolvedBlueprint = blueprintSource
    ? resolveServiceBlueprint({
      billing_model: typeof billingModel === "string" ? billingModel : service.billing_model,
      default_rate: typeof defaultRate === "number" || typeof defaultRate === "string" ? defaultRate : service.default_rate,
      unit: service.unit,
      billing_unit_label: typeof blueprintSource.unitLabel === "string" ? blueprintSource.unitLabel : service.billing_unit_label,
    })
    : null;
  const quantityValue = workLog.billable_quantity;
  const quantity = quantityValue !== null && quantityValue !== undefined && Number.isFinite(Number(quantityValue))
    ? Number(quantityValue)
    : rooms;
  const configuredRate = resolvedBlueprint?.defaultRate;
  const costService: ServicePricing = {
    ...service,
    billing_model: resolvedBlueprint?.billingModel ?? service.billing_model,
    default_rate: configuredRate ?? service.default_rate,
  };
  return calculateTaskCost(hours, rooms, costService, costOverride, quantity);
}