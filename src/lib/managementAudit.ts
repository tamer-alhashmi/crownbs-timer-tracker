import type { createPrivilegedServerSupabaseClient } from "@/lib/supabase/server";

export type ManagementAuditPageRequest = {
  page: number;
  pageSize: number;
  action?: string;
  actor?: string;
  startDate?: string;
  endDate?: string;
};

export type AuditDetail = { label: string; value: string };

export type ManagementAuditRecord = {
  id: string;
  entity_type: "task" | "shift";
  entity_id: string;
  action: string;
  actor_id: string;
  actor_name: string;
  target_label: string;
  override_reason: string;
  previous_details: AuditDetail[];
  new_details: AuditDetail[];
  created_at: string;
};

export type ManagementAuditPage = {
  records: ManagementAuditRecord[];
  page: number;
  pageSize: number;
  totalCount: number;
  pageCount: number;
};

export type ManagementHistoryFilter = { selected?: string[]; from?: string; to?: string; min?: string; max?: string };
export type ManagementHistoryFilters = Record<string, ManagementHistoryFilter>;
export type ManagementHistoryRecord = {
  id: string;
  user_id: string;
  hotel_id: string;
  service_id: string | null;
  shift_id: string | null;
  cleanerName: string;
  hotelName: string;
  assigneeRole: string;
  start_time: string;
  end_time: string | null;
  task_date: string;
  status: string;
  cancelled_at: string | null;
  rooms_completed: number;
  room_number: string | null;
  room_numbers: string[];
  room_ids: string[];
  roomDetails: { name: string; floor: string }[];
  service_name_snapshot: string | null;
  service_description_snapshot: string | null;
  notes: string | null;
  cost_override: number | string | null;
  owner_id: string | null;
  owner_name: string | null;
  manager_id: string | null;
  manager_name: string | null;
  responsibility_recorded_at: string | null;
  manager_approved: boolean;
  owner_approved: boolean;
  manager_rejected: boolean;
  owner_rejected: boolean;
  is_locked: boolean;
  rejection_notes: string | null;
  services_config: { name: string; description: string; default_rate: number; unit: string }[];
};
export type ManagementHistoryPage = {
  records: ManagementHistoryRecord[];
  page: number;
  pageSize: number;
  totalCount: number;
  pageCount: number;
};

type SupabaseClient = ReturnType<typeof createPrivilegedServerSupabaseClient>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function snapshotDetails(value: unknown): AuditDetail[] {
  if (!isObject(value)) return [];
  const fields: Record<string, string> = {
    status: "Status",
    start_time: "Start time",
    end_time: "End time",
    rooms_completed: "Rooms completed",
    cost_override: "Cost",
    cancelled_at: "Cancelled",
    room_number: "Room",
  };
  return Object.entries(fields).flatMap(([key, label]) => {
    if (!(key in value)) return [];
    const raw = value[key];
    if (key === "cancelled_at") return [{ label, value: raw ? "Yes" : "No" }];
    if (raw === null || raw === undefined || raw === "") return [{ label, value: "—" }];
    if ((key === "start_time" || key === "end_time") && typeof raw === "string") {
      const date = new Date(raw);
      return [{ label, value: Number.isNaN(date.getTime()) ? raw : date.toLocaleString("en-GB", { timeZone: "Africa/Cairo" }) }];
    }
    if (key === "cost_override") {
      const cost = Number(raw);
      return [{ label, value: Number.isFinite(cost) ? `GBP ${cost.toFixed(2)}` : "Unavailable" }];
    }
    return [{ label, value: String(raw).replaceAll("_", " ") }];
  });
}

function parseAuditPage(value: unknown, requestedPage: number, pageSize: number): ManagementAuditPage {
  if (!isObject(value) || !Array.isArray(value.records) || typeof value.totalCount !== "number") {
    throw new Error("The audit page query returned an invalid response.");
  }
  const records = value.records.map((item): ManagementAuditRecord => {
    if (!isObject(item)
      || typeof item.id !== "string"
      || (item.entity_type !== "task" && item.entity_type !== "shift")
      || typeof item.entity_id !== "string"
      || typeof item.action !== "string"
      || typeof item.actor_id !== "string"
      || typeof item.actor_name !== "string"
      || typeof item.override_reason !== "string"
      || typeof item.created_at !== "string") {
      throw new Error("The audit page query returned a malformed record.");
    }
    return {
      id: item.id,
      entity_type: item.entity_type,
      entity_id: item.entity_id,
      action: item.action,
      actor_id: item.actor_id,
      actor_name: item.actor_name,
      target_label: typeof item.target_label === "string" ? item.target_label : item.entity_type === "task" ? "Task" : "Shift",
      override_reason: item.override_reason,
      previous_details: snapshotDetails(item.previous_values),
      new_details: snapshotDetails(item.new_values),
      created_at: item.created_at,
    };
  });
  const totalCount = Math.max(0, Math.floor(value.totalCount));
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  return {
    records,
    page: Math.min(requestedPage, pageCount),
    pageSize,
    totalCount,
    pageCount,
  };
}

