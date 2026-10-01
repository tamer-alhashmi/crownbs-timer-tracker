"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Download, FileSpreadsheet, FileText, Pencil, Trash2, X } from "lucide-react";
import { strToU8, zipSync } from "fflate";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { calculateTaskCost, resolveBillingUnit, resolveServiceRate } from "@/lib/servicePricing";
import type { ServiceRecord } from "./serviceActions";
import { deletePayrollTask, updatePayrollTask } from "./actions";
import { DashboardPagination } from "@/components/dashboard/DashboardPagination";

type PayrollService = { name?: string | null; description?: string | null; default_rate?: number | string | null; unit?: string | null };
const EXPORT_COLUMNS = [
  "Work log ID", "User ID", "Hotel ID", "Service ID", "Shift ID", "Task date/time", "Started at (UTC)", "Ended at (UTC)", "Task date", "Status", "Payroll locked",
  "Cleaner", "Cleaner email", "Hotel", "Hotel location", "Service", "Service description", "Billing unit", "Rate (GBP)",
  "Duration hours", "Rooms completed", "Room number", "Room numbers", "Room IDs", "Travel time included", "Notes",
  "Manager name", "Manager ID", "Manager approved", "Manager approved at", "Manager rejected", "Manager rejected at",
  "Owner name", "Owner ID", "Owner approved", "Owner approved at", "Owner rejected", "Owner rejected at",
  "Responsibility snapshot at", "Rejection notes", "Created at", "Updated at", "Import key", "Cost (GBP)",
] as const;
type ExportColumn = typeof EXPORT_COLUMNS[number];
type ExportRow = Record<ExportColumn, string | number | boolean>;
type TaskForm = { serviceId: string; roomsCompleted: string; notes: string; cost: string };
export type PayrollLog = {
  id: string;
  user_id?: string;
  hotel_id?: string;
  service_id?: string;
  shift_id?: string | null;
  cleanerName: string;
  cleanerEmail?: string;
  hotelName: string;
  hotelLocation?: string;
  start_time: string;
  end_time: string | null;
  task_date: string;
  status?: string;
  rooms_completed: number;
  room_number?: string | null;
  room_numbers?: string[];
  room_ids?: string[];
  service_name_snapshot?: string | null;
  service_description_snapshot?: string | null;
  notes?: string | null;
  travel_time_included?: boolean;
  manager_approved?: boolean;
  owner_approved?: boolean;
  manager_approved_at?: string | null;
  owner_approved_at?: string | null;
  manager_rejected?: boolean;
  owner_rejected?: boolean;
  manager_rejected_at?: string | null;
  owner_rejected_at?: string | null;
  rejection_notes?: string | null;
  owner_id?: string | null;
  owner_name?: string | null;
  manager_id?: string | null;
  manager_name?: string | null;
  responsibility_recorded_at?: string | null;
  import_key?: string | null;
  is_locked?: boolean;
  cost_override?: number | string | null;
  created_at?: string;
  updated_at?: string;
  services_config: PayrollService[];
};

