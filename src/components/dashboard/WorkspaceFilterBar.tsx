"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { CalendarDays, ChevronDown, Filter, RotateCcw, SlidersHorizontal, X } from "lucide-react";

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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const datePopoverRef = useRef<HTMLDivElement>(null);
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
  const dateActive = Boolean(filters.from || filters.to);
  const fieldClass = "min-h-10 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 md:min-h-8 md:px-2.5 md:py-1";
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
  const formatDate = (value: string) => {
    if (!value) return "";
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  };
  const matchedPreset = presets.find(([preset]) => {
    const range = getPresetRange(preset);
    return range.from === filters.from && range.to === filters.to;
  });
  const dateSummary = matchedPreset
    ? matchedPreset[1]
    : dateActive
      ? [formatDate(filters.from), formatDate(filters.to)].filter(Boolean).join(" - ")
      : "All dates";
  const activeCount = activeFilters.length - (filters.from && filters.to ? 1 : 0);
  const removeFilter = (field: keyof WorkspaceFilters) => onChange(field === "from" || field === "to"
    ? { from: "", to: "" }
    : { [field]: "" });
  const dateFields = <div className="grid grid-cols-2 gap-3">
    <label className="text-xs font-semibold text-slate-600">From<input type="date" value={filters.from} max={filters.to || undefined} onChange={(event) => onChange({ from: event.target.value })} className={`${fieldClass} mt-1`} /></label>
    <label className="text-xs font-semibold text-slate-600">To<input type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => onChange({ to: event.target.value })} className={`${fieldClass} mt-1`} /></label>
  </div>;
  const datePresets = <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
    {presets.map(([value, title]) => <button key={value} type="button" onClick={() => { applyPreset(value); setDateOpen(false); }} className="brand-accent-hover min-h-10 rounded-lg border border-slate-200 px-3 text-left text-xs font-semibold text-slate-700 transition">{title}</button>)}
    <button type="button" onClick={() => { clearDateRange(); setDateOpen(false); }} className="brand-accent-hover min-h-10 rounded-lg border border-slate-200 px-3 text-left text-xs font-semibold text-slate-700 transition">All dates</button>
  </div>;
  const renderFilterFields = () => <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <SearchableFilterInput key={`property:${filters.property}`} label="Property" value={filters.property} options={properties} onChange={(property) => onChange({ property, worker: "" })} placeholder="All properties" />
    {showTenants && <SearchableFilterInput key={`tenant:${filters.tenant}`} label="Tenant / owner" value={filters.tenant} options={tenants} onChange={(tenant) => onChange({ tenant })} placeholder="All tenants" />}
    {showWorkers && <SearchableFilterInput key={`worker:${filters.worker}`} label="Worker" value={filters.worker} options={workers} onChange={(worker) => onChange({ worker })} placeholder="All workers" />}
    {statuses.length > 0 && <label className="text-xs font-semibold text-slate-600">Status<select value={filters.status} onChange={(event) => onChange({ status: event.target.value })} className={`${fieldClass} mt-1`}><option value="">All statuses</option>{statuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>}
    {children}
  </div>;

  useEffect(() => {
    if (!dateOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !datePopoverRef.current?.contains(event.target)) setDateOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDateOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [dateOpen]);

  const activeFilterPills = activeFilters.map(([field, value]) => {
    const isDate = field === "from" || field === "to";
    if (isDate && field === "to" && filters.from) return null;
    const labelText = isDate ? "Date" : field === "property" ? "Property" : field === "tenant" ? "Tenant" : field === "worker" ? "Worker" : field === "service" ? "Service" : field === "needsAction" ? "Needs action" : "Status";
    const itemLabel = isDate ? dateSummary
      : field === "property" ? properties.find((item) => item.id === value)?.name
      : field === "service" ? services.find((item) => item.id === value)?.name
      : field === "tenant" ? tenants.find((item) => item.id === value)?.name
      : field === "worker" ? workers.find((item) => item.id === value)?.name
      : field === "needsAction" ? "On"
      : value;
    return <button key={isDate ? "date-range" : field} type="button" onClick={() => removeFilter(field)} aria-label={`Remove ${labelText} filter`} className="brand-accent-soft inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium hover:brightness-95">{labelText}: {itemLabel}<X className="h-3 w-3" /></button>;
  });

  return <section aria-label={label} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800"><Filter className="h-4 w-4 text-slate-500" />Filter records</h3>
      {activeCount > 0 && <button type="button" onClick={onReset} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"><RotateCcw className="h-3.5 w-3.5" />Reset all</button>}
    </div>
    <div className="hidden flex-wrap items-end gap-2 md:flex">
      <div ref={datePopoverRef} className="relative shrink-0">
        <button type="button" aria-expanded={dateOpen} aria-haspopup="dialog" onClick={() => setDateOpen((open) => !open)} className={`inline-flex min-h-8 items-center gap-2 rounded-lg border px-3 text-xs font-semibold ${dateActive ? "brand-accent-soft" : "border-slate-200 bg-white text-slate-700"} hover:border-indigo-300`}>
          <CalendarDays className="h-4 w-4" />{dateSummary}<ChevronDown className="h-3.5 w-3.5" />
        </button>
        {dateOpen && <div role="dialog" aria-label="Choose date range" className="absolute left-0 top-full z-30 mt-2 w-[22rem] space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
          <div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Date presets</p>{datePresets}</div>
          <div className="border-t border-slate-100 pt-3"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Custom ISO range</p>{dateFields}</div>
        </div>}
      </div>
      <div className="w-full">{renderFilterFields()}</div>
    </div>
    <div className="md:hidden">
      <button type="button" aria-expanded={filtersOpen} aria-haspopup="dialog" onClick={() => setFiltersOpen(true)} className="inline-flex min-h-11 w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700">
        <span className="inline-flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 brand-accent-text" />Filters{activeCount > 0 && <span className="brand-accent grid h-5 min-w-5 place-items-center rounded-full px-1 text-[10px]">{activeCount}</span>}</span><span className="max-w-[55%] truncate text-xs font-medium text-slate-500">{dateSummary}</span>
      </button>
    </div>
    {activeCount > 0 && <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">{activeFilterPills}</div>}
    {filtersOpen && <div className="fixed inset-0 z-[80] flex items-end bg-slate-950/35 md:hidden" onMouseDown={(event) => { if (event.target === event.currentTarget) setFiltersOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-label="Workspace filters" className="filter-sheet-enter max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 pb-safe-4 shadow-2xl">
        <header className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3"><div><h4 className="font-semibold text-slate-900">Filters</h4><p className="text-xs text-slate-500">{activeCount ? `${activeCount} active` : "Choose a date range or narrow records"}</p></div><button type="button" aria-label="Close filters" onClick={() => setFiltersOpen(false)} className="grid h-10 w-10 place-items-center rounded-full border border-slate-200 text-slate-600"><X className="h-4 w-4" /></button></header>
        <div className="space-y-4"><div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Date presets</p>{datePresets}</div><div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Custom ISO range</p>{dateFields}</div>{renderFilterFields()}</div>
        <div className="sticky bottom-0 mt-4 flex gap-2 border-t border-slate-100 bg-white pt-3">
          {activeCount > 0 && <button type="button" onClick={onReset} className="min-h-11 flex-1 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700">Reset all</button>}
          <button type="button" onClick={() => setFiltersOpen(false)} className="brand-accent min-h-11 flex-1 rounded-lg text-sm font-semibold">Show results</button>
        </div>
      </section>
    </div>}
  </section>;
}
