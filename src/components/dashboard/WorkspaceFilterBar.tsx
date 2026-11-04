"use client";

import { useId, useState, useSyncExternalStore, type ReactNode } from "react";
import { Filter, RotateCcw, X } from "lucide-react";

export type WorkspaceFilters = {
  from: string;
  to: string;
  property: string;
  tenant: string;
  worker: string;
  status: string;
  service: string;
  needsAction: string;
  sort: string;
  ascending: string;
};

const EMPTY_FILTERS: WorkspaceFilters = {
  from: "",
  to: "",
  property: "",
  tenant: "",
  worker: "",
  status: "",
  service: "",
  needsAction: "",
  sort: "date",
  ascending: "false",
};

const FILTER_CHANGE_EVENT = "workspace-filters-change";

function subscribe(callback: () => void) {
  window.addEventListener("popstate", callback);
  window.addEventListener(FILTER_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener(FILTER_CHANGE_EVENT, callback);
  };
}

function getSearchSnapshot() {
  return window.location.search;
}

function getServerSearchSnapshot() {
  return "";
}

export function useWorkspaceFilters(prefix: "work" | "payroll", defaults: Partial<WorkspaceFilters> = {}) {
  const search = useSyncExternalStore(subscribe, getSearchSnapshot, getServerSearchSnapshot);
  const params = new URLSearchParams(search);
  const key = (field: keyof WorkspaceFilters) => prefix === "work"
    ? ({ from: "from", to: "to", property: "property", tenant: "tenant", worker: "worker", status: "status", service: "service", needsAction: "needsAction", sort: "sort", ascending: "ascending" } as const)[field]
    : `payroll${field[0].toUpperCase()}${field.slice(1)}`;
  const filters = Object.fromEntries(
    (Object.keys(EMPTY_FILTERS) as (keyof WorkspaceFilters)[]).map((field) => [
      field,
      params.get(key(field)) ?? defaults[field] ?? EMPTY_FILTERS[field],
    ])
  ) as WorkspaceFilters;

  const updateFilters = (changes: Partial<WorkspaceFilters>) => {
    const url = new URL(window.location.href);
    for (const [field, value] of Object.entries(changes) as [keyof WorkspaceFilters, string][]) {
      const parameter = key(field);
      if (value) url.searchParams.set(parameter, value);
      else if ((field === "from" || field === "to") && defaults[field] !== undefined) url.searchParams.set(parameter, "");
      else url.searchParams.delete(parameter);
    }
    window.history.replaceState(window.history.state, "", url);
    window.dispatchEvent(new Event(FILTER_CHANGE_EVENT));
  };

  const clearFilters = () => {
    updateFilters({
      from: defaults.from ?? "",
      to: defaults.to ?? "",
      property: "",
      tenant: "",
      worker: "",
      status: "",
      service: "",
      needsAction: "",
      sort: "date",
      ascending: "false",
    });
  };

  return { filters, updateFilters, clearFilters };
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getPresetRange(preset: string) {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const end = new Date(start);
  if (preset === "yesterday") {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  } else if (preset === "this-week") {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  } else if (preset === "this-month") {
    start.setDate(1);
  } else if (preset === "last-month") {
    start.setDate(1);
    start.setMonth(start.getMonth() - 1);
    end.setDate(0);
  } else if (preset === "this-year") {
    start.setMonth(0, 1);
  }
  return { from: dateKey(start), to: dateKey(end) };
}

type Option = { id: string; name: string };

function SearchableFilterInput({
  label,
  value,
  options,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const listId = useId();
  const selected = options.find((option) => option.id === value);
  const [query, setQuery] = useState(selected?.name ?? "");

  return <div className="text-xs font-semibold text-slate-600">
    <label htmlFor={`${listId}-input`}>{label}</label>
    <div className="relative mt-1">
      <input
        type="search"
        id={`${listId}-input`}
        list={`${listId}-options`}
        value={query}
        onChange={(event) => {
          const nextQuery = event.target.value;
          setQuery(nextQuery);
          const match = options.find((option) => option.name.toLocaleLowerCase() === nextQuery.trim().toLocaleLowerCase());
          if (match) onChange(match.id);
          else if (!nextQuery) onChange("");
        }}
        placeholder={placeholder}
        className="min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 pr-9 text-sm text-slate-800"
      />
      <datalist id={`${listId}-options`}>{options.map((option) => <option key={option.id} value={option.name} />)}</datalist>
      {value && <button type="button" aria-label={`Clear ${label.toLowerCase()} filter`} onClick={() => { setQuery(""); onChange(""); }} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 hover:bg-slate-100"><X className="h-3.5 w-3.5" /></button>}
    </div>
  </div>;
}

export function WorkspaceFilterBar({
  filters,
  onChange,
  onReset,
  properties,
  services = [],
  tenants = [],
  workers,
  statuses = [],
  children,
  showTenants = false,
  showWorkers = true,
  label = "Workspace filters",
}: {
  filters: WorkspaceFilters;
  onChange: (changes: Partial<WorkspaceFilters>) => void;
  onReset: () => void;
  properties: Option[];
  services?: Option[];
  tenants?: Option[];
  workers: Option[];
  statuses?: string[];
  children?: ReactNode;
  showTenants?: boolean;
  showWorkers?: boolean;
  label?: string;
}) {
  const activeFilters = ([
    ["from", filters.from],
    ["to", filters.to],
    ["property", filters.property],
    ...(showTenants ? [["tenant", filters.tenant] as const] : []),
    ...(showWorkers ? [["worker", filters.worker] as const] : []),
    ["status", filters.status],
    ["service", filters.service],
    ["needsAction", filters.needsAction],
  ] as [keyof WorkspaceFilters, string][]).filter(([, value]) => Boolean(value));
  const fieldClass = "min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800";
  const presets = [
    ["today", "Today"],
    ["yesterday", "Yesterday"],
    ["this-week", "This Week"],
    ["this-month", "This Month"],
    ["last-month", "Last Month"],
    ["this-year", "This Year"],
  ] as const;
  const applyPreset = (preset: string) => onChange({ ...getPresetRange(preset), sort: filters.sort });
  const clearDateRange = () => onChange({ from: "", to: "" });

  return <section aria-label={label} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800"><Filter className="h-4 w-4 text-slate-500" />Filter records</h3>
      {activeFilters.length > 0 && <button type="button" onClick={onReset} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"><RotateCcw className="h-3.5 w-3.5" />Reset filters</button>}
    </div>
    <div className="flex flex-wrap gap-2">
      {presets.map(([value, title]) => <button key={value} type="button" onClick={() => applyPreset(value)} className="min-h-9 rounded-full border border-slate-200 px-3 text-xs font-semibold text-slate-700 transition hover:border-sky-300 hover:bg-sky-50">{title}</button>)}
      <button type="button" onClick={clearDateRange} className="min-h-9 rounded-full border border-slate-200 px-3 text-xs font-semibold text-slate-700 transition hover:border-sky-300 hover:bg-sky-50">All Time</button>
      <span className="inline-flex min-h-9 items-center rounded-full bg-slate-50 px-3 text-xs font-semibold text-slate-600">Custom Range</span>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
      <label className="text-xs font-semibold text-slate-600">From<input type="date" value={filters.from} max={filters.to || undefined} onChange={(event) => onChange({ from: event.target.value })} className={`${fieldClass} mt-1`} /></label>
      <label className="text-xs font-semibold text-slate-600">To<input type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => onChange({ to: event.target.value })} className={`${fieldClass} mt-1`} /></label>
      <SearchableFilterInput key={`property:${filters.property}`} label="Property" value={filters.property} options={properties} onChange={(property) => onChange({ property, worker: "" })} placeholder="All properties" />
      {showTenants && <SearchableFilterInput key={`tenant:${filters.tenant}`} label="Tenant / owner" value={filters.tenant} options={tenants} onChange={(tenant) => onChange({ tenant })} placeholder="All tenants" />}
      {showWorkers && <SearchableFilterInput key={`worker:${filters.worker}`} label="Worker" value={filters.worker} options={workers} onChange={(worker) => onChange({ worker })} placeholder="All workers" />}
      {statuses.length > 0 && <label className="text-xs font-semibold text-slate-600">Status<select value={filters.status} onChange={(event) => onChange({ status: event.target.value })} className={`${fieldClass} mt-1`}><option value="">All statuses</option>{statuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>}
      {children}
    </div>
    {activeFilters.length > 0 && <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
      {activeFilters.map(([field, value]) => {
        const labelText = field === "from" ? "From" : field === "to" ? "To" : field === "property" ? "Property" : field === "tenant" ? "Tenant" : field === "worker" ? "Worker" : field === "service" ? "Service" : field === "needsAction" ? "Needs action" : "Status";
        const itemLabel = field === "property" ? properties.find((item) => item.id === value)?.name
          : field === "service" ? services.find((item) => item.id === value)?.name
          : field === "tenant" ? tenants.find((item) => item.id === value)?.name
            : field === "worker" ? workers.find((item) => item.id === value)?.name
              : field === "needsAction" ? "On"
                : value;
        return <button key={field} type="button" onClick={() => onChange({ [field]: "" })} aria-label={`Remove ${labelText} filter`} className="inline-flex min-h-8 items-center gap-1 rounded-full bg-sky-50 px-2.5 text-xs font-medium text-sky-800 hover:bg-sky-100">{labelText}: {itemLabel}<X className="h-3 w-3" /></button>;
      })}
    </div>}
  </section>;
}