export async function fetchManagementAuditPage(
  supabase: SupabaseClient,
  hotelIds: string[] | null,
  request: ManagementAuditPageRequest,
): Promise<ManagementAuditPage> {
  const page = Number.isInteger(request.page) ? Math.max(1, request.page) : 1;
  const pageSize = Number.isInteger(request.pageSize) ? Math.min(50, Math.max(1, request.pageSize)) : 20;
  const action = ["force_clock_out", "force_complete_task", "cancel_task"].includes(request.action ?? "")
    ? request.action!
    : null;
  const actor = request.actor?.trim().slice(0, 100) || null;
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const readDate = (date: string | undefined, label: string) => {
    if (!date) return null;
    const parsedDate = datePattern.test(date) ? new Date(`${date}T00:00:00Z`) : null;
    if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
      throw new Error(`Choose a valid ${label} date.`);
    }
    return date;
  };
  const startDate = readDate(request.startDate, "start");
  const endDate = readDate(request.endDate, "end");

  const { data, error } = await supabase.rpc("get_management_override_audit_page", {
    p_hotel_ids: hotelIds,
    p_page: page,
    p_page_size: pageSize,
    p_action: action,
    p_actor: actor,
    p_start_date: startDate,
    p_end_date: endDate,
  });
  if (error) throw new Error(`Unable to load operational audit history: ${error.message}`);
  return parseAuditPage(data, page, pageSize);
}

function parseHistoryRecord(value: unknown): ManagementHistoryRecord {
  if (!isObject(value)) throw new Error("The responsibility history query returned a malformed record.");
  const requiredStrings = ["id", "user_id", "hotel_id", "cleanerName", "hotelName", "assigneeRole", "start_time", "task_date", "status"] as const;
  if (!requiredStrings.every((key) => typeof value[key] === "string")) {
    throw new Error("The responsibility history query returned a malformed record.");
  }
  const nullableString = (key: string): string | null => {
    const item = value[key];
    if (item === null || item === undefined || typeof item === "string") return item ?? null;
    throw new Error("The responsibility history query returned a malformed record.");
  };
  const stringArray = (key: string) => {
    const item = value[key];
    if (!Array.isArray(item) || !item.every((entry) => typeof entry === "string")) {
      throw new Error("The responsibility history query returned a malformed record.");
    }
    return item;
  };
  const boolean = (key: string) => {
    if (typeof value[key] !== "boolean") throw new Error("The responsibility history query returned a malformed record.");
    return value[key];
  };
  const number = (key: string) => {
    const item = Number(value[key]);
    if (!Number.isFinite(item)) throw new Error("The responsibility history query returned a malformed record.");
    return item;
  };
  const serviceRows = value.services_config;
  if (!Array.isArray(serviceRows) || !serviceRows.every((service) => isObject(service)
    && typeof service.name === "string"
    && typeof service.description === "string"
    && Number.isFinite(Number(service.default_rate))
    && typeof service.unit === "string")) {
    throw new Error("The responsibility history query returned a malformed service record.");
  }
  const roomRows = value.roomDetails;
  if (!Array.isArray(roomRows) || !roomRows.every((room) => isObject(room) && typeof room.name === "string" && typeof room.floor === "string")) {
    throw new Error("The responsibility history query returned malformed room details.");
  }
  const costOverride = value.cost_override;
  if (costOverride !== null && costOverride !== undefined && typeof costOverride !== "string" && typeof costOverride !== "number") {
    throw new Error("The responsibility history query returned an invalid cost.");
  }
  return {
    id: value.id as string,
    user_id: value.user_id as string,
    hotel_id: value.hotel_id as string,
    service_id: nullableString("service_id"),
    shift_id: nullableString("shift_id"),
    cleanerName: value.cleanerName as string,
    hotelName: value.hotelName as string,
    assigneeRole: value.assigneeRole as string,
    start_time: value.start_time as string,
    end_time: nullableString("end_time"),
    task_date: value.task_date as string,
    status: value.status as string,
    cancelled_at: nullableString("cancelled_at"),
    rooms_completed: number("rooms_completed"),
    room_number: nullableString("room_number"),
    room_numbers: stringArray("room_numbers"),
    room_ids: stringArray("room_ids"),
    roomDetails: roomRows.map((room) => ({ name: room.name as string, floor: room.floor as string })),
    service_name_snapshot: nullableString("service_name_snapshot"),
    service_description_snapshot: nullableString("service_description_snapshot"),
    notes: nullableString("notes"),
    cost_override: costOverride ?? null,
    owner_id: nullableString("owner_id"),
    owner_name: nullableString("owner_name"),
    manager_id: nullableString("manager_id"),
    manager_name: nullableString("manager_name"),
    responsibility_recorded_at: nullableString("responsibility_recorded_at"),
    manager_approved: boolean("manager_approved"),
    owner_approved: boolean("owner_approved"),
    manager_rejected: boolean("manager_rejected"),
    owner_rejected: boolean("owner_rejected"),
    is_locked: boolean("is_locked"),
    rejection_notes: nullableString("rejection_notes"),
    services_config: serviceRows.map((service) => ({
      name: service.name as string,
      description: service.description as string,
      default_rate: Number(service.default_rate),
      unit: service.unit as string,
    })),
  };
}

