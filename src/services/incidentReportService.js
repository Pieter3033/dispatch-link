const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const sharp = require("sharp");
const config = require("../config");
const { sql, getRequest } = require("../db/pool");
const { createHttpError } = require("../utils/httpError");
const { qualifiedTable } = require("../utils/sql");

const incidentTable = qualifiedTable(config.db.database, "DispatchIncidents");
const photoTable = qualifiedTable(config.db.database, "DispatchIncidentPhotos");
const timelineTable = qualifiedTable(config.db.database, "DispatchIncidentTimeline");
const communicationTable = qualifiedTable(config.db.database, "DispatchCommunicationLog");

const BRAND = {
  navy: "#06245f",
  blue: "#123d8d",
  line: "#bdc8dd",
  pale: "#f4f7fb",
  text: "#18243b",
  muted: "#62708a",
  green: "#15803d",
  red: "#dc2626",
  white: "#ffffff"
};

// DispatchIncident and its related tables store operator-entered SQL datetime2,
// date, and time values as timezone-less wall-clock values. The mssql driver maps
// those components onto JavaScript Dates as UTC, so formatting them in a local
// timezone would shift what the operator entered (for example 14:30 to 16:30).
// Format report fields against UTC to preserve the stored wall-clock components.
const REPORT_WALL_CLOCK_TIME_ZONE = "UTC";
const VEHICLE_HISTORY_UNAVAILABLE_MARKER = "[VehicleHistoryUnavailable]";

function parseVehicleHistoryException(operatorNotes, trackingUnitStatus, updatedBy, updatedAt) {
  const raw = String(operatorNotes || "");
  const markerIndex = raw.indexOf(VEHICLE_HISTORY_UNAVAILABLE_MARKER);
  const reason = markerIndex >= 0
    ? raw.slice(markerIndex + VEHICLE_HISTORY_UNAVAILABLE_MARKER.length).trim()
    : "";
  const unavailable = trackingUnitStatus === "Not fitted with Pulsit Tracking" && Boolean(reason);
  return {
    operatorNotesText: markerIndex >= 0 ? raw.slice(0, markerIndex).trim() : raw.trim(),
    unavailable,
    reason: unavailable ? reason : "",
    recordedBy: unavailable ? updatedBy : null,
    recordedAt: unavailable ? updatedAt : null
  };
}

const PHOTO_LABELS = {
  LicenseDisk: "License disk",
  FrontVehicleWithReg: "Front of vehicle including registration",
  BackVehicleWithReg: "Back of vehicle including registration",
  VehicleSides: "Sides of vehicle",
  TrailersWithReg: "Trailer/s including registration",
  Stock: "Stock",
  Damages: "Damages",
  Dashboard: "Dashboard",
  VehicleKeys: "Vehicle keys",
  Odometer: "ODO meter",
  Driver: "Driver",
  DriverLicenseOrId: "Driver license or ID"
};

const PAGE = {
  width: 595.28,
  height: 841.89,
  margin: 28,
  contentTop: 112,
  contentBottom: 806
};

const REPORT_ICONS = {
  reference: [
    ["rect", 5, 4, 14, 17, 2],
    ["path", "M9 4V3h6v1"],
    ["line", 9, 9, 15, 9],
    ["line", 9, 13, 15, 13],
    ["line", 9, 17, 13, 17]
  ],
  truck: [
    ["rect", 3, 6, 11, 10, 1],
    ["path", "M14 10h4l3 3v3h-7"],
    ["circle", 7, 18, 2],
    ["circle", 18, 18, 2]
  ],
  calendar: [
    ["rect", 3, 5, 18, 16, 2],
    ["line", 3, 9, 21, 9],
    ["line", 8, 3, 8, 7],
    ["line", 16, 3, 16, 7],
    ["line", 8, 13, 8, 13.2],
    ["line", 12, 13, 12, 13.2],
    ["line", 16, 13, 16, 13.2],
    ["line", 8, 17, 8, 17.2],
    ["line", 12, 17, 12, 17.2]
  ],
  user: [
    ["circle", 12, 7, 4],
    ["path", "M4 21a8 8 0 0 1 16 0"]
  ],
  headset: [
    ["path", "M4 13v-2a8 8 0 0 1 16 0v2"],
    ["rect", 3, 12, 4, 7, 2],
    ["rect", 17, 12, 4, 7, 2],
    ["path", "M17 20c-1 1-2.5 1-4 1"]
  ],
  alert: [
    ["path", "M12 3 2.8 20h18.4Z"],
    ["line", 12, 9, 12, 14],
    ["line", 12, 17.5, 12, 17.7]
  ],
  clock: [
    ["circle", 12, 12, 9],
    ["path", "M12 7v5l3.5 2"]
  ],
  dispatch: [
    ["path", "m22 2-7 20-4-9-9-4Z"],
    ["path", "M22 2 11 13"]
  ],
  hourglass: [
    ["path", "M6 3h12M6 21h12M7 3c0 4 2 6 5 9-3 3-5 5-5 9M17 3c0 4-2 6-5 9 3 3 5 5 5 9"]
  ],
  flag: [
    ["line", 5, 22, 5, 3],
    ["path", "M5 4c5-3 9 3 14 0v10c-5 3-9-3-14 0"]
  ],
  stopwatch: [
    ["circle", 12, 13, 8],
    ["line", 12, 13, 15, 10],
    ["line", 9, 2, 15, 2],
    ["line", 12, 2, 12, 5],
    ["line", 18, 6, 20, 8]
  ],
  building: [
    ["rect", 4, 7, 16, 14, 1],
    ["path", "M8 7V3h8v4M8 11h2M14 11h2M8 15h2M14 15h2M10 21v-3h4v3"]
  ],
  phone: [
    ["path", "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.8 2.1Z"]
  ],
  shield: [
    ["path", "M12 3 20 6v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6Z"],
    ["path", "m8.5 12 2.3 2.3 4.8-5"]
  ],
  package: [
    ["path", "m12 3 8 4.5v9L12 21l-8-4.5v-9Z"],
    ["path", "m4 7.5 8 4.5 8-4.5M12 12v9"]
  ],
  key: [
    ["circle", 8, 15, 4],
    ["path", "m11 12 9-9M16 7l2 2M18 5l2 2"]
  ],
  radar: [
    ["circle", 12, 12, 2],
    ["path", "M7 7a7 7 0 0 0 0 10M17 7a7 7 0 0 1 0 10M4 4a11 11 0 0 0 0 16M20 4a11 11 0 0 1 0 16"]
  ],
  search: [
    ["circle", 11, 11, 7],
    ["line", 16, 16, 21, 21]
  ],
  location: [
    ["path", "M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"],
    ["circle", 12, 10, 2.5]
  ],
  check: [
    ["circle", 12, 12, 9],
    ["path", "m8 12 2.5 2.5L16 9"]
  ],
  note: [
    ["rect", 4, 3, 16, 18, 2],
    ["line", 8, 8, 16, 8],
    ["line", 8, 12, 16, 12],
    ["line", 8, 16, 13, 16]
  ],
  camera: [
    ["path", "M4 7h4l2-3h4l2 3h4a2 2 0 0 1 2 2v10H2V9a2 2 0 0 1 2-2Z"],
    ["circle", 12, 13, 4]
  ],
  close: [
    ["circle", 12, 12, 9],
    ["line", 9, 9, 15, 15],
    ["line", 15, 9, 9, 15]
  ]
};

