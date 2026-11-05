"use client";

import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import { Component, useCallback, useEffect, useRef, useState, useTransition, type ErrorInfo, type ReactNode } from "react";
import { Archive, ArrowRightLeft, Building2, CalendarDays, Check, CheckCircle2, Clock3, CreditCard, Download, FileSpreadsheet, FileText, Loader2, Mail, MapPin, MoreVertical, Pencil, Phone, Search, ShieldAlert, ShieldCheck, UserRound, UserX, UsersRound, X } from "lucide-react";
import { strToU8, zipSync } from "fflate";
import { DashboardPagination } from "@/components/dashboard/DashboardPagination";
import { showActionToast } from "@/components/ui/ActionToast";
import { formatUserMessage } from "@/lib/userMessages";
import { calculateTaskCost } from "@/lib/servicePricing";
import {
  getTenantDetails,
  getTenantWorkLogExport,
  reassignTenantWorker,
  setTenantActive,
  setTenantPropertyActive,
  setTenantPropertyArchived,
  setTenantWorkerActive,
  transferTenantProperty,
  updateTenantProfile,
  updateTenantPropertyAssignments,
  updateTenantPropertyDetails,
  type TenantDetails,
  type TenantLog,
} from "./tenantDetailsActions";
import { settleTenantCycle, type TenantAccount } from "./tenantAccountsActions";

type Props = {
  tenant: TenantAccount;
  onClose: () => void;
  onUpdated: () => void;
};
type TabId = "overview" | "operations" | "financials" | "history";
type DatePreset = "all" | "month" | "30days" | "custom";
type DateFilter = { from: string | null; to: string | null };

const TABS: { id: TabId; label: string; icon: typeof UserRound }[] = [
  { id: "overview", label: "Overview", icon: UserRound },
  { id: "operations", label: "Operations", icon: Building2 },
  { id: "financials", label: "Financials", icon: CreditCard },
  { id: "history", label: "Work history", icon: Clock3 },
];

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function dateLabel(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(date);
}

function duration(log: TenantLog) {
  return log.end_time ? Math.max(0, (Date.parse(log.end_time) - Date.parse(log.start_time)) / 3_600_000) : 0;
}

function calculateTenantLogCost(log: TenantLog) {
  return calculateTaskCost(duration(log), log.rooms_completed, log.service, log.cost_override);
}

