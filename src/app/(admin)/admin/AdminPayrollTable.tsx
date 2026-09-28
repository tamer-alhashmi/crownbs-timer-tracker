"use client";

import { useState } from "react";
import { ChevronDown, Download, FileSpreadsheet, FileText } from "lucide-react";
import { strToU8, zipSync } from "fflate";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { calculateServiceCost, resolveBillingUnit, resolveServiceRate } from "@/lib/servicePricing";

type PayrollService = { name?: string | null; default_rate?: number | string | null; unit?: string | null };
const EXPORT_COLUMNS = ["Task date/time", "Cleaner", "Hotel", "Service", "Unit", "Rate (GBP)", "Hours", "Rooms", "Cost (GBP)"] as const;
type ExportColumn = typeof EXPORT_COLUMNS[number];
type ExportRow = Record<ExportColumn, string | number>;
type PayrollLog = {
  id: string;
  cleanerName: string;
  hotelName: string;
  start_time: string;
  end_time: string | null;
  task_date: string;
  rooms_completed: number;
  services_config: PayrollService[];
};

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
    return {
      "Task date/time": new Date(log.start_time).toLocaleString("en-GB", { timeZone: "Africa/Cairo" }),
      Cleaner: log.cleanerName,
      Hotel: log.hotelName,
      Service: service.name ?? "Service",
      Unit: unit === "hourly" ? "Hourly" : unit === "per_room" ? "Per room" : "Fixed per task",
      "Rate (GBP)": rate,
      Hours: Number(hours.toFixed(2)),
      Rooms: log.rooms_completed,
      "Cost (GBP)": Number(calculateServiceCost(hours, log.rooms_completed, { ...service, default_rate: rate, unit }).toFixed(2)),
    };
  });
  const exportSummary: ExportRow = {
    "Task date/time": "FILTERED TOTALS",
    Cleaner: "",
    Hotel: selectedHotel || "All hotels",
    Service: "",
    Unit: "",
    "Rate (GBP)": "",
    Hours: Number(totals.hours.toFixed(2)),
    Rooms: totals.rooms,
    "Cost (GBP)": Number(totals.cost.toFixed(2)),
  };
  const filterSuffix = [from, to, selectedHotel, selectedCleaner].filter(Boolean).join("-").replace(/[^a-z0-9-]/gi, "-");
  const filename = `payroll-${filterSuffix || "all-records"}`;

  const exportCsv = () => {
    const csvCell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
    const csv = [EXPORT_COLUMNS, ...exportRows.map((row) => EXPORT_COLUMNS.map((column) => row[column])), EXPORT_COLUMNS.map((column) => exportSummary[column])]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");
    downloadFile(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }), `${filename}.csv`);
  };

  const exportExcel = () => {
    const rows = [EXPORT_COLUMNS, ...exportRows.map((row) => EXPORT_COLUMNS.map((column) => row[column])), EXPORT_COLUMNS.map((column) => exportSummary[column])];
    const cellReference = (column: number, row: number) => `${String.fromCharCode(65 + column)}${row}`;
    const xmlEscape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
    const worksheetRows = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
      const reference = cellReference(columnIndex, rowIndex + 1);
      return typeof value === "number" && Number.isFinite(value)
        ? `<c r="${reference}"><v>${value}</v></c>`
        : `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(value))}</t></is></c>`;
    }).join("")}</row>`).join("");
    const lastDataRow = exportRows.length + 1;
    const lastRow = rows.length;
    const worksheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:I${lastRow}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="1" width="22" customWidth="1"/><col min="2" max="5" width="20" customWidth="1"/><col min="6" max="9" width="14" customWidth="1"/></cols><sheetData>${worksheetRows}</sheetData><autoFilter ref="A1:I${lastDataRow}"/></worksheet>`;
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
    pdf.text("Payroll export", 14, 16);
    pdf.setFontSize(9);
    pdf.text(`Period: ${from} to ${to} · Hotel: ${selectedHotel || "All hotels"} · Cleaner: ${selectedCleaner || "All cleaners"}`, 14, 23);
    autoTable(pdf, {
      startY: 29,
      head: [["Task date/time", "Cleaner", "Hotel", "Service", "Unit", "Rate GBP", "Hours", "Rooms", "Cost GBP"]],
      body: exportRows.map((row) => [row["Task date/time"], row.Cleaner, row.Hotel, row.Service, row.Unit, Number(row["Rate (GBP)"]).toFixed(2), Number(row.Hours).toFixed(2), row.Rooms, Number(row["Cost (GBP)"]).toFixed(2)]),
      foot: [["Filtered totals", "", selectedHotel || "All hotels", "", "", "", totals.hours.toFixed(2), String(totals.rooms), totals.cost.toFixed(2)]],
      showFoot: "lastPage",
      styles: { fontSize: 8, cellPadding: 2.5 },
      headStyles: { fillColor: [30, 41, 59] },
      footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: "bold" },
      columnStyles: { 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" }, 8: { halign: "right" } },
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