const TIMELINE_ICONS = {
  Alert: "alert",
  Client: "user",
  Dispatch: "dispatch",
  Arrival: "location",
  Search: "search",
  Call: "phone",
  Confirmed: "check",
  StandDown: "flag",
  Note: "note"
};

function drawReportIcon(doc, name, x, y, size, color = BRAND.navy, lineWidth = 1.8) {
  const instructions = REPORT_ICONS[name] || REPORT_ICONS.note;
  const scale = size / 24;
  doc.save();
  doc.translate(x, y).scale(scale);
  doc.strokeColor(color).lineWidth(lineWidth).lineCap("round").lineJoin("round");
  for (const [type, ...values] of instructions) {
    if (type === "path") doc.path(values[0]).stroke();
    if (type === "line") doc.moveTo(values[0], values[1]).lineTo(values[2], values[3]).stroke();
    if (type === "circle") doc.circle(values[0], values[1], values[2]).stroke();
    if (type === "rect") doc.roundedRect(values[0], values[1], values[2], values[3], values[4] || 0).stroke();
  }
  doc.restore();
}

function reportLogoPath() {
  const candidates = [
    path.resolve(process.cwd(), "..", "assets", "images", "pulsit_logo.png"),
    path.resolve(process.cwd(), "public", "images", "pulsit-logo-navy.png")
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function prepareReportLogo() {
  const logoPath = reportLogoPath();
  if (!logoPath) return null;
  try {
    return await sharp(logoPath)
      .trim({ background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toBuffer();
  } catch (_error) {
    return fs.readFileSync(logoPath);
  }
}

function valueOrNA(value) {
  if (value === null || value === undefined || String(value).trim() === "") return "N/A";
  return String(value).trim();
}

function plainText(value) {
  return valueOrNA(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<li>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim() || "N/A";
}

function dateValue(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(value, includeTime = false) {
  const parsed = dateValue(value);
  if (!parsed) return "N/A";
  const date = new Intl.DateTimeFormat("en-ZA", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: REPORT_WALL_CLOCK_TIME_ZONE
  }).format(parsed);
  if (!includeTime) return date;
  const time = new Intl.DateTimeFormat("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: REPORT_WALL_CLOCK_TIME_ZONE
  }).format(parsed);
  return `${date} ${time}`;
}

function formatTime(value) {
  const parsed = dateValue(value);
  if (!parsed) return "N/A";
  return new Intl.DateTimeFormat("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: REPORT_WALL_CLOCK_TIME_ZONE
  }).format(parsed);
}

function formatTimelineDate(value) {
  const parsed = dateValue(value);
  if (!parsed) return "N/A";
  return new Intl.DateTimeFormat("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: REPORT_WALL_CLOCK_TIME_ZONE
  }).format(parsed);
}

function durationBetween(start, end) {
  const startDate = dateValue(start);
  const endDate = dateValue(end);
  if (!startDate || !endDate || endDate < startDate) return "N/A";
  const minutes = Math.round((endDate - startDate) / 60000);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours}h ${remainder}m` : `${remainder}m`;
}

function readableFileNamePart(value) {
  const cleaned = valueOrNA(value)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 60)
    .trim();
  return cleaned || "N/A";
}

function reportFileDate(incident) {
  const eventDate = dateValue(incident.EventDateTime) || new Date();
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: REPORT_WALL_CLOCK_TIME_ZONE
  }).format(eventDate);
}

function incidentReportFileName(incident) {
  const isoDate = reportFileDate(incident);
  const registration = readableFileNamePart(incident.RegNo);
  const event = readableFileNamePart(incident.Event);
  return `${registration} - ${event} - Incident report - ${isoDate}.pdf`;
}

function communicationLogReportFileName(incident) {
  const registration = readableFileNamePart(incident.RegNo);
  const event = readableFileNamePart(incident.Event);
  return `${registration} - ${event} - Communications report - ${reportFileDate(incident)}.pdf`;
}

function resolvePhotoPath(filePath) {
  if (!filePath) return null;
  let decoded = String(filePath);
  try {
    decoded = decodeURIComponent(decoded);
  } catch (_error) {
    // Retain the stored path when it is not URL encoded.
  }
  const normalized = decoded.replace(/^[/\\]+/, "").replace(/[\\/]+/g, "/");
  const withoutAppPrefix = normalized.replace(/^dispatch_link\//i, "");
  const withoutUploadsPrefix = withoutAppPrefix.replace(/^uploads\//i, "");
  const rootsAndRelatives = [
    [process.cwd(), withoutAppPrefix],
    [path.resolve(process.cwd(), "uploads"), withoutUploadsPrefix],
    [config.uploads.root, withoutUploadsPrefix]
  ];
  for (const [root, relativePath] of rootsAndRelatives) {
    const candidate = path.resolve(root, relativePath.replace(/\//g, path.sep));
    const relativeToRoot = path.relative(root, candidate);
    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) continue;
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function preparePhoto(photo) {
  const absolutePath = resolvePhotoPath(photo.FilePath);
  if (!absolutePath) return { ...photo, image: null };
  try {
    const image = await sharp(absolutePath)
      .rotate()
      .resize({ width: 1400, height: 1100, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 86, mozjpeg: true })
      .toBuffer();
    return { ...photo, image };
  } catch (_error) {
    return { ...photo, image: null };
  }
}

async function fetchIncidentReportData(id) {
  const request = await getRequest();
  request.input("id", sql.Int, id);
  const incidentResult = await request.query(`
    SELECT TOP (1)
      i.id,
      i.IncidentNumber,
      i.RiskEventReference,
      i.EventDateTime,
      i.Event,
      i.ETA,
      i.UnitId,
      i.RegNo,
      i.Company,
      i.FleetCode,
      i.Latitude,
      i.Longitude,
      i.GeoLocation,
      i.DriverName,
      i.DriverContactNumber,
      i.GroundTeamDetails,
      i.DispatchReason,
      i.OperatorNotesText,
      i.IncidentNotesHtml,
      i.ZohoAccount,
      i.TrailerRegistration1,
      i.TrailerRegistration2,
      i.VehicleMake,
      i.VehicleModel,
      i.VehicleColour,
      i.VehicleBranding,
      i.TrailerType,
      i.TrailerBranding,
      i.AdditionalAssetsJson,
      i.ClientName,
      i.ClientContactNumber,
      i.ClientPO,
      i.DLNumber,
      i.StockNumberWrc,
      i.DispatchTeam,
      i.DispatchDateTime,
      i.OBNumber,
      i.zoho_ob,
      i.StandDownDateTime,
      i.VehicleRecovered,
      i.RecoveryDateTime,
      i.LoadRecovered,
      i.VehicleKeyAvailable,
      i.TrailersRecovered,
      i.DriverOnScene,
      i.TrackingUnitStatus,
      i.DamageNotes,
      i.AssignedControlRoomAgent,
      i.Status,
      i.SubmittedAt,
      i.SubmittedBy,
      i.ApprovedAt,
      i.ApprovedBy,
      i.ApprovalComments,
      i.CreatedAt,
      i.CreatedBy,
      i.UpdatedAt,
      i.UpdatedBy
    FROM ${incidentTable} i
    WHERE i.id = @id
      AND ISNULL(i.IsDeleted, 0) = 0
  `);
  const incident = incidentResult.recordset[0];
  if (!incident) throw createHttpError(404, "Dispatch incident was not found.");
  const vehicleHistoryException = parseVehicleHistoryException(
    incident.OperatorNotesText,
    incident.TrackingUnitStatus,
    incident.UpdatedBy,
    incident.UpdatedAt
  );
  incident.OperatorNotesText = vehicleHistoryException.operatorNotesText;
  incident.VehicleHistoryUnavailable = vehicleHistoryException.unavailable;
  incident.VehicleHistoryUnavailableReason = vehicleHistoryException.reason;
  incident.VehicleHistoryUnavailableBy = vehicleHistoryException.recordedBy;
  incident.VehicleHistoryUnavailableAt = vehicleHistoryException.recordedAt;
  try {
    incident.AdditionalAssets = JSON.parse(incident.AdditionalAssetsJson || "[]");
    if (!Array.isArray(incident.AdditionalAssets)) incident.AdditionalAssets = [];
  } catch {
    incident.AdditionalAssets = [];
  }
  if (incident.Status !== "Approved") {
    throw createHttpError(409, "The incident report is available only after manager approval.");
  }

  const timelineRequest = await getRequest();
  timelineRequest.input("id", sql.Int, id);
  const timelineResult = await timelineRequest.query(`
    SELECT
      TimelineEntryID,
      EventDateTime,
      EventType,
      EntryText,
      CreatedAt,
      CreatedBy
    FROM ${timelineTable}
    WHERE DispatchID = @id
      AND ISNULL(IsDeleted, 0) = 0
    ORDER BY EventDateTime ASC, TimelineEntryID ASC
  `);

  const photoRequest = await getRequest();
  photoRequest.input("id", sql.Int, id);
  const photoResult = await photoRequest.query(`
    SELECT
      id,
      PhotoCategory,
      AssetKey,
      OriginalFileName,
      FilePath,
      MimeType,
      Notes,
      UploadedAt,
      UploadedBy
    FROM ${photoTable}
    WHERE dispatch_id = @id
      AND ISNULL(IsDeleted, 0) = 0
    ORDER BY UploadedAt ASC, id ASC
  `);
  const visiblePhotos = photoResult.recordset.filter((photo) => !photo.AssetKey ||
    incident.AdditionalAssets.some((asset) => String(asset.key || "").toLowerCase() === String(photo.AssetKey).toLowerCase()));
  for (const photo of visiblePhotos) {
    const assetIndex = incident.AdditionalAssets.findIndex((asset) =>
      String(asset.key || "").toLowerCase() === String(photo.AssetKey || "").toLowerCase());
    photo.AssetLabel = assetIndex >= 0 ? `Asset ${assetIndex + 2}: ` : "";
  }

  const communicationRequest = await getRequest();
  communicationRequest.input("id", sql.Int, id);
  const communicationResult = await communicationRequest.query(`
    SELECT
      CommunicationLogID,
      DisplayOrder,
      CommunicationDate,
      CommunicationTime,
      CommunicationType,
      ControlRoomAgent,
      ContactPerson,
      ContactNumber,
      EmailAddress,
      CommunicationNotes,
      CreatedAt,
      CreatedBy
    FROM ${communicationTable}
    WHERE DispatchID = @id
      AND ISNULL(IsDeleted, 0) = 0
    ORDER BY
      CASE WHEN DisplayOrder > 0 THEN DisplayOrder ELSE 2147483647 END ASC,
      CommunicationDate ASC,
      CommunicationTime ASC,
      CommunicationLogID ASC
  `);

  return {
    incident,
    timeline: timelineResult.recordset,
    photos: visiblePhotos,
    communications: communicationResult.recordset
  };
}

function addCorporateHeader(doc) {
  const left = PAGE.margin;
  const right = PAGE.width - PAGE.margin;
  doc.save();
  doc.polygon([left, 19], [340, 19], [326, 53], [left, 53]).fill(BRAND.navy);
  doc.polygon([344, 19], [389, 19], [375, 53], [330, 53]).fill("#b8b8b8");
  const logo = doc.reportLogo || reportLogoPath();
  if (logo) doc.image(logo, 410, 16, { fit: [157, 39], align: "right", valign: "center" });

  doc.fillColor(BRAND.text).font("Helvetica").fontSize(6.4);
  doc.text("Company Reg: 2010/022669/07   |   VESA No: 301660   |   ISO 9001|2015: SHEQ246-001", left + 17, 61, {
    width: right - left - 34,
    align: "left"
  });
  doc.text("Pulsit Electronics (Pty) Ltd P.O. Box 7, Henley on Klip, 1962   |   Tel: 0 (10) 476 2500   |   Email: notifications@example.invalid   |   Website: www.pulsit.co.za", left, 82, {
    width: right - left,
    align: "center"
  });
  doc.text("Directors: DG Fourie, MP Wray", left, 94, { width: right - left, align: "center" });
  doc.moveTo(left, 106).lineTo(right, 106).lineWidth(1.25).strokeColor(BRAND.navy).stroke();
  doc.restore();
}

function addPage(doc) {
  doc.addPage({ size: "A4", margins: { top: PAGE.contentTop, bottom: 36, left: PAGE.margin, right: PAGE.margin } });
  addCorporateHeader(doc);
  doc.x = PAGE.margin;
  doc.y = PAGE.contentTop;
}

function sectionTitle(doc, title, subtitle, iconName = null) {
  const titleX = iconName ? PAGE.margin + 31 : PAGE.margin;
  if (iconName) {
    doc.circle(PAGE.margin + 11, PAGE.contentTop + 12, 11).fill(BRAND.navy);
    drawReportIcon(doc, iconName, PAGE.margin + 5.5, PAGE.contentTop + 6.5, 11, BRAND.white, 2);
  }
  doc.fillColor(BRAND.navy).font("Helvetica-Bold").fontSize(21).text(title.toUpperCase(), titleX, PAGE.contentTop, {
    width: PAGE.width - PAGE.margin - titleX
  });
  let y = doc.y + 4;
  if (subtitle) {
    doc.fillColor(BRAND.muted).font("Helvetica").fontSize(8.5).text(subtitle, PAGE.margin, y, {
      width: PAGE.width - PAGE.margin * 2
    });
    y = doc.y + 8;
  } else {
    y += 8;
  }
  return y;
}

function drawOverviewCard(doc, x, y, width, label, value, secondary, iconName) {
  const height = 91;
  doc.save();
  doc.roundedRect(x, y, width, height, 4).fillAndStroke(BRAND.white, BRAND.line);
  doc.circle(x + width / 2, y + 18, 11).fill(BRAND.navy);
  drawReportIcon(doc, iconName, x + width / 2 - 6.5, y + 11.5, 13, BRAND.white, 1.9);
  doc.fillColor(BRAND.navy).font("Helvetica-Bold").fontSize(6.4).text(label.toUpperCase(), x + 5, y + 35, {
    width: width - 10,
    align: "center",
    height: 16
  });
  doc.fillColor(BRAND.text).font("Helvetica-Bold").fontSize(8.5).text(valueOrNA(value), x + 5, y + 54, {
    width: width - 10,
    align: "center",
    height: 17,
    ellipsis: true
  });
  if (secondary) {
    doc.fillColor(BRAND.muted).font("Helvetica").fontSize(6.5).text(valueOrNA(secondary), x + 5, y + 73, {
      width: width - 10,
      align: "center",
      height: 12,
      ellipsis: true
    });
  }
  doc.restore();
  return height;
}

function drawPanel(doc, x, y, width, title, rows, options = {}) {
  const labelWidth = options.labelWidth || Math.min(91, width * 0.43);
  const titleHeight = 27;
  const rowHeights = rows.map(([label, value]) => {
    const safeValue = plainText(value);
    const textHeight = doc.font("Helvetica").fontSize(7.2).heightOfString(safeValue, {
      width: width - labelWidth - 19,
      lineGap: 1
    });
    return Math.max(25, textHeight + 12);
  });
  const height = titleHeight + rowHeights.reduce((sum, rowHeight) => sum + rowHeight, 0);
  doc.save();
  doc.roundedRect(x, y, width, height, 4).fillAndStroke(BRAND.white, BRAND.line);
  doc.roundedRect(x, y, width, titleHeight, 4).fill(BRAND.pale);
  doc.rect(x, y + titleHeight - 4, width, 4).fill(BRAND.pale);
  if (options.titleIcon) drawReportIcon(doc, options.titleIcon, x + 10, y + 7, 13, BRAND.navy, 1.8);
  const titleX = options.titleIcon ? x + 30 : x + 11;
  doc.fillColor(BRAND.navy).font("Helvetica-Bold").fontSize(8).text(title.toUpperCase(), titleX, y + 9, {
    width: width - (titleX - x) - 11
  });
  let rowY = y + titleHeight;
  rows.forEach(([label, value, iconName], index) => {
    const rowHeight = rowHeights[index];
    if (index) doc.moveTo(x, rowY).lineTo(x + width, rowY).lineWidth(0.45).strokeColor(BRAND.line).stroke();
    if (options.rowIcons && iconName) {
      doc.roundedRect(x + 7, rowY + 4, 17, 17, 2).fill(BRAND.navy);
      drawReportIcon(doc, iconName, x + 10, rowY + 7, 11, BRAND.white, 1.8);
    }
    const labelX = options.rowIcons && iconName ? x + 29 : x + 10;
    doc.fillColor(BRAND.muted).font("Helvetica-Bold").fontSize(6.6).text(label, labelX, rowY + 8, {
      width: x + labelWidth - labelX - 3
    });
    const normalizedStatus = String(value || "").trim().toLowerCase();
    const statusIcon = options.statusIcons && ["yes", "no"].includes(normalizedStatus)
      ? (normalizedStatus === "yes" ? "check" : "close")
      : null;
    const statusOffset = statusIcon ? 14 : 0;
    if (statusIcon) {
      drawReportIcon(doc, statusIcon, x + labelWidth, rowY + 6.5, 10, normalizedStatus === "yes" ? BRAND.green : BRAND.red, 2.2);
    }
    doc.fillColor(BRAND.text).font("Helvetica").fontSize(7.2).text(plainText(value), x + labelWidth + statusOffset, rowY + 7, {
      width: width - labelWidth - statusOffset - 10,
      lineGap: 1
    });
    rowY += rowHeight;
  });
  doc.restore();
  return height;
}

function panelHeight(doc, width, rows, options = {}) {
  const labelWidth = options.labelWidth || Math.min(91, width * 0.43);
  return 27 + rows.reduce((total, [, value]) => {
    const textHeight = doc.font("Helvetica").fontSize(7.2).heightOfString(plainText(value), {
      width: width - labelWidth - 19,
      lineGap: 1
    });
    return total + Math.max(25, textHeight + 12);
  }, 0);
}

function assetDetailsPanelHeight(doc, width, vehicleRows, trailerRows) {
  const innerGap = 9;
  const innerPadding = 9;
  const innerWidth = width - innerPadding * 2;
  const detailOptions = { labelWidth: 84 };
  const contentHeight = panelHeight(doc, innerWidth, vehicleRows, detailOptions)
    + innerGap
    + panelHeight(doc, innerWidth, trailerRows, detailOptions);
  return 27 + innerPadding + contentHeight + innerPadding;
}

function drawAssetDetailsPanel(doc, x, y, width, vehicleRows, trailerRows) {
  const titleHeight = 27;
  const innerGap = 9;
  const innerPadding = 9;
  const innerWidth = width - innerPadding * 2;
  const detailOptions = { labelWidth: 84 };
  const height = assetDetailsPanelHeight(doc, width, vehicleRows, trailerRows);

  doc.save();
  doc.roundedRect(x, y, width, height, 4).fillAndStroke(BRAND.white, BRAND.line);
  doc.roundedRect(x, y, width, titleHeight, 4).fill(BRAND.pale);
  doc.rect(x, y + titleHeight - 4, width, 4).fill(BRAND.pale);
  drawReportIcon(doc, "truck", x + 10, y + 7, 13, BRAND.navy, 1.8);
  doc.fillColor(BRAND.navy).font("Helvetica-Bold").fontSize(8).text("ASSET DETAILS", x + 30, y + 9, {
    width: width - 41
  });
  doc.restore();

  const innerY = y + titleHeight + innerPadding;
  const vehicleHeight = drawPanel(doc, x + innerPadding, innerY, innerWidth, "Vehicle Details", vehicleRows, {
    ...detailOptions,
    titleIcon: "truck"
  });
  drawPanel(doc, x + innerPadding, innerY + vehicleHeight + innerGap, innerWidth, "Trailer Details", trailerRows, {
    ...detailOptions,
    titleIcon: "package"
  });

  return height;
}

function drawAdditionalAssetsPage(doc, data) {
  const assets = data.incident.AdditionalAssets || [];
  if (!assets.length) return;
  addPage(doc);
  let y = sectionTitle(doc, "Additional Assets", `${assets.length} additional asset${assets.length === 1 ? "" : "s"} recorded for this dispatch.`, "truck");
  const width = PAGE.width - PAGE.margin * 2;
  for (const [index, asset] of assets.entries()) {
    const vehicleRows = [
      ["Registration", asset.regNo], ["Make", asset.vehicleMake], ["Model", asset.vehicleModel],
      ["Colour", asset.vehicleColour], ["Branding", asset.vehicleBranding],
      ["No visible damages", asset.noVisibleDamages ? "Yes" : "No"]
    ];
    const trailerRows = [
      ["Registration 1", asset.trailerRegistration1], ["Registration 2", asset.trailerRegistration2],
      ["Type", asset.trailerType], ["Branding", asset.trailerBranding]
    ];
    const height = assetDetailsPanelHeight(doc, width, vehicleRows, trailerRows) + 27;
    if (y + height > PAGE.contentBottom) {
      addPage(doc);
      y = sectionTitle(doc, "Additional Assets", "Continued", "truck");
    }
    doc.fillColor(BRAND.navy).font("Helvetica-Bold").fontSize(10).text(`Asset ${index + 2}`, PAGE.margin, y, { width });
    y += 23;
    y += drawAssetDetailsPanel(doc, PAGE.margin, y, width, vehicleRows, trailerRows) + 12;
  }
}

function drawSummaryPage(doc, data) {
  const incident = data.incident;
  let y = sectionTitle(doc, "Incident Report");
  const gap = 7;
  const totalWidth = PAGE.width - PAGE.margin * 2;
  const overview = [
    ["Reference", incident.zoho_ob, null, "reference"],
    ["Asset Registration", incident.RegNo, null, "truck"],
    ["Incident Date", formatDate(incident.EventDateTime), new Intl.DateTimeFormat("en-ZA", { weekday: "long", timeZone: REPORT_WALL_CLOCK_TIME_ZONE }).format(dateValue(incident.EventDateTime) || new Date()), "calendar"],
    ["Client", incident.Company, incident.ClientName, "user"]
  ];
  const cardWidth = (totalWidth - gap * (overview.length - 1)) / overview.length;
  overview.forEach(([label, value, secondary, iconName], index) => {
    drawOverviewCard(doc, PAGE.margin + index * (cardWidth + gap), y, cardWidth, label, value, secondary, iconName);
  });
  y += 103;

  const columnGap = 9;
  const columnWidth = (totalWidth - columnGap) / 2;
  const incidentRows = [
    ["Type of Event", incident.Event, "alert"],
    ["Date of Event", formatDate(incident.EventDateTime), "calendar"],
    ["Time of Event", formatTime(incident.EventDateTime), "clock"],
    ["Dispatch GeoLocation", incident.GeoLocation, "location"],
    ["Coordinates", incident.Latitude !== null && incident.Latitude !== undefined
      && incident.Longitude !== null && incident.Longitude !== undefined
      ? `${incident.Latitude}, ${incident.Longitude}`
      : null, "location"],
    ["ETA (Km)", incident.ETA, "hourglass"],
    ["Dispatch Time", formatTime(incident.DispatchDateTime), "dispatch"],
    ["Recovery Time", formatTime(incident.RecoveryDateTime), "clock"],
    ["Time to Recovery", durationBetween(incident.DispatchDateTime, incident.RecoveryDateTime), "stopwatch"],
    ["Stand Down", formatDate(incident.StandDownDateTime, true), "flag"]
  ];
  const incidentOptions = { titleIcon: "alert", rowIcons: true };
  const recoveryRows = [
    ["Recovery Date/Time", formatDate(incident.RecoveryDateTime, true)],
    ["Vehicle Recovered", incident.VehicleRecovered],
    ["Trailer/s Recovered", incident.TrailersRecovered],
    ["Load Recovered", incident.LoadRecovered],
    ["Vehicle Key", incident.VehicleKeyAvailable],
    ["Driver On Scene", incident.DriverOnScene],
    ["Tracking Status", incident.TrackingUnitStatus],
    ["Vehicle History", incident.VehicleHistoryUnavailable ? "Not available — non-Pulsit unit" : "Available"],
    ["History Exception Reason", incident.VehicleHistoryUnavailable ? incident.VehicleHistoryUnavailableReason : null],
    ["History Exception Recorded", incident.VehicleHistoryUnavailable
      ? `${valueOrNA(incident.VehicleHistoryUnavailableBy)} | ${formatDate(incident.VehicleHistoryUnavailableAt, true)}`
      : null],
    ["Recovery OB", incident.OBNumber]
  ];
  const recoveryOptions = { titleIcon: "shield", statusIcons: true };
  drawPanel(doc, PAGE.margin, y, columnWidth, "Incident Details", incidentRows, incidentOptions);
  drawPanel(doc, PAGE.margin + columnWidth + columnGap, y, columnWidth, "Recovery Status", recoveryRows, recoveryOptions);
  y += Math.max(
    panelHeight(doc, columnWidth, incidentRows, incidentOptions),
    panelHeight(doc, columnWidth, recoveryRows, recoveryOptions)
  ) + 12;

  const clientRows = [
    ["Company", incident.Company],
    ["Client Name", incident.ClientName],
    ["Client Number", incident.ClientContactNumber],
    ["Client PO", incident.ClientPO],
    ["Risk Reference", incident.zoho_ob],
    ["DL Number", incident.DLNumber]
  ];
  const clientOptions = { titleIcon: "user" };

  const vehicleRows = [
    ["Registration", incident.RegNo],
    ["Fleet Number", incident.FleetCode],
    ["Make", incident.VehicleMake],
    ["Model", incident.VehicleModel],
    ["Colour", incident.VehicleColour],
    ["Branding", incident.VehicleBranding]
  ];
  const trailerRows = [
    ["Registration 1", incident.TrailerRegistration1],
    ["Registration 2", incident.TrailerRegistration2],
    ["Type", incident.TrailerType],
    ["Branding", incident.TrailerBranding]
  ];
  const lowerRowHeight = Math.max(
    panelHeight(doc, columnWidth, clientRows, clientOptions),
    assetDetailsPanelHeight(doc, columnWidth, vehicleRows, trailerRows)
  );
  if (y + lowerRowHeight > PAGE.contentBottom) {
    addPage(doc);
    y = PAGE.contentTop;
  }
  drawPanel(doc, PAGE.margin, y, columnWidth, "Client Information", clientRows, clientOptions);
  drawAssetDetailsPanel(doc, PAGE.margin + columnWidth + columnGap, y, columnWidth, vehicleRows, trailerRows);
}

function drawTimelinePage(doc, data) {
  let y = sectionTitle(doc, "Incident Timeline", "Events are shown in chronological order.", "clock");
  const visibleRows = (data.timeline || []).filter((row) => {
    const eventType = String(row.EventType || "").trim();
    const entryText = String(row.EntryText || "").trim();
    return !/^handover$/i.test(eventType) && !/^handover\s*:/i.test(entryText);
  });
  const rows = visibleRows.length ? visibleRows : [{ EventDateTime: null, EventType: "N/A", EntryText: "N/A" }];
  const timelineX = PAGE.margin + 12;
  const cardX = timelineX + 20;
  const cardWidth = PAGE.width - cardX - PAGE.margin;
  const rowGap = 8;
  for (const [index, row] of rows.entries()) {
    const description = plainText(row.EntryText);
    const descriptionHeight = doc.font("Helvetica").fontSize(8.2).heightOfString(description, {
      width: cardWidth - 24,
      lineGap: 2
    });
    const cardHeight = Math.max(48, descriptionHeight + 36);
    if (y + cardHeight > PAGE.contentBottom) {
      addPage(doc);
      y = sectionTitle(doc, "Incident Timeline", "Continued", "clock");
    }
    doc.save();
    if (index < rows.length - 1) {
      doc.moveTo(timelineX, y + 16).lineTo(timelineX, y + cardHeight + rowGap + 16)
        .lineWidth(1.1).strokeColor(BRAND.line).stroke();
    }
    doc.roundedRect(cardX, y, cardWidth, cardHeight, 4).fillAndStroke(BRAND.white, BRAND.line);
    doc.roundedRect(cardX, y, cardWidth, 25, 4).fill(BRAND.pale);
    doc.rect(cardX, y + 21, cardWidth, 4).fill(BRAND.pale);
    doc.circle(timelineX, y + 16, 9).fill(BRAND.navy);
    drawReportIcon(doc, TIMELINE_ICONS[row.EventType] || "note", timelineX - 5.5, y + 10.5, 11, BRAND.white, 1.9);
    doc.fillColor(BRAND.navy).font("Helvetica-Bold").fontSize(8).text(valueOrNA(row.EventType).toUpperCase(), cardX + 12, y + 8, {
      width: cardWidth - 190
    });
    doc.fillColor(BRAND.muted).font("Helvetica-Bold").fontSize(7).text(
      `${formatTimelineDate(row.EventDateTime)}  |  ${formatTime(row.EventDateTime)}`,
      cardX + cardWidth - 175,
      y + 8,
      {
        width: 163,
        align: "right"
      }
    );
    doc.fillColor(BRAND.text).font("Helvetica").fontSize(8.2).text(description, cardX + 12, y + 32, {
      width: cardWidth - 24,
      height: cardHeight - 38,
      lineGap: 2
    });
    doc.restore();
    y += cardHeight + rowGap;
  }
}

function drawCommunicationOverview(doc, incident) {
  let y = sectionTitle(doc, "Communication Log Report");
  const gap = 7;
  const totalWidth = PAGE.width - PAGE.margin * 2;
  const cardWidth = (totalWidth - gap * 4) / 5;
  const incidentDate = dateValue(incident.EventDateTime);
  const overview = [
    ["Reference", incident.zoho_ob, null, "reference"],
    ["Asset Registration", incident.RegNo, incident.UnitId, "truck"],
    ["Incident Date", formatDate(incident.EventDateTime), incidentDate
      ? new Intl.DateTimeFormat("en-ZA", { weekday: "long", timeZone: REPORT_WALL_CLOCK_TIME_ZONE }).format(incidentDate)
      : null, "calendar"],
    ["Client", incident.Company, incident.ClientName, "user"],
    ["Operator", incident.AssignedControlRoomAgent || incident.CreatedBy, incident.ApprovedBy ? `Approved: ${incident.ApprovedBy}` : null, "headset"]
  ];
  overview.forEach(([label, value, secondary, iconName], index) => {
    drawOverviewCard(doc, PAGE.margin + index * (cardWidth + gap), y, cardWidth, label, value, secondary, iconName);
  });
  return y + 105;
}

function communicationNotesHeight(doc, notes, width) {
  return doc.font("Helvetica").fontSize(8).heightOfString(notes, {
    width: width - 24,
    lineGap: 2
  });
}

function communicationRowHeight(doc, notes, width) {
  return Math.max(83, Math.ceil(78 + communicationNotesHeight(doc, notes, width)));
}

function fittingCommunicationNotes(doc, notes, width, availableHeight) {
  if (communicationNotesHeight(doc, notes, width) <= availableHeight) return notes;
  // Measure with the same font, width and spacing used for rendering. A single
  // entry can exceed a whole page, so moving its card alone is insufficient.
  let low = 0;
  let high = notes.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (communicationNotesHeight(doc, notes.slice(0, middle), width) <= availableHeight) low = middle;
    else high = middle - 1;
  }
  if (!low) throw new Error("The report page has no space for a communication line.");
  // Prefer a word/paragraph boundary; split very long unbroken words as needed.
  const boundary = notes.slice(0, low + 1).search(/\s+\S*$/);
  if (boundary > 0) low = boundary;
  // Never separate the UTF-16 halves of one character.
  if (/^[\uDC00-\uDFFF]$/.test(notes[low] || "")) low -= 1;
  return notes.slice(0, low);
}

function drawCommunicationRow(doc, row, index, x, y, width, height, notes, continued = false) {
  const date = formatDate(row.CommunicationDate);
  const time = formatTime(row.CommunicationTime);
  const contact = [
    row.ContactPerson,
    row.ContactNumber,
    row.EmailAddress
  ].filter((value) => String(value || "").trim()).join(" | ") || "N/A";

  doc.save();
  doc.roundedRect(x, y, width, height, 4).fillAndStroke(BRAND.white, BRAND.line);
  doc.roundedRect(x, y, width, 27, 4).fill(BRAND.pale);
  doc.rect(x, y + 23, width, 4).fill(BRAND.pale);
  doc.circle(x + 16, y + 13.5, 8).fill(BRAND.navy);
  drawReportIcon(doc, "phone", x + 11.5, y + 9, 9, BRAND.white, 1.8);
  doc.fillColor(BRAND.navy).font("Helvetica-Bold").fontSize(8)
    .text(`${index}. ${valueOrNA(row.CommunicationType)}${continued ? " (continued)" : ""}`, x + 30, y + 9, { width: width - 190, height: 12, ellipsis: true });
  doc.fillColor(BRAND.muted).font("Helvetica-Bold").fontSize(7)
    .text(`${date}  |  ${time}`, x + width - 155, y + 9, { width: 143, align: "right" });

  doc.fillColor(BRAND.muted).font("Helvetica-Bold").fontSize(6.7).text("CONTROL ROOM AGENT", x + 12, y + 36, { width: 105 });
  doc.fillColor(BRAND.text).font("Helvetica").fontSize(7.5).text(valueOrNA(row.ControlRoomAgent || row.CreatedBy), x + 119, y + 35, {
    width: width - 131,
    height: 12,
    ellipsis: true
  });
  doc.fillColor(BRAND.muted).font("Helvetica-Bold").fontSize(6.7).text("CONTACT", x + 12, y + 50, { width: 105 });
  doc.fillColor(BRAND.text).font("Helvetica").fontSize(7.5).text(contact, x + 119, y + 49, {
    width: width - 131,
    height: 12,
    ellipsis: true
  });
  doc.moveTo(x + 12, y + 63).lineTo(x + width - 12, y + 63).lineWidth(0.4).strokeColor(BRAND.line).stroke();
  doc.fillColor(BRAND.text).font("Helvetica").fontSize(8).text(notes, x + 12, y + 70, {
    width: width - 24,
    height: height - 78,
    lineGap: 2
  });
  doc.restore();
}

function drawCommunicationLog(doc, data) {
  let y = drawCommunicationOverview(doc, data.incident);
  const width = PAGE.width - PAGE.margin * 2;
  const rows = data.communications || [];
  doc.fillColor(BRAND.navy).font("Helvetica-Bold").fontSize(11).text("COMMUNICATION LOG", PAGE.margin, y, { width });
  y = doc.y + 8;

  if (!rows.length) {
    drawPanel(doc, PAGE.margin, y, width, "Communication Log", [["Entries", "No communication log entries were recorded."]], {
      titleIcon: "phone"
    });
    return;
  }

  rows.forEach((row, index) => {
    let remainingNotes = plainText(row.CommunicationNotes);
    const height = communicationRowHeight(doc, remainingNotes, width);
    if (y + height > PAGE.contentBottom) {
      addPage(doc);
      y = sectionTitle(doc, "Communication Log Report", "Communication log continued.", "phone");
    }
    let continued = false;
    while (remainingNotes.length) {
      const availableHeight = Math.floor(PAGE.contentBottom - y - 78);
      const notes = fittingCommunicationNotes(doc, remainingNotes, width, availableHeight);
      const fragmentHeight = communicationRowHeight(doc, notes, width);
      drawCommunicationRow(doc, row, index + 1, PAGE.margin, y, width, fragmentHeight, notes, continued);
      y += fragmentHeight + 8;
      remainingNotes = remainingNotes.slice(notes.length);
      if (remainingNotes.length) {
        addPage(doc);
        y = sectionTitle(doc, "Communication Log Report", "Communication log continued.", "phone");
        continued = true;
      }
    }
  });
}

function drawPhotoCard(doc, photo, x, y, width, height) {
  doc.save();
  doc.roundedRect(x, y, width, height, 4).fillAndStroke(BRAND.white, BRAND.line);
  const title = `${photo.AssetLabel || ""}${PHOTO_LABELS[photo.PhotoCategory] || valueOrNA(photo.PhotoCategory)}`;
  drawReportIcon(doc, "camera", x + 9, y + 6, 13, BRAND.navy, 1.8);
  doc.fillColor(BRAND.navy).font("Helvetica-Bold").fontSize(7.5).text(title.toUpperCase(), x + 29, y + 8, {
    width: width - 38,
    height: 11,
    ellipsis: true
  });
  const imageY = y + 25;
  const imageHeight = height - 34;
  doc.rect(x + 8, imageY, width - 16, imageHeight).fill(BRAND.pale);
  if (photo.image) {
    doc.image(photo.image, x + 8, imageY, {
      fit: [width - 16, imageHeight],
      align: "center",
      valign: "center"
    });
  } else {
    doc.fillColor(BRAND.muted).font("Helvetica").fontSize(8).text("Image unavailable", x + 8, imageY + imageHeight / 2 - 4, {
      width: width - 16,
      align: "center"
    });
  }
  doc.restore();
}

function drawPhotoPages(doc, data) {
  const photos = data.photos.length ? data.photos : [{ PhotoCategory: "Dispatch photographs", Notes: "N/A", image: null }];
  let index = 0;
  while (index < photos.length) {
    addPage(doc);
    let y = sectionTitle(doc, "Dispatch Photographs", `${photos.length} photograph${photos.length === 1 ? "" : "s"} attached to this incident.`, "camera");
    const gap = 10;
    const width = (PAGE.width - PAGE.margin * 2 - gap) / 2;
    const height = 286;
    for (let slot = 0; slot < 4 && index < photos.length; slot += 1, index += 1) {
      const column = slot % 2;
      const row = Math.floor(slot / 2);
      drawPhotoCard(doc, photos[index], PAGE.margin + column * (width + gap), y + row * (height + gap), width, height);
    }
  }
}

function addFooters(doc, incident, reportTitle = "Incident Report") {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const y = PAGE.height - 24;
    const originalBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.save();
    doc.moveTo(PAGE.margin, y - 8).lineTo(PAGE.width - PAGE.margin, y - 8).lineWidth(0.5).strokeColor(BRAND.line).stroke();
    doc.fillColor(BRAND.muted).font("Helvetica").fontSize(6.5).text(`${reportTitle} | ${valueOrNA(incident.RegNo)} | Confidential`, PAGE.margin, y, {
      width: 300
    });
    doc.text(`Page ${index + 1} of ${range.count}`, PAGE.width - PAGE.margin - 100, y, { width: 100, align: "right" });
    doc.restore();
    doc.page.margins.bottom = originalBottomMargin;
  }
}

async function generateIncidentReport(data, output) {
  const preparedPhotos = await Promise.all((data.photos || []).map(preparePhoto));
  const preparedLogo = await prepareReportLogo();
  const preparedData = { ...data, photos: preparedPhotos };
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: PAGE.contentTop, bottom: 36, left: PAGE.margin, right: PAGE.margin },
    bufferPages: true,
    autoFirstPage: false,
    info: {
      Title: `Incident Report - ${valueOrNA(data.incident.RegNo)}`,
      Author: "Pulsit Electronics (Pty) Ltd",
      Subject: valueOrNA(data.incident.IncidentNumber)
    }
  });
  doc.reportLogo = preparedLogo;
  doc.pipe(output);
  addPage(doc);
  drawSummaryPage(doc, preparedData);
  drawAdditionalAssetsPage(doc, preparedData);
  addPage(doc);
  drawTimelinePage(doc, preparedData);
  drawPhotoPages(doc, preparedData);
  addFooters(doc, data.incident);
  doc.end();
}

async function generateCommunicationLogReport(data, output) {
  const preparedLogo = await prepareReportLogo();
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: PAGE.contentTop, bottom: 36, left: PAGE.margin, right: PAGE.margin },
    bufferPages: true,
    autoFirstPage: false,
    info: {
      Title: `Communication Log Report - ${valueOrNA(data.incident.RegNo)}`,
      Author: "Pulsit Electronics (Pty) Ltd",
      Subject: valueOrNA(data.incident.IncidentNumber)
    }
  });
  doc.reportLogo = preparedLogo;
  doc.pipe(output);
  addPage(doc);
  drawCommunicationLog(doc, data);
  addFooters(doc, data.incident, "Communication Log Report");
  doc.end();
}

module.exports = {
  fetchIncidentReportData,
  generateIncidentReport,
  generateCommunicationLogReport,
  incidentReportFileName,
  communicationLogReportFileName,
  valueOrNA
};
