const PHOTO_CATEGORIES = [
  "LicenseDisk",
  "FrontVehicleWithReg",
  "BackVehicleWithReg",
  "VehicleSides",
  "TrailersWithReg",
  "Stock",
  "Damages",
  "Dashboard",
  "VehicleKeys",
  "Odometer",
  "Driver",
  "DriverLicenseOrId"
];

const FILE_TYPES = ["HistoryExcel", "HistoryPdf", "TeamIncidentReport", "GeneratedIncidentPdf"];
const APPROVAL_STATUSES = ["Pending", "Approved", "Rejected"];
const INCIDENT_STATUSES = [
  "Draft",
  "PendingApproval",
  "Approved",
  "Rejected",
  "ZohoQueued",
  "ZohoUploaded",
  "ZohoUploadFailed",
  "Cancelled"
];

const OPERATOR_META_MARKER = "\n\n[DispatchLinkMeta]\n";

function normalizeText(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

function normalizeNullable(value) {
  const normalized = normalizeText(value);
  return normalized || null;
}

function toBoolean(value) {
  return value === true || value === 1 || value === "1" || String(value || "").toLowerCase() === "true";
}

function parseOperatorNotes(rawValue) {
  const raw = String(rawValue ?? "");
  const markerIndex = raw.indexOf(OPERATOR_META_MARKER);
  if (markerIndex === -1) {
      return {
      text: raw.trim(),
      meta: {
        trailerApplicable: false,
        eta: "",
        incidentNotesHtml: "",
        stockApplicable: false,
        noVisibleDamages: false,
        damageNotes: "",
        vehicleMake: "",
        vehicleModel: "",
        vehicleColour: "",
        vehicleBranding: "",
        trailerType: "",
        trailerBranding: "",
        clientName: "",
        clientContactNumber: "",
        clientPo: "",
        dlNumber: "",
        stockNumberWrc: "",
        dispatchTeam: "",
        dispatchDateTime: "",
        obNumber: "",
        standDownDateTime: "",
        vehicleRecovered: "",
        recoveryDateTime: "",
        loadRecovered: "",
        vehicleKeyAvailable: "",
        trailersRecovered: "",
        driverOnScene: "",
        trackingUnitStatus: ""
      }
    };
  }

  const text = raw.slice(0, markerIndex).trim();
  const metaRaw = raw.slice(markerIndex + OPERATOR_META_MARKER.length).trim();
  try {
    const parsed = JSON.parse(metaRaw);
    return {
      text,
      meta: {
        trailerApplicable: toBoolean(parsed.trailerApplicable),
        eta: normalizeText(parsed.eta),
        incidentNotesHtml: normalizeText(parsed.incidentNotesHtml),
        stockApplicable: toBoolean(parsed.stockApplicable),
        noVisibleDamages: toBoolean(parsed.noVisibleDamages),
        damageNotes: normalizeText(parsed.damageNotes),
        vehicleMake: normalizeText(parsed.vehicleMake),
        vehicleModel: normalizeText(parsed.vehicleModel),
        vehicleColour: normalizeText(parsed.vehicleColour),
        vehicleBranding: normalizeText(parsed.vehicleBranding),
        trailerType: normalizeText(parsed.trailerType),
        trailerBranding: normalizeText(parsed.trailerBranding),
        clientName: normalizeText(parsed.clientName),
        clientContactNumber: normalizeText(parsed.clientContactNumber),
        clientPo: normalizeText(parsed.clientPo),
        dlNumber: normalizeText(parsed.dlNumber),
        stockNumberWrc: normalizeText(parsed.stockNumberWrc),
        dispatchTeam: normalizeText(parsed.dispatchTeam),
        dispatchDateTime: normalizeText(parsed.dispatchDateTime),
        obNumber: normalizeText(parsed.obNumber),
        standDownDateTime: normalizeText(parsed.standDownDateTime),
        vehicleRecovered: normalizeText(parsed.vehicleRecovered),
        recoveryDateTime: normalizeText(parsed.recoveryDateTime),
        loadRecovered: normalizeText(parsed.loadRecovered),
        vehicleKeyAvailable: normalizeText(parsed.vehicleKeyAvailable),
        trailersRecovered: normalizeText(parsed.trailersRecovered),
        driverOnScene: normalizeText(parsed.driverOnScene),
        trackingUnitStatus: normalizeText(parsed.trackingUnitStatus)
      }
    };
  } catch {
    return {
      text: raw.trim(),
      meta: {
        trailerApplicable: false,
        eta: "",
        incidentNotesHtml: "",
        stockApplicable: false,
        noVisibleDamages: false,
        damageNotes: "",
        vehicleMake: "",
        vehicleModel: "",
        vehicleColour: "",
        vehicleBranding: "",
        trailerType: "",
        trailerBranding: "",
        clientName: "",
        clientContactNumber: "",
        clientPo: "",
        dlNumber: "",
        stockNumberWrc: "",
        dispatchTeam: "",
        dispatchDateTime: "",
        obNumber: "",
        standDownDateTime: "",
        vehicleRecovered: "",
        recoveryDateTime: "",
        loadRecovered: "",
        vehicleKeyAvailable: "",
        trailersRecovered: "",
        driverOnScene: "",
        trackingUnitStatus: ""
      }
    };
  }
}

function buildOperatorNotes(textValue, metaValue = {}) {
  const text = normalizeText(textValue);
  const meta = {
    trailerApplicable: toBoolean(metaValue.trailerApplicable),
    eta: normalizeText(metaValue.eta),
    incidentNotesHtml: normalizeText(metaValue.incidentNotesHtml),
    stockApplicable: toBoolean(metaValue.stockApplicable),
    noVisibleDamages: toBoolean(metaValue.noVisibleDamages),
    damageNotes: normalizeText(metaValue.damageNotes),
    vehicleMake: normalizeText(metaValue.vehicleMake),
    vehicleModel: normalizeText(metaValue.vehicleModel),
    vehicleColour: normalizeText(metaValue.vehicleColour),
    vehicleBranding: normalizeText(metaValue.vehicleBranding),
    trailerType: normalizeText(metaValue.trailerType),
    trailerBranding: normalizeText(metaValue.trailerBranding),
    clientName: normalizeText(metaValue.clientName),
    clientContactNumber: normalizeText(metaValue.clientContactNumber),
    clientPo: normalizeText(metaValue.clientPo),
    dlNumber: normalizeText(metaValue.dlNumber),
    stockNumberWrc: normalizeText(metaValue.stockNumberWrc),
    dispatchTeam: normalizeText(metaValue.dispatchTeam),
    dispatchDateTime: normalizeText(metaValue.dispatchDateTime),
    obNumber: normalizeText(metaValue.obNumber),
    standDownDateTime: normalizeText(metaValue.standDownDateTime),
    vehicleRecovered: normalizeText(metaValue.vehicleRecovered),
    recoveryDateTime: normalizeText(metaValue.recoveryDateTime),
    loadRecovered: normalizeText(metaValue.loadRecovered),
    vehicleKeyAvailable: normalizeText(metaValue.vehicleKeyAvailable),
    trailersRecovered: normalizeText(metaValue.trailersRecovered),
    driverOnScene: normalizeText(metaValue.driverOnScene),
    trackingUnitStatus: normalizeText(metaValue.trackingUnitStatus)
  };

  return `${text}${OPERATOR_META_MARKER}${JSON.stringify(meta)}`.trim();
}

function computeIncidentValidation(incident, photos = [], files = []) {
  const parsedNotes = parseOperatorNotes(incident.OperatorNotes);
  const missingFields = [];
  const missingPhotos = [];

  if (!normalizeText(incident.UnitId)) missingFields.push("Unit ID");
  if (!normalizeText(incident.RegNo) && !normalizeText(incident.RiskEventReference)) missingFields.push("Registration number");
  if (!normalizeText(incident.Company)) missingFields.push("Company");
  if (!normalizeText(incident.Event)) missingFields.push("Event");
  if (!incident.EventDateTime) missingFields.push("Event date/time");
  if (!normalizeText(incident.DispatchReason) && !normalizeText(parsedNotes.text)) missingFields.push("Dispatch reason or incident detail text");
  if (!normalizeText(incident.CreatedBy)) missingFields.push("Authenticated username");

  const uploadedCategories = new Set(
    photos
      .map((photo) => String(photo.PhotoCategory || "").trim())
      .filter(Boolean)
  );

  const vehicleRecovered = normalizeText(incident.VehicleRecovered || parsedNotes.meta.vehicleRecovered);
  const vehicleKeyAvailable = normalizeText(incident.VehicleKeyAvailable || parsedNotes.meta.vehicleKeyAvailable);
  const trailersRecovered = normalizeText(incident.TrailersRecovered || parsedNotes.meta.trailersRecovered);
  const driverOnScene = normalizeText(incident.DriverOnScene || parsedNotes.meta.driverOnScene);
  const recoveryDateTime = incident.RecoveryDateTime || parsedNotes.meta.recoveryDateTime;
  const requiredCategories = [];

  if (vehicleRecovered === "Yes") {
    requiredCategories.push(
      "LicenseDisk",
      "FrontVehicleWithReg",
      "BackVehicleWithReg",
      "VehicleSides",
      "Dashboard"
    );
    if (!recoveryDateTime) missingFields.push("Recovery DateTime");
  }
  if (vehicleKeyAvailable === "Yes") requiredCategories.push("VehicleKeys");
  if (trailersRecovered === "Yes") requiredCategories.push("TrailersWithReg");
  if (driverOnScene === "Yes") requiredCategories.push("Driver", "DriverLicenseOrId");

  for (const category of requiredCategories) {
    if (!uploadedCategories.has(category)) {
      missingPhotos.push(category);
    }
  }

  return {
    isValid: missingFields.length === 0 && missingPhotos.length === 0,
    missingFields,
    missingPhotos,
    flags: parsedNotes.meta,
    noteText: parsedNotes.text,
    uploads: {
      photoCount: photos.length,
      fileCount: files.length
    }
  };
}

function canEditIncident(status) {
  return status === "Draft" || status === "Rejected" || status === "PendingApproval";
}

function canSubmitIncident(status) {
  return status === "Draft" || status === "Rejected";
}

function ensureAllowedValue(value, allowedValues, label) {
  if (!allowedValues.includes(value)) {
    throw new Error(`${label} must be one of: ${allowedValues.join(", ")}`);
  }
}

module.exports = {
  APPROVAL_STATUSES,
  FILE_TYPES,
  INCIDENT_STATUSES,
  OPERATOR_META_MARKER,
  PHOTO_CATEGORIES,
  buildOperatorNotes,
  canEditIncident,
  canSubmitIncident,
  computeIncidentValidation,
  ensureAllowedValue,
  normalizeNullable,
  normalizeText,
  parseOperatorNotes,
  toBoolean
};
