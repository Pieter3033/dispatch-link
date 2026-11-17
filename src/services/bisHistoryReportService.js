const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

const LOGO_PATH = path.join(process.cwd(), "public", "assets", "pulsit-logo-navy.png");

const COLORS = {
  navy: "#0b1f3a",
  blue: "#1d4ed8",
  pale: "#eef4ff",
  line: "#cbd5e1",
  text: "#18243b",
  muted: "#64748b",
  white: "#ffffff"
};

function reportBaseName(incident) {
  const registration = incident.RegNo || incident.IncidentNumber || `Dispatch-${incident.id}`;
  const safeRegistration = String(registration).replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-").trim();
  return `${safeRegistration} - History Report`;
}

function parseBisDate(value) {
  const text = String(value ?? "").trim();
  const dotNetDate = /^\/Date\((-?\d+)(?:[+-]\d+)?\)\/$/.exec(text);
  const date = dotNetDate ? new Date(Number(dotNetDate[1])) : new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatLocalDate(value) {
  const date = parseBisDate(value);
  if (!date) return String(value ?? "-");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function displayValue(value, key = "") {
  if (value === null || value === undefined || value === "") return "-";
  if (/date|time/i.test(key) || /^\/Date\(/.test(String(value))) return formatLocalDate(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function escapeHtml(value, key = "") {
  return displayValue(value, key).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
}

function historyColumns(history) {
  const columns = [];
  const seen = new Set();
  for (const row of history.rows || []) {
    for (const key of Object.keys(row || {})) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  return columns;
}

function columnLabel(column) {
  return String(column).replace(/([a-z])([A-Z])/g, "$1 $2");
}

function rowValue(row, aliases) {
  const entries = Object.entries(row || {});
  for (const alias of aliases) {
    const match = entries.find(([key]) => String(key).replace(/\s+/g, "").toLowerCase() === alias.replace(/\s+/g, "").toLowerCase());
    if (match) return match[1];
  }
  return null;
}

function locationUrl(row) {
  const latitude = rowValue(row, ["Latitude"]);
  const longitude = rowValue(row, ["Longitude"]);
  if (latitude !== null && longitude !== null && latitude !== "" && longitude !== "") {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`;
  }
  const location = rowValue(row, ["Location", "GeoLocation"]);
  return location ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(String(location))}` : "";
}

function addExternalPdfLink(doc, x, y, width, height, url) {
  const action = doc.ref({
    S: "URI",
    URI: new String(url),
    NewWindow: true
  });
  action.end();
  doc.annotate(x, y, width, height, { Subtype: "Link", A: action });
}

function buildBisHistoryExcel(incident, history) {
  const columns = historyColumns(history);
  const rows = history.rows || [];
  const table = columns.length
    ? `<table><thead><tr>${columns.map((column) => `<th>${escapeHtml(columnLabel(column))}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(row[column], column)}</td>`).join("")}</tr>`).join("")}</tbody></table>`
    : '<p class="empty">No History</p>';
  return `<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><style>body{font-family:Calibri,Arial,sans-serif;color:#18243b}h1{color:#0b1f3a;margin-top:4px}table{border-collapse:collapse}th{background:#1d4ed8;color:#fff;font-weight:bold}th,td{border:1px solid #cbd5e1;padding:6px;vertical-align:top;white-space:nowrap}.meta td:first-child{font-weight:bold;background:#eef4ff}.empty{color:#64748b}</style></head><body><h1>Pulsit History Report</h1><table class="meta"><tr><td>Dispatch</td><td>${escapeHtml(incident.IncidentNumber || incident.id)}</td></tr><tr><td>Registration</td><td>${escapeHtml(history.registration || incident.RegNo)}</td></tr><tr><td>From</td><td>${escapeHtml(formatLocalDate(history.start))}</td></tr><tr><td>Until</td><td>${escapeHtml(formatLocalDate(history.end))}</td></tr><tr><td>Records</td><td>${escapeHtml(history.count)}</td></tr><tr><td>Generated</td><td>${escapeHtml(formatLocalDate(new Date()))}</td></tr></table><br>${table}</body></html>`;
}

function generateBisHistoryPdf(incident, history, output) {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36, bufferPages: true, info: { Title: "Pulsit History Report" } });
  doc.pipe(output);
  const pageWidth = doc.page.width - 72;
  doc.rect(0, 0, doc.page.width, 82).fill(COLORS.white);
  if (fs.existsSync(LOGO_PATH)) doc.image(LOGO_PATH, 36, 10, { fit: [220, 60], align: "left", valign: "center" });
  doc.fillColor(COLORS.navy).font("Helvetica-Bold").fontSize(20).text("Pulsit History Report", 300, 24);
  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(9).text(`Generated ${formatLocalDate(new Date())}`, 300, 52);
  doc.rect(0, 78, doc.page.width, 4).fill(COLORS.navy);
  doc.y = 100;
  const meta = [
    ["Dispatch", incident.IncidentNumber || incident.id],
    ["Registration", history.registration || incident.RegNo || "-"],
    ["From", formatLocalDate(history.start)],
    ["Until", formatLocalDate(history.end)],
    ["Records", history.count || 0]
  ];
  for (let index = 0; index < meta.length; index += 1) {
    const x = 36 + (index % 2) * (pageWidth / 2);
    const y = 100 + Math.floor(index / 2) * 38;
    doc.roundedRect(x, y, pageWidth / 2 - 8, 30, 4).fill(COLORS.pale);
    doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(7).text(meta[index][0].toUpperCase(), x + 10, y + 6);
    doc.fillColor(COLORS.text).font("Helvetica").fontSize(10).text(displayValue(meta[index][1]), x + 10, y + 16, { width: pageWidth / 2 - 28 });
  }
  doc.y = 218;
  const rows = history.rows || [];
  if (!rows.length) {
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(11).text("No History");
  } else {
    const columns = [
      { label: "Registration", aliases: ["Registration"], weight: 8 },
      { label: "Date Time", aliases: ["DateTime", "Date Time"], weight: 13, date: true },
      { label: "Event", aliases: ["Event"], weight: 15 },
      { label: "Ignition", aliases: ["Ignition"], weight: 6 },
      { label: "Speed", aliases: ["Speed"], weight: 5 },
      { label: "Location", aliases: [], weight: 6, map: true },
      { label: "Vehicle V", aliases: ["VehicleVoltage", "Vehicle Voltage"], weight: 7 },
      { label: "Unit V", aliases: ["UnitVoltage", "Unit Voltage"], weight: 7 },
      { label: "Latitude", aliases: ["Latitude"], weight: 9 },
      { label: "Longitude", aliases: ["Longitude"], weight: 9 },
      { label: "Odometer", aliases: ["Odometer"], weight: 9 }
    ];
    const totalWeight = columns.reduce((sum, column) => sum + column.weight, 0);
    const widths = columns.map((column) => pageWidth * column.weight / totalWeight);
    const rowHeight = 20;
    const headerHeight = 24;
    const drawHeader = (top) => {
      doc.rect(36, top, pageWidth, headerHeight).fill(COLORS.blue);
      let x = 36;
      columns.forEach((column, index) => {
        doc.fillColor(COLORS.white).font("Helvetica-Bold").fontSize(6.5)
          .text(column.label, x + 3, top + 8, { width: widths[index] - 6, align: "left", lineBreak: false, ellipsis: true });
        x += widths[index];
      });
      doc.y = top + headerHeight;
    };
    drawHeader(doc.y);
    rows.forEach((row, rowIndex) => {
      if (doc.y + rowHeight > doc.page.height - 42) {
        doc.addPage();
        if (fs.existsSync(LOGO_PATH)) doc.image(LOGO_PATH, 36, 8, { fit: [120, 34], align: "left", valign: "center" });
        doc.fillColor(COLORS.navy).font("Helvetica-Bold").fontSize(10).text("Pulsit History Report", 172, 18);
        drawHeader(50);
      }
      const top = doc.y;
      doc.rect(36, top, pageWidth, rowHeight).fill(rowIndex % 2 ? COLORS.pale : COLORS.white);
      doc.moveTo(36, top + rowHeight).lineTo(36 + pageWidth, top + rowHeight).lineWidth(0.4).strokeColor(COLORS.line).stroke();
      let x = 36;
      columns.forEach((column, columnIndex) => {
        const width = widths[columnIndex];
        if (column.map) {
          const url = locationUrl(row);
          doc.fillColor(url ? COLORS.blue : COLORS.muted).font("Helvetica-Bold").fontSize(6.5)
            .text(url ? "Map" : "-", x + 3, top + 7, { width: width - 6, lineBreak: false, underline: Boolean(url) });
          if (url) addExternalPdfLink(doc, x + 2, top + 4, width - 4, rowHeight - 8, url);
        } else {
          const value = rowValue(row, column.aliases);
          const rendered = column.date ? formatLocalDate(value) : displayValue(value, column.label);
          doc.fillColor(COLORS.text).font("Helvetica").fontSize(6.3)
            .text(rendered, x + 3, top + 7, { width: width - 6, height: 9, lineBreak: false, ellipsis: true });
        }
        x += width;
      });
      doc.y = top + rowHeight;
    });
  }
  const range = doc.bufferedPageRange();
  for (let page = range.start; page < range.start + range.count; page += 1) {
    doc.switchToPage(page);
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8).text(`Page ${page + 1} of ${range.count}`, 36, doc.page.height - 28, { width: pageWidth, align: "right" });
  }
  doc.end();
}

module.exports = { buildBisHistoryExcel, generateBisHistoryPdf, reportBaseName };