function csvCell(value: string | number | boolean) {
  const text = String(value);
  const safe = typeof value === "string" && /^[\t\r ]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function xmlEscape(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function columnName(index: number) {
  let number = index + 1;
  let result = "";
  while (number > 0) {
    result = String.fromCharCode(65 + ((number - 1) % 26)) + result;
    number = Math.floor((number - 1) / 26);
  }
  return result;
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportXlsx(logs: TenantLog[], filename: string) {
  const columns = ["Log ID", "Date", "Worker", "Property", "Service", "Status", "Start", "End", "Hours", "Room count", "Room identifiers", "Cost (USD)", "Priority", "Due at", "Created at", "Locked", "Manager approval", "Manager approved at", "Owner approval", "Owner approved at", "Rejection notes", "Notes", "Complete source record (JSON)"];
  const rows: (string | number | boolean)[][] = logs.map((log) => [
    log.id,
    log.task_date ?? log.start_time.slice(0, 10),
    log.cleanerName,
    log.hotelName,
    log.serviceName,
    log.status,
    log.start_time,
    log.end_time ?? "",
    Number(duration(log).toFixed(2)),
    log.rooms_completed,
    log.room_numbers.length ? log.room_numbers.join(", ") : log.room_number ?? "",
    Number(calculateTenantLogCost(log).toFixed(2)),
    log.priority,
    log.due_at ?? "",
    log.created_at,
    log.is_locked,
    log.manager_approved,
    log.manager_approved_at ?? "",
    log.owner_approved,
    log.owner_approved_at ?? "",
    log.rejection_notes ?? "",
    log.notes ?? "",
    JSON.stringify(log),
  ]);
  const xmlRows = [columns, ...rows].map((row, rowIndex) =>
    `<row r="${rowIndex + 1}">${row.map((value, cellIndex) => {
      const reference = `${columnName(cellIndex)}${rowIndex + 1}`;
      return typeof value === "number"
        ? `<c r="${reference}"><v>${value}</v></c>`
        : `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(value))}</t></is></c>`;
    }).join("")}</row>`
  ).join("");
  const lastColumn = columnName(columns.length - 1);
  const lastRow = rows.length + 1;
  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastColumn}${lastRow}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetData>${xmlRows}</sheetData><autoFilter ref="A1:${lastColumn}${lastRow}"/></worksheet>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Work history" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const workbookRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
  const rootRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
  const file = zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rootRelationships),
    "xl/workbook.xml": strToU8(workbook),
    "xl/_rels/workbook.xml.rels": strToU8(workbookRelationships),
    "xl/worksheets/sheet1.xml": strToU8(worksheet),
  });
  download(new Blob([file], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${filename}.xlsx`);
}

function MetricCard({ label, value, detail, icon: Icon, tone, onClick }: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Building2;
  tone: "sky" | "emerald" | "amber" | "violet";
  onClick?: () => void;
}) {
  const tones = {
    sky: "text-sky-700 bg-sky-50 border-sky-100",
    emerald: "text-emerald-700 bg-emerald-50 border-emerald-100",
    amber: "text-amber-700 bg-amber-50 border-amber-100",
    violet: "text-violet-700 bg-violet-50 border-violet-100",
  };
  return (
    <motion.article
      title={detail}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? `${label}: ${value}. ${detail}` : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      } : undefined}
      whileHover={onClick ? { y: -3, scale: 1.01 } : undefined}
      whileTap={onClick ? { scale: 0.99 } : undefined}
      transition={{ type: "spring", stiffness: 350, damping: 24 }}
      className={`group rounded-2xl border border-line bg-surface p-4 shadow-sm transition hover:border-sky-200 hover:shadow-lg hover:shadow-sky-950/5 ${onClick ? "cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><p className="truncate text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</p><p className="mt-2 truncate text-xl font-bold tabular-nums text-ink">{value}</p></div>
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${tones[tone]}`}><Icon className="h-5 w-5" aria-hidden="true" /></span>
      </div>
      <p className="mt-2 truncate text-xs text-ink-muted">{detail}</p>
    </motion.article>
  );
}

function Skeleton() {
  return <div className="animate-pulse space-y-4 p-5 sm:p-7" aria-label="Loading tenant details">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-24 rounded-2xl bg-surface-secondary" />)}</div>
    <div className="h-48 rounded-2xl bg-surface-secondary" />
    <div className="h-56 rounded-2xl bg-surface-secondary" />
  </div>;
}

export function TenantDetailsModal({ tenant, onClose, onUpdated }: Props) {
  return (
    <TenantDetailsErrorBoundary onClose={onClose}>
      <TenantDetailsModalContent tenant={tenant} onClose={onClose} onUpdated={onUpdated} />
    </TenantDetailsErrorBoundary>
  );
}

class TenantDetailsErrorBoundary extends Component<
  { children: ReactNode; onClose: () => void },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Tenant details modal rendering failed:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <section role="alertdialog" aria-modal="true" className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-2xl">
            <h2 className="font-bold text-ink">Tenant details are unavailable</h2>
            <p className="mt-2 text-sm text-ink-secondary">An unexpected display error occurred. Your tenant data has not been changed.</p>
            <button type="button" onClick={this.props.onClose} className="mt-5 min-h-10 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white">Close</button>
          </section>
        </div>
      );
    }
    return this.props.children;
  }
}

function TenantDetailsModalContent({ tenant, onClose, onUpdated }: Props) {
  const [details, setDetails] = useState<TenantDetails | null>(null);
  const [tab, setTab] = useState<TabId>("overview");
  const [preset, setPreset] = useState<DatePreset>("all");
  const [filter, setFilter] = useState<DateFilter>({ from: null, to: null });
  const [page, setPage] = useState(1);
  const [loadError, setLoadError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [isEditing, setIsEditing] = useState(false);
  const [profileDraft, setProfileDraft] = useState({ fullName: tenant.name, email: tenant.email, phoneNumber: "" });
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [confirmationText, setConfirmationText] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const latestRequest = useRef(0);

  const applyDetails = useCallback((next: TenantDetails) => {
    setDetails(next);
    setProfileDraft({
      fullName: next.owner.fullName,
      email: next.owner.email,
      phoneNumber: next.owner.phoneNumber ?? "",
    });
  }, []);

  const loadDetails = useCallback(async () => {
    const request = ++latestRequest.current;
    try {
      const next = await getTenantDetails(tenant.id, filter, page);
      if (request !== latestRequest.current) return;
      applyDetails(next);
      setLoadError("");
    } catch (error) {
      if (request !== latestRequest.current) return;
      const message = formatUserMessage(error, "Unable to load tenant details.");
      setLoadError(message);
      showActionToast("error", message);
    } finally {
      if (request === latestRequest.current) setIsLoading(false);
    }
  }, [applyDetails, filter, page, tenant.id]);

  useEffect(() => {
    const request = ++latestRequest.current;
    void getTenantDetails(tenant.id, filter, page).then((next) => {
      if (request !== latestRequest.current) return;
      applyDetails(next);
      setLoadError("");
    }).catch((error: unknown) => {
      if (request !== latestRequest.current) return;
      const message = formatUserMessage(error, "Unable to load tenant details.");
      setLoadError(message);
      showActionToast("error", message);
    }).finally(() => {
      if (request === latestRequest.current) setIsLoading(false);
    });
    return () => {
      if (request === latestRequest.current) latestRequest.current += 1;
    };
  }, [applyDetails, filter, page, tenant.id]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !confirmDeactivate) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [confirmDeactivate, onClose]);

  const saveProfile = () => startTransition(async () => {
    try {
      await updateTenantProfile(tenant.id, profileDraft);
      setIsEditing(false);
      showActionToast("success", "Tenant contact details saved.");
      onUpdated();
      setIsLoading(true);
      await loadDetails();
    } catch (error) {
      showActionToast("error", error instanceof Error ? error.message : "Unable to save tenant details.");
    }
  });

  const updateStatus = (isActive: boolean) => startTransition(async () => {
    try {
      await setTenantActive(tenant.id, isActive);
      setConfirmDeactivate(false);
      setConfirmationText("");
      showActionToast("success", isActive ? "Tenant account reactivated." : "Tenant account deactivated; history was retained.");
      onUpdated();
      setIsLoading(true);
      await loadDetails();
    } catch (error) {
      showActionToast("error", error instanceof Error ? error.message : "Unable to update tenant status.");
    }
  });

  const markSettled = () => startTransition(async () => {
    try {
      await settleTenantCycle(tenant.id);
      showActionToast("success", "Current billing cycle marked as settled.");
      onUpdated();
      setIsLoading(true);
      await loadDetails();
    } catch (error) {
      showActionToast("error", error instanceof Error ? error.message : "Unable to record settlement.");
    }
  });

  const toggleProperty = (propertyId: string, isActive: boolean) => startTransition(async () => {
    try {
      await setTenantPropertyActive(tenant.id, propertyId, !isActive);
      showActionToast("success", isActive ? "Property suspended." : "Property reactivated.");
      onUpdated();
      setIsLoading(true);
      await loadDetails();
    } catch (error) {
      showActionToast("error", error instanceof Error ? error.message : "Unable to update property.");
    }
  });

  const runPropertyAction = (action: () => Promise<void>, successMessage: string, fallbackMessage: string) =>
    new Promise<boolean>((resolve) => startTransition(async () => {
      try {
        await action();
        showActionToast("success", successMessage);
        onUpdated();
        setIsLoading(true);
        await loadDetails();
        resolve(true);
      } catch (error) {
        showActionToast("error", error instanceof Error ? error.message : fallbackMessage);
        resolve(false);
      }
    }));

  const savePropertyDetails = (propertyId: string, updates: { name: string; location: string; rooms: number; floors: number }) =>
    runPropertyAction(() => updateTenantPropertyDetails(tenant.id, propertyId, updates), "Property details saved.", "Unable to update property details.");
  const archiveProperty = (propertyId: string, archived: boolean) =>
    runPropertyAction(() => setTenantPropertyArchived(tenant.id, propertyId, archived), archived ? "Property archived; work history was retained." : "Property restored. Activate it separately when ready.", "Unable to update property archive status.");
  const transferProperty = (propertyId: string, targetOwnerId: string) =>
    runPropertyAction(() => transferTenantProperty(tenant.id, propertyId, targetOwnerId), "Property transferred to the selected tenant.", "Unable to transfer property ownership.");
  const reassignWorker = (workerId: string, propertyId: string) =>
    runPropertyAction(() => reassignTenantWorker(tenant.id, workerId, propertyId), "Workforce assignment updated.", "Unable to reassign workforce member.");
  const toggleWorkerStatus = (workerId: string, workerName: string, isActive: boolean) =>
    runPropertyAction(() => setTenantWorkerActive(tenant.id, workerId, !isActive), `${workerName} ${isActive ? "deactivated" : "reactivated"}.`, "Unable to update workforce status.");

  const saveAssignments = (propertyId: string, managerId: string | null, housekeepingAdminId: string | null, cleanerIds: string[]) => startTransition(async () => {
    try {
      await updateTenantPropertyAssignments(tenant.id, propertyId, managerId, housekeepingAdminId, cleanerIds);
      showActionToast("success", "Property team assignments saved.");
      onUpdated();
      setIsLoading(true);
      await loadDetails();
    } catch (error) {
      showActionToast("error", error instanceof Error ? error.message : "Unable to update property assignments.");
    }
  });

  const selectPreset = (nextPreset: DatePreset) => {
    setPreset(nextPreset);
    if (nextPreset === "custom") {
      if (page !== 1) {
        setIsLoading(true);
        setPage(1);
      }
      return;
    }
    setPage(1);
    setIsLoading(true);
    const today = new Date();
    const formatDate = (date: Date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };
    if (nextPreset === "all") {
      setFilter({ from: null, to: null });
      return;
    }
    if (nextPreset === "month") {
      setFilter({ from: formatDate(new Date(today.getFullYear(), today.getMonth(), 1)), to: formatDate(today) });
      return;
    }
    const from = new Date(today);
    from.setDate(from.getDate() - 29);
    setFilter({ from: formatDate(from), to: formatDate(today) });
  };

  const exportLogs = async (format: "csv" | "xlsx") => {
    setIsExporting(true);
    try {
      const logs = await getTenantWorkLogExport(tenant.id, filter);
      const filename = `tenant-work-history-${tenant.id.slice(0, 8)}`;
      if (format === "csv") {
        const headers = ["Log ID", "Date", "Worker", "Property", "Service", "Status", "Start", "End", "Hours", "Room count", "Room identifiers", "Cost (USD)", "Priority", "Due at", "Created at", "Locked", "Manager approval", "Manager approved at", "Owner approval", "Owner approved at", "Rejection notes", "Notes", "Complete source record (JSON)"];
        const rows = logs.map((log) => [
          log.id,
          log.task_date ?? log.start_time.slice(0, 10),
          log.cleanerName,
          log.hotelName,
          log.serviceName,
          log.status,
          log.start_time,
          log.end_time ?? "",
          duration(log).toFixed(2),
          log.rooms_completed,
          log.room_numbers.length ? log.room_numbers.join(", ") : log.room_number ?? "",
          calculateTenantLogCost(log).toFixed(2),
          log.priority,
          log.due_at ?? "",
          log.created_at,
          log.is_locked,
          log.manager_approved,
          log.manager_approved_at ?? "",
          log.owner_approved,
          log.owner_approved_at ?? "",
          log.rejection_notes ?? "",
          log.notes ?? "",
          JSON.stringify(log),
        ]);
        const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
        download(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }), `${filename}.csv`);
      } else {
        exportXlsx(logs, filename);
      }
      showActionToast("success", `Exported ${logs.length.toLocaleString()} work logs.`);
    } catch (error) {
      showActionToast("error", error instanceof Error ? error.message : "Unable to export tenant history.");
    } finally {
      setIsExporting(false);
    }
  };

  const pageCount = Math.max(1, Math.ceil((details?.logCount ?? 0) / (details?.pageSize ?? 15)));

  return (
    <AnimatePresence>
      <motion.div
        key="tenant-details-backdrop"
        className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-2 backdrop-blur-md sm:p-5"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        onMouseDown={(event) => { if (event.target === event.currentTarget && !confirmDeactivate) onClose(); }}
      >
        <motion.section
          role="dialog"
          aria-modal="true"
          aria-labelledby="tenant-details-title"
          className="flex h-[min(94dvh,920px)] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-white/60 bg-surface-secondary shadow-2xl shadow-slate-950/30"
          initial={{ opacity: 0, scale: 0.97, y: 18 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.98, y: 10 }}
          transition={{ type: "spring", stiffness: 300, damping: 28 }}
        >
          <header className="relative shrink-0 overflow-hidden border-b border-line bg-surface px-5 py-5 sm:px-7">
            <div className="pointer-events-none absolute -right-12 -top-20 h-56 w-56 rounded-full bg-sky-100/70 blur-3xl" />
            <div className="relative flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                {details?.owner.avatarUrl
                  ? <Image src={details.owner.avatarUrl} alt="" width={56} height={56} unoptimized className="h-12 w-12 rounded-2xl object-cover ring-1 ring-line sm:h-14 sm:w-14" />
                  : <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-slate-950 text-lg font-bold text-white sm:h-14 sm:w-14">{tenant.name.trim().charAt(0).toUpperCase()}</div>}
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-sky-800">Tenant account · Owner</p>
                  <h2 id="tenant-details-title" className="mt-1 truncate text-xl font-bold tracking-tight text-ink sm:text-2xl">{details?.owner.fullName ?? tenant.name}</h2>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${details?.owner.isActive ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${details?.owner.isActive ? "bg-emerald-500" : "bg-rose-500"}`} />
                      {details?.owner.isActive ? "Active" : "Deactivated"}
                    </span>
                    <span className="text-xs text-ink-muted">Joined {dateLabel(details?.owner.createdAt ?? tenant.joinedAt)}</span>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button type="button" onClick={onClose} aria-label="Close tenant details" className="grid h-10 w-10 place-items-center rounded-xl text-ink-muted transition hover:bg-surface-secondary hover:text-ink"><X className="h-5 w-5" /></button>
              </div>
            </div>
          </header>

          <nav aria-label="Tenant details sections" className="flex shrink-0 gap-1 overflow-x-auto border-b border-line bg-surface px-4 py-2 sm:px-6">
            {TABS.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => setTab(id)} aria-current={tab === id ? "page" : undefined} className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-3 text-xs font-semibold transition sm:px-4 sm:text-sm ${tab === id ? "bg-slate-950 text-white shadow-sm" : "text-ink-secondary hover:bg-surface-secondary hover:text-ink"}`}><Icon className="h-4 w-4" />{label}</button>)}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
            {isLoading ? <Skeleton /> : loadError ? <div className="m-5 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800" role="alert"><p className="font-semibold">Tenant details could not be loaded.</p><p className="mt-1">{loadError}</p><button type="button" onClick={() => { setIsLoading(true); void loadDetails(); }} className="mt-3 rounded-lg bg-rose-700 px-3 py-2 font-semibold text-white">Retry</button></div> : details && (
              <AnimatePresence mode="wait">
                <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16 }} className="space-y-5">
                  {tab === "overview" && <OverviewTab details={details} isEditing={isEditing} draft={profileDraft} setDraft={setProfileDraft} isPending={isPending} onNavigate={setTab} onEdit={() => setIsEditing(true)} onCancel={() => { setIsEditing(false); setProfileDraft({ fullName: details.owner.fullName, email: details.owner.email, phoneNumber: details.owner.phoneNumber ?? "" }); }} onSave={saveProfile} />}
                  {tab === "operations" && <OperationsTab details={details} isPending={isPending} onToggleProperty={toggleProperty} onSaveAssignments={saveAssignments} onSavePropertyDetails={savePropertyDetails} onArchiveProperty={archiveProperty} onTransferProperty={transferProperty} onReassignWorker={reassignWorker} onToggleWorkerStatus={toggleWorkerStatus} />}
                  {tab === "financials" && <FinancialsTab details={details} onSettle={markSettled} isPending={isPending} />}
                  {tab === "history" && <HistoryTab details={details} preset={preset} filter={filter} page={page} pageCount={pageCount} isExporting={isExporting} onPreset={selectPreset} onFilter={(nextFilter) => { setIsLoading(true); setFilter(nextFilter); setPage(1); }} onPage={(nextPage) => { setIsLoading(true); setPage(nextPage); }} onExport={exportLogs} />}
                </motion.div>
              </AnimatePresence>
            )}
          </div>
          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-line bg-surface px-4 py-3 sm:px-6">
            <p className="text-xs text-ink-muted">Tenant ID <span className="font-mono text-ink-secondary">{tenant.id}</span></p>
            <div className="flex items-center gap-2">
              {details?.owner.isActive
                ? <button type="button" disabled={isPending} onClick={() => { setConfirmDeactivate(true); setConfirmationText(""); }} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-rose-200 px-3 text-xs font-semibold text-rose-700 disabled:opacity-50"><UserX className="h-4 w-4" />Deactivate</button>
                : <button type="button" disabled={isPending} onClick={() => updateStatus(true)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-emerald-200 px-3 text-xs font-semibold text-emerald-700 disabled:opacity-50"><ShieldCheck className="h-4 w-4" />Reactivate</button>}
              <button type="button" onClick={onClose} className="min-h-10 rounded-xl border border-line px-4 text-xs font-semibold text-ink-secondary transition hover:bg-surface-secondary">Close</button>
            </div>
          </footer>
        </motion.section>

        <AnimatePresence>
          {confirmDeactivate && (
            <motion.div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <motion.section role="alertdialog" aria-modal="true" aria-labelledby="tenant-deactivation-title" className="w-full max-w-md rounded-2xl border border-rose-100 bg-surface p-5 shadow-2xl sm:p-6" initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, y: 4 }}>
                <div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-700"><ShieldAlert className="h-5 w-5" /></span><div><h3 id="tenant-deactivation-title" className="font-bold text-ink">Deactivate tenant account?</h3><p className="mt-1 text-sm leading-5 text-ink-secondary">This blocks future sign-in. Properties, work logs, settlements, and audit history are retained. This is reversible.</p></div></div>
                <label className="mt-5 block text-xs font-semibold text-ink-secondary">Type <span className="font-mono text-rose-700">DEACTIVATE</span> to confirm<input autoFocus value={confirmationText} onChange={(event) => setConfirmationText(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-line px-3 text-sm text-ink outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100" /></label>
                <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setConfirmDeactivate(false)} className="min-h-10 rounded-xl border border-line px-4 text-xs font-semibold text-ink-secondary">Cancel</button><button type="button" disabled={isPending || confirmationText !== "DEACTIVATE"} onClick={() => updateStatus(false)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-rose-700 px-4 text-xs font-semibold text-white disabled:opacity-40">{isPending && <Loader2 className="h-4 w-4 animate-spin" />}Deactivate account</button></div>
              </motion.section>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
}

function OverviewTab({ details, isEditing, draft, setDraft, isPending, onNavigate, onEdit, onCancel, onSave }: {
  details: TenantDetails;
  isEditing: boolean;
  draft: { fullName: string; email: string; phoneNumber: string };
  setDraft: (draft: { fullName: string; email: string; phoneNumber: string }) => void;
  isPending: boolean;
  onNavigate: (tab: TabId) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { owner } = details;
  return <>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Properties" value={owner.role === "owner" ? String(details.properties.length) : "—"} detail="Hotels currently owned by this account · Open Operations" icon={Building2} tone="sky" onClick={() => onNavigate("operations")} />
      <MetricCard label="Workforce" value={String(details.workforce.length)} detail="Managers and staff assigned to these properties · Open Operations" icon={UsersRound} tone="violet" onClick={() => onNavigate("operations")} />
      <MetricCard label="Historical tasks" value={details.metrics.taskCount.toLocaleString()} detail="Non-deleted, non-cancelled work logs · Open Work history" icon={CheckCircle2} tone="emerald" onClick={() => onNavigate("history")} />
      <MetricCard label="Labor cost" value={money(details.metrics.laborCost)} detail="Completed work in the selected history period · Open Financials" icon={CreditCard} tone="amber" onClick={() => onNavigate("financials")} />
    </div>
    <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <div className="mb-5 flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wide text-sky-800">Account profile</p><h3 className="mt-1 text-lg font-bold text-ink">Database fields</h3><p className="mt-1 text-sm text-ink-muted">Fields shown here are available on the current users schema.</p></div>{!isEditing && <button type="button" onClick={onEdit} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-line px-3 text-xs font-semibold text-ink-secondary transition hover:bg-surface-secondary"><Pencil className="h-4 w-4" />Edit contact</button>}</div>
      {isEditing ? <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tenant name"><input value={draft.fullName} onChange={(event) => setDraft({ ...draft, fullName: event.target.value })} className="mt-1.5 min-h-11 w-full rounded-xl border border-line px-3 text-sm text-ink outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100" /></Field>
        <Field label="Contact email"><input type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} className="mt-1.5 min-h-11 w-full rounded-xl border border-line px-3 text-sm text-ink outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100" /></Field>
        <Field label="Phone number"><input type="tel" value={draft.phoneNumber} onChange={(event) => setDraft({ ...draft, phoneNumber: event.target.value })} className="mt-1.5 min-h-11 w-full rounded-xl border border-line px-3 text-sm text-ink outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100" /></Field>
        <div className="flex items-end justify-end gap-2"><button type="button" onClick={onCancel} className="min-h-11 rounded-xl border border-line px-4 text-sm font-semibold text-ink-secondary">Cancel</button><button type="button" onClick={onSave} disabled={isPending} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-50">{isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save contact</button></div>
      </div> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <DataField icon={UserRound} label="Full name" value={owner.fullName} />
        <DataField icon={Mail} label="Contact email" value={owner.email} />
        <DataField icon={Phone} label="Phone number" value={owner.phoneNumber || "Not recorded"} />
        <DataField icon={CalendarDays} label="Created at" value={dateLabel(owner.createdAt)} />
        <DataField icon={Clock3} label="Last updated" value={dateLabel(owner.updatedAt)} />
        <DataField icon={CreditCard} label="Hourly rate" value={money(owner.hourlyRate)} />
        <DataField icon={Building2} label="Primary property" value={details.properties.find((property) => property.id === owner.primaryHotelId)?.name ?? "Not assigned"} />
        <DataField icon={UserRound} label="Language preference" value={owner.languagePreference} />
        <DataField icon={ShieldCheck} label="Role" value={owner.role} />
        <DataField icon={owner.isActive ? CheckCircle2 : UserX} label="Account status" value={owner.isActive ? "Active" : `Deactivated · ${dateLabel(owner.deactivatedAt)}`} />
      </div>}
      <div className="mt-6 rounded-xl border border-dashed border-line bg-surface-secondary px-4 py-3 text-xs leading-5 text-ink-secondary">Tax/VAT number, billing address, subscription tier, payment terms, and custom metadata are not columns in the current schema, so this view does not fabricate those fields.</div>
    </section>
  </>;
}

function OperationsTab({ details, isPending, onToggleProperty, onSaveAssignments, onSavePropertyDetails, onArchiveProperty, onTransferProperty, onReassignWorker, onToggleWorkerStatus }: {
  details: TenantDetails;
  isPending: boolean;
  onToggleProperty: (propertyId: string, isActive: boolean) => void;
  onSaveAssignments: (propertyId: string, managerId: string | null, housekeepingAdminId: string | null, cleanerIds: string[]) => void;
  onSavePropertyDetails: (propertyId: string, updates: { name: string; location: string; rooms: number; floors: number }) => Promise<boolean>;
  onArchiveProperty: (propertyId: string, archived: boolean) => Promise<boolean>;
  onTransferProperty: (propertyId: string, targetOwnerId: string) => Promise<boolean>;
  onReassignWorker: (workerId: string, propertyId: string) => Promise<boolean>;
  onToggleWorkerStatus: (workerId: string, workerName: string, isActive: boolean) => Promise<boolean>;
}) {
  const [editingPropertyId, setEditingPropertyId] = useState<string | null>(null);
  const [managerId, setManagerId] = useState<string | null>(null);
  const [housekeepingAdminId, setHousekeepingAdminId] = useState<string | null>(null);
  const [cleanerIds, setCleanerIds] = useState<string[]>([]);
  const [candidateSearch, setCandidateSearch] = useState("");
  const [staffSearch, setStaffSearch] = useState("");
  const [workforceSearch, setWorkforceSearch] = useState("");
  const [workforceRoleFilter, setWorkforceRoleFilter] = useState<"all" | "managers" | "cleaners">("all");
  const [reassigningWorker, setReassigningWorker] = useState<TenantDetails["workforce"][number] | null>(null);
  const [reassignPropertyId, setReassignPropertyId] = useState("");
  const [propertyActionId, setPropertyActionId] = useState<string | null>(null);
  const [propertyDialog, setPropertyDialog] = useState<"edit" | "archive" | "transfer" | null>(null);
  const [actionProperty, setActionProperty] = useState<TenantDetails["properties"][number] | null>(null);
  const [propertyDraft, setPropertyDraft] = useState({ name: "", location: "", rooms: 0, floors: 0 });
  const [targetOwnerId, setTargetOwnerId] = useState("");
  const [propertyConfirmation, setPropertyConfirmation] = useState("");
  const managerCandidates = details.assignmentCandidates.filter((candidate) => candidate.role === "manager" && candidate.isActive);
  const housekeepingAdminCandidates = details.assignmentCandidates.filter((candidate) => ["housekeeping_admin", "hk_admin"].includes(candidate.role) && candidate.isActive);
  const activeCleanerCandidates = details.assignmentCandidates
    .filter((candidate) => candidate.role === "cleaner" && candidate.isActive);
  const inactiveAssignedCleaners = details.workforce
    .filter((worker) => worker.role === "cleaner" && !worker.isActive && worker.propertyIds.includes(editingPropertyId ?? ""))
    .map((worker) => ({ id: worker.id, name: worker.name, email: worker.email, role: worker.role, isActive: false }));
  const cleanerCandidates = [...activeCleanerCandidates, ...inactiveAssignedCleaners];
  const filteredCleaners = cleanerCandidates.filter((candidate) =>
    `${candidate.name} ${candidate.email}`.toLowerCase().includes(candidateSearch.toLowerCase().trim())
  );
  const filteredStaff = (candidates: typeof managerCandidates) => candidates.filter((candidate) =>
    `${candidate.name} ${candidate.email}`.toLowerCase().includes(staffSearch.trim().toLowerCase())
  );
  const visibleWorkforce = details.workforce.filter((worker) => {
    const matchesText = `${worker.name} ${worker.email}`.toLowerCase().includes(workforceSearch.trim().toLowerCase());
    const matchesRole = workforceRoleFilter === "all"
      || (workforceRoleFilter === "managers" && ["manager", "housekeeping_admin", "hk_admin"].includes(worker.role))
      || (workforceRoleFilter === "cleaners" && worker.role === "cleaner");
    return matchesText && matchesRole;
  });
  const activeProperties = details.properties.filter((property) => property.isActive && !property.archivedAt);
  const openPropertyDialog = (property: TenantDetails["properties"][number], dialog: "edit" | "archive" | "transfer") => {
    setActionProperty(property);
    setPropertyDialog(dialog);
    setPropertyDraft({ name: property.name, location: property.location, rooms: property.storedTotalRooms, floors: property.floorCount });
    setTargetOwnerId("");
    setPropertyConfirmation("");
    setPropertyActionId(null);
  };
  const closePropertyDialog = () => {
    setActionProperty(null);
    setPropertyDialog(null);
    setPropertyConfirmation("");
  };
  const editAssignments = (property: TenantDetails["properties"][number]) => {
    setEditingPropertyId(property.id);
    setManagerId(property.managerId);
    setHousekeepingAdminId(details.workforce.find((worker) => ["housekeeping_admin", "hk_admin"].includes(worker.role) && worker.propertyIds.includes(property.id))?.id ?? null);
    setCleanerIds(details.workforce.filter((worker) => worker.role === "cleaner" && worker.propertyIds.includes(property.id)).map((worker) => worker.id));
    setCandidateSearch("");
    setStaffSearch("");
  };
  return <>
    <div className="grid gap-3 sm:grid-cols-3">
      <MetricCard label="Properties" value={String(details.properties.length)} detail="Owned properties, active and suspended" icon={Building2} tone="sky" />
      <MetricCard label="Rooms / units" value={details.properties.reduce((total, property) => total + property.totalRooms, 0).toLocaleString()} detail="Room counts from property and room records" icon={Search} tone="violet" />
      <MetricCard label="Assigned workforce" value={String(details.workforce.length)} detail={`${details.workforce.filter((worker) => worker.isActive).length} active accounts`} icon={UsersRound} tone="emerald" />
    </div>
    <section className="rounded-2xl border border-line bg-surface p-5">
      <h3 className="text-lg font-bold text-ink">Properties & management</h3>
      <p className="mt-1 text-sm text-ink-muted">Property ownership, location, capacity, and current manager.</p>
      <div className="mt-4 space-y-3">
        {details.properties.map((property) => <article key={property.id} className={`flex flex-col gap-4 rounded-xl border p-4 ${property.archivedAt ? "border-line bg-surface-secondary" : "border-line bg-surface"}`}>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><h4 className="font-semibold text-ink">{property.name}</h4><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${property.archivedAt ? "bg-slate-200 text-ink-secondary" : property.isActive ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>{property.archivedAt ? "Archived" : property.isActive ? "Active" : "Suspended"}</span>{property.archivedAt && <span className="text-xs text-ink-muted">Archived {dateLabel(property.archivedAt)}</span>}</div>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-muted"><MapPin className="h-3.5 w-3.5" />{property.location || "No location recorded"}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-secondary"><span>{property.totalRooms.toLocaleString()} rooms / units (effective)</span><span>{property.roomCount.toLocaleString()} room count · {property.storedTotalRooms.toLocaleString()} configured rooms</span><span>{property.floorCount.toLocaleString()} floors</span><span>Added {dateLabel(property.createdAt)}</span><span>Manager: {property.managerName ?? "Unassigned"}</span><span>{details.workforce.filter((worker) => worker.role === "cleaner" && worker.propertyIds.includes(property.id)).length} cleaners assigned</span></div>
            {property.managerEmail && <p className="mt-1 text-xs text-ink-muted">{property.managerEmail}</p>}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {!property.archivedAt && <button type="button" disabled={isPending} onClick={() => editAssignments(property)} className="min-h-10 rounded-xl border border-line px-3 text-xs font-semibold text-ink-secondary transition hover:bg-surface-secondary disabled:opacity-50">Manage team</button>}
            <div className="relative ml-auto">
              <button type="button" aria-label={`Property actions for ${property.name}`} aria-expanded={propertyActionId === property.id} disabled={isPending} onClick={() => setPropertyActionId((current) => current === property.id ? null : property.id)} className="grid h-10 w-10 place-items-center rounded-xl border border-line text-ink-secondary transition hover:border-line hover:bg-surface-secondary disabled:opacity-50"><MoreVertical className="h-5 w-5" /></button>
              {propertyActionId === property.id && <div className="absolute right-0 top-12 z-10 w-56 rounded-xl border border-line bg-surface p-1.5 shadow-xl">
                {!property.archivedAt && <><button type="button" onClick={() => { openPropertyDialog(property, "edit"); setPropertyActionId(null); }} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-semibold text-ink-secondary hover:bg-surface-secondary"><Pencil className="h-4 w-4" />Edit property</button>
                  <button type="button" onClick={() => { openPropertyDialog(property, "transfer"); setPropertyActionId(null); }} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-semibold text-ink-secondary hover:bg-surface-secondary"><ArrowRightLeft className="h-4 w-4" />Transfer tenant ownership</button>
                  <button type="button" disabled={isPending} onClick={() => { onToggleProperty(property.id, property.isActive); setPropertyActionId(null); }} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-semibold text-ink-secondary hover:bg-surface-secondary disabled:opacity-50"><ShieldCheck className="h-4 w-4" />{property.isActive ? "Suspend property" : "Activate property"}</button></>}
                <button type="button" onClick={() => { openPropertyDialog(property, "archive"); setPropertyActionId(null); }} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-semibold text-rose-700 hover:bg-rose-50"><Archive className="h-4 w-4" />{property.archivedAt ? "Restore property" : "Archive property"}</button>
              </div>}
            </div>
          </div>
          {editingPropertyId === property.id && !property.archivedAt && <div className="w-full rounded-xl border border-line bg-surface-secondary p-4">
            <div className="mb-3 flex flex-wrap gap-2 text-[11px] font-semibold">
              <span className="rounded-full bg-surface-secondary px-2.5 py-1 text-ink-secondary">Property Owner · {details.owner.fullName || "Tenant"}</span>
              <span className="rounded-full bg-surface-secondary px-2.5 py-1 text-ink-secondary">{managerId ? "1 Manager" : "No Manager"}</span>
              <span className="rounded-full bg-surface-secondary px-2.5 py-1 text-ink-secondary">{housekeepingAdminId ? "1 HK Admin" : "No HK Admin"}</span>
              <span className="rounded-full bg-surface-secondary px-2.5 py-1 text-ink-secondary">{cleanerIds.length} Cleaners assigned</span>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-3">
                <label className="block text-xs font-semibold text-ink-secondary">Search staff<input value={staffSearch} onChange={(event) => setStaffSearch(event.target.value)} placeholder="Search staff" className="mt-1.5 min-h-11 w-full rounded-lg border border-line bg-surface-secondary px-3 text-sm text-ink" /></label>
                <label className="block text-xs font-semibold text-ink-secondary">Property manager<select value={managerId ?? ""} onChange={(event) => setManagerId(event.target.value || null)} className="mt-1.5 min-h-11 w-full rounded-lg border border-line bg-surface-secondary px-3 text-sm text-ink">
                  <option value="">Unassigned</option>
                  {property.managerId && !managerCandidates.some((candidate) => candidate.id === property.managerId) && <option value={property.managerId} disabled>{property.managerName ?? "Current manager"} (inactive or unavailable)</option>}
                  {filteredStaff(managerCandidates).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} · Property Manager</option>)}
                </select></label>
                <label className="block text-xs font-semibold text-ink-secondary">Housekeeping Admin<select value={housekeepingAdminId ?? ""} onChange={(event) => setHousekeepingAdminId(event.target.value || null)} className="mt-1.5 min-h-11 w-full rounded-lg border border-line bg-surface-secondary px-3 text-sm text-ink">
                  <option value="">Unassigned</option>
                  {housekeepingAdminId && !housekeepingAdminCandidates.some((candidate) => candidate.id === housekeepingAdminId) && <option value={housekeepingAdminId} disabled>{details.workforce.find((worker) => worker.id === housekeepingAdminId)?.name ?? "Current Housekeeping Admin"} (inactive or unavailable)</option>}
                  {filteredStaff(housekeepingAdminCandidates).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} · Housekeeping Admin</option>)}
                </select></label>
              </div>
              <div><label className="block text-xs font-semibold text-ink-secondary" htmlFor={`cleaner-search-${property.id}`}>Assigned cleaners</label><div className="relative mt-1.5"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" /><input id={`cleaner-search-${property.id}`} value={candidateSearch} onChange={(event) => setCandidateSearch(event.target.value)} placeholder="Filter cleaners" className="min-h-11 w-full rounded-lg border border-line bg-surface-secondary pl-9 pr-3 text-sm text-ink" /></div>
                <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-line bg-surface p-2">
                  {filteredCleaners.map((candidate) => { const checked = cleanerIds.includes(candidate.id); return <label key={candidate.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-ink-secondary hover:bg-surface-secondary"><input type="checkbox" checked={checked} disabled={!candidate.isActive && !checked} onChange={(event) => setCleanerIds((current) => event.target.checked ? [...current, candidate.id] : current.filter((id) => id !== candidate.id))} /><span className="min-w-0"><span className="block truncate font-medium">{candidate.name}{!candidate.isActive && " · Inactive (remove)"}</span><span className="block truncate text-[10px] text-ink-muted">{candidate.email}</span></span></label>; })}
                  {!filteredCleaners.length && <p className="p-3 text-center text-xs text-ink-muted">No active cleaners match.</p>}
                </div>
              </div>
            </div>
            <div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setEditingPropertyId(null)} className="min-h-9 rounded-lg border border-line bg-surface-secondary px-3 text-xs font-semibold text-ink">Cancel</button><button type="button" disabled={isPending} onClick={() => onSaveAssignments(property.id, managerId, housekeepingAdminId, cleanerIds)} className="min-h-9 rounded-lg bg-accent px-3 text-xs font-semibold text-white hover:bg-accent-hover disabled:opacity-50">Save team assignments</button></div>
          </div>}
        </article>)}
        {!details.properties.length && <EmptyState title="No owned properties" text="No hotels are currently assigned to this owner account." />}
      </div>
    </section>
    <section className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><h3 className="text-lg font-bold text-ink">Assigned workforce</h3><p className="mt-1 text-sm text-ink-muted">People linked through primary property, manager assignment, or user-property assignments.</p></div>
        <div className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_160px]">
          <label className="relative block"><span className="sr-only">Search workforce by name or email</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" /><input value={workforceSearch} onChange={(event) => setWorkforceSearch(event.target.value)} placeholder="Search name or email" className="min-h-10 w-full rounded-lg border border-line pl-9 pr-3 text-xs text-ink outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100" /></label>
          <label className="block"><span className="sr-only">Filter workforce by role</span><select value={workforceRoleFilter} onChange={(event) => setWorkforceRoleFilter(event.target.value as typeof workforceRoleFilter)} className="min-h-10 w-full rounded-lg border border-line bg-surface px-3 text-xs font-medium text-ink-secondary"><option value="all">All roles</option><option value="managers">Managers</option><option value="cleaners">Cleaners</option></select></label>
        </div>
      </div>
      <div className="mt-4 divide-y divide-line rounded-xl border border-line">
        {visibleWorkforce.map((worker) => <div key={worker.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">{worker.name}</p><p className="truncate text-xs text-ink-muted">{worker.email}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[10px] font-semibold capitalize text-sky-800">{worker.role.replaceAll("_", " ")}</span>
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${worker.isActive ? "bg-emerald-50 text-emerald-800" : "bg-surface-secondary text-ink-secondary"}`}>{worker.isActive ? "Active" : "Inactive"}</span>
              <span className="text-xs text-ink-secondary">Assigned: {worker.propertyNames.join(", ") || "No property"}</span>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {activeProperties.length > 0 && <button type="button" disabled={isPending} onClick={() => { setReassigningWorker(worker); setReassignPropertyId(activeProperties.find((property) => !worker.propertyIds.includes(property.id))?.id ?? activeProperties[0].id); }} className="min-h-9 rounded-lg border border-line px-3 text-xs font-semibold text-ink-secondary hover:bg-surface-secondary disabled:opacity-50">Reassign Property</button>}
            <button type="button" disabled={isPending} onClick={() => void onToggleWorkerStatus(worker.id, worker.name, worker.isActive)} className={`min-h-9 rounded-lg border px-3 text-xs font-semibold disabled:opacity-50 ${worker.isActive ? "border-rose-200 text-rose-700 hover:bg-rose-50" : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"}`}>{worker.isActive ? "Deactivate" : "Activate"}</button>
          </div>
        </div>)}
        {!visibleWorkforce.length && <EmptyState title={details.workforce.length ? "No matching workforce" : "No assigned workforce"} text={details.workforce.length ? "Try another name, email, or role filter." : "No workers or managers are linked to these properties."} />}
      </div>
    </section>
    {reassigningWorker && <div className="fixed inset-0 z-[85] grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setReassigningWorker(null); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="reassign-worker-title" className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-2xl">
        <h3 id="reassign-worker-title" className="font-bold text-ink">Reassign property</h3><p className="mt-1 text-sm text-ink-secondary">{reassigningWorker.name} · {reassigningWorker.role.replaceAll("_", " ")}</p>
        <label className="mt-4 block text-xs font-semibold text-ink-secondary">Active property<select value={reassignPropertyId} onChange={(event) => setReassignPropertyId(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink">{activeProperties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label>
        <p className="mt-3 text-xs leading-5 text-ink-muted">For cleaners, this updates their primary property and linked assignment. For managers, it changes the property’s assigned manager.</p>
        <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setReassigningWorker(null)} className="min-h-10 rounded-lg border border-line px-3 text-xs font-semibold text-ink-secondary">Cancel</button><button type="button" disabled={isPending || !reassignPropertyId} onClick={async () => { if (await onReassignWorker(reassigningWorker.id, reassignPropertyId)) setReassigningWorker(null); }} className="min-h-10 rounded-lg bg-slate-950 px-3 text-xs font-semibold text-white disabled:opacity-50">Save assignment</button></div>
      </section>
    </div>}
    {actionProperty && propertyDialog && <PropertyActionDialog
      property={actionProperty}
      dialog={propertyDialog}
      draft={propertyDraft}
      setDraft={setPropertyDraft}
      tenantCandidates={details.tenantCandidates}
      targetOwnerId={targetOwnerId}
      setTargetOwnerId={setTargetOwnerId}
      confirmation={propertyConfirmation}
      setConfirmation={setPropertyConfirmation}
      isPending={isPending}
      onClose={closePropertyDialog}
      onSaveDetails={async () => { if (await onSavePropertyDetails(actionProperty.id, propertyDraft)) closePropertyDialog(); }}
      onArchive={async () => { if (await onArchiveProperty(actionProperty.id, !actionProperty.archivedAt)) closePropertyDialog(); }}
      onTransfer={async () => { if (await onTransferProperty(actionProperty.id, targetOwnerId)) closePropertyDialog(); }}
    />}
  </>;
}