function excelColumn(index: number) {
  let number = index + 1;
  let result = "";
  while (number > 0) {
    const remainder = (number - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    number = Math.floor((number - 1) / 26);
  }
  return result;
}

function xmlEscape(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function durationHours(log: PayrollLog) {
  return log.end_time ? Math.max(0, (Date.parse(log.end_time) - Date.parse(log.start_time)) / 3_600_000) : 0;
}

function downloadFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function AdminPayrollTable({ logs, services, hotels, cleaners, canManageTasks }: {
  logs: PayrollLog[];
  services: ServiceRecord[];
  hotels: { id: string; name: string }[];
  cleaners: { id: string; name: string; primary_hotel_id?: string | null }[];
  canManageTasks: boolean;
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [selectedHotelId, setSelectedHotelId] = useState("");
  const [selectedCleanerId, setSelectedCleanerId] = useState("");
  const [page, setPage] = useState(1);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<PayrollLog | null>(null);
  const [taskForm, setTaskForm] = useState<TaskForm>({ serviceId: "", roomsCompleted: "0", notes: "", cost: "0" });
  const [deletingTask, setDeletingTask] = useState<PayrollLog | null>(null);
  const [taskMessage, setTaskMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [isTaskPending, startTaskTransition] = useTransition();
  const hotelNames = new Map(hotels.map((hotel) => [hotel.id, hotel.name]));
  const cleanerNames = new Map(cleaners.map((cleaner) => [cleaner.id, cleaner.name]));
  const filteredLogs = logs
    .filter((log) => log.task_date >= from && log.task_date <= to)
    .filter((log) => !selectedHotelId || log.hotel_id === selectedHotelId)
    .filter((log) => !selectedCleanerId || log.user_id === selectedCleanerId)
    .sort((left, right) => right.start_time.localeCompare(left.start_time));
  const scopedCleaners = selectedHotelId
    ? cleaners.filter((cleaner) => cleaner.primary_hotel_id === selectedHotelId || logs.some((log) => log.hotel_id === selectedHotelId && log.user_id === cleaner.id && log.task_date >= from && log.task_date <= to))
    : cleaners;
  const pageCount = Math.max(1, Math.ceil(filteredLogs.length / 30));
  const currentPage = Math.min(page, pageCount);
  const visibleLogs = filteredLogs.slice((currentPage - 1) * 30, currentPage * 30);
  const totals = filteredLogs.reduce((total, log) => {
    const hours = durationHours(log);
    const service = log.services_config[0] ?? {};
    return {
      hours: total.hours + hours,
      rooms: total.rooms + log.rooms_completed,
      cost: total.cost + calculateTaskCost(hours, log.rooms_completed, service, log.cost_override),
    };
  }, { hours: 0, rooms: 0, cost: 0 });
  const exportRows: ExportRow[] = filteredLogs.map((log) => {
    const service = log.services_config[0] ?? {};
    const rate = resolveServiceRate(service);
    const unit = resolveBillingUnit(service.unit, service.name ?? "");
    const hours = durationHours(log);
    const serviceName = log.service_name_snapshot ?? service.name ?? "Service";
    return {
      "Work log ID": log.id,
      "User ID": log.user_id ?? "",
      "Hotel ID": log.hotel_id ?? "",
      "Service ID": log.service_id ?? "",
      "Shift ID": log.shift_id ?? "",
      "Task date/time": new Date(log.start_time).toLocaleString("en-GB", { timeZone: "Africa/Cairo" }),
      "Started at (UTC)": log.start_time,
      "Ended at (UTC)": log.end_time ?? "",
      "Task date": log.task_date,
      Status: log.status ?? "completed",
      "Payroll locked": log.is_locked ?? true,
      Cleaner: log.cleanerName,
      "Cleaner email": log.cleanerEmail ?? "",
      Hotel: log.hotelName,
      "Hotel location": log.hotelLocation ?? "",
      Service: serviceName,
      "Service description": log.service_description_snapshot ?? service.description ?? "",
      "Billing unit": unit === "hourly" ? "Hourly" : unit === "per_room" ? "Per room" : "Fixed per task",
      "Rate (GBP)": rate,
      "Duration hours": Number(hours.toFixed(2)),
      "Rooms completed": log.rooms_completed,
      "Room number": log.room_number ?? "",
      "Room numbers": (log.room_numbers ?? []).join(", "),
      "Room IDs": (log.room_ids ?? []).join(", "),
      "Travel time included": log.travel_time_included ?? false,
      Notes: log.notes ?? "",
      "Manager name": log.manager_name ?? "",
      "Manager ID": log.manager_id ?? "",
      "Manager approved": log.manager_approved ?? false,
      "Manager approved at": log.manager_approved_at ?? "",
      "Manager rejected": log.manager_rejected ?? false,
      "Manager rejected at": log.manager_rejected_at ?? "",
      "Owner name": log.owner_name ?? "",
      "Owner ID": log.owner_id ?? "",
      "Owner approved": log.owner_approved ?? false,
      "Owner approved at": log.owner_approved_at ?? "",
      "Owner rejected": log.owner_rejected ?? false,
      "Owner rejected at": log.owner_rejected_at ?? "",
      "Responsibility snapshot at": log.responsibility_recorded_at ?? "",
      "Rejection notes": log.rejection_notes ?? "",
      "Created at": log.created_at ?? "",
      "Updated at": log.updated_at ?? "",
      "Import key": log.import_key ?? "",
      "Cost (GBP)": Number(calculateTaskCost(hours, log.rooms_completed, { ...service, default_rate: rate, unit }, log.cost_override).toFixed(2)),
    };
  });
  const exportSummary = Object.fromEntries(EXPORT_COLUMNS.map((column) => [column, ""])) as ExportRow;
  exportSummary["Task date/time"] = "FILTERED TOTALS";
  exportSummary["Work log ID"] = `${filteredLogs.length} tasks`;
  exportSummary.Cleaner = cleanerNames.get(selectedCleanerId) ?? "All cleaners";
  exportSummary.Hotel = hotelNames.get(selectedHotelId) ?? "All hotels";
  exportSummary["Duration hours"] = Number(totals.hours.toFixed(2));
  exportSummary["Rooms completed"] = totals.rooms;
  exportSummary["Cost (GBP)"] = Number(totals.cost.toFixed(2));
  const filterSuffix = [from, to, hotelNames.get(selectedHotelId), cleanerNames.get(selectedCleanerId)].filter(Boolean).join("-").replace(/[^a-z0-9-]/gi, "-");
  const filename = `payroll-${filterSuffix || "all-records"}`;
  const startEditingTask = (log: PayrollLog) => {
    const service = log.services_config[0] ?? {};
    const hours = durationHours(log);
    const cost = calculateTaskCost(hours, log.rooms_completed, service, log.cost_override);
    setEditingTask(log);
    setTaskForm({
      serviceId: log.service_id ?? "",
      roomsCompleted: String(log.rooms_completed),
      notes: log.notes ?? "",
      cost: Number(cost).toFixed(2),
    });
    setTaskMessage(null);
  };

  const saveTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingTask) return;
    startTaskTransition(async () => {
      try {
        await updatePayrollTask(editingTask.id, {
          serviceId: taskForm.serviceId,
          roomsCompleted: Number(taskForm.roomsCompleted),
          notes: taskForm.notes,
          cost: Number(taskForm.cost),
        });
        setEditingTask(null);
        setTaskMessage({ text: "Payroll task updated.", error: false });
        router.refresh();
      } catch (error) {
        setTaskMessage({ text: error instanceof Error ? error.message : "Unable to update task.", error: true });
      }
    });
  };

  const confirmDeleteTask = () => {
    if (!deletingTask) return;
    startTaskTransition(async () => {
      try {
        await deletePayrollTask(deletingTask.id);
        setDeletingTask(null);
        setTaskMessage({ text: "Task removed from payroll. Its audit history is retained.", error: false });
        router.refresh();
      } catch (error) {
        setTaskMessage({ text: error instanceof Error ? error.message : "Unable to remove task.", error: true });
      }
    });
  };

  const exportCsv = () => {
    const csvCell = (value: string | number | boolean) => {
      const text = String(value);
      const safeText = typeof value === "string" && /^[\t\r ]*[=+\-@]/.test(text) ? `'${text}` : text;
      return `"${safeText.replaceAll('"', '""')}"`;
    };
    const csv = [EXPORT_COLUMNS, ...exportRows.map((row) => EXPORT_COLUMNS.map((column) => row[column])), EXPORT_COLUMNS.map((column) => exportSummary[column])]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");
    downloadFile(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }), `${filename}.csv`);
  };

  const exportExcel = () => {
    const rows = [EXPORT_COLUMNS, ...exportRows.map((row) => EXPORT_COLUMNS.map((column) => row[column])), EXPORT_COLUMNS.map((column) => exportSummary[column])];
    const worksheetRows = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
      const reference = `${excelColumn(columnIndex)}${rowIndex + 1}`;
      return typeof value === "number" && Number.isFinite(value)
        ? `<c r="${reference}"><v>${value}</v></c>`
        : `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(value))}</t></is></c>`;
    }).join("")}</row>`).join("");
    const lastDataRow = exportRows.length + 1;
    const lastRow = rows.length;
    const lastColumn = excelColumn(EXPORT_COLUMNS.length - 1);
    const worksheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastColumn}${lastRow}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="${EXPORT_COLUMNS.length}" width="22" customWidth="1"/></cols><sheetData>${worksheetRows}</sheetData><autoFilter ref="A1:${lastColumn}${lastDataRow}"/></worksheet>`;
    const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Payroll" sheetId="1" r:id="rId1"/></sheets></workbook>`;
    const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
    const workbook = zipSync({
      "[Content_Types].xml": strToU8(contentTypes),
      "_rels/.rels": strToU8(rootRels),
      "xl/workbook.xml": strToU8(workbookXml),
      "xl/_rels/workbook.xml.rels": strToU8(workbookRels),
      "xl/worksheets/sheet1.xml": strToU8(worksheetXml),
    });
    downloadFile(new Blob([workbook], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${filename}.xlsx`);
  };

  const exportPdf = () => {
    const pdf = new jsPDF({ orientation: "landscape" });
    pdf.setFontSize(16);
    pdf.text("Payroll task detail export", 14, 16);
    pdf.setFontSize(9);
    pdf.text(`Period: ${from} to ${to} · Hotel: ${hotelNames.get(selectedHotelId) ?? "All hotels"} · Cleaner: ${cleanerNames.get(selectedCleanerId) ?? "All cleaners"}`, 14, 23);
    const detailColumns = EXPORT_COLUMNS.filter((column) => !["Task date/time", "Cleaner", "Hotel", "Cost (GBP)"].includes(column));
    autoTable(pdf, {
      startY: 29,
      head: [["Task date/time", "Cleaner / hotel", "Complete task details", "Cost (GBP)"]],
      body: exportRows.map((row) => [
        String(row["Task date/time"]),
        `${row.Cleaner}\n${row["Cleaner email"]}\n${row.Hotel}\n${row["Hotel location"]}`,
        detailColumns.map((column) => `${column}: ${String(row[column])}`).join("\n"),
        Number(row["Cost (GBP)"]).toFixed(2),
      ]),
      foot: [[`Filtered totals · ${filteredLogs.length} tasks`, "", `${totals.hours.toFixed(2)} hours · ${totals.rooms} rooms`, totals.cost.toFixed(2)]],
      showFoot: "lastPage",
      rowPageBreak: "avoid",
      styles: { fontSize: 7, cellPadding: 2, overflow: "linebreak", valign: "top" },
      headStyles: { fillColor: [30, 41, 59] },
      footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: "bold" },
      columnStyles: { 0: { cellWidth: 32 }, 1: { cellWidth: 42 }, 2: { cellWidth: 165 }, 3: { cellWidth: 25, halign: "right" } },
    });
    pdf.save(`${filename}.pdf`);
  };

  return <section className="rounded-2xl bg-white p-4 text-slate-900 shadow-sm ring-1 ring-slate-200 sm:p-6">
    {taskMessage && <p role={taskMessage.error ? "alert" : "status"} className={`mb-4 rounded-lg border px-3 py-2 text-sm ${taskMessage.error ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{taskMessage.text}</p>}
    <div className="flex flex-col gap-4 border-b border-slate-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div><h3 className="text-lg font-semibold text-slate-950">Payroll</h3><p className="mt-1 text-sm text-slate-500">Configured service costs · {filteredLogs.length} records</p></div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <label className="text-xs font-medium text-slate-600">From<input type="date" value={from} max={to} onChange={(event) => { setFrom(event.target.value); setPage(1); }} className="mt-1 block min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900" /></label>
        <label className="text-xs font-medium text-slate-600">To<input type="date" value={to} min={from} max={today} onChange={(event) => { setTo(event.target.value); setPage(1); }} className="mt-1 block min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900" /></label>
        <label className="text-xs font-medium text-slate-600">Hotel<select value={selectedHotelId} onChange={(event) => { setSelectedHotelId(event.target.value); setSelectedCleanerId(""); setPage(1); }} className="mt-1 block min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"><option value="">All hotels</option>{hotels.map((hotel) => <option key={hotel.id} value={hotel.id}>{hotel.name}</option>)}</select></label>
        <label className="text-xs font-medium text-slate-600">Cleaner<select value={selectedCleanerId} onChange={(event) => { setSelectedCleanerId(event.target.value); setPage(1); }} className="mt-1 block min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"><option value="">All cleaners</option>{scopedCleaners.map((cleaner) => <option key={cleaner.id} value={cleaner.id}>{cleaner.name}</option>)}</select></label>
      </div>
      <div className="flex justify-end">
        <div className="relative">
          <button type="button" onClick={() => setExportMenuOpen((open) => !open)} disabled={!filteredLogs.length} aria-haspopup="menu" aria-expanded={exportMenuOpen} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"><Download className="h-4 w-4" />Export<ChevronDown className={`h-4 w-4 transition-transform ${exportMenuOpen ? "rotate-180" : ""}`} /></button>
          {exportMenuOpen && <div role="menu" className="absolute right-0 top-full z-20 mt-2 w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
            <button type="button" role="menuitem" onClick={() => { exportCsv(); setExportMenuOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"><Download className="h-4 w-4 text-slate-400" />CSV</button>
            <button type="button" role="menuitem" onClick={() => { exportExcel(); setExportMenuOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"><FileSpreadsheet className="h-4 w-4 text-slate-400" />Excel (.xlsx)</button>
            <button type="button" role="menuitem" onClick={() => { exportPdf(); setExportMenuOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"><FileText className="h-4 w-4 text-slate-400" />PDF</button>
          </div>}
        </div>
      </div>
    </div>
    <div className="admin-config-scroll mt-4 max-h-[65vh] overflow-auto rounded-lg border border-slate-200 [-webkit-overflow-scrolling:touch]">
      <table className="min-w-[760px] w-full text-left text-sm">
        <thead className="sticky top-0 z-10 bg-white/95 text-slate-600 shadow-sm backdrop-blur"><tr><th className="px-3 py-3">Task date/time</th><th className="px-3 py-3">Cleaner</th><th className="px-3 py-3">Hotel / service</th><th className="px-3 py-3 text-right">Hours</th><th className="px-3 py-3 text-right">Rooms</th><th className="px-3 py-3 text-right">Cost (GBP)</th>{canManageTasks && <th className="px-3 py-3 text-right">Manage</th>}</tr></thead>
        <tbody className="divide-y divide-slate-100">
          {visibleLogs.map((log) => {
            const hours = durationHours(log);
            const service = log.services_config[0] ?? {};
            const rate = resolveServiceRate(service);
            const unit = resolveBillingUnit(service.unit, service.name ?? "");
            const cost = calculateTaskCost(hours, log.rooms_completed, { ...service, default_rate: rate, unit }, log.cost_override);
            const unitLabel = unit === "hourly" ? "/hr" : unit === "per_room" ? "/room" : "fixed";
            return <tr key={log.id} className="hover:bg-slate-50">
              <td className="whitespace-nowrap px-3 py-3 text-slate-600">{new Date(log.start_time).toLocaleString("en-GB", { timeZone: "Africa/Cairo" })}</td>
              <td className="px-3 py-3 font-medium text-slate-900">{log.cleanerName}</td>
              <td className="px-3 py-3 text-slate-700">{log.hotelName}<span className="mt-0.5 block text-xs text-slate-500">{service.name ?? log.service_name_snapshot ?? "Service"} · GBP {rate.toFixed(2)} {unitLabel}</span></td>
              <td className="px-3 py-3 text-right tabular-nums text-slate-700">{hours.toFixed(2)}</td>
              <td className="px-3 py-3 text-right tabular-nums text-slate-700">{log.rooms_completed}</td>
              <td className="px-3 py-3 text-right font-semibold tabular-nums text-slate-900">{cost.toFixed(2)}</td>
              {canManageTasks && <td className="px-3 py-3"><div className="flex justify-end gap-1"><button type="button" onClick={() => startEditingTask(log)} aria-label={`Edit payroll task for ${log.cleanerName}`} title="Edit task" className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-950"><Pencil className="h-4 w-4" /></button><button type="button" onClick={() => setDeletingTask(log)} aria-label={`Remove payroll task for ${log.cleanerName}`} title="Remove task from payroll" className="flex h-11 w-11 items-center justify-center rounded-lg text-rose-700 hover:bg-rose-50"><Trash2 className="h-4 w-4" /></button></div></td>}
            </tr>;
          })}
          {filteredLogs.length === 0 && <tr><td colSpan={canManageTasks ? 7 : 6} className="px-3 py-8 text-center text-slate-500">No locked payroll records in this date range.</td></tr>}
        </tbody>
        <tfoot><tr className="font-semibold text-slate-950"><td colSpan={3} className="px-3 py-3">Filtered totals</td><td className="px-3 py-3 text-right tabular-nums">{totals.hours.toFixed(2)}</td><td className="px-3 py-3 text-right tabular-nums">{totals.rooms}</td><td className="px-3 py-3 text-right tabular-nums">GBP {totals.cost.toFixed(2)}</td>{canManageTasks && <td />}</tr></tfoot>
      </table>
    </div>
    <DashboardPagination currentPage={currentPage} pageCount={pageCount} total={filteredLogs.length} pageSize={30} label="payroll records" onPageChange={setPage} />
    {editingTask && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-labelledby="payroll-task-edit-title">
      <form onSubmit={saveTask} className="w-full max-w-lg rounded-2xl bg-white p-5 text-slate-900 shadow-2xl">
        <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Payroll task</p><h2 id="payroll-task-edit-title" className="mt-1 text-xl font-bold">Edit completed task</h2></div><button type="button" onClick={() => setEditingTask(null)} aria-label="Close task editor" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        <p className="mt-2 text-sm text-slate-600">{editingTask.cleanerName} · {editingTask.hotelName} · {new Date(editingTask.start_time).toLocaleDateString("en-GB")}</p>
        <div className="mt-5 grid gap-4">
          <label className="text-sm font-medium text-slate-700">Assigned service<select required value={taskForm.serviceId} onChange={(event) => setTaskForm((current) => ({ ...current, serviceId: event.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900">{services.filter((service) => service.is_active || service.id === editingTask.service_id).map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium text-slate-700">Units / rooms completed<input required type="number" min="0" max="1000000" step="1" value={taskForm.roomsCompleted} onChange={(event) => setTaskForm((current) => ({ ...current, roomsCompleted: event.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900" /></label><label className="text-sm font-medium text-slate-700">Task amount (GBP)<input required type="number" min="0" max="1000000000" step="0.01" value={taskForm.cost} onChange={(event) => setTaskForm((current) => ({ ...current, cost: event.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900" /></label></div>
          <label className="text-sm font-medium text-slate-700">Task notes<textarea maxLength={2000} rows={4} value={taskForm.notes} onChange={(event) => setTaskForm((current) => ({ ...current, notes: event.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900" /></label>
          <p className="text-xs text-slate-500">This amount applies to this task only. It does not change the service catalog price.</p>
        </div>
        {taskMessage?.error && <p role="alert" className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{taskMessage.text}</p>}
        <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={() => setEditingTask(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button><button type="submit" disabled={isTaskPending} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{isTaskPending ? "Saving…" : "Save task"}</button></div>
      </form>
    </div>}
    {deletingTask && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4" role="alertdialog" aria-modal="true" aria-labelledby="payroll-task-delete-title">
      <section className="w-full max-w-md rounded-2xl bg-white p-5 text-slate-900 shadow-2xl"><h2 id="payroll-task-delete-title" className="text-lg font-bold">Remove this payroll task?</h2><p className="mt-2 text-sm leading-6 text-slate-600">This will exclude {deletingTask.cleanerName}&apos;s task at {deletingTask.hotelName} from payroll totals and reports. The record is retained as deleted in the audit history.</p>{taskMessage?.error && <p role="alert" className="mt-3 text-sm text-rose-700">{taskMessage.text}</p>}<div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setDeletingTask(null)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">Cancel</button><button type="button" onClick={confirmDeleteTask} disabled={isTaskPending} className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{isTaskPending ? "Removing…" : "Remove task"}</button></div></section>
    </div>}
  </section>;
}