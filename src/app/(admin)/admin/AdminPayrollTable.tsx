"use client";

import { useState } from "react";
import { ChevronDown, Download, FileSpreadsheet, FileText } from "lucide-react";
import { strToU8, zipSync } from "fflate";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { calculateServiceCost, resolveBillingUnit, resolveServiceRate } from "@/lib/servicePricing";

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

export function AdminPayrollTable({ logs }: { logs: PayrollLog[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [selectedHotel, setSelectedHotel] = useState("");
  const [selectedCleaner, setSelectedCleaner] = useState("");
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const hotels = [...new Set(logs.map((log) => log.hotelName))].sort((left, right) => left.localeCompare(right));
  const cleaners = [...new Set(logs.map((log) => log.cleanerName))].sort((left, right) => left.localeCompare(right));
  const filteredLogs = logs
    .filter((log) => log.task_date >= from && log.task_date <= to)
    .filter((log) => !selectedHotel || log.hotelName === selectedHotel)
    .filter((log) => !selectedCleaner || log.cleanerName === selectedCleaner)
    .sort((left, right) => right.start_time.localeCompare(left.start_time));
  const totals = filteredLogs.reduce((total, log) => {
    const hours = durationHours(log);
    const service = log.services_config[0] ?? {};
    return {
      hours: total.hours + hours,
      rooms: total.rooms + log.rooms_completed,
      cost: total.cost + calculateServiceCost(hours, log.rooms_completed, service),
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
      "Cost (GBP)": Number(calculateServiceCost(hours, log.rooms_completed, { ...service, default_rate: rate, unit }).toFixed(2)),
    };
  });
  const exportSummary = Object.fromEntries(EXPORT_COLUMNS.map((column) => [column, ""])) as ExportRow;
  exportSummary["Task date/time"] = "FILTERED TOTALS";
  exportSummary["Work log ID"] = `${filteredLogs.length} tasks`;
  exportSummary.Cleaner = selectedCleaner || "All cleaners";
  exportSummary.Hotel = selectedHotel || "All hotels";
  exportSummary["Duration hours"] = Number(totals.hours.toFixed(2));
  exportSummary["Rooms completed"] = totals.rooms;
  exportSummary["Cost (GBP)"] = Number(totals.cost.toFixed(2));
  const filterSuffix = [from, to, selectedHotel, selectedCleaner].filter(Boolean).join("-").replace(/[^a-z0-9-]/gi, "-");
  const filename = `payroll-${filterSuffix || "all-records"}`;

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
    pdf.text(`Period: ${from} to ${to} · Hotel: ${selectedHotel || "All hotels"} · Cleaner: ${selectedCleaner || "All cleaners"}`, 14, 23);
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
    <div className="flex flex-col gap-4 border-b border-slate-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div><h3 className="text-lg font-semibold text-slate-950">Payroll</h3><p className="mt-1 text-sm text-slate-500">Configured service costs · {filteredLogs.length} records</p></div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <label className="text-xs font-medium text-slate-600">From<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900" /></label>
        <label className="text-xs font-medium text-slate-600">To<input type="date" value={to} min={from} max={today} onChange={(event) => setTo(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900" /></label>
        <label className="text-xs font-medium text-slate-600">Hotel<select value={selectedHotel} onChange={(event) => setSelectedHotel(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"><option value="">All hotels</option>{hotels.map((hotel) => <option key={hotel} value={hotel}>{hotel}</option>)}</select></label>
        <label className="text-xs font-medium text-slate-600">Cleaner<select value={selectedCleaner} onChange={(event) => setSelectedCleaner(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"><option value="">All cleaners</option>{cleaners.map((cleaner) => <option key={cleaner} value={cleaner}>{cleaner}</option>)}</select></label>
      </div>
      <div className="flex justify-end">
        <div className="relative">
          <button type="button" onClick={() => setExportMenuOpen((open) => !open)} disabled={!filteredLogs.length} aria-haspopup="menu" aria-expanded={exportMenuOpen} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"><Download className="h-4 w-4" />Export<ChevronDown className={`h-4 w-4 transition-transform ${exportMenuOpen ? "rotate-180" : ""}`} /></button>
          {exportMenuOpen && <div role="menu" className="absolute right-0 top-full z-20 mt-2 w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
            <button type="button" role="menuitem" onClick={() => { exportCsv(); setExportMenuOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"><Download className="h-4 w-4 text-slate-400" />CSV</button>
            <button type="button" role="menuitem" onClick={() => { exportExcel(); setExportMenuOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"><FileSpreadsheet className="h-4 w-4 text-slate-400" />Excel (.xlsx)</button>
            <button type="button" role="menuitem" onClick={() => { exportPdf(); setExportMenuOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"><FileText className="h-4 w-4 text-slate-400" />PDF</button>
          </div>}
        </div>
      </div>
    </div>
    <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-[760px] w-full text-left text-sm">
        <thead><tr><th className="px-3 py-3">Task date/time</th><th className="px-3 py-3">Cleaner</th><th className="px-3 py-3">Hotel / service</th><th className="px-3 py-3 text-right">Hours</th><th className="px-3 py-3 text-right">Rooms</th><th className="px-3 py-3 text-right">Cost (GBP)</th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {filteredLogs.map((log) => {
            const hours = durationHours(log);
            const service = log.services_config[0] ?? {};
            const rate = resolveServiceRate(service);
            const unit = resolveBillingUnit(service.unit, service.name ?? "");
            const cost = calculateServiceCost(hours, log.rooms_completed, { ...service, default_rate: rate, unit });
            const unitLabel = unit === "hourly" ? "/hr" : unit === "per_room" ? "/room" : "fixed";
            return <tr key={log.id} className="hover:bg-slate-50">
              <td className="whitespace-nowrap px-3 py-3 text-slate-600">{new Date(log.start_time).toLocaleString("en-GB", { timeZone: "Africa/Cairo" })}</td>
              <td className="px-3 py-3 font-medium text-slate-900">{log.cleanerName}</td>
              <td className="px-3 py-3 text-slate-700">{log.hotelName}<span className="block text-xs text-slate-500">{service.name ?? "Service"} · GBP {rate.toFixed(2)} {unitLabel}</span></td>
              <td className="px-3 py-3 text-right tabular-nums text-slate-700">{hours.toFixed(2)}</td>
              <td className="px-3 py-3 text-right tabular-nums text-slate-700">{log.rooms_completed}</td>
              <td className="px-3 py-3 text-right font-semibold tabular-nums text-slate-900">{cost.toFixed(2)}</td>
            </tr>;
          })}
          {filteredLogs.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">No locked payroll records in this date range.</td></tr>}
        </tbody>
        <tfoot><tr className="font-semibold text-slate-950"><td colSpan={3} className="px-3 py-3">Filtered totals</td><td className="px-3 py-3 text-right tabular-nums">{totals.hours.toFixed(2)}</td><td className="px-3 py-3 text-right tabular-nums">{totals.rooms}</td><td className="px-3 py-3 text-right tabular-nums">GBP {totals.cost.toFixed(2)}</td></tr></tfoot>
      </table>
    </div>
  </section>;
}