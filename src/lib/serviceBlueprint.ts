export type BillingModel = "duration" | "quantity" | "fixed";
export type SpatialMode = "units" | "open_zone" | "general";

export type ChecklistBlueprint = {
  items: string[];
  requirePhoto: boolean;
};

export type ServiceBlueprint = {
  serviceCategory: string | null;
  billingModel: BillingModel;
  defaultRate: number | null;
  unitLabel: string | null;
  benchmarkQuantity: number | null;
  spatialMode: SpatialMode;
  requiresAssetReference: boolean;
  checklist: ChecklistBlueprint;
};

export type ServiceBlueprintSource = {
  service_category?: string | null;
  billing_model?: string | null;
  billing_unit_label?: string | null;
  benchmark_quantity?: number | string | null;
  spatial_mode?: string | null;
  requires_asset_reference?: boolean | null;
  checklist_blueprint?: unknown;
  unit?: string | null;
  name?: string | null;
  default_rate?: number | string | null;
};

export function resolveChecklistBlueprint(value: unknown): ChecklistBlueprint {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { items: [], requirePhoto: false };
  }
  const record = value as Record<string, unknown>;
  const items = Array.isArray(record.items)
    ? [...new Set(record.items
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean))]
    : [];
  return { items, requirePhoto: record.requirePhoto === true };
}

export function resolveServiceBlueprint(source: ServiceBlueprintSource): ServiceBlueprint {
  const legacyUnit = source.unit ?? "";
  const billingModel: BillingModel = source.billing_model === "duration"
    || source.billing_model === "quantity"
    || source.billing_model === "fixed"
    ? source.billing_model
    : legacyUnit === "fixed" ? "fixed" : legacyUnit === "per_room" ? "quantity" : "duration";
  const configuredBenchmark = source.benchmark_quantity === null || source.benchmark_quantity === undefined || source.benchmark_quantity === ""
    ? Number.NaN
    : Number(source.benchmark_quantity);
  const configuredRate = source.default_rate === null || source.default_rate === undefined || source.default_rate === ""
    ? Number.NaN
    : Number(source.default_rate);
  const spatialMode: SpatialMode = source.spatial_mode === "units"
    || source.spatial_mode === "open_zone"
    || source.spatial_mode === "general"
    ? source.spatial_mode
    : legacyUnit === "per_room" ? "units" : "general";
  return {
    serviceCategory: source.service_category?.trim() || null,
    billingModel,
    defaultRate: Number.isFinite(configuredRate) && configuredRate >= 0 ? configuredRate : null,
    unitLabel: source.billing_unit_label?.trim() || (legacyUnit === "per_room" ? "rooms" : null),
    benchmarkQuantity: Number.isFinite(configuredBenchmark) && configuredBenchmark >= 0 ? configuredBenchmark : null,
    spatialMode,
    requiresAssetReference: source.requires_asset_reference === true,
    checklist: resolveChecklistBlueprint(source.checklist_blueprint),
  };
}

export function resolveTaskChecklist(snapshot: unknown): ChecklistBlueprint {
  if (typeof snapshot !== "object" || snapshot === null || Array.isArray(snapshot)) {
    return { items: [], requirePhoto: false };
  }
  return resolveChecklistBlueprint((snapshot as Record<string, unknown>).checklist);
}

export function createServiceBlueprintSnapshot(source: ServiceBlueprintSource) {
  return resolveServiceBlueprint(source);
}