function FinancialsTab({ details, onSettle, isPending }: { details: TenantDetails; onSettle: () => void; isPending: boolean }) {
  const outstanding = Math.max(0, details.metrics.currentCycleAmountDue - details.metrics.currentCycleSettledAmount);
  return <>
    <section className="grid gap-3 rounded-2xl border border-line bg-surface p-4 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center sm:px-5">
      <div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-muted">Current cycle outstanding</p><p className="mt-1 text-xl font-bold tabular-nums text-ink">{money(outstanding)}</p></div>
      <div className="text-xs text-ink-secondary"><span className="block text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Billed</span><span className="mt-1 block font-semibold tabular-nums text-ink">{money(details.metrics.currentCycleAmountDue)}</span></div>
      <div className="text-xs text-ink-secondary"><span className="block text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Settled</span><span className="mt-1 block font-semibold tabular-nums text-ink">{money(details.metrics.currentCycleSettledAmount)}</span></div>
      <button type="button" disabled={isPending || !details.metrics.completedTasks || outstanding <= 0} onClick={onSettle} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"><Check className="h-4 w-4" />Settle cycle</button>
    </section>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Current cycle billed" value={money(details.metrics.currentCycleAmountDue)} detail={`${details.metrics.completedTasks.toLocaleString()} completed tasks × ${money(details.metrics.ratePerTask)} per task`} icon={CreditCard} tone="sky" />
      <MetricCard label="Current cycle settled" value={money(details.metrics.currentCycleSettledAmount)} detail="Recorded against the current settlement cycle" icon={CheckCircle2} tone="emerald" />
      <MetricCard label="Outstanding balance" value={money(outstanding)} detail="Current cycle billed less recorded settlement" icon={ShieldAlert} tone="amber" />
      <MetricCard label="Historical labor cost" value={money(details.metrics.laborCost)} detail="Calculated from completed work logs" icon={Clock3} tone="violet" />
    </div>
    <section className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-lg font-bold text-ink">Settlement ledger</h3><p className="mt-1 text-sm text-ink-muted">Recorded cycles from the existing tenant_settlements table.</p></div><button type="button" disabled={isPending || outstanding <= 0} onClick={onSettle} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"><Check className="h-4 w-4" />Settle current cycle</button></div>
      <div className="mt-4 overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[640px] text-left text-sm"><thead className="bg-surface-secondary text-xs font-semibold uppercase tracking-wide text-ink-muted"><tr><th className="px-4 py-3">Cycle</th><th className="px-4 py-3 text-right">Tasks</th><th className="px-4 py-3 text-right">Settled amount</th><th className="px-4 py-3">Recorded</th><th className="px-4 py-3">Status</th></tr></thead><tbody className="divide-y divide-line">
          {details.settlements.map((settlement) => <tr key={settlement.id}><td className="px-4 py-3 text-ink-secondary">{dateLabel(settlement.cycleStart)} – {dateLabel(settlement.cycleEnd)}</td><td className="px-4 py-3 text-right tabular-nums text-ink-secondary">{settlement.settledTaskCount.toLocaleString()}</td><td className="px-4 py-3 text-right font-semibold tabular-nums text-ink">{money(settlement.settledAmount)}</td><td className="px-4 py-3 text-ink-secondary">{dateLabel(settlement.settledAt)}</td><td className="px-4 py-3"><span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800"><CheckCircle2 className="h-3.5 w-3.5" />Recorded</span></td></tr>)}
          {!details.settlements.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-ink-muted">No settlement records yet.</td></tr>}
        </tbody></table>
      </div>
      <p className="mt-4 rounded-xl border border-dashed border-line bg-surface-secondary px-4 py-3 text-xs leading-5 text-ink-secondary">The current database has no invoice, billing-record, platform-fee, payout-status, or per-tenant billing-rate tables. The figures above use the existing per-completed-task charge and settlement records; invoice generation and manual invoice adjustments are unavailable until those tables exist.</p>
    </section>
  </>;
}

function HistoryTab({ details, preset, filter, page, pageCount, isExporting, onPreset, onFilter, onPage, onExport }: {
  details: TenantDetails;
  preset: DatePreset;
  filter: DateFilter;
  page: number;
  pageCount: number;
  isExporting: boolean;
  onPreset: (preset: DatePreset) => void;
  onFilter: (filter: DateFilter) => void;
  onPage: (page: number) => void;
  onExport: (format: "csv" | "xlsx") => void;
}) {
  const presets: { id: DatePreset; label: string }[] = [{ id: "all", label: "All time" }, { id: "month", label: "This month" }, { id: "30days", label: "Last 30 days" }, { id: "custom", label: "Custom range" }];
  return <>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Work logs" value={details.metrics.taskCount.toLocaleString()} detail={`${details.metrics.completedTasks.toLocaleString()} completed in selected date range`} icon={CheckCircle2} tone="sky" />
      <MetricCard label="Clean hours" value={`${details.metrics.completedHours.toFixed(1)} h`} detail="Completed logs with recorded clock-out" icon={Clock3} tone="violet" />
      <MetricCard label="Labor cost" value={money(details.metrics.laborCost)} detail="Calculated from stored service rates and overrides" icon={CreditCard} tone="emerald" />
      <MetricCard
        label="Efficiency score"
        value={details.metrics.efficiencyScore === null ? "Not enough data" : `${details.metrics.efficiencyScore}%`}
        detail={details.metrics.efficiencyTaskCount
          ? `Weighted across ${details.metrics.efficiencyTaskCount} timed tasks using a 2 rooms/hour target or each task's scheduled duration.`
          : "Room tasks need room counts; other tasks need a scheduled duration to be scored."}
        icon={ShieldAlert}
        tone="amber"
      />
    </div>
    <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-col gap-4 border-b border-line pb-4 xl:flex-row xl:items-end xl:justify-between">
        <div><h3 className="font-bold text-ink">Complete work history</h3><p className="mt-1 text-sm text-ink-muted">Date-filtered logs across all properties currently owned by this tenant.</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1 rounded-xl bg-surface-secondary p-1">{presets.map((item) => <button key={item.id} type="button" onClick={() => onPreset(item.id)} className={`min-h-8 rounded-lg px-2.5 text-xs font-semibold transition ${preset === item.id ? "bg-surface text-ink shadow-sm" : "text-ink-secondary hover:text-ink"}`}>{item.label}</button>)}</div>
          {preset === "custom" && <div className="flex items-center gap-2"><label className="sr-only" htmlFor="tenant-history-from">From</label><input id="tenant-history-from" type="date" value={filter.from ?? ""} onChange={(event) => onFilter({ ...filter, from: event.target.value || null })} className="min-h-10 rounded-lg border border-line px-2 text-xs text-ink-secondary" /><span className="text-xs text-ink-muted">to</span><label className="sr-only" htmlFor="tenant-history-to">To</label><input id="tenant-history-to" type="date" value={filter.to ?? ""} onChange={(event) => onFilter({ ...filter, to: event.target.value || null })} className="min-h-10 rounded-lg border border-line px-2 text-xs text-ink-secondary" /></div>}
          <div className="flex gap-2">
            <button type="button" disabled={isExporting} onClick={() => onExport("csv")} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-semibold text-ink-secondary hover:bg-surface-secondary disabled:opacity-50">{isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}CSV</button>
            <button type="button" disabled={isExporting} onClick={() => onExport("xlsx")} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-semibold text-ink-secondary hover:bg-surface-secondary disabled:opacity-50"><FileSpreadsheet className="h-4 w-4" />Excel</button>
          </div>
        </div>
      </div>
      <div className="mt-4 overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[1050px] text-left text-sm">
          <thead className="bg-surface-secondary text-xs font-semibold uppercase tracking-wide text-ink-muted"><tr><th className="px-3 py-3">Date / worker</th><th className="px-3 py-3">Property / service</th><th className="px-3 py-3">Time / priority</th><th className="px-3 py-3 text-right">Hours</th><th className="px-3 py-3 text-right">Rooms</th><th className="px-3 py-3">Approvals</th><th className="px-3 py-3 text-right">Cost</th></tr></thead>
          <tbody className="divide-y divide-line">
            {details.logs.map((log) => <tr key={log.id} className="hover:bg-surface-secondary/80">
              <td className="px-3 py-3"><p className="font-medium text-ink">{log.task_date ?? dateLabel(log.start_time)}</p><p className="mt-0.5 text-xs text-ink-muted">{log.cleanerName}</p><p className="mt-0.5 text-[10px] text-ink-muted" title={`Created ${new Date(log.created_at).toLocaleString()}`}>Log {log.id.slice(0, 8)}</p></td>
              <td className="px-3 py-3"><p className="font-medium text-ink-secondary">{log.hotelName}</p><p className="mt-0.5 text-xs text-ink-muted">{log.serviceName}</p><details className="mt-1 max-w-64 text-xs text-ink-muted"><summary className="cursor-pointer font-medium text-sky-800">Task details</summary><div className="mt-2 space-y-1 break-words"><p>Rooms: {log.room_numbers.join(", ") || log.room_number || "Not recorded"} ({log.room_ids.length} linked room IDs)</p><p>Service snapshot: {log.service_description_snapshot || log.service.description || "Not recorded"}</p><p>Billing: {log.service.unit || "hourly"} · {money(Number(log.service.default_rate ?? 0))} base rate · {log.cost_override == null ? "no cost override" : `override ${money(Number(log.cost_override))}`}</p><p>Travel time included: {log.travel_time_included ? "Yes" : "No"} · shift {log.shift_id ?? "not linked"}</p><p>Owner: {log.owner_name || "Not recorded"} ({log.owner_id || "no ID"})</p><p>Manager: {log.manager_name || "Not recorded"} ({log.manager_id || "no ID"})</p><p>Assigned by {log.assigned_by || "not recorded"} · assigned to {log.assigned_to || "not recorded"}{log.assigned_at ? ` on ${dateLabel(log.assigned_at)}` : ""}</p><p>Responsibility recorded: {dateLabel(log.responsibility_recorded_at)} · last updated {dateLabel(log.updated_at)}</p><p>Import key: {log.import_key || "Not imported"}</p>{Object.keys(log.dispatch_metadata).length > 0 && <p>Dispatch metadata: {JSON.stringify(log.dispatch_metadata)}</p>}{log.notes && <p>Note: {log.notes}</p>}{log.rejection_notes && <p className="text-rose-700">Rejection: {log.rejection_notes}</p>}</div></details></td>
              <td className="px-3 py-3 text-xs text-ink-secondary"><p>{new Date(log.start_time).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })} – {log.end_time ? new Date(log.end_time).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : "In progress"}</p><p className="mt-0.5 capitalize">{log.status} · {log.priority}</p>{log.due_at && <p className="mt-0.5 text-ink-muted">Due {dateLabel(log.due_at)}</p>}</td>
              <td className="px-3 py-3 text-right tabular-nums text-ink-secondary">{duration(log).toFixed(2)}</td>
              <td className="px-3 py-3 text-right tabular-nums text-ink-secondary">{log.rooms_completed.toLocaleString()}</td>
              <td className="px-3 py-3 text-xs"><p title={log.manager_approved_at ? `Approved ${dateLabel(log.manager_approved_at)}` : undefined} className={log.manager_approved ? "text-emerald-700" : log.manager_rejected ? "text-rose-700" : "text-amber-700"}>Manager · {log.manager_approved ? "Approved" : log.manager_rejected ? "Rejected" : "Pending"}</p><p title={log.owner_approved_at ? `Approved ${dateLabel(log.owner_approved_at)}` : undefined} className={log.owner_approved ? "mt-1 text-emerald-700" : log.owner_rejected ? "mt-1 text-rose-700" : "mt-1 text-amber-700"}>Owner · {log.owner_approved ? "Approved" : log.owner_rejected ? "Rejected" : "Pending"}</p>{log.is_locked && <span className="mt-1 inline-flex rounded-full bg-surface-secondary px-2 py-0.5 text-[10px] font-semibold text-ink-secondary">Locked</span>}</td>
              <td className="px-3 py-3 text-right font-semibold tabular-nums text-ink">{money(calculateTenantLogCost(log))}</td>
            </tr>)}
            {!details.logs.length && <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-ink-muted">No work logs match this date range.</td></tr>}
          </tbody>
        </table>
      </div>
      <DashboardPagination currentPage={page} pageCount={pageCount} total={details.logCount} pageSize={details.pageSize} label="work logs" onPageChange={onPage} />
      <div className="mt-2 flex items-center justify-end gap-1 text-xs text-ink-muted"><Download className="h-3.5 w-3.5" />Exports include all records matching the selected dates.</div>
    </section>
  </>;
}

function DataField({ icon: Icon, label, value }: { icon: typeof UserRound; label: string; value: string }) {
  return <div className="flex min-w-0 items-start gap-3 rounded-xl border border-line bg-surface-secondary/70 p-3"><Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" /><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-wide text-ink-muted">{label}</p><p className="mt-1 break-words text-sm font-medium text-ink">{value}</p></div></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs font-semibold text-ink-secondary">{label}{children}</label>;
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className="p-6 text-center"><p className="text-sm font-semibold text-ink-secondary">{title}</p><p className="mt-1 text-xs text-ink-muted">{text}</p></div>;
}

function PropertyActionDialog({ property, dialog, draft, setDraft, tenantCandidates, targetOwnerId, setTargetOwnerId, confirmation, setConfirmation, isPending, onClose, onSaveDetails, onArchive, onTransfer }: {
  property: TenantDetails["properties"][number];
  dialog: "edit" | "archive" | "transfer";
  draft: { name: string; location: string; rooms: number; floors: number };
  setDraft: (draft: { name: string; location: string; rooms: number; floors: number }) => void;
  tenantCandidates: TenantDetails["tenantCandidates"];
  targetOwnerId: string;
  setTargetOwnerId: (ownerId: string) => void;
  confirmation: string;
  setConfirmation: (value: string) => void;
  isPending: boolean;
  onClose: () => void;
  onSaveDetails: () => void;
  onArchive: () => void;
  onTransfer: () => void;
}) {
  const isRestore = dialog === "archive" && Boolean(property.archivedAt);
  const title = dialog === "edit" ? "Edit property" : dialog === "transfer" ? "Transfer property ownership" : isRestore ? "Restore property" : "Archive property";
  const confirmed = confirmation === property.name;
  return <div className="fixed inset-0 z-[85] grid place-items-center bg-slate-950/60 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !isPending) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="property-action-title" className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-2xl sm:p-6">
      <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-sky-800">Property management</p><h3 id="property-action-title" className="mt-1 text-lg font-bold text-ink">{title}</h3><p className="mt-1 text-sm text-ink-secondary">{property.name}</p></div><button type="button" disabled={isPending} aria-label="Close dialog" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg text-ink-muted hover:bg-surface-secondary disabled:opacity-50"><X className="h-4 w-4" /></button></div>
      {dialog === "edit" && <div className="mt-5 grid gap-4">
        <label className="block text-xs font-semibold text-ink-secondary">Property name<input maxLength={120} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="mt-1.5 min-h-11 w-full rounded-lg border border-line px-3 text-sm text-ink" /></label>
        <label className="block text-xs font-semibold text-ink-secondary">Address / location<input maxLength={240} value={draft.location} onChange={(event) => setDraft({ ...draft, location: event.target.value })} className="mt-1.5 min-h-11 w-full rounded-lg border border-line px-3 text-sm text-ink" /></label>
        <div className="grid gap-3 sm:grid-cols-2"><label className="block text-xs font-semibold text-ink-secondary">Rooms / units<input type="number" min={0} max={2000} step={1} value={draft.rooms} onChange={(event) => setDraft({ ...draft, rooms: Number(event.target.value) })} className="mt-1.5 min-h-11 w-full rounded-lg border border-line px-3 text-sm text-ink" /></label><label className="block text-xs font-semibold text-ink-secondary">Floors<input type="number" min={0} max={200} step={1} value={draft.floors} onChange={(event) => setDraft({ ...draft, floors: Number(event.target.value) })} className="mt-1.5 min-h-11 w-full rounded-lg border border-line px-3 text-sm text-ink" /></label></div>
      </div>}
      {dialog === "transfer" && <div className="mt-5 space-y-4">
        <label className="block text-xs font-semibold text-ink-secondary">Transfer to tenant<select value={targetOwnerId} onChange={(event) => setTargetOwnerId(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink"><option value="">Select an active tenant…</option>{tenantCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.email}</option>)}</select></label>
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">This changes the property’s tenant ownership. Historical work logs and performance summaries are retained and will be associated with the new owner through the property.</p>
        <label className="block text-xs font-semibold text-ink-secondary">Type <span className="font-mono">{property.name}</span> to confirm<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-lg border border-line px-3 text-sm text-ink" /></label>
      </div>}
      {dialog === "archive" && <div className="mt-5 space-y-4">
        <p className={`rounded-xl border p-3 text-sm leading-5 ${isRestore ? "border-sky-200 bg-sky-50 text-sky-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>{isRestore ? "Restoring makes this property available in administrative lists again. It remains suspended until explicitly activated." : "This soft-archives the property, suspends operations, and hides it from active operational lists. Existing rooms and work-log history are retained; nothing is hard-deleted."}</p>
        {!isRestore && <label className="block text-xs font-semibold text-ink-secondary">Type <span className="font-mono">{property.name}</span> to confirm<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-lg border border-line px-3 text-sm text-ink" /></label>}
      </div>}
      <div className="mt-6 flex justify-end gap-2"><button type="button" disabled={isPending} onClick={onClose} className="min-h-10 rounded-lg border border-line px-4 text-xs font-semibold text-ink-secondary">Cancel</button>
        {dialog === "edit" && <button type="button" disabled={isPending || !draft.name.trim() || !draft.location.trim()} onClick={onSaveDetails} className="min-h-10 rounded-lg bg-slate-950 px-4 text-xs font-semibold text-white disabled:opacity-40">Save changes</button>}
        {dialog === "transfer" && <button type="button" disabled={isPending || !targetOwnerId || !confirmed} onClick={onTransfer} className="min-h-10 rounded-lg bg-amber-700 px-4 text-xs font-semibold text-white disabled:opacity-40">Transfer ownership</button>}
        {dialog === "archive" && <button type="button" disabled={isPending || (!isRestore && !confirmed)} onClick={onArchive} className={`min-h-10 rounded-lg px-4 text-xs font-semibold text-white disabled:opacity-40 ${isRestore ? "bg-sky-700" : "bg-rose-700"}`}>{isRestore ? "Restore property" : "Archive property"}</button>}
      </div>
    </section>
  </div>;
}