function validateHistoryFilters(filters: ManagementHistoryFilters): ManagementHistoryFilters {
  const allowedFields = new Set(["worker", "facility", "owner", "manager", "snapshot", "service", "status", "approvals", "room", "date", "hours", "value"]);
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const validated: ManagementHistoryFilters = {};
  for (const [key, filter] of Object.entries(filters)) {
    if (!allowedFields.has(key) || !isObject(filter)) continue;
    const item: ManagementHistoryFilter = {};
    if (filter.selected !== undefined) {
      if (!Array.isArray(filter.selected) || filter.selected.length > 100 || !filter.selected.every((entry) => typeof entry === "string" && entry.length <= 200)) {
        throw new Error("Audit filter selections are invalid.");
      }
      item.selected = filter.selected;
    }
    for (const dateField of ["from", "to"] as const) {
      const date = filter[dateField];
      if (date === undefined) continue;
      const parsedDate = typeof date === "string" && datePattern.test(date) ? new Date(`${date}T00:00:00Z`) : null;
      if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
        throw new Error("Audit date filters must be valid calendar dates.");
      }
      item[dateField] = date;
    }
    for (const numberField of ["min", "max"] as const) {
      const numeric = filter[numberField];
      if (numeric === undefined) continue;
      if (typeof numeric !== "string" || !Number.isFinite(Number(numeric)) || Number(numeric) < 0 || Number(numeric) > 1_000_000_000) {
        throw new Error("Audit numeric filters must be non-negative numbers.");
      }
      item[numberField] = numeric;
    }
    validated[key] = item;
  }
  return validated;
}

export async function fetchManagementHistoryPage(
  supabase: SupabaseClient,
  hotelIds: string[] | null,
  request: { page: number; pageSize: number; filters: ManagementHistoryFilters },
): Promise<ManagementHistoryPage> {
  const page = Number.isInteger(request.page) ? Math.max(1, request.page) : 1;
  const pageSize = Number.isInteger(request.pageSize) ? Math.min(50, Math.max(1, request.pageSize)) : 20;
  const filters = validateHistoryFilters(request.filters);
  const { data, error } = await supabase.rpc("get_management_responsibility_history_page", {
    p_hotel_ids: hotelIds,
    p_page: page,
    p_page_size: pageSize,
    p_filters: filters,
  });
  if (error) throw new Error(`Unable to load responsibility history: ${error.message}`);
  if (!isObject(data) || !Array.isArray(data.records) || typeof data.totalCount !== "number") {
    throw new Error("The responsibility history query returned an invalid response.");
  }
  const totalCount = Math.max(0, Math.floor(data.totalCount));
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  return {
    records: data.records.map(parseHistoryRecord),
    page: Math.min(page, pageCount),
    pageSize,
    totalCount,
    pageCount,
  };
}
