function getDispatchServiceOrigin() {
  const configuredOrigin = String(
    window.DISPATCH_API_ORIGIN
      || document.querySelector('meta[name="dispatch-api-origin"]')?.content
      || ""
  ).trim();

  if (configuredOrigin) {
    return configuredOrigin.replace(/\/+$/, "");
  }

  const { protocol, origin } = window.location;

  if (protocol === "http:" || protocol === "https:") {
    return origin;
  }

  return "http://127.0.0.1:8080";
}

const dispatchServiceOrigin = getDispatchServiceOrigin();
const dispatchLinkBase = (() => {
  const path = window.location.pathname;
  const marker = "/dispatch_link/";
  const index = path.toLowerCase().indexOf(marker);
  if (index !== -1) return path.slice(0, index + marker.length - 1);
  return "/dispatch_link";
})();

const apiBase = `${dispatchLinkBase}/api`;

const api = {
  currentUser: `${apiBase}/current_user.sql`,
  metadata: `${apiBase}/dispatch_metadata.sql`,
  teamQuotas: `${apiBase}/dispatch_team_quotas.sql`,
  incidents: `${apiBase}/dispatch_incidents.sql`,
  summary: `${apiBase}/dispatch_summary.sql`,
  vesaIncidents: `${apiBase}/vesa_dispatches.sql`,
  incidentDetail: `${apiBase}/dispatch_incident_detail.sql`,
  incidentAudit: `${apiBase}/dispatch_incident_audit.sql`,
  incidentPhase2Detail: `${apiBase}/dispatch_phase2_detail.sql`,
  pendingApprovals: `${apiBase}/dispatch_approvals_pending.sql`,
  pendingClosures: `${apiBase}/dispatch_closures_pending.sql`,
  registrationLookup: `${apiBase}/dispatch_registration_lookup.sql`,
  uploadPhoto: `${apiBase}/upload_photo.sql`,
  uploadFile: `${apiBase}/upload_file.sql`,
  saveIncident: `${apiBase}/save_incident.sql`,
  saveCommunication: `${apiBase}/save_communication.sql`,
  deleteCommunication: `${apiBase}/delete_communication.sql`,
  saveTimelineEntry: `${apiBase}/save_timeline_entry.sql`,
  deleteTimelineEntry: `${apiBase}/delete_timeline_entry.sql`,
  saveHandover: `${apiBase}/save_dispatch_handover.sql`,
  submitIncident: `${apiBase}/submit_incident.sql`,
  approveIncident: `${apiBase}/approve_incident.sql`,
  rejectIncident: `${apiBase}/reject_incident.sql`,
  requestClosure: `${apiBase}/request_dispatch_closure.sql`,
  reviewClosure: `${apiBase}/review_dispatch_closure.sql`,
  closureComments: `${apiBase}/add_dispatch_manager_comment.sql`,
  cancelEntry: `${apiBase}/cancel_entry.sql`,
  cancelDispatch: `${apiBase}/cancel_dispatch.sql`,
  cancelledDispatches: `${apiBase}/cancelled_dispatches.sql`,
  recoverDispatch: `${apiBase}/recover_dispatch.sql`,
  returnToApprovals: `${apiBase}/return_dispatch_to_approvals.sql`,
  etaRequestSummary: `${apiBase}/eta_request_summary.sql`,
  ticketSummary: "/internaltickets/api_tickets.sql",
  bisHistory: `${apiBase}/generate_mstrack_history.sql`
};

const photoLabels = {
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

const vehicleRecoveryPhotoCategories = [
  "LicenseDisk",
  "FrontVehicleWithReg",
  "BackVehicleWithReg",
  "VehicleSides",
  "Dashboard"
];

const clientPoRequiredZohoAccountIds = new Set([
  "2353121000001489143", // BH Industrial
  "2353121000009669173", // Interland Distribution - Cape Town
  "2353121000007701027", // Interland Distribution Services - Johannesburg
  "2353121000028964001", // Ekhwesi Business Solutions (Secure One)
  "2353121000001490111"  // Wardens Cartage
]);
const clientPoExemptIncidentTypes = new Set([
  "Armed Robbery",
  "Harness Tamper",
  "Hijacking",
  "Jamming Detected",
  "Tamper",
  "Tilt"
]);

const communicationTypes = [
  "Call Made",
  "Call Received",
  "Email Sent",
  "Email Received",
  "SMS Sent",
  "WhatsApp Sent",
  "WhatsApp Received",
  "Radio",
  "Internal Note",
  "Customer Update",
  "Technician Update"
];

const timelineEventTypes = [
  { value: "Alert", label: "Alert" },
  { value: "Client", label: "Client / Person" },
  { value: "Dispatch", label: "Dispatched" },
  { value: "Arrival", label: "Arrived on Scene" },
  { value: "Search", label: "Search / Investigation" },
  { value: "Call", label: "Phone Call" },
  { value: "Confirmed", label: "Confirmed / Completed" },
  { value: "StandDown", label: "Stand Down" },
  { value: "Note", label: "General Note" }
];

const sidebarStorageKey = "pulsit-sidebar-collapsed";
const sidebarGroupStorageKey = "pulsit-sidebar-groups";
const legacyBrowserDraftStorageKey = "dispatch-link-draft-recovery-v1";
const compactSidebarQuery = window.matchMedia("(max-width: 980px)");
const registrationLookupCache = new Map();
let registrationLookupTimer = 0;
let registrationLookupRequestId = 0;
let dispatchDurationAlertTimer = 0;
let draggedCommunicationRow = null;
let communicationDragStartIndex = -1;
let communicationAgentSelectId = 0;
let communicationTimeComboboxId = 0;
let authRedirectStarted = false;
const dispatchDurationWarningMs = (2 * 60 + 45) * 60 * 1000;
const dispatchDurationCriticalMs = 3 * 60 * 60 * 1000;
const vehicleAutofillFieldNames = ["unitId", "company", "fleetCode", "vehicleMake", "vehicleModel", "vehicleColour"];
const alwaysEditableVehicleAutofillFields = new Set(["vehicleMake", "vehicleModel", "vehicleColour"]);

function normalizeCommunicationContactNumber(value) {
  return String(value ?? "").replace(/[\s/]+/gu, "");
}

function normalizeCoordinateNotAvailable(control) {
  if (!control || !["latitude", "longitude"].includes(control.name)) return;
  if (/^n\/a$/i.test(String(control.value || "").trim())) {
    control.value = "N/A";
  }
}

const state = {
  currentUser: null,
  metadata: {
    photoCategories: [],
    dispatchTeams: [],
    teamQuotas: { periodLabel: "", teams: [] },
    staffUsers: [],
    zohoAccounts: [],
    zohoAccountMappings: []
  },
  summary: {
    draftCount: 0,
    pendingCount: 0,
    approvedCount: 0
  },
  incidents: [],
  pendingApprovals: [],
  approvalsLoaded: false,
  completedIncidents: [],
  completedPage: 0,
  vesaIncidents: [],
  vesaPage: 0,
  cancelledIncidents: [],
  recoveryIncidentId: null,
  selectedIncidentId: null,
  selectedIncidentDetail: null,
  saveRequestId: null,
  draftSavePromise: null,
  selectedPhotoIndex: 0,
  removedHistoryFileIds: new Set(),
  removedCommunicationLogIds: new Set(),
  removedTimelineEntryIds: new Set(),
  contextIncidentId: null,
  hasUnsavedChanges: false,
  vehicleLookupAutofill: {
    active: false,
    sourceReg: "",
    values: {}
  },
  viewOnly: new URLSearchParams(window.location.search).get("mode") === "view"
};

const elements = {
  appShell: document.querySelector(".app-shell"),
  sidebarCollapseButton: document.querySelector("#sidebarCollapseButton"),
  themeToggle: document.querySelector("#themeToggle"),
  userAvatar: document.querySelector("#userAvatar"),
  userDisplayName: document.querySelector("#userDisplayName"),
  userRoleLabel: document.querySelector("#userRoleLabel"),
  notice: document.querySelector("#notice"),
  filters: document.querySelector("#incidentFilters"),
  completedFilters: document.querySelector("#completedFilters"),
  incidentRows: document.querySelector("#incidentRows"),
  approvalRows: document.querySelector("#approvalRows"),
  completedRows: document.querySelector("#completedRows"),
  completedCountLabel: document.querySelector("#completedCountLabel"),
  completedPreviousPage: document.querySelector("#completedPreviousPage"),
  completedNextPage: document.querySelector("#completedNextPage"),
  vesaFilters: document.querySelector("#vesaFilters"),
  vesaRows: document.querySelector("#vesaRows"),
  vesaCountLabel: document.querySelector("#vesaCountLabel"),
  vesaPreviousPage: document.querySelector("#vesaPreviousPage"),
  vesaNextPage: document.querySelector("#vesaNextPage"),
  vesaRefreshButton: document.querySelector("#vesaRefreshButton"),
  cancelledFilters: document.querySelector("#cancelledFilters"),
  cancelledRows: document.querySelector("#cancelledRows"),
  cancelledCountLabel: document.querySelector("#cancelledCountLabel"),
  recoverDispatchConfirmOverlay: document.querySelector("#recoverDispatchConfirmOverlay"),
  recoverDispatchConfirmAccept: document.querySelector("#recoverDispatchConfirmAccept"),
  recoverDispatchConfirmBack: document.querySelector("#recoverDispatchConfirmBack"),
  recoverDispatchConfirmClose: document.querySelector("#recoverDispatchConfirmClose"),
  recordContextMenu: document.querySelector("#recordContextMenu"),
  form: document.querySelector("#incidentForm"),
  formTitle: document.querySelector("#formTitle"),
  formSubtitle: document.querySelector("#formSubtitle"),
  validationSummary: document.querySelector("#validationSummary"),
  photoGalleryPanel: document.querySelector("#photoGalleryPanel"),
  photoUploadList: document.querySelector("#photoUploadList"),
  additionalAssets: document.querySelector("#additionalAssets"),
  addAssetButton: document.querySelector("#addAssetButton"),
  historyReportsSection: document.querySelector("#historyReportsSection"),
  historyExcelFile: document.querySelector("#historyExcelFile"),
  historyPdfFile: document.querySelector("#historyPdfFile"),
  historyUploadGrid: document.querySelector("[data-history-upload-grid]"),
  historyReportsHelp: document.querySelector("[data-history-reports-help]"),
  historyUnavailableReason: document.querySelector("[data-history-unavailable-reason]"),
  historyUnavailableAudit: document.querySelector("[data-history-unavailable-audit]"),
  communicationLogRows: document.querySelector("#communicationLogRows"),
  addCommunicationRowButton: document.querySelector("#addCommunicationRowButton"),
  incidentTimelineRows: document.querySelector("#incidentTimelineRows"),
  addTimelineRowButton: document.querySelector("#addTimelineRowButton"),
  refreshButton: document.querySelector("#refreshButton"),
  submitApprovalButton: document.querySelector("#submitApprovalButton"),
  cancelEntryButton: document.querySelector("#cancelEntryButton"),
  cancelEntryConfirmOverlay: document.querySelector("#cancelEntryConfirmOverlay"),
  cancelEntryConfirmDialog: document.querySelector("#cancelEntryConfirmDialog"),
  cancelEntryConfirmAccept: document.querySelector("#cancelEntryConfirmAccept"),
  cancelEntryConfirmBack: document.querySelector("#cancelEntryConfirmBack"),
  cancelEntryConfirmClose: document.querySelector("#cancelEntryConfirmClose"),
  cancelDispatchButton: document.querySelector("#cancelDispatchButton"),
  cancelDispatchConfirmOverlay: document.querySelector("#cancelDispatchConfirmOverlay"),
  cancelDispatchConfirmAccept: document.querySelector("#cancelDispatchConfirmAccept"),
  cancelDispatchConfirmBack: document.querySelector("#cancelDispatchConfirmBack"),
  cancelDispatchConfirmClose: document.querySelector("#cancelDispatchConfirmClose"),
  cancelDispatchReason: document.querySelector("#cancelDispatchReason"),
  returnToApprovalsButton: document.querySelector("#returnToApprovalsButton"),
  returnToApprovalsConfirmOverlay: document.querySelector("#returnToApprovalsConfirmOverlay"),
  returnToApprovalsConfirmAccept: document.querySelector("#returnToApprovalsConfirmAccept"),
  returnToApprovalsConfirmBack: document.querySelector("#returnToApprovalsConfirmBack"),
  returnToApprovalsConfirmClose: document.querySelector("#returnToApprovalsConfirmClose"),
  dispatchCancellationSummary: document.querySelector("#dispatchCancellationSummary"),
  saveDraftButton: document.querySelector("#saveDraftButton"),
  saveDraftIconButton: document.querySelector("#saveDraftIconButton"),
  unsavedChangesNotice: document.querySelector("#unsavedChangesNotice"),
  dispatchDurationAlert: document.querySelector("#dispatchDurationAlert"),
  handoverForm: document.querySelector("#dispatchHandoverForm"),
  handoverTimeline: document.querySelector("#dispatchHandoverTimeline"),
  handoverDateTime: document.querySelector("#handoverDateTime"),
  handoverTargetOperator: document.querySelector("#handoverTargetOperator"),
  addHandoverButton: document.querySelector("#addHandoverButton"),
  handoverFormStatus: document.querySelector("#handoverFormStatus"),
  currentHandoverOperator: document.querySelector("#currentHandoverOperator")
};

function isDraftEditing() {
  if (!elements.form || state.viewOnly) return false;
  const status = state.selectedIncidentDetail?.incident?.Status;
  return !status || status === "Draft" || status === "Rejected" || status === "PendingApproval";
}

function setDraftUnsavedChanges(hasChanges) {
  state.hasUnsavedChanges = Boolean(hasChanges && isDraftEditing());
  if (elements.unsavedChangesNotice) {
    elements.unsavedChangesNotice.hidden = !state.hasUnsavedChanges;
  }
  for (const button of [elements.saveDraftButton, elements.saveDraftIconButton]) {
    button?.classList.toggle("has-unsaved-changes", state.hasUnsavedChanges);
  }
}

function markDraftUnsaved() {
  if (!isDraftEditing()) return;
  setDraftUnsavedChanges(true);
}

function currentDispatchReturnPath() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function createAdditionalAssetKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function readAdditionalAssets() {
  return Array.from(elements.additionalAssets?.querySelectorAll("[data-asset-key]") || []).map((card) => {
    const asset = { key: card.dataset.assetKey };
    for (const [field] of additionalAssetFields) {
      asset[field] = String(card.querySelector(`[data-asset-field="${field}"]`)?.value || "").trim();
    }
    asset.noVisibleDamages = Boolean(card.querySelector('[data-asset-field="noVisibleDamages"]')?.checked);
    return asset;
  });
}

function renderAdditionalAssetPhotos(detail = state.selectedIncidentDetail) {
  for (const [index, card] of Array.from(elements.additionalAssets?.querySelectorAll("[data-asset-key]") || []).entries()) {
    const assetKey = card.dataset.assetKey;
    for (const photoRow of card.querySelectorAll("[data-photo-category]")) {
      const category = photoRow.dataset.photoCategory;
      const photo = (detail?.photos || []).find((item) =>
        String(item.AssetKey || "").toLowerCase() === assetKey.toLowerCase() && item.PhotoCategory === category);
      const status = photoRow.querySelector("[data-asset-photo-status]");
      if (status) status.textContent = photo ? `Uploaded: ${photo.OriginalFileName}` : "No photo uploaded";
      const link = photoRow.querySelector("[data-asset-photo-link]");
      if (link) {
        link.hidden = !photo;
        if (photo) link.href = downloadUrl(photo.downloadUrl);
      }
      const required = getRequiredPhotoCategories();
      const hasVehicle = Boolean(card.querySelector('[data-asset-field="regNo"]')?.value.trim());
      const hasTrailer = Boolean(card.querySelector('[data-asset-field="trailerRegistration1"]')?.value.trim()
        || card.querySelector('[data-asset-field="trailerRegistration2"]')?.value.trim());
      const isRequired = (hasVehicle && required.has(category) && vehicleRecoveryPhotoCategories.includes(category))
        || (hasTrailer && category === "TrailersWithReg" && required.has(category));
      const badge = photoRow.querySelector("[data-asset-photo-required]");
      if (badge) badge.hidden = !isRequired;
    }
    const heading = card.querySelector("[data-asset-heading]");
    if (heading) heading.textContent = `Asset ${index + 2}`;
  }
}

function renderAdditionalAssets(assets = [], detail = state.selectedIncidentDetail) {
  if (!elements.additionalAssets) return;
  const saved = Boolean(detail?.incident?.id);
  const savedAssetKeys = new Set((detail?.incident?.additionalAssets || []).map((asset) => String(asset.key || "").toLowerCase()));
  const locked = state.viewOnly || ["Closed", "Cancelled"].includes(detail?.incident?.DispatchStatus);
  elements.additionalAssets.innerHTML = (Array.isArray(assets) ? assets : []).map((asset, index) => {
    const key = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(String(asset.key || "")) ? asset.key : createAdditionalAssetKey();
    const fields = additionalAssetFields.map(([field, label, length]) => {
      const requiredKind = ["vehicleMake", "vehicleModel", "vehicleColour", "vehicleBranding"].includes(field)
        ? "data-vehicle-recovered-required"
        : ["trailerType", "trailerBranding"].includes(field) ? "data-trailers-recovered-required" : "";
      return `<label><span class="field-head">${label} ${requiredKind ? `<strong ${requiredKind} hidden>*</strong>` : ""}</span><input data-asset-field="${field}" maxlength="${length}" value="${escapeHtml(asset[field] || "")}" ${locked ? "disabled" : ""}></label>`;
    }).join("");
    const photos = state.metadata.photoCategories.map((category) => `
      <label class="additional-asset-photo" data-photo-category="${escapeHtml(category)}">
        <span>${escapeHtml(photoLabels[category] || category)} <strong data-asset-photo-required hidden>*</strong></span>
        <input type="file" accept="image/*,.jpg,.jpeg,.png,.webp" ${!saved || !savedAssetKeys.has(key.toLowerCase()) || locked ? "disabled" : ""}>
        <small data-asset-photo-status>No photo uploaded</small>
        <a data-asset-photo-link target="_blank" rel="noopener noreferrer" hidden>View photo</a>
      </label>
    `).join("");
    return `<article class="additional-asset-card" data-asset-key="${escapeHtml(key)}">
      <div class="additional-asset-header"><h3 data-asset-heading>Asset ${index + 2}</h3><button type="button" data-remove-asset ${locked ? "disabled" : ""}>Remove asset</button></div>
      <div class="section-grid">${fields}
        <label class="checkbox-field"><input type="checkbox" data-asset-field="noVisibleDamages" ${asset.noVisibleDamages ? "checked" : ""} ${locked ? "disabled" : ""}><span>No visible damages</span></label>
      </div>
      <h4>Asset photos</h4><p class="muted-line">${saved && savedAssetKeys.has(key.toLowerCase()) ? "Upload photos for this asset separately." : "Save the dispatch draft before uploading photos."}</p>
      <div class="additional-asset-photos">${photos}</div>
    </article>`;
  }).join("");
  if (elements.addAssetButton) {
    elements.addAssetButton.disabled = locked || state.metadata.additionalAssetsEnabled === false;
    elements.addAssetButton.title = state.metadata.additionalAssetsEnabled === false
      ? "Additional assets are not available in this environment." : "";
  }
  renderAdditionalAssetPhotos(detail);
}

function clearStoredBrowserDraft() {
  try {
    localStorage.removeItem(legacyBrowserDraftStorageKey);
  } catch {
    // Storage may be disabled. Browser drafts are never read or restored.
  }
}

function redirectToSignIn() {
  if (authRedirectStarted) return;
  authRedirectStarted = true;
  clearStoredBrowserDraft();
  const returnTo = currentDispatchReturnPath();
  try {
    sessionStorage.setItem("dispatch-link-auth-return", returnTo);
  } catch {
    // The query parameter below is the fallback.
  }
  document.documentElement.classList.add("auth-pending");
  const query = new URLSearchParams({ error: "1", returnTo });
  window.location.replace(`/signin.sql?${query.toString()}`);
}

function parseLocalDateTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatElapsedDispatchTime(elapsedMs) {
  const totalMinutes = Math.max(0, Math.floor(elapsedMs / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function getDispatchDurationAlertState(dispatchDateTime, standDownDateTime, status, now = Date.now()) {
  if (status !== "Draft" || String(standDownDateTime || "").trim()) return null;
  const dispatchStartedAt = parseLocalDateTime(dispatchDateTime);
  if (!dispatchStartedAt) return null;

  const elapsedMs = now - dispatchStartedAt.getTime();
  if (elapsedMs < dispatchDurationWarningMs) return null;

  const elapsed = formatElapsedDispatchTime(elapsedMs);
  if (elapsedMs >= dispatchDurationCriticalMs) {
    return {
      level: "critical",
      title: "3-hour dispatch limit reached",
      message: `${elapsed} elapsed. Management needs to be informed now.`
    };
  }

  return {
    level: "warning",
    title: "Dispatch nearing the 3-hour limit",
    message: `${elapsed} elapsed. The dispatch is approaching 3 hours; prepare to inform management.`
  };
}

function updateDispatchDurationAlert() {
  if (!elements.dispatchDurationAlert || !elements.form) return;
  const status = state.selectedIncidentDetail?.incident?.Status || "Draft";
  const alertState = getDispatchDurationAlertState(
    elements.form.elements.dispatchDateTime?.value,
    elements.form.elements.standDownDateTime?.value,
    status
  );

  elements.dispatchDurationAlert.hidden = !alertState;
  elements.dispatchDurationAlert.classList.toggle("is-warning", alertState?.level === "warning");
  elements.dispatchDurationAlert.classList.toggle("is-critical", alertState?.level === "critical");
  if (!alertState) return;

  const title = elements.dispatchDurationAlert.querySelector("[data-dispatch-duration-alert-title]");
  const message = elements.dispatchDurationAlert.querySelector("[data-dispatch-duration-alert-message]");
  if (title) title.textContent = alertState.title;
  if (message) message.textContent = alertState.message;
}

function startDispatchDurationAlertTimer() {
  window.clearInterval(dispatchDurationAlertTimer);
  updateDispatchDurationAlert();
  if (!elements.dispatchDurationAlert) return;
  dispatchDurationAlertTimer = window.setInterval(updateDispatchDurationAlert, 1000);
}

let cancelEntryPreviousFocus = null;

function setCancelEntryConfirmationOpen(open) {
  if (!elements.cancelEntryConfirmOverlay) return;
  elements.cancelEntryConfirmOverlay.hidden = !open;
  document.body.classList.toggle("eta-modal-open", open);
  if (open) {
    cancelEntryPreviousFocus = document.activeElement;
    window.requestAnimationFrame(() => elements.cancelEntryConfirmAccept?.focus());
  } else {
    cancelEntryPreviousFocus?.focus?.();
    cancelEntryPreviousFocus = null;
  }
}

async function cancelCurrentEntry() {
  const incidentId = Number(state.selectedIncidentDetail?.incident?.id || 0);
  if (!incidentId) {
    clearStoredBrowserDraft();
    setDraftUnsavedChanges(false);
    window.location.href = "index.html#incidents";
    return;
  }

  const result = await requestJson(api.cancelEntry, {
    method: "POST",
    body: { incidentId }
  });
  if (result?.status !== "ok") {
    const messages = {
      unauthorized: "Your session is not authorized to cancel this entry.",
      validation_error: "A valid draft entry is required.",
      not_found: "This entry is no longer available.",
      locked_status: "Only draft entries can be cancelled."
    };
    throw new Error(messages[result?.status] || result?.message || "The entry could not be cancelled.");
  }

  clearStoredBrowserDraft();
  setDraftUnsavedChanges(false);
  window.location.href = "index.html#incidents";
}

let cancelDispatchPreviousFocus = null;

let returnToApprovalsPreviousFocus = null;
let returnToApprovalsInProgress = false;

function canReturnDispatchToApprovals(incident = state.selectedIncidentDetail?.incident) {
  return isDispatchAdmin() && Number(incident?.id) > 0
    && incident.Status === "Approved" && !isTrueFlag(incident.IsDeleted)
    && !["Closed", "Cancelled"].includes(incident.DispatchStatus);
}

function setReturnToApprovalsConfirmationOpen(open) {
  if (!elements.returnToApprovalsConfirmOverlay || returnToApprovalsInProgress) return;
  if (open && !canReturnDispatchToApprovals()) return;
  elements.returnToApprovalsConfirmOverlay.hidden = !open;
  document.body.classList.toggle("eta-modal-open", open);
  if (open) {
    returnToApprovalsPreviousFocus = document.activeElement;
    window.requestAnimationFrame(() => elements.returnToApprovalsConfirmBack?.focus());
  } else {
    returnToApprovalsPreviousFocus?.focus?.();
    returnToApprovalsPreviousFocus = null;
  }
}

async function returnCurrentDispatchToApprovals() {
  if (!canReturnDispatchToApprovals()) throw new Error("Only administrators can return an approved dispatch to Approvals.");
  const incident = state.selectedIncidentDetail.incident;
  const result = await requestJson(api.returnToApprovals, {
    method: "POST",
    body: { incidentId: incident.id, expectedUpdatedAt: incident.UpdatedAt }
  });
  if (result?.status !== "ok") {
    const messages = {
      unauthorized: "Your signed-in session is no longer active.",
      forbidden: "Only administrators can return a dispatch to Approvals.",
      validation_error: "Reload the dispatch before returning it to Approvals.",
      not_found: "This dispatch is no longer available.",
      conflict: "This dispatch has changed. Reload it before returning it to Approvals.",
      locked_status: "Only approved dispatches that are open and not cancelled can be returned to Approvals."
    };
    throw new Error(messages[result?.status] || "The dispatch could not be returned to Approvals.");
  }
  clearStoredBrowserDraft();
  setDraftUnsavedChanges(false);
  // Reload in edit mode so controls disabled by a completed-list view are reset.
  const url = new URL(window.location.href);
  url.searchParams.delete("mode");
  url.searchParams.set("id", String(incident.id));
  url.searchParams.set("returnedToApprovals", "1");
  window.location.assign(url.href);
}

function setCancelDispatchConfirmationOpen(open) {
  if (!elements.cancelDispatchConfirmOverlay) return;
  elements.cancelDispatchConfirmOverlay.hidden = !open;
  document.body.classList.toggle("eta-modal-open", open);
  if (open) {
    cancelDispatchPreviousFocus = document.activeElement;
    window.requestAnimationFrame(() => elements.cancelDispatchReason?.focus());
  } else {
    cancelDispatchPreviousFocus?.focus?.();
    cancelDispatchPreviousFocus = null;
  }
}

async function cancelCurrentDispatch() {
  const incidentId = Number(state.selectedIncidentDetail?.incident?.id || 0);
  const cancellationReason = String(elements.cancelDispatchReason?.value || "").trim();
  if (!incidentId) throw new Error("Save the dispatch before cancelling it.");
  if (!cancellationReason) throw new Error("Enter a cancellation reason.");

  const result = await requestJson(api.cancelDispatch, {
    method: "POST",
    body: { incidentId, cancellationReason }
  });
  if (result?.status !== "ok") {
    const messages = {
      unauthorized: "Your session is not authorized to cancel this dispatch.",
      missing_cancellation_reason: "Enter a cancellation reason.",
      not_found: "This dispatch is no longer available.",
      locked_status: "A closed or cancelled dispatch cannot be cancelled."
    };
    throw new Error(messages[result?.status] || result?.message || "The dispatch could not be cancelled.");
  }

  setCancelDispatchConfirmationOpen(false);
  if (elements.cancelDispatchReason) elements.cancelDispatchReason.value = "";
  await loadIncidentDetail(incidentId);
  showNotice("Dispatch cancelled. The record has been retained in the audit history.");
  await Promise.all([
    elements.incidentRows ? loadIncidents() : Promise.resolve(),
    elements.approvalRows ? loadPendingApprovals() : Promise.resolve(),
    elements.completedRows ? loadCompletedIncidents() : Promise.resolve()
  ]);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[character]));
}

function canonicalDispatchTeamName(value) {
  const name = String(value ?? "").trim();
  const legacyName = ["ren", "trak"].join("");
  return name.toLowerCase() === legacyName ? "Matrix" : name;
}

function dispatchTeamApiName(value) {
  const canonicalName = canonicalDispatchTeamName(value);
  const teams = Array.isArray(state.metadata.dispatchTeams) ? state.metadata.dispatchTeams : [];
  const matchingTeam = teams.find((team) => {
    const teamName = typeof team === "string" ? team : team?.value || team?.label;
    return canonicalDispatchTeamName(teamName).toLowerCase() === canonicalName.toLowerCase();
  });
  return typeof matchingTeam === "string"
    ? matchingTeam
    : matchingTeam?.value || matchingTeam?.label || canonicalName;
}

function sanitizeIncidentNotesHtml(value) {
  const template = document.createElement("template");
  template.innerHTML = String(value || "");
  const allowedTags = new Set(["P", "BR", "STRONG", "B", "EM", "I", "UL", "OL", "LI"]);
  for (const element of [...template.content.querySelectorAll("*")].reverse()) {
    if (!allowedTags.has(element.tagName)) {
      element.replaceWith(...element.childNodes);
      continue;
    }
    for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name);
  }
  return template.innerHTML;
}

function setIncidentNotes(value) {
  const editor = elements.form?.querySelector("[data-incident-notes-editor]");
  const input = elements.form?.elements.incidentNotesHtml;
  const sanitized = sanitizeIncidentNotesHtml(value);
  if (editor) editor.innerHTML = sanitized;
  if (input) input.value = sanitized;
}

function syncIncidentNotesInput() {
  const editor = elements.form?.querySelector("[data-incident-notes-editor]");
  const input = elements.form?.elements.incidentNotesHtml;
  if (!editor || !input) return;
  const sanitized = sanitizeIncidentNotesHtml(editor.innerHTML);
  input.value = editor.textContent.trim() ? sanitized : "";
}

function localDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function syncIncidentDateTimeValue() {
  if (!elements.form) return;
  const dateField = elements.form.elements.eventDate;
  const hourField = elements.form.elements.eventHour;
  const minuteField = elements.form.elements.eventMinute;
  const timeField = elements.form.elements.eventTime;
  const combinedField = elements.form.elements.eventDateTime;
  if (!dateField || !hourField || !minuteField || !timeField || !combinedField) return;
  syncTimePairValue(hourField);
  combinedField.value = dateField.value && timeField.value
    ? `${dateField.value}T${timeField.value}`
    : "";
}

function normalizeIncidentTimePart(control) {
  if (!control?.matches("[data-time-part]")) return;
  const max = control.dataset.timePart === "hour" ? 23 : 59;
  const digits = String(control.value || "").replace(/\D/g, "").slice(0, 2);
  control.value = digits && Number(digits) <= max ? digits.padStart(2, "0") : digits;
}

function syncTimePairValue(control) {
  const pair = control?.closest("[data-time-pair]");
  const hourField = pair?.querySelector('[data-time-part="hour"]');
  const minuteField = pair?.querySelector('[data-time-part="minute"]');
  const timeField = pair?.querySelector("input[data-time-value]");
  if (!hourField || !minuteField || !timeField) return "";
  const hasValidHour = /^(?:[01]\d|2[0-3])$/.test(hourField.value);
  const hasValidMinute = /^[0-5]\d$/.test(minuteField.value);
  timeField.value = hasValidHour && hasValidMinute
    ? `${hourField.value}:${minuteField.value}`
    : "";
  return timeField.value;
}

function syncDateTimePairValue(control) {
  const pair = control?.closest("[data-date-time-pair]");
  const dateField = pair?.querySelector("[data-date-part]");
  const timeField = pair?.querySelector("input[data-time-value]");
  const combinedField = pair?.querySelector("[data-date-time-value]");
  if (!dateField || !timeField || !combinedField) return "";
  combinedField.value = dateField.value && timeField.value
    ? `${dateField.value}T${timeField.value}`
    : "";
  return combinedField.value;
}

function setDateTimePairControls(fieldName, value, defaultToToday = false) {
  if (!elements.form) return;
  const combinedField = elements.form.elements[fieldName];
  const pair = combinedField?.closest("[data-date-time-pair]");
  const dateField = pair?.querySelector("[data-date-part]");
  const hourField = pair?.querySelector('[data-time-part="hour"]');
  const minuteField = pair?.querySelector('[data-time-part="minute"]');
  if (!combinedField || !dateField || !hourField || !minuteField) return;

  const normalized = String(value || "").trim().replace(" ", "T");
  const [savedDate = "", savedTime = ""] = normalized.split("T");
  dateField.value = /^\d{4}-\d{2}-\d{2}$/.test(savedDate)
    ? savedDate
    : (defaultToToday ? localDateInputValue() : "");
  hourField.value = /^\d{2}:\d{2}/.test(savedTime) ? savedTime.slice(0, 2) : "";
  minuteField.value = /^\d{2}:\d{2}/.test(savedTime) ? savedTime.slice(3, 5) : "";
  syncTimePairValue(hourField);
  syncDateTimePairValue(dateField);
}

function closeIncidentTimeOptions(exceptInput = null) {
  if (!elements.form) return;
  for (const input of elements.form.querySelectorAll("[data-time-combobox] input")) {
    if (input === exceptInput) continue;
    const options = input.closest("[data-time-combobox]")?.querySelector(".incident-time-options");
    if (options) options.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }
  for (const section of elements.form.querySelectorAll(".dispatch-section.has-open-time-options")) {
    if (!exceptInput || !section.contains(exceptInput)) section.classList.remove("has-open-time-options");
  }
}

function positionTimeOptions(input, options) {
  if (!input.closest(".communication-time-combobox")) return;
  const gap = 4;
  const viewportPadding = 8;
  const inputBounds = input.getBoundingClientRect();
  const popupWidth = Math.max(inputBounds.width, 58);
  const roomBelow = window.innerHeight - inputBounds.bottom - viewportPadding - gap;
  const roomAbove = inputBounds.top - viewportPadding - gap;
  const openAbove = roomBelow < 150 && roomAbove > roomBelow;
  const availableHeight = Math.max(96, Math.min(184, openAbove ? roomAbove : roomBelow));

  options.style.width = `${popupWidth}px`;
  options.style.maxHeight = `${availableHeight}px`;
  options.style.left = "0px";
  options.style.top = "0px";
  const containingBlockOrigin = options.getBoundingClientRect();
  const left = Math.min(
    Math.max(viewportPadding, inputBounds.left),
    Math.max(viewportPadding, window.innerWidth - popupWidth - viewportPadding)
  );
  const top = openAbove
    ? Math.max(viewportPadding, inputBounds.top - options.offsetHeight - gap)
    : inputBounds.bottom + gap;
  options.style.left = `${left - containingBlockOrigin.left}px`;
  options.style.top = `${top - containingBlockOrigin.top}px`;
  correctFixedPopupPosition(options, left, top);
}

function correctFixedPopupPosition(popup, viewportLeft, viewportTop) {
  const renderedBounds = popup.getBoundingClientRect();
  const currentLeft = Number.parseFloat(popup.style.left) || 0;
  const currentTop = Number.parseFloat(popup.style.top) || 0;
  popup.style.left = `${currentLeft + viewportLeft - renderedBounds.left}px`;
  popup.style.top = `${currentTop + viewportTop - renderedBounds.top}px`;
}

function renderIncidentTimeOptions(input, filterByInput = false) {
  if (!input?.matches("[data-time-part]")) return;
  const options = input.closest("[data-time-combobox]")?.querySelector(".incident-time-options");
  if (!options) return;
  const max = input.dataset.timePart === "hour" ? 23 : 59;
  const query = filterByInput ? String(input.value || "") : "";
  const values = Array.from({ length: max + 1 }, (_, index) => String(index).padStart(2, "0"))
    .filter((value) => !query || value.startsWith(query));

  options.replaceChildren(...values.map((value) => {
    const option = document.createElement("button");
    option.type = "button";
    option.id = `${options.id}Option${value}`;
    option.className = "incident-time-option";
    option.classList.toggle("is-active", input.value === value);
    option.dataset.timeValue = value;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(input.value === value));
    option.textContent = value;
    option.addEventListener("mousedown", (event) => event.preventDefault());
    option.addEventListener("click", () => {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      closeIncidentTimeOptions();
      input.focus();
    });
    return option;
  }));
  closeIncidentTimeOptions(input);
  input.closest(".dispatch-section")?.classList.add("has-open-time-options");
  options.hidden = false;
  positionTimeOptions(input, options);
  input.setAttribute("aria-expanded", "true");
  const selectedOption = options.querySelector("[aria-selected='true']");
  if (selectedOption) {
    options.scrollTop = Math.max(0, selectedOption.offsetTop - ((options.clientHeight - selectedOption.offsetHeight) / 2));
    input.setAttribute("aria-activedescendant", selectedOption.id);
  } else {
    input.removeAttribute("aria-activedescendant");
  }
}

function setupIncidentTimeComboboxes(root = elements.form) {
  if (!root) return;
  for (const input of root.querySelectorAll("[data-time-combobox] input")) {
    if (input.dataset.timeComboboxReady === "true") continue;
    input.dataset.timeComboboxReady = "true";
    const optionList = input.closest("[data-time-combobox]")?.querySelector(".incident-time-options");
    optionList?.addEventListener("wheel", (event) => {
      const maxScrollTop = optionList.scrollHeight - optionList.clientHeight;
      const wouldScrollPastTop = event.deltaY < 0 && optionList.scrollTop <= 0;
      const wouldScrollPastBottom = event.deltaY > 0 && optionList.scrollTop >= maxScrollTop - 1;
      if (maxScrollTop <= 0 || wouldScrollPastTop || wouldScrollPastBottom) {
        event.preventDefault();
      }
      event.stopPropagation();
    }, { passive: false });
    input.addEventListener("focus", () => renderIncidentTimeOptions(input));
    input.addEventListener("click", () => renderIncidentTimeOptions(input));
    input.addEventListener("blur", () => {
      window.setTimeout(() => {
        if (!input.closest("[data-time-combobox]")?.contains(document.activeElement)) {
          closeIncidentTimeOptions();
        }
      }, 0);
    });
    input.addEventListener("keydown", (event) => {
      const options = input.closest("[data-time-combobox]")?.querySelector(".incident-time-options");
      if (!options || options.hidden) return;
      const buttons = Array.from(options.querySelectorAll(".incident-time-option"));
      const activeIndex = buttons.findIndex((button) => button.classList.contains("is-active"));
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex = Math.min(Math.max(activeIndex + direction, 0), buttons.length - 1);
        buttons.forEach((button, index) => button.classList.toggle("is-active", index === nextIndex));
        const nextButton = buttons[nextIndex];
        nextButton?.scrollIntoView({ block: "nearest" });
        if (nextButton) input.setAttribute("aria-activedescendant", nextButton.id);
      } else if (event.key === "Enter" && activeIndex >= 0) {
        event.preventDefault();
        buttons[activeIndex].click();
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeIncidentTimeOptions();
      }
    });
  }
  if (!setupIncidentTimeComboboxes.documentEventsBound) {
    setupIncidentTimeComboboxes.documentEventsBound = true;
    document.addEventListener("click", (event) => {
      if (!event.target.closest?.("[data-time-combobox]")) closeIncidentTimeOptions();
    });
    window.addEventListener("resize", () => closeIncidentTimeOptions());
    document.addEventListener("scroll", (event) => {
      if (!event.target.closest?.(".incident-time-options")) closeIncidentTimeOptions();
    }, true);
  }
}

function setIncidentDateTimeControls(value, defaultToToday = false) {
  if (!elements.form) return;
  const dateField = elements.form.elements.eventDate;
  const hourField = elements.form.elements.eventHour;
  const minuteField = elements.form.elements.eventMinute;
  const timeField = elements.form.elements.eventTime;
  const combinedField = elements.form.elements.eventDateTime;
  if (!dateField || !hourField || !minuteField || !timeField || !combinedField) return;

  const normalized = String(value || "").trim().replace(" ", "T");
  const [savedDate = "", savedTime = ""] = normalized.split("T");
  dateField.value = /^\d{4}-\d{2}-\d{2}$/.test(savedDate)
    ? savedDate
    : (defaultToToday ? localDateInputValue() : "");
  hourField.value = /^\d{2}:\d{2}/.test(savedTime) ? savedTime.slice(0, 2) : "";
  minuteField.value = /^\d{2}:\d{2}/.test(savedTime) ? savedTime.slice(3, 5) : "";
  syncIncidentDateTimeValue();
}

function getCompulsorySectionControls(section) {
  const controls = [];
  for (const marker of section.querySelectorAll(".field-head strong:not([hidden])")) {
    const fieldContainer = marker.closest("label, .rich-text-field");
    for (const control of fieldContainer?.querySelectorAll("input:not([type='hidden']), select, textarea, [contenteditable='true']") || []) {
      if (!controls.includes(control)) controls.push(control);
    }
  }
  return controls;
}

function requiresDispatchCaptureFields(incident = state.selectedIncidentDetail?.incident) {
  return !incident?.id || Number(incident.DispatchCaptureVersion) === 1;
}

function getDispatchCaptureFieldErrors(values, required = false) {
  const reason = String(values.actualDispatchReason ?? "").trim();
  const positiveVesa = String(values.positiveVesa ?? "").trim();
  const errors = [];
  if (required && !reason) errors.push("Actual Reason for dispatch is required (Ground Team reason for dispatch).");
  if (reason.length > 1000) errors.push("Actual Reason for dispatch may not exceed 1000 characters.");
  if (required && !positiveVesa) errors.push("Positive VESA is required.");
  if (positiveVesa && !["Hijacked", "Stolen", "No"].includes(positiveVesa)) errors.push("Positive VESA must be Hijacked, Stolen, or No.");
  return errors;
}

function syncDispatchCaptureFields(incident = state.selectedIncidentDetail?.incident) {
  if (!elements.form) return;
  const required = requiresDispatchCaptureFields(incident);
  for (const marker of elements.form.querySelectorAll("[data-dispatch-capture-required]")) marker.hidden = !required;
  // Native required inputs would also block Save Draft. Enforce completeness
  // at submission time, with the same rule checked against the saved row.
  const help = elements.form.querySelector("[data-dispatch-capture-help]");
  if (help) help.textContent = required
    ? "Complete both fields before submitting for approval. Drafts can be saved without them."
    : "These fields are optional for dispatches created before they were introduced.";
  for (const summary of document.querySelectorAll("[data-dispatch-capture-summary]")) {
    summary.hidden = !required && !String(elements.form.elements.actualDispatchReason?.value || "").trim()
      && !String(elements.form.elements.positiveVesa?.value || "").trim();
  }
}

function updateConditionalCompulsoryFields() {
  if (!elements.form) return;
  const driverIsOnScene = elements.form.elements.driverOnScene?.value === "Yes";
  const vehicleIsRecovered = elements.form.elements.vehicleRecovered?.value === "Yes";
  const trailersAreRecovered = elements.form.elements.trailersRecovered?.value === "Yes";
  for (const marker of elements.form.querySelectorAll("[data-driver-on-scene-required]")) {
    marker.hidden = !driverIsOnScene;
  }
  for (const marker of elements.form.querySelectorAll("[data-vehicle-recovered-required]")) {
    const card = marker.closest("[data-asset-key]");
    marker.hidden = !vehicleIsRecovered || (card && !card.querySelector('[data-asset-field="regNo"]')?.value.trim());
  }
  for (const marker of elements.form.querySelectorAll("[data-trailers-recovered-required]")) {
    const card = marker.closest("[data-asset-key]");
    marker.hidden = !trailersAreRecovered || (card && !(
      card.querySelector('[data-asset-field="trailerRegistration1"]')?.value.trim()
      || card.querySelector('[data-asset-field="trailerRegistration2"]')?.value.trim()
    ));
  }
  updateClientPoRequirement();
  updateEvidenceRequirementPresentation();
}

function getRequiredPhotoCategories() {
  const required = new Set();
  if (!elements.form) return required;

  const value = (name) => String(elements.form.elements[name]?.value || "").trim();
  const vehicleIsRecovered = value("vehicleRecovered") === "Yes";

  if (vehicleIsRecovered) {
    for (const category of vehicleRecoveryPhotoCategories) required.add(category);
  }
  if (value("vehicleKeyAvailable") === "Yes") required.add("VehicleKeys");
  if (value("trailersRecovered") === "Yes") required.add("TrailersWithReg");
  if (value("driverOnScene") === "Yes") {
    required.add("Driver");
    required.add("DriverLicenseOrId");
  }

  return required;
}

function getMissingRequiredPhotoCategories(detail = state.selectedIncidentDetail) {
  const uploaded = new Set(
    (detail?.photos || [])
      .filter((photo) => !photo.IsDeleted && !photo.AssetKey)
      .map((photo) => String(photo.PhotoCategory || "").trim())
      .filter(Boolean)
  );
  const missing = Array.from(getRequiredPhotoCategories()).filter((category) => !uploaded.has(category));
  const required = getRequiredPhotoCategories();
  for (const [index, asset] of readAdditionalAssets().entries()) {
    const assetPhotos = new Set((detail?.photos || [])
      .filter((photo) => String(photo.AssetKey || "").toLowerCase() === asset.key.toLowerCase())
      .map((photo) => photo.PhotoCategory));
    for (const category of required) {
      if (asset.regNo && vehicleRecoveryPhotoCategories.includes(category) && !assetPhotos.has(category)) {
        missing.push(`Asset ${index + 2}: ${photoLabels[category] || category}`);
      }
      if ((asset.trailerRegistration1 || asset.trailerRegistration2) && category === "TrailersWithReg" && !assetPhotos.has(category)) {
        missing.push(`Asset ${index + 2}: ${photoLabels[category] || category}`);
      }
    }
  }
  return missing;
}

function updateEvidenceRequirementPresentation() {
  if (!elements.photoUploadList) return;
  const required = getRequiredPhotoCategories();
  for (const item of elements.photoUploadList.querySelectorAll("[data-photo-category]")) {
    const isRequired = required.has(item.dataset.photoCategory);
    item.classList.toggle("is-required", isRequired);
    const badge = item.querySelector(".photo-required-badge");
    if (badge) badge.hidden = !isRequired;
  }
  renderAdditionalAssetPhotos();
}

function isCompulsoryControlComplete(control) {
  if (control.matches("[contenteditable='true']")) return Boolean(String(control.textContent || "").trim());
  if (control.type === "checkbox" || control.type === "radio") return control.checked;
  if (control.name === "zohoAccount") return Boolean(findZohoAccount(control.value));
  return Boolean(String(control.value || "").trim());
}

function updateDispatchSectionStatuses() {
  if (!elements.form) return;
  for (const section of elements.form.querySelectorAll(".dispatch-section")) {
    const badge = section.querySelector(":scope > header .dispatch-section-status");
    const invalidIndicator = section.querySelector(":scope > header .dispatch-section-invalid-indicator");
    if (!badge) continue;
    const controls = getCompulsorySectionControls(section);
    const isEvidenceSection = Boolean(elements.photoUploadList && section.contains(elements.photoUploadList));
    const requiredPhotoCount = isEvidenceSection ? getRequiredPhotoCategories().size : 0;
    badge.hidden = controls.length === 0 && requiredPhotoCount === 0;
    const invalidControls = section.querySelectorAll("[aria-invalid='true']").length;
    if (invalidIndicator) {
      invalidIndicator.hidden = invalidControls === 0;
      invalidIndicator.title = invalidControls
        ? `${invalidControls} field ${invalidControls === 1 ? "is" : "are"} blocking save`
        : "No validation issues";
    }
    if (badge.hidden) continue;
    const missingControlCount = controls.filter((control) => !isCompulsoryControlComplete(control)).length;
    const missingPhotoCount = isEvidenceSection ? getMissingRequiredPhotoCategories().length : 0;
    const missingCount = missingControlCount + missingPhotoCount;
    const complete = missingCount === 0;
    badge.classList.toggle("is-complete", complete);
    badge.textContent = complete ? "✓" : String(missingCount);
    badge.setAttribute("aria-label", complete
      ? "All compulsory items in this section are complete"
      : `${missingCount} compulsory ${missingCount === 1 ? "item is" : "items are"} incomplete`);
  }
}

function scrollCommunicationLogToBottom(section) {
  const tableWrap = section?.querySelector(".communication-log-table-wrap");
  if (!tableWrap) return;
  const scrollToBottom = () => {
    tableWrap.scrollTop = tableWrap.scrollHeight;
  };
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      scrollToBottom();
    });
  });
  window.setTimeout(scrollToBottom, 400);
}

function setDispatchSectionExpanded(section, expanded) {
  const header = section.querySelector(":scope > header");
  const inner = section.querySelector(":scope > .dispatch-section-body > .dispatch-section-body-inner");
  const indicator = section.querySelector(":scope > header .dispatch-section-toggle-indicator");
  section.classList.toggle("is-collapsed", !expanded);
  header?.setAttribute("aria-expanded", String(expanded));
  if (indicator) {
    indicator.title = expanded ? "Collapse panel" : "Expand panel";
    const label = indicator.querySelector(".dispatch-section-toggle-label");
    const glyph = indicator.querySelector(".dispatch-section-toggle-glyph");
    if (label) label.textContent = expanded ? "Collapse" : "Expand";
    if (glyph) glyph.textContent = expanded ? "▲" : "▼";
  }
  if (inner) inner.inert = !expanded;
  if (section.classList.contains("communication-log-section")) {
    section.closest(".dispatch-editor-grid")?.classList.toggle("is-communication-log-expanded", expanded);
    if (expanded) scrollCommunicationLogToBottom(section);
  }
}

function revealValidationControl(control) {
  if (!(control instanceof HTMLElement)) return false;
  const section = control.closest(".dispatch-section");
  if (section) setDispatchSectionExpanded(section, true);
  control.setAttribute("aria-invalid", "true");
  updateDispatchSectionStatuses();

  const scrollToControl = (behavior = "smooth") => {
    control.scrollIntoView({ behavior, block: "center", inline: "nearest" });
  };
  window.requestAnimationFrame(() => {
    control.focus({ preventScroll: true });
    scrollToControl();
  });
  // The accordion takes 360ms to open. Re-align after it finishes so the
  // expanding content cannot push the blocking field away from the viewport.
  if (section?.classList.contains("dispatch-section")) {
    window.setTimeout(() => scrollToControl("auto"), 400);
  }
  return true;
}

function setupDispatchSectionPanels() {
  if (!elements.form) return;
  const sections = Array.from(elements.form.querySelectorAll(".dispatch-section"));
  sections.forEach((section, index) => {
    const header = section.querySelector(":scope > header");
    if (!header || section.querySelector(":scope > .dispatch-section-body")) return;
    const body = document.createElement("div");
    body.className = "dispatch-section-body";
    const inner = document.createElement("div");
    inner.className = "dispatch-section-body-inner";
    while (header.nextSibling) inner.append(header.nextSibling);
    body.append(inner);
    section.append(body);

    const actions = document.createElement("div");
    actions.className = "dispatch-section-header-actions";
    actions.innerHTML = `
      <span class="dispatch-section-status" aria-live="polite"></span>
      <span class="dispatch-section-invalid-indicator" aria-label="Validation issue" title="No validation issues" hidden><span aria-hidden="true">i</span></span>
      <span class="dispatch-section-toggle-indicator" title="Collapse panel" aria-hidden="true">
        <span class="dispatch-section-toggle-label">Collapse</span>
        <span class="dispatch-section-toggle-glyph">▲</span>
      </span>
    `;
    header.append(actions);
    header.setAttribute("role", "button");
    header.setAttribute("tabindex", "0");
    header.setAttribute("aria-controls", `dispatch-section-body-${index + 1}`);
    body.id = `dispatch-section-body-${index + 1}`;

    const toggle = () => setDispatchSectionExpanded(section, section.classList.contains("is-collapsed"));
    header.addEventListener("click", toggle);
    header.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggle();
    });
    setDispatchSectionExpanded(section, index === 0);
  });
  updateDispatchSectionStatuses();
}

function registrationLookupScope() {
  return document.querySelector('[data-registration-lookup="dispatch"]');
}

function resetRegistrationLookup(scopeEl = registrationLookupScope()) {
  if (!scopeEl) return;
  for (const item of scopeEl.querySelectorAll(".registration-lookup-item")) {
    item.hidden = true;
    item.dataset.state = "neutral";
    const popover = item.querySelector(".registration-lookup-popover");
    if (popover) popover.textContent = "";
  }
}

function setRegistrationLookupState(stateName, popoverHtml, label, scopeEl = registrationLookupScope()) {
  const item = scopeEl?.querySelector('[data-lookup-kind="exact"]');
  if (!item) return;
  const icon = item.querySelector(".registration-lookup-icon");
  const popover = item.querySelector(".registration-lookup-popover");
  item.hidden = false;
  item.dataset.state = stateName;
  if (icon) icon.setAttribute("aria-label", label);
  if (popover) popover.innerHTML = popoverHtml;
}

function registrationDetailsMarkup(vehicle = {}) {
  const rows = [
    ["Registration", vehicle.reg_no],
    ["Unit ID", vehicle.unit_id],
    ["Company", vehicle.company],
    ["Fleet Number", vehicle.fleet_Code],
    ["Model", vehicle.modeldesc],
    ["Make", vehicle.MakeDesc],
    ["Color", vehicle.color]
  ].filter(([, value]) => String(value || "").trim());

  return `
    <strong>Vehicle info found.</strong>
    ${rows.map(([label, value]) => `<span>${escapeHtml(label)}: ${escapeHtml(value)}</span>`).join("")}
  `;
}

function renderRegistrationLookup(result = {}, scopeEl = registrationLookupScope()) {
  if (!scopeEl) return;
  if (result.exactFound && result.vehicle) {
    setRegistrationLookupState("found", registrationDetailsMarkup(result.vehicle), "Vehicle info found.", scopeEl);
    return;
  }

  setRegistrationLookupState("missing", "<strong>No match found.</strong>", "No match found.", scopeEl);
}

function renderRegistrationLookupError(scopeEl = registrationLookupScope()) {
  setRegistrationLookupState("missing", "<strong>Lookup unavailable.</strong>", "Lookup unavailable.", scopeEl);
}

function renderRegistrationLookupPending(scopeEl = registrationLookupScope()) {
  setRegistrationLookupState("pending", "<strong>Checking vehicle info...</strong>", "Checking vehicle info.", scopeEl);
}

async function loadRegistrationLookup(registration) {
  const reg = String(registration || "").trim();
  if (!reg) return null;
  const cacheKey = reg.toUpperCase();
  if (registrationLookupCache.has(cacheKey)) {
    return registrationLookupCache.get(cacheKey);
  }
  const result = await requestJson(`${api.registrationLookup}?${new URLSearchParams({ reg_no: reg, _: String(Date.now()) }).toString()}`);
  registrationLookupCache.set(cacheKey, result || {});
  return result || {};
}

function releaseVehicleLookupAutofill(clearValues = false) {
  if (!elements.form) return;
  const previousValues = state.vehicleLookupAutofill.values || {};
  const wasActive = state.vehicleLookupAutofill.active;

  for (const fieldName of vehicleAutofillFieldNames) {
    const field = elements.form.elements[fieldName];
    if (!field) continue;
    if (clearValues && wasActive) {
      const currentValue = String(field.value || "").trim();
      const previousValue = String(previousValues[fieldName] || "").trim();
      if (currentValue === previousValue) {
        field.value = "";
      }
    }
    field.readOnly = false;
    field.classList.remove("is-autofilled-locked");
    field.dataset.autofilledLock = "false";
    field.removeAttribute("aria-readonly");
  }

  state.vehicleLookupAutofill = {
    active: false,
    sourceReg: "",
    values: {}
  };
}

function lockVehicleLookupAutofill(registration, values = {}) {
  if (!elements.form) return false;
  let changedForm = false;

  for (const fieldName of vehicleAutofillFieldNames) {
    const field = elements.form.elements[fieldName];
    if (!field) continue;
    const lookupValue = String(values[fieldName] ?? "");
    const currentValue = String(field.value ?? "");
    const preserveCapturedValue = alwaysEditableVehicleAutofillFields.has(fieldName)
      && currentValue.trim().length > 0;
    if (!preserveCapturedValue && currentValue !== lookupValue) {
      field.value = lookupValue;
      changedForm = true;
    }
    const hasLookupValue = lookupValue.trim().length > 0;
    const shouldLock = hasLookupValue && !alwaysEditableVehicleAutofillFields.has(fieldName);
    field.readOnly = shouldLock;
    field.classList.toggle("is-autofilled-locked", shouldLock);
    field.dataset.autofilledLock = String(shouldLock);
    if (shouldLock) {
      field.setAttribute("aria-readonly", "true");
    } else {
      field.removeAttribute("aria-readonly");
    }
  }

  state.vehicleLookupAutofill = {
    active: true,
    sourceReg: String(registration || "").trim().toUpperCase(),
    values: Object.fromEntries(vehicleAutofillFieldNames.map((fieldName) => [fieldName, String(values[fieldName] ?? "")]))
  };
  return changedForm;
}

function applyRegistrationLookup(result = {}, expectedRegistration = "") {
  if (!elements.form || !result.exactFound || !result.vehicle) return;
  const currentReg = String(elements.form.elements.regNo?.value || "").trim();
  if (currentReg.toUpperCase() !== String(expectedRegistration || "").trim().toUpperCase()) return;

  const vehicle = result.vehicle;
  const mappings = {
    regNo: vehicle.reg_no,
    unitId: vehicle.unit_id,
    company: vehicle.company,
    fleetCode: vehicle.fleet_Code,
    vehicleMake: vehicle.MakeDesc,
    vehicleModel: vehicle.modeldesc,
    vehicleColour: vehicle.color
  };
  let lookupChangedForm = false;
  if (elements.form.elements.regNo && String(mappings.regNo || "").trim()) {
    if (String(elements.form.elements.regNo.value || "") !== String(mappings.regNo)) {
      elements.form.elements.regNo.value = mappings.regNo;
      lookupChangedForm = true;
    }
  }
  lookupChangedForm = lockVehicleLookupAutofill(mappings.regNo || expectedRegistration, mappings)
    || lookupChangedForm;
  const historyUnavailable = elements.form.elements.vehicleHistoryUnavailable;
  const historyUnavailableReason = elements.form.elements.vehicleHistoryUnavailableReason;
  if (historyUnavailable?.checked) {
    historyUnavailable.checked = false;
    if (historyUnavailableReason) historyUnavailableReason.value = "";
    syncVehicleHistoryExceptionControls();
    lookupChangedForm = true;
  }
  autoPopulateZohoAccount();
  updateDispatchPresentation();
  updateDispatchSectionStatuses();
  if (lookupChangedForm) markDraftUnsaved();
}

function normalizedZohoLookupValue(value) {
  return String(value || "").trim().toLowerCase();
}

function renderZohoAccountOptions() {
  const datalist = document.querySelector("#zohoAccountOptions");
  if (!datalist) return;
  const accounts = Array.isArray(state.metadata.zohoAccounts) ? state.metadata.zohoAccounts : [];
  datalist.innerHTML = accounts
    .map((account) => `<option value="${escapeHtml(account.label || account.value || "")}"></option>`)
    .join("");
}

function findZohoAccount(value) {
  const normalized = normalizedZohoLookupValue(value);
  if (!normalized) return null;
  const accounts = Array.isArray(state.metadata.zohoAccounts) ? state.metadata.zohoAccounts : [];
  return accounts.find((account) => (
    normalizedZohoLookupValue(account.label) === normalized
    || normalizedZohoLookupValue(account.value) === normalized
  )) || null;
}

function clientPoIsRequired(zohoAccount, incidentType) {
  return clientPoRequiredZohoAccountIds.has(String(zohoAccount?.id || ""))
    && Boolean(incidentType)
    && !clientPoExemptIncidentTypes.has(String(incidentType).trim());
}

function updateClientPoRequirement() {
  if (!elements.form) return;
  const field = elements.form.elements.clientPo;
  const note = elements.form.querySelector("[data-client-po-note]");
  const marker = elements.form.querySelector("[data-client-po-required]");
  const account = findZohoAccount(elements.form.elements.zohoAccount?.value);
  const required = clientPoIsRequired(account, elements.form.elements.event?.value);
  if (marker) marker.hidden = !required;
  if (note) note.hidden = !required;
  if (field) {
    if (required) field.setAttribute("aria-required", "true");
    else field.removeAttribute("aria-required");
  }
}

function setZohoAccountAutopopulatedLock(field, locked) {
  if (!field) return;
  field.readOnly = locked;
  field.dataset.autopopulated = String(locked);
  field.classList.toggle("is-zoho-autopopulated-locked", locked);
  if (locked) {
    field.setAttribute("aria-readonly", "true");
    field.title = "This Zoho Account was selected automatically from the Company and Fleet Number.";
  } else {
    field.removeAttribute("aria-readonly");
    field.removeAttribute("title");
  }
}

function matchingZohoAccountMapping() {
  if (!elements.form) return null;
  const company = normalizedZohoLookupValue(elements.form.elements.company?.value);
  const fleetCode = normalizedZohoLookupValue(elements.form.elements.fleetCode?.value);
  const mappings = Array.isArray(state.metadata.zohoAccountMappings) ? state.metadata.zohoAccountMappings : [];
  return company && fleetCode
    ? mappings.find((item) => (
      normalizedZohoLookupValue(item.company) === company
      && normalizedZohoLookupValue(item.fleetCode) === fleetCode
    )) || null
    : null;
}

function autoPopulateZohoAccount() {
  if (!elements.form) return;
  const field = elements.form.elements.zohoAccount;
  if (!field) return;
  const mapping = matchingZohoAccountMapping();

  if (mapping) {
    field.value = mapping.label || mapping.value || "";
    setZohoAccountAutopopulatedLock(field, true);
  } else if (field.dataset.autopopulated === "true") {
    field.value = "";
    setZohoAccountAutopopulatedLock(field, false);
  }
  updateClientPoRequirement();
}

function syncLoadedZohoAccountLock() {
  if (!elements.form) return;
  const field = elements.form.elements.zohoAccount;
  const mapping = matchingZohoAccountMapping();
  const mappedValue = mapping?.label || mapping?.value || "";
  const shouldLock = Boolean(
    mappedValue
    && normalizedZohoLookupValue(field?.value) === normalizedZohoLookupValue(mappedValue)
  );
  setZohoAccountAutopopulatedLock(field, shouldLock);
}

function scheduleDispatchRegistrationLookup() {
  if (!elements.form || state.viewOnly) return;
  const input = elements.form.elements.regNo;
  const registration = input?.value || "";
  const normalizedRegistration = String(registration || "").trim().toUpperCase();
  const scopeEl = registrationLookupScope();
  window.clearTimeout(registrationLookupTimer);
  const requestId = ++registrationLookupRequestId;
  if (state.vehicleLookupAutofill.active && normalizedRegistration !== state.vehicleLookupAutofill.sourceReg) {
    releaseVehicleLookupAutofill(true);
    updateDispatchPresentation();
  }
  if (!registration.trim()) {
    releaseVehicleLookupAutofill(true);
    resetRegistrationLookup(scopeEl);
    updateDispatchPresentation();
    return;
  }
  renderRegistrationLookupPending(scopeEl);
  registrationLookupTimer = window.setTimeout(() => {
    loadRegistrationLookup(registration)
      .then((result) => {
        if (requestId !== registrationLookupRequestId) return;
        renderRegistrationLookup(result, scopeEl);
        if (!result?.exactFound) {
          releaseVehicleLookupAutofill(true);
        }
        applyRegistrationLookup(result, registration);
        updateDispatchPresentation();
      })
      .catch((error) => {
        if (requestId !== registrationLookupRequestId) return;
        console.warn("Registration lookup failed:", error);
        renderRegistrationLookupError(scopeEl);
      });
  }, 1000);
}

function getFullName(user) {
  return [user?.name, user?.surname].map((part) => String(part || "").trim()).filter(Boolean).join(" ") || user?.username || "Dispatch Link";
}

function showNotice(message, type = "success") {
  if (!elements.notice) return;
  elements.notice.textContent = message;
  elements.notice.className = `notice ${type}`;
  elements.notice.hidden = false;
  window.clearTimeout(showNotice.timer);
  showNotice.timer = window.setTimeout(() => {
    elements.notice.hidden = true;
  }, 5000);
}

async function requestJson(url, options = {}) {
  let response;
  const body = options.body && !(options.body instanceof FormData)
    ? new URLSearchParams(Object.entries(options.body).map(([key, value]) => [key, String(value ?? "")]))
    : options.body;
  try {
    response = await fetch(url, {
      credentials: "include",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/x-www-form-urlencoded" } : {})
      },
      ...options,
      body
    });
  } catch (error) {
    throw new Error(`Cannot reach Dispatch Link API at ${dispatchServiceOrigin}. Make sure the service is running.`);
  }

  const responseText = await response.text().catch(() => "");
  const payload = parseSqlPageJsonResponse(responseText);
  if (response.status === 401 || payload?.status === "unauthorized") {
    redirectToSignIn();
    throw new Error(payload?.message || "Your signed-in session is no longer active.");
  }
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `Request failed with HTTP ${response.status}`);
    error.details = payload?.error?.details || null;
    throw error;
  }
  const emptyObjectIsValid = responseText.trim() === "{}"
    || /<td[^>]*>\s*\{\}\s*<\/td>/i.test(responseText);
  if (!Object.keys(payload).length && responseText.trim() && !emptyObjectIsValid) {
    throw new Error("Dispatch Link API returned an invalid response.");
  }
  return payload;
}

function decodeHtmlEntities(value) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}

function tryParseEmbeddedJson(text) {
  const starts = [];
  let fallback = null;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "{" || text[index] === "[") starts.push(index);
  }
  for (const start of starts) {
    const close = text[start] === "{" ? "}" : "]";
    let end = text.lastIndexOf(close);
    while (end > start) {
      const candidate = text.slice(start, end + 1).trim();
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)
          && (Object.hasOwn(parsed, "status") || Object.hasOwn(parsed, "id") || Object.hasOwn(parsed, "error"))) {
          return parsed;
        }
        fallback ??= parsed;
        break;
      } catch {
        end = text.lastIndexOf(close, end - 1);
      }
    }
  }
  return fallback;
}

function parseSqlPageJsonResponse(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return {};
  try {
    return normalizeParsedJson(JSON.parse(trimmed));
  } catch {
    // SQLPage can render JSON through a table template depending on headers/templates.
  }

  const documentResponse = new DOMParser().parseFromString(trimmed, "text/html");
  for (const cell of documentResponse.querySelectorAll("td")) {
    const value = cell.textContent.trim();
    try {
      const parsed = normalizeParsedJson(JSON.parse(value));
      if (parsed && typeof parsed === "object"
        && (Object.hasOwn(parsed, "status") || Object.hasOwn(parsed, "id") || Object.hasOwn(parsed, "error"))) {
        return parsed;
      }
    } catch {
      // Continue to the next rendered table cell.
    }
  }

  const tdMatches = Array.from(trimmed.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi));
  if (tdMatches.length) {
    const stitched = tdMatches.map((match) => decodeHtmlEntities(match[1])).join("").trim();
    try {
      return normalizeParsedJson(JSON.parse(stitched));
    } catch {
      // Fall through to embedded JSON recovery.
    }
  }

  const decoded = decodeHtmlEntities(trimmed);
  const stripped = decoded.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const embedded = tryParseEmbeddedJson(decoded) ?? tryParseEmbeddedJson(stripped);
  if (embedded !== null) return normalizeParsedJson(embedded);

  return {};
}

function normalizeParsedJson(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        return normalizeParsedJson(JSON.parse(trimmed));
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeParsedJson(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeParsedJson(item)]));
  }
  return value;
}

function downloadUrl(value) {
  const raw = String(value || "");
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${dispatchServiceOrigin}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

function responseDownloadFileName(response, fallback) {
  const disposition = response.headers.get("Content-Disposition") || "";
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (utf8Match) return decodeURIComponent(utf8Match[1].replace(/^"|"$/g, ""));
  const regularMatch = /filename="?([^";]+)"?/i.exec(disposition);
  if (regularMatch?.[1]) return regularMatch[1];
  try {
    const urlFileName = decodeURIComponent(new URL(response.url).pathname.split("/").pop() || "");
    if (urlFileName) return urlFileName;
  } catch (_error) {}
  return fallback || "report-download";
}

function readableDownloadNamePart(value) {
  const cleaned = String(value || "N/A")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 60)
    .trim();
  return cleaned || "N/A";
}

function reportDownloadDate(incident) {
  const eventDate = new Date(incident.EventDateTime || incident.CreatedAt || Date.now());
  return Number.isNaN(eventDate.getTime())
    ? new Date().toISOString().slice(0, 10)
    : new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone: "Africa/Johannesburg"
      }).format(eventDate);
}

function incidentReportDownloadFileName(incident) {
  return `${readableDownloadNamePart(incident.RegNo)} - ${readableDownloadNamePart(incident.Event)} - Incident report - ${reportDownloadDate(incident)}.pdf`;
}

function communicationReportDownloadFileName(incident) {
  return `${readableDownloadNamePart(incident.RegNo)} - ${readableDownloadNamePart(incident.Event)} - Communications report - ${reportDownloadDate(incident)}.pdf`;
}

function historyReportErrorMessage(code) {
  const messages = {
    "mstrack-connector-config": "MSTrack report access is not configured on the application server. Contact an administrator.",
    "mstrack-connector-auth": "The report service could not authenticate with the MSTrack connector. Contact an administrator.",
    "mstrack-connector-unreachable": "The report service could not reach the MSTrack connector. Check that the connector is running on the application server.",
    "mstrack-connector-timeout": "The MSTrack history request timed out. Please try again.",
    "mstrack-history-window": "The dispatch dates could not be used for the history report. Check the dispatch and stand-down times; the history period must be no more than 31 days.",
    "mstrack-history-query": "The MSTrack connector is running, but its history query failed. Contact an administrator to check the connector logs.",
    "mstrack-connector-response": "The MSTrack connector returned an unexpected response. Contact an administrator.",
    "mstrack-incident-input": "Dispatch details could not be loaded for the history report. Contact an administrator.",
    "mstrack-report-runtime": "A required report dependency is missing on the application server. Contact an administrator.",
    "mstrack-report-output": "The application server could not save the history report. Contact an administrator to check folder access and available disk space.",
    "mstrack-report-generation": "The MSTrack history report could not be created. Contact an administrator."
  };
  return Object.prototype.hasOwnProperty.call(messages, code) ? messages[code] : "";
}

async function downloadReportWithProgress(link) {
  if (!link || link.classList.contains("is-loading")) return;
  const label = link.querySelector("span");
  const originalLabel = label?.textContent || "Download Report";
  link.classList.add("is-loading");
  link.setAttribute("aria-busy", "true");
  link.setAttribute("aria-disabled", "true");
  if (label) label.textContent = "Preparing report...";
  try {
    const response = await fetch(link.href, { credentials: "include", cache: "no-store" });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error?.message || `Report download failed with HTTP ${response.status}.`);
    }
    const contentType = response.headers.get("Content-Type") || "";
    const responseUrl = (() => {
      try {
        return new URL(response.url);
      } catch (_error) {
        return null;
      }
    })();
    const reportError = historyReportErrorMessage(responseUrl?.searchParams.get("reportError"));
    if (reportError) throw new Error(reportError);
    const responsePath = responseUrl?.pathname || "";
    if (/\/(?:signin|login)\.sql$/i.test(responsePath)) {
      throw new Error("Your session has expired. Sign in and try downloading the report again.");
    }
    // The legacy Excel exporter produces an HTML workbook with an .xls name.
    // Accept that content only from a generated .xls report, not an error page.
    const generatedExcel = responsePath.startsWith(`${dispatchLinkBase}/public/generated-reports/`) && /\.xls$/i.test(responsePath);
    if ((/text\/html/i.test(contentType) && !generatedExcel) || /\.sql$/i.test(responsePath)) {
      throw new Error(`${originalLabel.replace(/^Download\s+/i, "")} could not be generated. The server returned an error page.`);
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const downloadLink = document.createElement("a");
    downloadLink.href = objectUrl;
    downloadLink.download = responseDownloadFileName(response, link.dataset.downloadFilename);
    document.body.appendChild(downloadLink);
    downloadLink.click();
    downloadLink.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
    showNotice(`${originalLabel.replace(/^Download\s+/i, "")} is ready.`);
  } finally {
    link.classList.remove("is-loading");
    link.removeAttribute("aria-busy");
    link.removeAttribute("aria-disabled");
    if (label) label.textContent = originalLabel;
  }
}

function syncThemeToggle() {
  const theme = localStorage.getItem("srf-jobcard-theme") === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  if (!elements.themeToggle) return;
  elements.themeToggle.checked = theme === "dark";
  elements.themeToggle.setAttribute("aria-label", `Switch to ${theme === "dark" ? "light" : "dark"} mode`);
}

function setTheme(theme) {
  const nextTheme = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = nextTheme;
  localStorage.setItem("srf-jobcard-theme", nextTheme);
  syncThemeToggle();
}

function setSidebarCollapsed(collapsed) {
  elements.appShell.classList.toggle("sidebar-collapsed", collapsed);
  localStorage.setItem(sidebarStorageKey, collapsed ? "1" : "0");
  elements.sidebarCollapseButton?.setAttribute("aria-expanded", String(!collapsed));
}

function getSidebarGroupState() {
  try {
    return JSON.parse(localStorage.getItem(sidebarGroupStorageKey) || "{}");
  } catch {
    return {};
  }
}

function setSidebarGroupOpen(section, open, persist = true) {
  section.classList.toggle("is-open", open);
  const toggle = section.querySelector("[data-sidebar-toggle]");
  if (toggle) toggle.setAttribute("aria-expanded", String(open));
  if (!persist) return;
  const saved = getSidebarGroupState();
  saved[section.dataset.sidebarGroup] = open;
  localStorage.setItem(sidebarGroupStorageKey, JSON.stringify(saved));
}

function syncSidebarGroups() {
  const saved = getSidebarGroupState();
  for (const section of document.querySelectorAll("[data-sidebar-group]")) {
    const defaultOpen = section.dataset.sidebarGroup === "dispatch";
    setSidebarGroupOpen(section, saved[section.dataset.sidebarGroup] ?? defaultOpen, false);
  }
}

function isCompletedDispatchViewer() {
  const user = state.currentUser;
  const userType = String(user?.user_type ?? user?.userType ?? "").trim();
  return userType === "15" || [true, 1, "1", "true"].includes(user?.completedDispatchOnly);
}

function canViewDispatchLink() {
  if (isCompletedDispatchViewer()) return true;
  const userType = String(state.currentUser?.user_type ?? state.currentUser?.userType ?? "").trim();
  const isHelpdeskUser = [true, 1, "1", "true"].includes(state.currentUser?.helpdesk);
  return userType === "7" || userType === "8" || userType === "14" || (userType === "1" && isHelpdeskUser);
}

function applyStandardEtaProfile(user) {
  if (!user) return user;
  return {
    ...user,
    etaRole: String(user.etaRole || "None"),
    canViewDispatchOperations: Boolean(user.canViewDispatchOperations)
  };
}

function canViewDispatchOperations() {
  if (isCompletedDispatchViewer()) return false;
  return state.currentUser?.etaRole !== "DispatchTeam"
    && state.currentUser?.canViewDispatchOperations !== false;
}

function canViewEtaRequests() {
  return ["CallCentre", "DispatchTeam"].includes(String(state.currentUser?.etaRole || ""));
}

function isDispatchAdmin() {
  return Boolean(state.currentUser?.isApprover);
}

function syncSidebarAccess() {
  const userType = String(state.currentUser?.user_type ?? state.currentUser?.userType ?? "").trim();
  for (const element of document.querySelectorAll("[data-hide-for-user-type], [data-show-for-user-type]")) {
    const hiddenUserTypes = String(element.dataset.hideForUserType || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const shownUserTypes = String(element.dataset.showForUserType || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    element.hidden = !userType || hiddenUserTypes.includes(userType) || (shownUserTypes.length > 0 && !shownUserTypes.includes(userType));
  }
  for (const element of document.querySelectorAll("[data-show-for-dispatch-access]")) {
    element.hidden = !canViewDispatchLink();
  }
  for (const element of document.querySelectorAll("[data-show-for-dispatch-operations]")) {
    element.hidden = !canViewDispatchOperations();
  }
  for (const element of document.querySelectorAll("[data-show-for-eta-access]")) {
    element.hidden = !canViewEtaRequests();
  }
  const isHelpdeskUser = [true, 1, "1", "true"].includes(state.currentUser?.helpdesk);
  for (const element of document.querySelectorAll("[data-show-for-helpdesk]")) {
    element.hidden = !isHelpdeskUser;
  }
  for (const element of document.querySelectorAll("[data-show-for-approver]")) {
    element.hidden = !Boolean(state.currentUser?.isApprover);
  }
}

function syncCompletedViewerAccess() {
  if (!isCompletedDispatchViewer()) return;
  for (const section of document.querySelectorAll(".sidebar-nav > section")) {
    const completedLink = section.querySelector('a[href="completed.html"]');
    const logout = section.querySelector('a[href="/signin.sql"], a[href="/Logout.sql"]');
    section.hidden = !completedLink && !logout;
    if (completedLink || logout) {
      section.classList.add("is-open");
      section.querySelector("[data-sidebar-toggle]")?.setAttribute("aria-expanded", "true");
    }
    for (const child of section.children) {
      child.hidden = child !== completedLink && child !== logout
        && !(completedLink && child.classList.contains("nav-section-title"));
    }
    for (const link of section.querySelectorAll("a")) {
      link.hidden = link !== completedLink && link !== logout;
      if (link === logout) link.href = "/Logout.sql";
    }
    const completedLabel = completedLink?.querySelector(".nav-label > span");
    if (completedLabel) completedLabel.textContent = "Completed Dispatches";
    const completedCount = completedLink?.querySelector("[data-summary-count]");
    if (completedCount) completedCount.hidden = !elements.completedRows;
  }
  for (const button of document.querySelectorAll('[data-context-action="edit"], #saveDraftButton, #saveDraftIconButton, #submitApprovalButton, #cancelEntryButton, #cancelDispatchButton, #returnToApprovalsButton')) {
    button.hidden = true;
    button.style.setProperty("display", "none", "important");
    button.disabled = true;
  }
  for (const link of document.querySelectorAll('a[href="index.html"], a[href="index.html#incidents"]')) {
    link.href = "completed.html";
  }
}

function syncDispatchListView() {
  if (!elements.incidentRows || !elements.approvalRows) return;
  const approvalsView = window.location.hash.toLowerCase() === "#approvals";
  const incidentsSection = document.querySelector("#incidents");
  const approvalsSection = document.querySelector("#approvals");
  const title = document.querySelector(".page-title h1");
  if (incidentsSection) incidentsSection.hidden = approvalsView;
  if (approvalsSection) approvalsSection.hidden = !approvalsView;
  if (title) title.textContent = approvalsView ? "Dispatch Approvals" : "Dispatches";
  for (const link of document.querySelectorAll("[data-dispatch-view]")) {
    link.classList.toggle("active", link.dataset.dispatchView === (approvalsView ? "approvals" : "incidents"));
  }
}

function syncSidebarCollapsed() {
  setSidebarCollapsed(compactSidebarQuery.matches || localStorage.getItem(sidebarStorageKey) !== "0");
}

function renderCurrentUser() {
  const label = getFullName(state.currentUser);
  if (elements.userDisplayName) {
    elements.userDisplayName.textContent = label;
  }
  if (elements.userRoleLabel) {
    elements.userRoleLabel.textContent = state.currentUser
      ? isCompletedDispatchViewer() ? "Completed dispatches · Read only"
      : state.currentUser.etaRole === "DispatchTeam"
        ? `${canonicalDispatchTeamName(state.currentUser.etaTeamName) || "Dispatch team"} ETA access`
        : state.currentUser.etaRole === "CallCentre"
          ? "Call Centre ETA access"
          : state.currentUser.isApprover ? "Approver access enabled" : "Operator access enabled"
      : "Waiting for authenticated cookie";
  }
  const initials = label.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("");
  if (elements.userAvatar) {
    elements.userAvatar.textContent = initials || "DL";
  }
}

function renderDispatchTeamOptions() {
  const select = elements.form?.elements?.dispatchTeam;
  if (!select) return;
  const selectedValue = canonicalDispatchTeamName(select.value);
  const teams = Array.isArray(state.metadata.dispatchTeams) ? state.metadata.dispatchTeams : [];
  const configuredEntries = teams
    .map((team) => ({
      value: canonicalDispatchTeamName(typeof team === "string" ? team : team?.value || team?.label),
      label: canonicalDispatchTeamName(typeof team === "string" ? team : team?.label || team?.value)
    }));
  if (!configuredEntries.length) return;
  const entries = [...configuredEntries, { value: "Matrix", label: "Matrix" }]
    .filter((team, index, allTeams) => team.value && allTeams.findIndex(
      (entry) => entry.value.toLocaleLowerCase() === team.value.toLocaleLowerCase()
    ) === index);
  const values = entries.map((team) => team.value);
  select.innerHTML = [
    '<option value="">Select dispatch team</option>',
    ...entries.map((team) => {
      const quota = getTeamQuota(team.value);
      const label = quota ? `${team.label} — ${quota.remainingCount} remaining` : team.label;
      return `<option value="${escapeHtml(team.value)}">${escapeHtml(label)}</option>`;
    })
  ].join("");
  if (selectedValue && !values.includes(selectedValue)) {
    select.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(selectedValue)}">${escapeHtml(selectedValue)}</option>`);
  }
  select.value = selectedValue;
  renderSelectedTeamQuota();
}

function getTeamQuota(teamName) {
  const normalizedName = canonicalDispatchTeamName(teamName).toLowerCase();
  return (Array.isArray(state.metadata.teamQuotas?.teams) ? state.metadata.teamQuotas.teams : [])
    .find((team) => canonicalDispatchTeamName(team?.teamName).toLowerCase() === normalizedName) || null;
}

function quotaTone(quota) {
  const usedPercent = Number(quota?.usagePercent || 0);
  const available = Number(quota?.availableCount || 0);
  if (available <= 0 || usedPercent >= 95) return "critical";
  if (usedPercent >= 80) return "warning";
  return "normal";
}

function renderSelectedTeamQuota() {
  const element = document.querySelector("#dispatchTeamQuota");
  const selectedTeam = elements.form?.elements?.dispatchTeam?.value;
  const quota = getTeamQuota(selectedTeam);
  if (!element) return;
  element.hidden = !quota;
  element.classList.remove("is-warning", "is-critical");
  if (!quota) return;
  const tone = quotaTone(quota);
  if (tone !== "normal") element.classList.add(`is-${tone}`);
  element.innerHTML = `<b>${escapeHtml(quota.remainingCount)}</b> of ${escapeHtml(quota.monthlyLimit)} remaining · ${escapeHtml(quota.pendingCount)} pending · ${escapeHtml(state.metadata.teamQuotas.periodLabel || "this month")}`;
}

function renderTeamQuota() {
  const quota = getTeamQuota("Matrix");
  const card = document.querySelector("#matrixQuotaStat");
  if (!quota) {
    if (card) card.hidden = true;
    renderSelectedTeamQuota();
    return;
  }
  if (card) {
    card.hidden = false;
    card.classList.remove("is-warning", "is-critical");
    const tone = quotaTone(quota);
    if (tone !== "normal") card.classList.add(`is-${tone}`);
  }
  const values = {
    matrixRemaining: quota.remainingCount,
    matrixUsed: quota.usedCount,
    matrixPending: quota.pendingCount,
    matrixQuotaPeriod: state.metadata.teamQuotas.periodLabel || "this month"
  };
  for (const [id, value] of Object.entries(values)) {
    const element = document.getElementById(id);
    if (element) element.textContent = String(value ?? 0);
  }
  const progress = document.querySelector("#matrixQuotaProgress");
  if (progress) progress.style.width = `${Math.min(100, Math.max(0, Number(quota.usagePercent || 0)))}%`;
  renderSelectedTeamQuota();
}

function renderSummary() {
  for (const [key, value] of Object.entries(state.summary)) {
    const stat = document.getElementById(key);
    if (stat) stat.textContent = String(value ?? 0);
    document.querySelector(`[data-summary-count="${key}"]`)?.replaceChildren(document.createTextNode(String(value ?? 0)));
  }
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-ZA", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function handoverOperators() {
  return (Array.isArray(state.metadata.staffUsers) ? state.metadata.staffUsers : [])
    .map((user) => ({
      username: String(user?.username || "").trim(),
      label: String(user?.label || user?.value || user?.username || "").trim()
    }))
    .filter((user) => user.username
      && user.label
      && user.username.toLowerCase() !== "eta_callcentre");
}

function renderHandoverOperatorOptions(selectedValue = "") {
  if (!elements.handoverTargetOperator) return;
  const options = handoverOperators();
  elements.handoverTargetOperator.innerHTML = [
    '<option value="">Select operator</option>',
    ...options.map((operator) => `<option value="${escapeHtml(operator.username)}">${escapeHtml(operator.label)}</option>`)
  ].join("");
  elements.handoverTargetOperator.value = options.some((operator) => operator.username === selectedValue)
    ? selectedValue
    : "";
}

function setHandoverStatus(message = "", type = "") {
  if (!elements.handoverFormStatus) return;
  elements.handoverFormStatus.textContent = message;
  elements.handoverFormStatus.className = `handover-form-status${type ? ` ${type}` : ""}`;
  elements.handoverFormStatus.hidden = !message;
}

function renderDispatchHandover(detail = state.selectedIncidentDetail) {
  if (!elements.handoverTimeline) return;
  const incident = detail?.incident;
  const creatorName = String(incident?.CreatedByDisplayName || incident?.CreatedBy || "Unknown operator").trim();
  const handovers = (Array.isArray(detail?.handovers) ? detail.handovers : [])
    .slice()
    .sort((left, right) => {
      const timeDifference = new Date(left.HandoverDateTime).getTime() - new Date(right.HandoverDateTime).getTime();
      return timeDifference || Number(left.id || 0) - Number(right.id || 0);
    });

  renderHandoverOperatorOptions(elements.handoverTargetOperator?.value || "");

  if (!incident) {
    elements.handoverTimeline.innerHTML = '<p class="empty-copy">Save or load a dispatch to see its handover history.</p>';
    if (elements.currentHandoverOperator) elements.currentHandoverOperator.textContent = "Not assigned";
  } else {
    let previousOperator = creatorName;
    const entries = [{
      title: "Dispatch created",
      operator: creatorName,
      effectiveAt: incident.CreatedAt,
      recordedBy: ""
    }];
    for (const handover of handovers) {
      const targetName = String(handover.TargetOperatorDisplayName || handover.TargetOperatorUsername || "Unknown operator").trim();
      const recorderName = String(handover.RecordedByDisplayName || handover.CreatedBy || "Unknown operator").trim();
      entries.push({
        title: `${previousOperator} → ${targetName}`,
        operator: "Handover",
        effectiveAt: handover.HandoverDateTime,
        recordedBy: `Recorded by ${recorderName} on ${formatDate(handover.CreatedAt)}`
      });
      previousOperator = targetName;
    }
    elements.handoverTimeline.innerHTML = entries.map((entry, index) => `
      <article class="dispatch-handover-entry">
        <span class="dispatch-handover-node" aria-hidden="true">${index + 1}</span>
        <div class="dispatch-handover-entry-copy">
          <span>${escapeHtml(entry.operator)}</span>
          <strong>${escapeHtml(entry.title)}</strong>
          <time>${escapeHtml(formatDate(entry.effectiveAt))}</time>
          ${entry.recordedBy ? `<small>${escapeHtml(entry.recordedBy)}</small>` : ""}
        </div>
      </article>
    `).join("");
    if (elements.currentHandoverOperator) elements.currentHandoverOperator.textContent = previousOperator;
  }

  const isLocked = !incident || state.viewOnly || ["Closed", "Cancelled"].includes(incident.DispatchStatus);
  if (elements.handoverDateTime) elements.handoverDateTime.disabled = isLocked;
  if (elements.handoverTargetOperator) elements.handoverTargetOperator.disabled = isLocked;
  if (elements.addHandoverButton) elements.addHandoverButton.disabled = isLocked;
  if (!incident) setHandoverStatus("");
}

function formatAuditValue(value) {
  const normalized = String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "(blank)";
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

function setSummaryField(name, value) {
  const displayValue = String(value || "").trim() || "Pending";
  for (const element of document.querySelectorAll(`[data-summary-field="${name}"]`)) {
    element.textContent = displayValue;
  }
}

function updateDispatchPresentation(detail = state.selectedIncidentDetail) {
  if (!elements.form) return;
  syncDispatchCaptureFields(detail?.incident);
  updateClientPoRequirement();
  const incident = detail?.incident || {};
  const form = elements.form.elements;
  const valueFor = (name) => form[name]?.value || "";
  const status = incident.Status || "Draft";
  const dispatchStatus = incident.DispatchStatus || "Dispatch Requested";
  const dispatchNumber = incident.IncidentNumber || "New draft";
  const schedule = formatDate(valueFor("eventDateTime") || incident.EventDateTime);
  const submissionSection = elements.submitApprovalButton?.closest(".dispatch-section");
  const approvalNotesSection = document.querySelector("#approvalNotesSection");
  const approvalNotesEditor = document.querySelector("[data-approval-notes-editor]");
  const approvalNotesToolbar = document.querySelector("#approvalNotesToolbar");
  const approvalDecisionButtons = document.querySelector("#approvalDecisionButtons");
  const hasPendingClosure = (detail?.closureReviews || []).some((review) => review.ReviewStatus === "Pending");
  const canReviewApproval = Boolean(state.currentUser?.isApprover)
    && (status === "PendingApproval" || hasPendingClosure);
  const hasEnteredApprovalWorkflow = ["PendingApproval", "Rejected", "Approved"].includes(status) || hasPendingClosure;

  if (elements.returnToApprovalsButton) {
    const allowed = canReturnDispatchToApprovals(incident);
    elements.returnToApprovalsButton.hidden = !allowed;
    elements.returnToApprovalsButton.disabled = !allowed || returnToApprovalsInProgress;
  }

  if (elements.formTitle) {
    const incidentType = String(valueFor("event") || incident.Event || "").trim();
    elements.formTitle.textContent = incidentType ? `${incidentType} Report` : "New Dispatch Report";
  }
  if (elements.formSubtitle) {
    elements.formSubtitle.textContent = status === "PendingApproval"
      ? "Submitted for review. Check the report details and approval notes below."
      : status === "Rejected"
        ? "Returned for revision. Review the approval notes and update the report below."
        : status === "Approved"
          ? "Completed report."
          : "Capture the incident details, supporting evidence, and timeline below.";
  }

  setSummaryField("incidentNumber", dispatchNumber);
  setSummaryField("status", status);
  setSummaryField("dispatchStatus", dispatchStatus);
  setSummaryField("event", valueFor("event"));
  setSummaryField("eventDateTime", schedule === "-" ? "" : schedule);
  setSummaryField("unitId", valueFor("unitId"));
  setSummaryField("regNo", valueFor("regNo"));
  setSummaryField("company", valueFor("company"));
  setSummaryField("fleetCode", valueFor("fleetCode"));
  setSummaryField("dispatchTeam", valueFor("dispatchTeam"));
  setSummaryField("driverName", valueFor("driverName"));
  setSummaryField("dispatchReason", valueFor("dispatchReason"));
  setSummaryField("actualDispatchReason", valueFor("actualDispatchReason"));
  setSummaryField("positiveVesa", valueFor("positiveVesa"));
  setSummaryField("zohoOb", incident.zoho_ob);

  for (const pill of document.querySelectorAll("[data-dispatch-status]")) {
    pill.textContent = dispatchStatus;
  }

  if (elements.dispatchCancellationSummary) {
    const cancellationReason = String(incident.CancellationReason || "").trim();
    const cancellationMeta = [
      incident.CancelledBy ? `by ${incident.CancelledBy}` : "",
      incident.CancelledAt ? `on ${formatDate(incident.CancelledAt)}` : ""
    ].filter(Boolean).join(" ");
    elements.dispatchCancellationSummary.textContent = cancellationReason
      ? `${cancellationReason}${cancellationMeta ? ` (${cancellationMeta})` : ""}`
      : "";
    elements.dispatchCancellationSummary.hidden = !cancellationReason;
  }

  if (elements.submitApprovalButton) {
    const awaitingApproval = status === "PendingApproval";
    if (submissionSection) submissionSection.hidden = awaitingApproval;
    const readyForClosure = state.currentUser?.closureWorkflowEnabled === true
      && status === "Approved" && ["Stood Down", "Closure Requested"].includes(dispatchStatus);
    elements.submitApprovalButton.disabled = awaitingApproval || (status === "Approved" && !readyForClosure);
    elements.submitApprovalButton.textContent = readyForClosure ? "Request Closure Review" : (awaitingApproval ? "Awaiting Approval" : "Submit for Approval");
  }
  if (approvalNotesSection) approvalNotesSection.hidden = !hasEnteredApprovalWorkflow;
  if (approvalNotesToolbar) approvalNotesToolbar.hidden = !canReviewApproval;
  if (approvalDecisionButtons) approvalDecisionButtons.hidden = !canReviewApproval;
  if (approvalNotesEditor) {
    approvalNotesEditor.setAttribute("contenteditable", String(canReviewApproval && !state.viewOnly));
    approvalNotesEditor.classList.toggle("is-readonly", !canReviewApproval || state.viewOnly);
  }
  updateDispatchDurationAlert();
}

function syncDocumentFileName(fileInput) {
  if (!fileInput?.id) return;
  const label = document.querySelector(`[data-file-name-for="${fileInput.id}"]`);
  if (!label) return;
  label.textContent = fileInput.files?.[0]?.name || "No file chosen";
}

function getLocalDateTimeParts(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return { date: "", time: "" };
  const pad = (number) => String(number).padStart(2, "0");
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`
  };
}

function toDateInputValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return getLocalDateTimeParts(raw).date;
}

function toTimeInputValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{2}):(\d{2})/);
  if (match) return `${match[1]}:${match[2]}`;
  return getLocalDateTimeParts(raw).time;
}

function getCurrentHourDefaults() {
  const currentHour = new Date();
  currentHour.setMinutes(0, 0, 0);
  const parts = getLocalDateTimeParts(currentHour);
  return {
    communicationDate: parts.date,
    communicationTime: parts.time
  };
}

function optionMarkup(options, selectedValue = "") {
  return options.map((option) => {
    const value = typeof option === "string" ? option : option.value;
    const label = typeof option === "string" ? option : option.label;
    return `<option value="${escapeHtml(value)}"${value === selectedValue ? " selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
}

function normalizeCommunicationLogRecord(values = {}) {
  return {
    id: values.id ?? values.CommunicationLogID ?? "",
    displayOrder: Number(values.displayOrder ?? values.DisplayOrder ?? 0) || 0,
    communicationDate: toDateInputValue(values.communicationDate ?? values.CommunicationDate),
    communicationTime: toTimeInputValue(values.communicationTime ?? values.CommunicationTime),
    communicationType: values.communicationType ?? values.CommunicationType ?? "",
    controlRoomAgent: values.controlRoomAgent ?? values.ControlRoomAgent ?? "",
    contactPerson: values.contactPerson ?? values.ContactPerson ?? "",
    contactNumber: normalizeCommunicationContactNumber(values.contactNumber ?? values.ContactNumber ?? ""),
    emailAddress: values.emailAddress ?? values.EmailAddress ?? "",
    communicationNotes: values.communicationNotes ?? values.CommunicationNotes ?? ""
  };
}

function communicationTimeControl(value) {
  const normalized = toTimeInputValue(value);
  const [hour = "", minute = ""] = normalized.split(":");
  const controlId = ++communicationTimeComboboxId;
  const hourOptionsId = `communicationHourOptions${controlId}`;
  const minuteOptionsId = `communicationMinuteOptions${controlId}`;
  return `
    <div class="communication-time-combobox" data-time-pair>
      <span class="incident-time-selectors">
        <span class="incident-time-combobox" data-time-combobox>
          <input name="communicationHour" data-time-part="hour" type="text" inputmode="numeric" maxlength="2"
            pattern="(?:[01][0-9]|2[0-3])" value="${escapeHtml(hour)}" placeholder="HH"
            title="Enter or select an hour from 00 to 23" aria-label="Communication hour, 00 to 23"
            role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${hourOptionsId}" autocomplete="off">
          <span id="${hourOptionsId}" class="incident-time-options" role="listbox" hidden></span>
        </span>
        <span aria-hidden="true">:</span>
        <span class="incident-time-combobox" data-time-combobox>
          <input name="communicationMinute" data-time-part="minute" type="text" inputmode="numeric" maxlength="2"
            pattern="[0-5][0-9]" value="${escapeHtml(minute)}" placeholder="MM"
            title="Enter or select minutes from 00 to 59" aria-label="Communication minute, 00 to 59"
            role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${minuteOptionsId}" autocomplete="off">
          <span id="${minuteOptionsId}" class="incident-time-options" role="listbox" hidden></span>
        </span>
      </span>
      <input name="communicationTime" data-time-value type="hidden" value="${escapeHtml(normalized)}">
    </div>
  `;
}

function syncCommunicationRowOrder() {
  if (!elements.communicationLogRows) return;
  Array.from(elements.communicationLogRows.querySelectorAll("tr")).forEach((row, index) => {
    const displayOrder = index + 1;
    row.dataset.displayOrder = String(displayOrder);
    const dragHandle = row.querySelector("[data-drag-communication-row]");
    if (dragHandle) {
      dragHandle.setAttribute("aria-label", `Move communication row ${displayOrder}`);
      dragHandle.title = `Drag to move communication row ${displayOrder}`;
    }
  });
}

function communicationAgentControl(selectedValue) {
  const staffUsers = Array.isArray(state.metadata.staffUsers) ? state.metadata.staffUsers : [];
  if (!staffUsers.length) {
    return `<input name="communicationAgent" maxlength="100" value="${escapeHtml(selectedValue)}">`;
  }

  const options = [{ value: "", label: "Select agent" }];
  for (const user of staffUsers) {
    const value = String(user.value || user.username || user.label || "").trim();
    const label = String(user.label || user.displayName || user.username || value).trim();
    if (value) options.push({ value, label: label || value });
  }
  if (selectedValue && !options.some((option) => option.value === selectedValue)) {
    options.push({ value: selectedValue, label: selectedValue });
  }

  const listboxId = `communication-agent-options-${++communicationAgentSelectId}`;
  const selectedOption = options.find((option) => option.value === selectedValue) || options[0];
  const optionButtons = options.map((option) => `
    <button class="communication-agent-option" type="button" role="option"
      data-communication-agent-value="${escapeHtml(option.value)}"
      aria-selected="${String(option.value === selectedValue)}">${escapeHtml(option.label)}</button>
  `).join("");

  return `
    <div class="communication-agent-select" data-communication-agent-select>
      <select class="communication-agent-native" name="communicationAgent" tabindex="-1" aria-hidden="true">
        ${optionMarkup(options, selectedValue)}
      </select>
      <button class="communication-agent-trigger" type="button" data-communication-agent-trigger
        aria-haspopup="listbox" aria-expanded="false" aria-controls="${listboxId}">
        <span data-communication-agent-label>${escapeHtml(selectedOption.label)}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"></path></svg>
      </button>
      <div class="communication-agent-popup" data-communication-agent-popup hidden>
        <label class="communication-agent-search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg>
          <span class="sr-only">Search agents</span>
          <input type="search" data-communication-agent-search aria-label="Search agents" autocomplete="off">
        </label>
        <div class="communication-agent-options" id="${listboxId}" role="listbox">
          ${optionButtons}
        </div>
        <p class="communication-agent-empty" data-communication-agent-empty hidden>No agents found</p>
      </div>
    </div>
  `;
}

function filterCommunicationAgents(control, query = "") {
  if (!control) return;
  const normalizedQuery = String(query).trim().toLocaleLowerCase();
  let visibleCount = 0;
  for (const option of control.querySelectorAll("[data-communication-agent-value]")) {
    const visible = !normalizedQuery || option.textContent.toLocaleLowerCase().includes(normalizedQuery);
    option.hidden = !visible;
    if (visible) visibleCount += 1;
  }
  const emptyMessage = control.querySelector("[data-communication-agent-empty]");
  if (emptyMessage) emptyMessage.hidden = visibleCount !== 0;
}

function positionCommunicationAgentPopup(control) {
  const trigger = control?.querySelector("[data-communication-agent-trigger]");
  const popup = control?.querySelector("[data-communication-agent-popup]");
  if (!trigger || !popup || popup.hidden) return;

  const gap = 4;
  const viewportPadding = 8;
  const triggerBounds = trigger.getBoundingClientRect();
  const popupWidth = Math.max(triggerBounds.width, 200);
  const roomBelow = window.innerHeight - triggerBounds.bottom - viewportPadding - gap;
  const roomAbove = triggerBounds.top - viewportPadding - gap;
  const openAbove = roomBelow < 220 && roomAbove > roomBelow;
  const availableHeight = Math.max(140, Math.min(330, openAbove ? roomAbove : roomBelow));
  const left = Math.min(
    Math.max(viewportPadding, triggerBounds.left),
    Math.max(viewportPadding, window.innerWidth - popupWidth - viewportPadding)
  );

  popup.style.width = `${popupWidth}px`;
  popup.style.maxHeight = `${availableHeight}px`;
  // A transformed application shell becomes the containing block for fixed
  // descendants. Measure that origin so the popup still lands on the trigger.
  popup.style.left = "0px";
  popup.style.top = "0px";
  const containingBlockOrigin = popup.getBoundingClientRect();
  const top = openAbove
    ? Math.max(viewportPadding, triggerBounds.top - popup.offsetHeight - gap)
    : triggerBounds.bottom + gap;
  popup.style.left = `${left - containingBlockOrigin.left}px`;
  popup.style.top = `${top - containingBlockOrigin.top}px`;
  correctFixedPopupPosition(popup, left, top);
}

function closeCommunicationAgentSelect(control, { restoreFocus = false } = {}) {
  const trigger = control?.querySelector("[data-communication-agent-trigger]");
  const popup = control?.querySelector("[data-communication-agent-popup]");
  if (!trigger || !popup || popup.hidden) return;
  popup.hidden = true;
  control.closest(".communication-log-section")?.classList.remove("has-open-agent-popup");
  trigger.setAttribute("aria-expanded", "false");
  const search = control.querySelector("[data-communication-agent-search]");
  if (search) search.value = "";
  filterCommunicationAgents(control);
  if (restoreFocus) trigger.focus();
}

function closeAllCommunicationAgentSelects(exceptControl = null) {
  for (const control of document.querySelectorAll("[data-communication-agent-select]")) {
    if (control !== exceptControl) closeCommunicationAgentSelect(control);
  }
}

function openCommunicationAgentSelect(control) {
  const trigger = control?.querySelector("[data-communication-agent-trigger]");
  const popup = control?.querySelector("[data-communication-agent-popup]");
  const search = control?.querySelector("[data-communication-agent-search]");
  if (!trigger || !popup || trigger.disabled) return;
  closeAllCommunicationAgentSelects(control);
  control.closest(".communication-log-section")?.classList.add("has-open-agent-popup");
  popup.hidden = false;
  trigger.setAttribute("aria-expanded", "true");
  filterCommunicationAgents(control);
  positionCommunicationAgentPopup(control);
  search?.focus();
}

function selectCommunicationAgent(control, option) {
  const select = control?.querySelector('select[name="communicationAgent"]');
  const label = control?.querySelector("[data-communication-agent-label]");
  if (!select || !option) return;
  select.value = option.dataset.communicationAgentValue || "";
  if (label) label.textContent = option.textContent.trim();
  for (const candidate of control.querySelectorAll("[data-communication-agent-value]")) {
    candidate.setAttribute("aria-selected", String(candidate === option));
  }
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
  closeCommunicationAgentSelect(control, { restoreFocus: true });
}

function resizeCommunicationNotes(textarea) {
  if (!textarea) return;
  const minimumHeight = 30;
  const maximumHeight = 72;
  textarea.style.height = `${minimumHeight}px`;
  const contentHeight = Math.max(minimumHeight, textarea.scrollHeight);
  textarea.style.height = `${Math.min(contentHeight, maximumHeight)}px`;
  textarea.style.overflowY = contentHeight > maximumHeight ? "auto" : "hidden";
}

function addCommunicationRow(values = {}, { afterRow = null } = {}) {
  if (!elements.communicationLogRows) return;
  const isNewRow = !Object.keys(values).length;
  const record = normalizeCommunicationLogRecord(isNewRow ? getCurrentHourDefaults() : values);
  const row = document.createElement("tr");
  const typeOptions = [{ value: "", label: "Select type" }, ...communicationTypes.map((type) => ({ value: type, label: type }))];
  if (record.communicationType && record.communicationType !== "WhatsApp" && !communicationTypes.includes(record.communicationType)) {
    typeOptions.push({ value: record.communicationType, label: record.communicationType });
  }
  row.dataset.communicationLogId = String(record.id || "");
  row.dataset.communicationRowKey = values.rowKey || createAdditionalAssetKey();
  if (values.pendingSave && !record.id) {
    row.dataset.communicationPendingSave = JSON.stringify(values.pendingSave);
  }
  row.dataset.displayOrder = String(record.displayOrder || "");

  row.innerHTML = `
    <td>
      <div class="communication-log-row-actions">
        <button class="communication-log-drag-handle" type="button" draggable="true" data-drag-communication-row aria-label="Move communication row" title="Drag to move communication row">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="7" r="1"></circle><circle cx="16" cy="7" r="1"></circle><circle cx="8" cy="12" r="1"></circle><circle cx="16" cy="12" r="1"></circle><circle cx="8" cy="17" r="1"></circle><circle cx="16" cy="17" r="1"></circle></svg>
        </button>
        <button class="communication-log-duplicate" type="button" data-duplicate-communication-row aria-label="Duplicate communication row without notes" title="Duplicate row without notes">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path></svg>
        </button>
        <button class="communication-log-remove" type="button" data-remove-communication-row aria-label="Remove communication row" title="Remove communication row">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>
        </button>
      </div>
    </td>
    <td><input name="communicationDate" type="date" value="${escapeHtml(record.communicationDate)}"></td>
    <td>${communicationTimeControl(record.communicationTime)}</td>
    <td><select name="communicationType">${optionMarkup(typeOptions, record.communicationType)}</select></td>
    <td>${communicationAgentControl(record.controlRoomAgent)}</td>
    <td><input name="communicationContactPerson" maxlength="150" value="${escapeHtml(record.contactPerson)}"></td>
    <td><input name="communicationContactNumber" maxlength="50" inputmode="tel" data-communication-contact-number value="${escapeHtml(record.contactNumber)}"></td>
    <td><input name="communicationEmailAddress" type="email" maxlength="255" value="${escapeHtml(record.emailAddress)}"></td>
    <td><textarea name="communicationNotes">${escapeHtml(record.communicationNotes)}</textarea></td>
  `;

  if (afterRow) afterRow.after(row);
  else elements.communicationLogRows.append(row);
  setupIncidentTimeComboboxes(row);
  const communicationNotes = row.querySelector('[name="communicationNotes"]');
  resizeCommunicationNotes(communicationNotes);
  window.requestAnimationFrame(() => resizeCommunicationNotes(communicationNotes));
  const dragHandle = row.querySelector("[data-drag-communication-row]");
  if (dragHandle) {
    dragHandle.disabled = state.viewOnly;
    dragHandle.draggable = !state.viewOnly;
  }
  syncCommunicationRowOrder();
  syncViewOnlyMode();
  return row;
}

function duplicateCommunicationRow(sourceRow) {
  const field = (name) => sourceRow.querySelector(`[name="${name}"]`)?.value || "";
  const duplicate = addCommunicationRow({
    communicationDate: field("communicationDate"),
    communicationTime: syncTimePairValue(sourceRow.querySelector('[data-time-part="hour"]')),
    communicationType: field("communicationType"),
    controlRoomAgent: field("communicationAgent"),
    contactPerson: field("communicationContactPerson"),
    contactNumber: field("communicationContactNumber"),
    emailAddress: field("communicationEmailAddress"),
    communicationNotes: ""
  }, { afterRow: sourceRow });
  duplicate?.querySelector('[name="communicationNotes"]')?.focus();
  markDraftUnsaved();
}

function renderCommunicationLog(records = []) {
  if (!elements.communicationLogRows) return;
  state.removedCommunicationLogIds.clear();
  elements.communicationLogRows.replaceChildren();
  for (const record of records) {
    addCommunicationRow(record);
  }
  syncCommunicationRowOrder();
}

function readCommunicationLogRows() {
  if (!elements.communicationLogRows) return { rows: [], deletedIds: [] };
  const rows = [];
  const errors = [];
  const communicationErrors = [];
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  Array.from(elements.communicationLogRows.querySelectorAll("tr")).forEach((row, index) => {
    const field = (name) => String(row.querySelector(`[name="${name}"]`)?.value || "").trim();
    const communicationTime = syncTimePairValue(row.querySelector('[data-time-part="hour"]'));
    const record = {
      id: row.dataset.communicationLogId ? Number(row.dataset.communicationLogId) : null,
      rowKey: row.dataset.communicationRowKey,
      pendingSave: row.dataset.communicationPendingSave ? JSON.parse(row.dataset.communicationPendingSave) : null,
      communicationDate: field("communicationDate"),
      communicationTime,
      communicationType: field("communicationType"),
      controlRoomAgent: field("communicationAgent"),
      contactPerson: field("communicationContactPerson"),
      contactNumber: normalizeCommunicationContactNumber(field("communicationContactNumber")),
      emailAddress: field("communicationEmailAddress"),
      communicationNotes: field("communicationNotes")
    };
    const hasAnyValue = Object.entries(record)
      .some(([key, value]) => !["id", "rowKey", "pendingSave"].includes(key) && String(value || "").trim());

    if (!record.id && !hasAnyValue) return;

    const rowNumber = index + 1;
    const addError = (fieldName, message) => {
      const fullMessage = `Communication row ${rowNumber}: ${message}`;
      errors.push(fullMessage);
      communicationErrors.push({ rowNumber, fieldName, message: fullMessage });
    };
    if (!record.communicationDate) addError("communicationDate", "Date is required.");
    if (!record.communicationTime) addError("communicationTime", "Time is required.");
    if (!record.communicationType) {
      addError("communicationType", "Communication Type is required.");
    } else if (!communicationTypes.includes(record.communicationType)) {
      addError("communicationType", "Communication Type is not valid.");
    }
    if (!record.controlRoomAgent) addError("communicationAgent", "Control Room Agent is required.");
    if (record.emailAddress && !emailPattern.test(record.emailAddress)) {
      addError("communicationEmailAddress", "Email Address is not valid.");
    }
    record.displayOrder = rows.length + 1;
    rows.push(record);
  });

  if (errors.length) {
    const error = new Error("Communication log validation failed.");
    error.details = {
      isValid: false,
      missingFields: errors,
      missingPhotos: [],
      communicationErrors
    };
    throw error;
  }

  return {
    rows,
    deletedIds: Array.from(state.removedCommunicationLogIds).filter(Boolean)
  };
}

function timelineIconMarkup(type) {
  const paths = {
    Alert: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path>',
    Client: '<circle cx="12" cy="7" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path>',
    Dispatch: '<path d="m22 2-7 20-4-9-9-4Z"></path><path d="M22 2 11 13"></path>',
    Arrival: '<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"></path><circle cx="12" cy="10" r="2.5"></circle>',
    Search: '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path>',
    Call: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.8 2.1Z"></path>',
    Confirmed: '<circle cx="12" cy="12" r="9"></circle><path d="m8 12 2.5 2.5L16 9"></path>',
    StandDown: '<path d="M5 22V4"></path><path d="M5 5c5-4 9 4 14 0v10c-5 4-9-4-14 0"></path>',
    Note: '<path d="M4 4h16v16H4z"></path><path d="M8 9h8M8 13h8M8 17h5"></path>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[type] || paths.Note}</svg>`;
}

function normalizeTimelineRecord(values = {}) {
  const rawDateTime = values.eventDateTime ?? values.EventDateTime ?? "";
  return {
    id: Number(values.id ?? values.TimelineEntryID ?? 0) || null,
    eventDateTime: rawDateTime ? String(rawDateTime).slice(0, 16) : "",
    eventType: values.eventType ?? values.EventType ?? "Note",
    entryText: values.entryText ?? values.EntryText ?? ""
  };
}

function addTimelineRow(values = {}) {
  if (!elements.incidentTimelineRows) return;
  const record = normalizeTimelineRecord(values);
  const row = document.createElement("article");
  row.className = "incident-timeline-row";
  row.dataset.timelineEntryId = String(record.id || "");
  row.innerHTML = `
    <div class="incident-timeline-datetime">
      <span>Date and time</span>
      <input name="timelineEventDateTime" type="datetime-local" value="${escapeHtml(record.eventDateTime)}">
    </div>
    <span class="incident-timeline-node" aria-hidden="true"></span>
    <div class="incident-timeline-event">
      <span class="incident-timeline-icon" data-timeline-icon>${timelineIconMarkup(record.eventType)}</span>
      <label>
        <span>Icon / event</span>
        <select name="timelineEventType">${optionMarkup(timelineEventTypes, record.eventType)}</select>
      </label>
    </div>
    <label class="incident-timeline-description">
      <span>Timeline description</span>
      <textarea name="timelineEntryText" maxlength="1000" placeholder="Describe what happened at this point in the incident">${escapeHtml(record.entryText)}</textarea>
    </label>
    <button class="communication-log-remove incident-timeline-remove" type="button" data-remove-timeline-row aria-label="Remove timeline event" title="Remove timeline event">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>
    </button>
  `;
  elements.incidentTimelineRows.append(row);
  syncViewOnlyMode();
}

function renderIncidentTimeline(records = []) {
  if (!elements.incidentTimelineRows) return;
  state.removedTimelineEntryIds.clear();
  elements.incidentTimelineRows.replaceChildren();
  if (!records.length) {
    addTimelineRow();
    return;
  }
  for (const record of records) addTimelineRow(record);
}

function readTimelineRows() {
  if (!elements.incidentTimelineRows) return { rows: [], deletedIds: [] };
  const rows = [];
  const errors = [];
  Array.from(elements.incidentTimelineRows.querySelectorAll(".incident-timeline-row")).forEach((row, index) => {
    const field = (name) => String(row.querySelector(`[name="${name}"]`)?.value || "").trim();
    const record = {
      id: row.dataset.timelineEntryId ? Number(row.dataset.timelineEntryId) : null,
      eventDateTime: field("timelineEventDateTime"),
      eventType: field("timelineEventType"),
      entryText: field("timelineEntryText")
    };
    const hasAnyValue = Boolean(record.id || record.eventDateTime || record.entryText || (record.eventType && record.eventType !== "Note"));
    if (!hasAnyValue) return;
    const rowLabel = `Timeline event ${index + 1}`;
    if (!record.eventDateTime) errors.push(`${rowLabel}: Date and time are required.`);
    if (!timelineEventTypes.some((type) => type.value === record.eventType)) errors.push(`${rowLabel}: Select a valid icon/event.`);
    if (!record.entryText) errors.push(`${rowLabel}: Description is required.`);
    rows.push(record);
  });
  if (errors.length) {
    const error = new Error("Incident timeline validation failed.");
    error.details = { isValid: false, missingFields: errors, missingPhotos: [] };
    throw error;
  }
  return { rows, deletedIds: Array.from(state.removedTimelineEntryIds).filter(Boolean) };
}

function syncPhotoUploadFileName(fileInput) {
  const uploadItem = fileInput?.closest("[data-photo-category]");
  const label = uploadItem?.querySelector("[data-photo-file-name]");
  if (!label) return;
  label.textContent = fileInput.files?.[0]?.name || "No file chosen";
}

function hasSavedIncident() {
  return Boolean(state.selectedIncidentDetail?.incident?.id);
}

function getLatestHistoryFile(fileType, detail = state.selectedIncidentDetail) {
  return (detail?.files || [])
    .filter((file) => file.FileType === fileType && !state.removedHistoryFileIds.has(Number(file.id)))
    .sort((left, right) => {
      const leftDate = new Date(String(left.UploadedAt || left.CreatedAt || "").replace(" ", "T")).getTime() || 0;
      const rightDate = new Date(String(right.UploadedAt || right.CreatedAt || "").replace(" ", "T")).getTime() || 0;
      return rightDate - leftDate || Number(right.id || 0) - Number(left.id || 0);
    })[0] || null;
}

function getVisibleHistoryFiles(detail = state.selectedIncidentDetail) {
  return (detail?.files || []).filter((file) => !state.removedHistoryFileIds.has(Number(file.id)));
}

function historyFileIcon(fileType) {
  if (fileType === "HistoryExcel") {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4" /><path d="M4 15l4 6" /><path d="M4 21l4 -6" /><path d="M17 20.25c0 .414 .336 .75 .75 .75h1.25a1 1 0 0 0 1 -1v-1a1 1 0 0 0 -1 -1h-1a1 1 0 0 1 -1 -1v-1a1 1 0 0 1 1 -1h1.25a.75 .75 0 0 1 .75 .75" /><path d="M11 15v6h3" /></svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4" /><path d="M5 18h1.5a1.5 1.5 0 0 0 0 -3h-1.5v6" /><path d="M17 18h2" /><path d="M20 15h-3v6" /><path d="M11 15v6h1a2 2 0 0 0 2 -2v-2a2 2 0 0 0 -2 -2h-1" /></svg>`;
}

function isTrueFlag(value) {
  return value === true || value === 1 || value === "1" || String(value || "").toLowerCase() === "true";
}

function syncVehicleHistoryExceptionControls(detail = state.selectedIncidentDetail) {
  if (!elements.form) return false;
  const checkbox = elements.form.elements.vehicleHistoryUnavailable;
  const reason = elements.form.elements.vehicleHistoryUnavailableReason;
  const selected = Boolean(checkbox?.checked);
  const requiredMarker = elements.historyUnavailableReason?.querySelector("[data-history-unavailable-required]");

  if (elements.historyUnavailableReason) elements.historyUnavailableReason.hidden = !selected;
  if (requiredMarker) requiredMarker.hidden = !selected;
  if (reason) reason.required = selected;
  if (elements.historyUploadGrid) elements.historyUploadGrid.hidden = selected;
  if (elements.historyReportsHelp) {
    elements.historyReportsHelp.textContent = selected
      ? "The history-report uploads are waived. Enter the compulsory reason below before saving and submitting."
      : "This registration was not found on MSTrack. Upload both history reports before submitting the draft for approval.";
  }

  const incident = detail?.incident;
  const recorded = isTrueFlag(incident?.VehicleHistoryUnavailable)
    && (incident?.VehicleHistoryUnavailableBy || incident?.VehicleHistoryUnavailableAt);
  if (elements.historyUnavailableAudit) {
    elements.historyUnavailableAudit.hidden = !recorded;
    elements.historyUnavailableAudit.textContent = recorded
      ? `Exception recorded by ${incident.VehicleHistoryUnavailableBy || "-"} on ${formatDate(incident.VehicleHistoryUnavailableAt)}.`
      : "";
  }
  return selected;
}

function renderHistoryUploadControls(detail = state.selectedIncidentDetail) {
  const incident = detail?.incident;
  const statusName = String(incident?.Status || "");
  const registrationMissing = Boolean(incident?.id) && incident.MSTrackRegistrationExists !== true
    && incident.MSTrackRegistrationExists !== 1
    && String(incident.MSTrackRegistrationExists).toLowerCase() !== "true";
  const showUploads = registrationMissing && ["Draft", "Rejected", "PendingApproval"].includes(statusName) && !state.viewOnly;
  if (elements.historyReportsSection) elements.historyReportsSection.hidden = !showUploads;
  const historyUnavailable = syncVehicleHistoryExceptionControls(detail);

  for (const fileType of ["HistoryExcel", "HistoryPdf"]) {
    const card = document.querySelector(`[data-history-file-type="${fileType}"]`);
    if (!card) continue;
    const uploadedFile = getLatestHistoryFile(fileType, detail);
    const fileInput = fileType === "HistoryExcel" ? elements.historyExcelFile : elements.historyPdfFile;
    const fileNameLabel = card.querySelector("[data-history-file-name]");
    const status = card.querySelector("[data-history-status]");
    const uploadControl = card.querySelector(".document-upload");
    const icon = card.querySelector("[data-history-icon]");
    const canUpload = showUploads && !historyUnavailable && hasSavedIncident();
    const pickerEnabled = canUpload && !uploadedFile;

    card.classList.toggle("has-file", Boolean(uploadedFile));
    card.classList.toggle("is-locked", !canUpload);
    card.classList.toggle("is-disabled", Boolean(uploadedFile));
    if (fileInput) fileInput.disabled = !pickerEnabled;
    if (icon) icon.innerHTML = historyFileIcon(fileType);

    if (fileNameLabel) {
      fileNameLabel.textContent = uploadedFile?.OriginalFileName || (canUpload ? "No file chosen" : "Save draft first");
    }

    if (!status) continue;
    if (!uploadedFile) {
      status.innerHTML = `<span class="document-upload-status-empty">${canUpload ? "No file uploaded yet." : "Save the draft before uploading."}</span>`;
      continue;
    }

    status.innerHTML = `
      <div class="document-upload-status-file">
        <span class="document-upload-status-icon">${historyFileIcon(fileType)}</span>
        <div class="document-upload-status-copy">
          <strong>${escapeHtml(uploadedFile.OriginalFileName || "Uploaded file")}</strong>
          <span>${escapeHtml(uploadedFile.UploadedBy || "-")} | ${escapeHtml(formatDate(uploadedFile.UploadedAt))}</span>
        </div>
        <div class="document-upload-status-actions">
          ${uploadedFile.downloadUrl ? `<a href="${escapeHtml(downloadUrl(uploadedFile.downloadUrl))}" target="_blank" rel="noopener noreferrer">View</a>` : ""}
          <button type="button" data-remove-history-file="${escapeHtml(String(uploadedFile.id))}">Remove from report</button>
        </div>
      </div>
    `;
  }
}

function getLatestPhotosByCategory(detail) {
  const latestPhotos = new Map();
  for (const photo of detail?.photos || []) {
    if (photo.AssetKey) continue;
    if (!latestPhotos.has(photo.PhotoCategory)) {
      latestPhotos.set(photo.PhotoCategory, photo);
    }
  }
  return latestPhotos;
}

function getPhotoGalleryItems(detail) {
  return (detail?.photos || [])
    .map((photo, index) => {
      const url = photo?.downloadUrl ? downloadUrl(photo.downloadUrl) : "";
      const assetIndex = (detail?.incident?.additionalAssets || []).findIndex((asset) =>
        String(asset.key || "").toLowerCase() === String(photo.AssetKey || "").toLowerCase());
      const category = `${assetIndex >= 0 ? `Asset ${assetIndex + 2}: ` : ""}${photoLabels[photo.PhotoCategory] || photo.PhotoCategory || "Dispatch photo"}`;
      const fileName = photo.OriginalFileName || "";
      return {
        index,
        id: Number(photo.id),
        category: photo.PhotoCategory,
        url,
        label: category,
        fileName,
        uploadedBy: photo.UploadedBy || "-",
        uploadedAt: photo.UploadedAt,
        alt: [category, fileName].filter(Boolean).join(" - ") || "Dispatch photo"
      };
    })
    .filter((photo) => photo.url);
}

function updatePhotoGalleryScrollButtons(gallery = elements.photoGalleryPanel) {
  if (!gallery) return;
  const track = gallery.querySelector("[data-gallery-track]");
  const previousButton = gallery.querySelector('[data-gallery-scroll="previous"]');
  const nextButton = gallery.querySelector('[data-gallery-scroll="next"]');
  if (!track || !previousButton || !nextButton) return;

  const maxScrollLeft = Math.max(0, track.scrollWidth - track.clientWidth - 1);
  const atStart = track.scrollLeft <= 1;
  const atEnd = track.scrollLeft >= maxScrollLeft;
  previousButton.disabled = atStart;
  nextButton.disabled = atEnd;
  previousButton.classList.toggle("is-disabled", atStart);
  nextButton.classList.toggle("is-disabled", atEnd);
}

function updatePhotoChecklistScrollButtons() {
  const track = elements.photoUploadList;
  const previousButton = document.querySelector('[data-photo-checklist-scroll="previous"]');
  const nextButton = document.querySelector('[data-photo-checklist-scroll="next"]');
  if (!track || !previousButton || !nextButton) return;

  const maxScrollLeft = Math.max(0, track.scrollWidth - track.clientWidth - 1);
  const atStart = track.scrollLeft <= 1;
  const atEnd = track.scrollLeft >= maxScrollLeft;
  previousButton.disabled = atStart;
  nextButton.disabled = atEnd;
  previousButton.classList.toggle("is-disabled", atStart);
  nextButton.classList.toggle("is-disabled", atEnd);
}

function getPhotoCarouselStep(track) {
  const firstCard = track?.querySelector(".upload-item");
  if (!track || !firstCard) return 280;
  const styles = window.getComputedStyle(track);
  const gap = Number.parseFloat(styles.columnGap || styles.gap || "0") || 0;
  return firstCard.getBoundingClientRect().width + gap;
}

function animateHorizontalScroll(track, targetLeft, duration = 460) {
  if (!track) return;
  if (track.scrollAnimationFrame) {
    window.cancelAnimationFrame(track.scrollAnimationFrame);
  }
  const startLeft = track.scrollLeft;
  const maxLeft = Math.max(0, track.scrollWidth - track.clientWidth);
  const endLeft = Math.min(Math.max(targetLeft, 0), maxLeft);
  const distance = endLeft - startLeft;
  if (Math.abs(distance) < 1) return;

  const startedAt = performance.now();
  track.classList.add("is-scrolling");
  window.clearTimeout(track.scrollFlowTimer);

  const step = (now) => {
    const progress = Math.min((now - startedAt) / duration, 1);
    const eased = progress < .5
      ? 4 * progress * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 3) / 2;
    track.scrollLeft = startLeft + distance * eased;
    if (progress < 1) {
      track.scrollAnimationFrame = window.requestAnimationFrame(step);
      return;
    }
    track.scrollAnimationFrame = null;
    window.clearTimeout(track.scrollFlowTimer);
    track.scrollFlowTimer = window.setTimeout(() => track.classList.remove("is-scrolling"), 140);
  };

  track.scrollAnimationFrame = window.requestAnimationFrame(step);
}

function renderPhotoGallery(detail = state.selectedIncidentDetail) {
  if (!elements.photoGalleryPanel) return;
  const photos = getPhotoGalleryItems(detail);

  if (!photos.length) {
    state.selectedPhotoIndex = 0;
    elements.photoGalleryPanel.innerHTML = `
      <div class="image-gallery is-empty">
        <div class="image-gallery-empty">
          <strong>No images uploaded yet.</strong>
          <span>Uploaded photos will appear here.</span>
        </div>
      </div>
    `;
    return;
  }

  state.selectedPhotoIndex = Math.min(Math.max(state.selectedPhotoIndex || 0, 0), photos.length - 1);
  const selected = photos[state.selectedPhotoIndex] || photos[0];

  elements.photoGalleryPanel.innerHTML = `
    <div class="image-gallery is-loading" data-image-gallery>
      <a class="gallery-preview evidence-preview-box" href="${escapeHtml(selected.url)}" target="_blank" rel="noopener noreferrer" aria-label="Open selected image">
        <img class="gallery-preview-image" src="${escapeHtml(selected.url)}" alt="${escapeHtml(selected.alt)}">
        <span class="gallery-loading">Loading image...</span>
      </a>
      <div class="gallery-caption">
        <strong>${escapeHtml(selected.label)}</strong>
        <span>${escapeHtml(selected.fileName || "Uploaded image")} | ${escapeHtml(selected.uploadedBy)} | ${escapeHtml(formatDate(selected.uploadedAt))}</span>
      </div>
    </div>
  `;

  window.requestAnimationFrame(() => {
    const previewImage = elements.photoGalleryPanel?.querySelector(".gallery-preview-image");
    if (previewImage?.complete) {
      previewImage.closest("[data-image-gallery]")?.classList.remove("is-loading");
    }
  });
}

function isSupportedImageFile(file) {
  if (!file) return false;
  const lowerName = String(file.name || "").toLowerCase();
  const allowedExtension = /\.(jpg|jpeg|png|webp)$/i.test(lowerName);
  const allowedMime = !file.type || /^image\/(jpeg|png|webp)$/i.test(file.type);
  return allowedExtension && allowedMime;
}

function setPhotoCardBusy(row, isBusy, fileName = "") {
  if (!row) return;
  row.classList.toggle("is-uploading", Boolean(isBusy));
  const label = row.querySelector("[data-photo-file-name], [data-asset-photo-status]");
  if (label) {
    label.textContent = isBusy ? `Uploading ${fileName || "image"}...` : (fileName || label.textContent);
  }
}

function ensurePhotoUploadsAvailable() {
  if (state.viewOnly) {
    showNotice("Photo uploads are disabled in view mode.", "error");
    return false;
  }
  if (hasSavedIncident()) return true;
  showNotice("Save the dispatch draft before uploading photos.", "error");
  const saveButton = document.querySelector("#saveDraftButton");
  saveButton?.classList.add("needs-attention");
  saveButton?.scrollIntoView({ behavior: "smooth", block: "center" });
  window.clearTimeout(ensurePhotoUploadsAvailable.timer);
  ensurePhotoUploadsAvailable.timer = window.setTimeout(() => {
    saveButton?.classList.remove("needs-attention");
  }, 2200);
  return false;
}

function statusBadge(status) {
  return `<span class="status-badge status-${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

function renderIncidentRows() {
  if (!elements.incidentRows) return;
  elements.incidentRows.removeAttribute("aria-busy");
  if (!state.incidents.length) {
    elements.incidentRows.innerHTML = `<tr><td colspan="7" class="empty-row">No dispatches matched the current filters.</td></tr>`;
    return;
  }

  elements.incidentRows.innerHTML = state.incidents.map((incident) => `
    <tr data-incident-id="${incident.id}" class="${Number(state.selectedIncidentId) === Number(incident.id) ? "is-selected" : ""}">
      <td>${escapeHtml(incident.RegNo || "-")}</td>
      <td>${escapeHtml(incident.Company || "-")}</td>
      <td>${escapeHtml(canonicalDispatchTeamName(incident.DispatchTeam) || "-")}</td>
      <td>${statusBadge(incident.Status)}</td>
      <td>${escapeHtml(incident.SubmittedByDisplayName || incident.SubmittedBy || "-")}</td>
      <td>${escapeHtml(formatDate(incident.UpdatedAt || incident.CreatedAt))}</td>
      <td>${escapeHtml(incident.IncidentNumber || "-")}</td>
    </tr>
  `).join("");
}

function renderApprovalRows() {
  if (!elements.approvalRows) return;
  if (!state.pendingApprovals.length) {
    elements.approvalRows.innerHTML = `<tr><td colspan="5" class="empty-row">No pending approvals.</td></tr>`;
    return;
  }
  elements.approvalRows.innerHTML = state.pendingApprovals.map((incident) => `
    <tr data-incident-id="${incident.id}" class="${incident.Status === "Rejected" ? "needs-revision" : ""}">
      <td><strong>${escapeHtml(incident.RegNo || "-")}</strong>${incident.QueueType === "Closure" ? `<br><small class="revision-label">Closure review</small>` : (incident.Status === "Rejected" ? `<br><small class="revision-label">Needs revision</small>` : "")}</td>
      <td>${escapeHtml(incident.Event || "-")}</td>
      <td>${escapeHtml(incident.Company || "-")}</td>
      <td>${escapeHtml(formatDate(incident.RequestedAt || incident.CreatedAt))}</td>
      <td>${escapeHtml(incident.QueueType === "Closure"
        ? (incident.RequestedBy || incident.CreatedByDisplayName || incident.CreatedBy || "-")
        : (incident.LastHandoverToDisplayName || incident.LastHandoverToUsername || incident.CreatedByDisplayName || incident.CreatedBy || "-"))}</td>
    </tr>
  `).join("");
}

function renderCompletedRows() {
  if (!elements.completedRows) return;
  const filteredIncidents = getFilteredCompletedIncidents();
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(filteredIncidents.length / pageSize));
  state.completedPage = Math.min(Math.max(0, state.completedPage), pageCount - 1);
  const startIndex = state.completedPage * pageSize;
  const visibleIncidents = filteredIncidents.slice(startIndex, startIndex + pageSize);
  if (elements.completedCountLabel) {
    const count = filteredIncidents.length;
    const rangeStart = count ? startIndex + 1 : 0;
    const rangeEnd = startIndex + visibleIncidents.length;
    elements.completedCountLabel.textContent = count
      ? `${rangeStart}–${rangeEnd} of ${count} ${count === 1 ? "dispatch" : "dispatches"}`
      : "0 dispatches";
  }
  if (elements.completedPreviousPage) elements.completedPreviousPage.disabled = state.completedPage === 0;
  if (elements.completedNextPage) elements.completedNextPage.disabled = state.completedPage >= pageCount - 1;
  if (!visibleIncidents.length) {
    elements.completedRows.innerHTML = `<tr><td colspan="8" class="empty-row">No completed dispatches matched the filters.</td></tr>`;
    return;
  }
  elements.completedRows.innerHTML = visibleIncidents.map((incident) => {
    const mstrackRegistrationExists = incident.MSTrackRegistrationExists === true
      || incident.MSTrackRegistrationExists === 1
      || String(incident.MSTrackRegistrationExists).toLowerCase() === "true";
    const historyUnavailable = isTrueFlag(incident.VehicleHistoryUnavailable);
    const mstrackUnavailableTitle = historyUnavailable
      ? `Vehicle history is not applicable because this was recorded as a non-Pulsit unit. Reason: ${incident.VehicleHistoryUnavailableReason || "Not supplied"}`
      : "Registration not found on MSTrack. Pull the history from the relevant system.";
    const historyUnavailableLabel = historyUnavailable ? "History not applicable — non-Pulsit" : "MSTrack History Unavailable";
    return `
    <tr data-incident-id="${incident.id}">
      <td>${escapeHtml(incident.RegNo || "-")}</td>
      <td>${escapeHtml(incident.Company || "-")}</td>
      <td>${escapeHtml(canonicalDispatchTeamName(incident.DispatchTeam) || "-")}</td>
      <td>${statusBadge(incident.Status)}</td>
      <td>${escapeHtml(incident.SubmittedByDisplayName || incident.SubmittedBy || "-")}</td>
      <td>${escapeHtml(formatDate(incident.UpdatedAt || incident.CreatedAt))}</td>
      <td>${escapeHtml(incident.zoho_ob || "-")}</td>
      <td class="completed-report-cell">
        <div class="completed-report-actions">
          ${incident.TeamIncidentReportDownloadUrl ? `
          <a class="completed-report-button" href="${escapeHtml(incident.TeamIncidentReportDownloadUrl)}" data-report-download data-async-report-download data-download-filename="${escapeHtml(incident.TeamIncidentReportName || `Ground-Team-Incident-Report-${incident.id}.pdf`)}" download title="Download Ground Team Incident Report" aria-label="Download Ground Team Incident Report for ${escapeHtml(incident.RegNo || incident.IncidentNumber || "dispatch")}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path></svg>
            <span>Download Ground Team Report</span>
          </a>` : `
          <button class="completed-report-button is-disabled is-awaiting-report" type="button" disabled title="Awaiting Ground Team Incident" aria-label="Awaiting Ground Team Incident">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path></svg>
            <span>Awaiting Ground Team Incident</span>
          </button>`}
          <a class="completed-report-button" href="${escapeHtml(`${apiBase}/generate_incident_report.sql?incidentId=${encodeURIComponent(incident.id)}`)}" data-report-download data-async-report-download data-download-filename="${escapeHtml(incidentReportDownloadFileName(incident))}" download title="Download Incident Report" aria-label="Download Incident Report for ${escapeHtml(incident.RegNo || incident.IncidentNumber || "dispatch")}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path></svg>
            <span>Download Incident Report</span>
          </a>
          <a class="completed-report-button" href="${escapeHtml(`${apiBase}/generate_communication_log_report.sql?incidentId=${encodeURIComponent(incident.id)}`)}" data-report-download data-async-report-download data-download-filename="${escapeHtml(communicationReportDownloadFileName(incident))}" download title="Download Communication Log Report" aria-label="Download Communication Log Report for ${escapeHtml(incident.RegNo || incident.IncidentNumber || "dispatch")}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path></svg>
            <span>Download Communication Log Report</span>
          </a>
          ${mstrackRegistrationExists ? `<a class="completed-report-button" href="${escapeHtml(`${api.bisHistory}?incidentId=${encodeURIComponent(incident.id)}&format=xls`)}" data-report-download data-async-report-download data-download-filename="${escapeHtml(`${incident.RegNo || incident.IncidentNumber || "Dispatch"} - History Report.xls`)}" download title="Download MSTrack History Excel" aria-label="Download MSTrack History Excel for ${escapeHtml(incident.RegNo || incident.IncidentNumber || "dispatch")}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path></svg>
            <span>Download MSTrack History Excel</span>
          </a>` : `<button class="completed-report-button is-disabled is-awaiting-report" type="button" disabled title="${escapeHtml(mstrackUnavailableTitle)}" aria-label="MSTrack History Excel unavailable for ${escapeHtml(incident.RegNo || incident.IncidentNumber || "dispatch")}. ${escapeHtml(mstrackUnavailableTitle)}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path></svg>
            <span>${escapeHtml(historyUnavailableLabel)}</span>
          </button>`}
          ${mstrackRegistrationExists ? `<a class="completed-report-button" href="${escapeHtml(`${api.bisHistory}?incidentId=${encodeURIComponent(incident.id)}&format=pdf`)}" data-report-download data-async-report-download data-download-filename="${escapeHtml(`${incident.RegNo || incident.IncidentNumber || "Dispatch"} - History Report.pdf`)}" download title="Download MSTrack History PDF" aria-label="Download MSTrack History PDF for ${escapeHtml(incident.RegNo || incident.IncidentNumber || "dispatch")}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path></svg>
            <span>Download MSTrack History PDF</span>
          </a>` : `<button class="completed-report-button is-disabled is-awaiting-report" type="button" disabled title="${escapeHtml(mstrackUnavailableTitle)}" aria-label="MSTrack History PDF unavailable for ${escapeHtml(incident.RegNo || incident.IncidentNumber || "dispatch")}. ${escapeHtml(mstrackUnavailableTitle)}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path></svg>
            <span>${escapeHtml(historyUnavailableLabel)}</span>
          </button>`}
        </div>
      </td>
    </tr>
  `;
  }).join("");
}

function getFilteredCancelledIncidents() {
  const formData = elements.cancelledFilters ? new FormData(elements.cancelledFilters) : new FormData();
  const search = String(formData.get("search") || "").trim().toLowerCase();
  const cancelledFrom = getDateOnlyTime(formData.get("cancelledFrom"));
  const cancelledTo = getDateOnlyTime(formData.get("cancelledTo"), true);

  return state.cancelledIncidents.filter((incident) => {
    const searchable = [
      incident.IncidentNumber,
      incident.UnitId,
      incident.RegNo,
      incident.Company,
      incident.DispatchTeam,
      incident.CancellationReason,
      incident.CancelledByDisplayName,
      incident.CancelledBy
    ].filter(Boolean).join(" ").toLowerCase();
    const cancelledAt = new Date(incident.CancelledAt || incident.UpdatedAt || 0).getTime();
    return (!search || searchable.includes(search))
      && (!cancelledFrom || cancelledAt >= cancelledFrom)
      && (!cancelledTo || cancelledAt <= cancelledTo);
  });
}

function renderCancelledRows() {
  if (!elements.cancelledRows) return;
  const filteredIncidents = getFilteredCancelledIncidents();
  if (elements.cancelledCountLabel) {
    const count = filteredIncidents.length;
    elements.cancelledCountLabel.textContent = `${count} cancelled ${count === 1 ? "dispatch" : "dispatches"}`;
  }
  if (!filteredIncidents.length) {
    elements.cancelledRows.innerHTML = `<tr><td colspan="8" class="empty-row">No cancelled dispatches matched the filters.</td></tr>`;
    return;
  }
  elements.cancelledRows.innerHTML = filteredIncidents.map((incident) => `
    <tr data-incident-id="${incident.id}">
      <td>${escapeHtml(incident.RegNo || "-")}</td>
      <td>${escapeHtml(incident.Company || "-")}</td>
      <td>${escapeHtml(canonicalDispatchTeamName(incident.DispatchTeam) || "-")}</td>
      <td><strong>${escapeHtml(incident.IncidentNumber || "-")}</strong><br><small class="revision-label">${escapeHtml(incident.CancellationType || "Cancelled dispatch")}</small></td>
      <td class="cancelled-reason-cell">${escapeHtml(incident.CancellationReason || "No reason recorded")}</td>
      <td>${escapeHtml(incident.CancelledByDisplayName || incident.CancelledBy || incident.UpdatedBy || "-")}</td>
      <td>${escapeHtml(formatDate(incident.CancelledAt || incident.UpdatedAt))}</td>
      <td class="cancelled-action-cell">
        <button class="filter-button compact recover-dispatch-button" type="button" data-recover-dispatch="${incident.id}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10a8 8 0 1 1 2.3 5.7"></path><path d="M4 4v6h6"></path></svg>
          <span>Recover</span>
        </button>
      </td>
    </tr>
  `).join("");
}

function renderCancelledError(message) {
  if (!elements.cancelledRows) return;
  elements.cancelledRows.innerHTML = `<tr><td colspan="8" class="empty-row">${escapeHtml(message)}</td></tr>`;
}

function setRecoverDispatchConfirmationOpen(open, incidentId = null) {
  if (!elements.recoverDispatchConfirmOverlay) return;
  state.recoveryIncidentId = open ? Number(incidentId) : null;
  elements.recoverDispatchConfirmOverlay.hidden = !open;
  document.body.classList.toggle("eta-modal-open", open);
  if (open) window.requestAnimationFrame(() => elements.recoverDispatchConfirmAccept?.focus());
}

async function recoverCancelledDispatch() {
  const incidentId = Number(state.recoveryIncidentId);
  if (!Number.isInteger(incidentId) || incidentId <= 0) throw new Error("Select a cancelled dispatch to recover.");
  const result = await requestJson(api.recoverDispatch, {
    method: "POST",
    body: { incidentId }
  });
  if (result?.status !== "ok") {
    const messages = {
      unauthorized: "Your signed-in session is no longer active.",
      forbidden: "Only administrators can recover cancelled dispatches.",
      validation_error: "A valid cancelled dispatch is required.",
      not_found: "This dispatch is no longer available.",
      locked_status: "This dispatch is no longer cancelled."
    };
    throw new Error(messages[result?.status] || result?.message || "The dispatch could not be recovered.");
  }
  setRecoverDispatchConfirmationOpen(false);
  await Promise.all([loadCancelledIncidents(), loadIncidents()]);
  showNotice(`Dispatch recovered as ${result.dispatchStatus || "active"}.`);
}

function renderIncidentError(message) {
  if (!elements.incidentRows) return;
  elements.incidentRows.removeAttribute("aria-busy");
  elements.incidentRows.innerHTML = `<tr><td colspan="7" class="empty-row">${escapeHtml(message)}</td></tr>`;
}

function renderCompletedError(message) {
  if (!elements.completedRows) return;
  elements.completedRows.innerHTML = `<tr><td colspan="8" class="empty-row">${escapeHtml(message)}</td></tr>`;
}

function renderVesaError(message) {
  if (!elements.vesaRows) return;
  elements.vesaRows.innerHTML = `<tr><td colspan="4" class="empty-row">${escapeHtml(message)}</td></tr>`;
  if (elements.vesaCountLabel) elements.vesaCountLabel.textContent = "Unavailable";
  if (elements.vesaPreviousPage) elements.vesaPreviousPage.disabled = true;
  if (elements.vesaNextPage) elements.vesaNextPage.disabled = true;
}

function getFilteredVesaIncidents() {
  const filters = elements.vesaFilters ? new FormData(elements.vesaFilters) : new FormData();
  const search = String(filters.get("search") || "").trim().toLowerCase();
  const createdFrom = getDateOnlyTime(filters.get("createdFrom"));
  const createdTo = getDateOnlyTime(filters.get("createdTo"), true);
  return state.vesaIncidents.filter((incident) => {
    const searchable = [incident.RegNo, incident.Company, incident.OBNumber, incident.zoho_ob]
      .map((value) => String(value ?? "").toLowerCase()).join(" ");
    const created = new Date(String(incident.CreatedAt || "").replace(" ", "T")).getTime();
    return (!search || searchable.includes(search))
      && (!createdFrom || created >= createdFrom)
      && (!createdTo || created <= createdTo);
  });
}

function renderVesaRows() {
  if (!elements.vesaRows) return;
  const incidents = getFilteredVesaIncidents();
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(incidents.length / pageSize));
  state.vesaPage = Math.min(Math.max(0, state.vesaPage), pageCount - 1);
  const start = state.vesaPage * pageSize;
  const visible = incidents.slice(start, start + pageSize);
  if (elements.vesaCountLabel) {
    elements.vesaCountLabel.textContent = incidents.length
      ? `${start + 1}–${start + visible.length} of ${incidents.length} ${incidents.length === 1 ? "dispatch" : "dispatches"}`
      : "0 dispatches";
  }
  if (elements.vesaPreviousPage) elements.vesaPreviousPage.disabled = state.vesaPage === 0;
  if (elements.vesaNextPage) elements.vesaNextPage.disabled = state.vesaPage >= pageCount - 1;
  elements.vesaRows.innerHTML = visible.length ? visible.map((incident) => `
    <tr>
      <td>${escapeHtml(incident.RegNo || "-")}</td>
      <td>${escapeHtml(incident.Company || "-")}</td>
      <td>${escapeHtml(incident.OBNumber || "-")}</td>
      <td>${escapeHtml(incident.zoho_ob || "-")}</td>
    </tr>
  `).join("") : `<tr><td colspan="4" class="empty-row">No approved dispatches marked Hijacked or Stolen matched the filters.</td></tr>`;
}

function renderApprovalError(message) {
  if (!elements.approvalRows) return;
  elements.approvalRows.innerHTML = `<tr><td colspan="5" class="empty-row">${escapeHtml(message)}</td></tr>`;
}

function getDateOnlyTime(value, endOfDay = false) {
  if (!value) return null;
  const date = new Date(`${value}T${endOfDay ? "23:59:59" : "00:00:00"}`);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function getFilteredCompletedIncidents() {
  const formData = elements.completedFilters ? new FormData(elements.completedFilters) : new FormData();
  const search = String(formData.get("search") || "").trim().toLowerCase();
  const createdFrom = getDateOnlyTime(formData.get("createdFrom"));
  const createdTo = getDateOnlyTime(formData.get("createdTo"), true);

  return state.completedIncidents
    .filter((incident) => {
      const searchable = [
        incident.IncidentNumber,
        incident.Event,
        incident.UnitId,
        incident.RegNo,
        incident.Company,
        incident.SubmittedBy,
        incident.ApprovedBy
      ].map((value) => String(value || "").toLowerCase()).join(" ");
      const created = incident.CreatedAt ? new Date(String(incident.CreatedAt).replace(" ", "T")).getTime() : null;
      return (!search || searchable.includes(search))
        && (!createdFrom || (created && created >= createdFrom))
        && (!createdTo || (created && created <= createdTo));
    })
    .sort((left, right) => {
      const leftCreated = new Date(String(left.CreatedAt || "").replace(" ", "T")).getTime() || 0;
      const rightCreated = new Date(String(right.CreatedAt || "").replace(" ", "T")).getTime() || 0;
      return rightCreated - leftCreated || Number(right.id || 0) - Number(left.id || 0);
    });
}

function openDispatch(id, mode = "edit") {
  if (!id) return;
  const params = new URLSearchParams({ id: String(id) });
  if (mode === "view" || isCompletedDispatchViewer()) params.set("mode", "view");
  window.location.href = `dispatch.html?${params.toString()}`;
}

function hideRecordContextMenu() {
  if (!elements.recordContextMenu) return;
  elements.recordContextMenu.hidden = true;
  state.contextIncidentId = null;
}

function showRecordContextMenu(event, id) {
  if (!elements.recordContextMenu) return;
  event.preventDefault();
  state.contextIncidentId = id;
  elements.recordContextMenu.hidden = false;
  const menuRect = elements.recordContextMenu.getBoundingClientRect();
  const left = Math.min(event.clientX, window.innerWidth - menuRect.width - 12);
  const top = Math.min(event.clientY, window.innerHeight - menuRect.height - 12);
  elements.recordContextMenu.style.left = `${Math.max(12, left)}px`;
  elements.recordContextMenu.style.top = `${Math.max(12, top)}px`;
}

function renderValidationSummary(validation) {
  if (!elements.validationSummary) return;
  if (!validation) {
    elements.validationSummary.innerHTML = `<p class="empty-copy">Save or load a dispatch to see server-side validation results.</p>`;
    return;
  }
  if (validation.isValid) {
    elements.validationSummary.innerHTML = `<div class="validation-ok">Dispatch is complete enough to submit or approve.</div>`;
    return;
  }

  const missingFields = validation.missingFields || [];
  const missingPhotos = validation.missingPhotos || [];
  const fieldItems = missingFields.length
    ? `<div class="validation-problem"><strong>Missing fields</strong><ul class="validation-list">${missingFields.map((field) => `<li>${escapeHtml(field)}</li>`).join("")}</ul></div>`
    : "";
  const photoItems = missingPhotos.length
    ? `<div class="validation-problem"><strong>Missing photos / evidence</strong><ul class="validation-list">${missingPhotos.map((field) => `<li>${escapeHtml(photoLabels[field] || field)}</li>`).join("")}</ul></div>`
    : "";
  elements.validationSummary.innerHTML = `${fieldItems}${photoItems}`;
}

function clearInlineFieldErrors() {
  if (elements.notice) elements.notice.hidden = true;
  for (const errorElement of elements.form?.querySelectorAll("[data-field-error]") || []) {
    errorElement.hidden = true;
    errorElement.textContent = "";
  }
  for (const control of elements.form?.querySelectorAll("[aria-invalid='true']") || []) {
    control.removeAttribute("aria-invalid");
    if (control.closest("#communicationLogRows")) control.removeAttribute("title");
  }
  for (const row of elements.communicationLogRows?.querySelectorAll("tr.is-validation-error") || []) {
    row.classList.remove("is-validation-error");
    row.removeAttribute("title");
    row.querySelector(".communication-log-error-marker")?.remove();
  }
  updateDispatchSectionStatuses();
}

function communicationFieldNameFromMessage(message) {
  const text = String(message || "");
  if (/\bdate\b/i.test(text) && !/date and time/i.test(text)) return "communicationDate";
  if (/\btime\b/i.test(text)) return "communicationTime";
  if (/communication type/i.test(text)) return "communicationType";
  if (/control room agent/i.test(text)) return "communicationAgent";
  if (/email address/i.test(text)) return "communicationEmailAddress";
  return "";
}

function showCommunicationLogErrors(error) {
  if (!elements.communicationLogRows) return false;
  const suppliedErrors = Array.isArray(error?.details?.communicationErrors)
    ? error.details.communicationErrors
    : [];
  const parsedErrors = suppliedErrors.length ? suppliedErrors : (error?.details?.missingFields || [])
    .map((message) => {
      const match = String(message).match(/^Communication row\s+(\d+):\s*(.+)$/i);
      return match ? {
        rowNumber: Number(match[1]),
        fieldName: communicationFieldNameFromMessage(match[2]),
        message: String(message)
      } : null;
    })
    .filter(Boolean);
  if (!parsedErrors.length) return false;

  const rows = Array.from(elements.communicationLogRows.querySelectorAll("tr"));
  let firstInvalidControl = null;
  for (const item of parsedErrors) {
    const row = rows[Number(item.rowNumber) - 1];
    if (!row) continue;
    row.classList.add("is-validation-error");
    const existingMessages = row.title ? row.title.split("\n") : [];
    if (item.message && !existingMessages.includes(item.message)) {
      row.title = [...existingMessages, item.message].join("\n");
    }
    let marker = row.querySelector(".communication-log-error-marker");
    if (!marker) {
      marker = document.createElement("span");
      marker.className = "communication-log-error-marker";
      marker.textContent = "!";
      marker.setAttribute("aria-label", `Communication row ${item.rowNumber} has a validation error`);
      row.querySelector(".communication-log-row-actions")?.append(marker);
    }
    marker.title = row.title;
    const control = item.fieldName === "communicationTime"
      ? row.querySelector('[data-time-part="hour"]')
      : (item.fieldName ? row.querySelector(`[name="${item.fieldName}"]`) : null);
    if (control) {
      control.setAttribute("aria-invalid", "true");
      control.title = item.message || "This field is preventing the communication log from saving.";
      firstInvalidControl ||= control;
    }
  }

  const firstInvalidRow = elements.communicationLogRows.querySelector("tr.is-validation-error");
  const scrollTarget = firstInvalidControl || firstInvalidRow;
  const communicationSection = firstInvalidRow?.closest(".dispatch-section");
  if (communicationSection) setDispatchSectionExpanded(communicationSection, true);
  window.requestAnimationFrame(() => {
    scrollTarget?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    firstInvalidControl?.focus({ preventScroll: true });
  });
  return Boolean(firstInvalidRow);
}

function showCoordinateFormatError(message) {
  if (!/latitude\/longitude|latitude|longitude/i.test(String(message || ""))) return false;
  const displayMessage = "Incorrect format for Latitude/Longitude";
  const coordinateRules = { latitude: [-90, 90], longitude: [-180, 180] };
  const invalidFields = Object.entries(coordinateRules)
    .filter(([fieldName, [minimum, maximum]]) => {
      const rawValue = String(elements.form?.elements[fieldName]?.value || "").trim();
      if (!rawValue || /^N\/A$/i.test(rawValue)) return false;
      return !/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(rawValue)
        || Number(rawValue) < minimum
        || Number(rawValue) > maximum;
    })
    .map(([fieldName]) => fieldName);
  const fieldsToMark = invalidFields.length ? invalidFields : Object.keys(coordinateRules);
  for (const fieldName of fieldsToMark) {
    const control = elements.form?.elements[fieldName];
    const errorElement = elements.form?.querySelector(`[data-field-error="${fieldName}"]`);
    if (control) control.setAttribute("aria-invalid", "true");
    if (errorElement) {
      errorElement.hidden = false;
      errorElement.textContent = displayMessage;
    }
  }
  const firstInvalidControl = fieldsToMark
    .map((fieldName) => elements.form?.elements[fieldName])
    .find(Boolean);
  revealValidationControl(firstInvalidControl);
  return true;
}

function renderUploadList(detail) {
  if (!elements.photoUploadList) return;
  const uploadsEnabled = hasSavedIncident() && !state.viewOnly;
  const galleryItems = getPhotoGalleryItems(detail);
  const galleryIndexByPhotoId = new Map(galleryItems.map((photo, index) => [photo.id, index]));
  const photoCounts = new Map();
  const latestPhotos = getLatestPhotosByCategory(detail);
  const requiredCategories = getRequiredPhotoCategories();
  for (const photo of detail?.photos || []) {
    if (photo.AssetKey) continue;
    photoCounts.set(photo.PhotoCategory, (photoCounts.get(photo.PhotoCategory) || 0) + 1);
  }

  elements.photoUploadList.innerHTML = state.metadata.photoCategories.map((category) => `
    ${(() => {
      const latestPhoto = latestPhotos.get(category);
      const uploadedCount = photoCounts.get(category) || 0;
      const categoryLabel = escapeHtml(photoLabels[category] || category);
      const latestPhotoUrl = latestPhoto?.downloadUrl ? escapeHtml(downloadUrl(latestPhoto.downloadUrl)) : "";
      const latestPhotoFileName = escapeHtml(latestPhoto?.OriginalFileName || "No file chosen");
      const galleryIndex = latestPhoto ? galleryIndexByPhotoId.get(Number(latestPhoto.id)) : null;
      const isSelected = galleryIndex !== null && galleryIndex === state.selectedPhotoIndex;
      const helperCopy = uploadsEnabled
        ? (latestPhoto ? "Drag and drop or browse image" : "Drag and drop or browse image")
        : "Save the draft first to enable uploads";
      return `
    <div class="upload-item ${latestPhoto ? "has-image" : "is-empty"} ${isSelected ? "is-selected" : ""} ${requiredCategories.has(category) ? "is-required" : ""}" data-photo-category="${category}" ${galleryIndex !== null ? `data-upload-gallery-index="${galleryIndex}"` : ""}>
      <label class="photo-upload-shell" for="photo-file-${escapeHtml(category)}">
        <input class="photo-file" id="photo-file-${escapeHtml(category)}" type="file" accept="image/*,.jpg,.jpeg,.png,.webp" ${uploadsEnabled ? "" : "disabled"}>
        <div class="photo-upload-design ${uploadsEnabled ? "" : "is-locked"}" data-photo-dropzone tabindex="${state.viewOnly ? "-1" : "0"}" aria-disabled="${uploadsEnabled ? "false" : "true"}">
          ${latestPhotoUrl ? `<img class="photo-upload-preview" src="${latestPhotoUrl}" alt="${categoryLabel}">` : ""}
          <div class="photo-upload-topline">
            <span class="photo-name-pill">${categoryLabel}</span>
            <span class="photo-required-badge" aria-label="Compulsory" ${requiredCategories.has(category) ? "" : "hidden"}><strong>*</strong></span>
          </div>
          <div class="photo-upload-hover">
            <span class="photo-upload-edit">${latestPhoto ? "Edit image" : "Browse image"}</span>
            <small>${helperCopy}</small>
          </div>
          <div class="photo-upload-copy">
            ${latestPhoto ? "" : `
          <svg viewBox="0 0 640 512" aria-hidden="true">
            <path d="M144 480C64.5 480 0 415.5 0 336c0-62.8 40.2-116.2 96.2-135.9c-.1-2.7-.2-5.4-.2-8.1c0-88.4 71.6-160 160-160c59.3 0 111 32.2 138.7 80.2C409.9 102 428.3 96 448 96c53 0 96 43 96 96c0 12.2-2.3 23.8-6.4 34.6C596 238.4 640 290.1 640 352c0 70.7-57.3 128-128 128H144zm79-217c-9.4 9.4-9.4 24.6 0 33.9s24.6 9.4 33.9 0l39-39V392c0 13.3 10.7 24 24 24s24-10.7 24-24V257.9l39 39c9.4 9.4 24.6 9.4 33.9 0s9.4-24.6 0-33.9l-80-80c-9.4-9.4-24.6-9.4-33.9 0l-80 80z"></path>
          </svg>
            `}
            ${latestPhoto ? `
              <p>${categoryLabel}</p>
              <p>Browse image or drag a replacement</p>
              <span class="browse-button">${uploadsEnabled ? "Swap image" : "Save draft first"}</span>
            ` : ""}
            ${latestPhoto ? `<small data-photo-file-name>${latestPhotoFileName}</small>` : ""}
          </div>
        </div>
      </label>
    </div>
  `;
    })()}
  `).join("");

  updateDispatchSectionStatuses();
  window.requestAnimationFrame(updatePhotoChecklistScrollButtons);
}

function renderDetailPanel() {
  renderAdditionalAssetPhotos(state.selectedIncidentDetail);
  if (!elements.detailPanel) {
    renderValidationSummary(state.selectedIncidentDetail?.validation || null);
    renderPhotoGallery(state.selectedIncidentDetail);
    renderUploadList(state.selectedIncidentDetail);
    renderHistoryUploadControls(state.selectedIncidentDetail);
    return;
  }

  const detail = state.selectedIncidentDetail;
  if (!detail) {
    elements.detailPanel.innerHTML = `<p class="empty-copy">Select an incident to view its full detail.</p>`;
    renderValidationSummary(null);
    renderPhotoGallery(null);
    renderUploadList(null);
    renderHistoryUploadControls(null);
    return;
  }

  const incident = detail.incident;
  elements.detailPanel.innerHTML = `
    <section class="detail-summary">
      <div class="detail-fact"><span>Incident</span><strong>${escapeHtml(incident.IncidentNumber || "-")}</strong></div>
      <div class="detail-fact"><span>Status</span><strong>${statusBadge(incident.Status)}</strong></div>
      <div class="detail-fact"><span>Zoho OB</span><strong>${escapeHtml(incident.zoho_ob || "Pending")}</strong></div>
      <div class="detail-fact"><span>Dispatch Team OB</span><strong>${escapeHtml(incident.dispatchMeta?.obNumber || "-")}</strong></div>
    </section>

    <section class="detail-block">
      <h3>Incident Data</h3>
      <div class="detail-grid">
        <p><span>Incident Type</span><br><strong>${escapeHtml(incident.Event || "-")}</strong></p>
        <p><span>Incident date/time</span><br><strong>${escapeHtml(formatDate(incident.EventDateTime))}</strong></p>
        <p><span>Unit ID</span><br><strong>${escapeHtml(incident.UnitId || "-")}</strong></p>
        <p><span>Registration</span><br><strong>${escapeHtml(incident.RegNo || "-")}</strong></p>
        <p><span>Company</span><br><strong>${escapeHtml(incident.Company || "-")}</strong></p>
        <p><span>Make</span><br><strong>${escapeHtml(incident.dispatchMeta?.vehicleMake || "-")}</strong></p>
        <p><span>Model</span><br><strong>${escapeHtml(incident.dispatchMeta?.vehicleModel || "-")}</strong></p>
        <p><span>Vehicle colour</span><br><strong>${escapeHtml(incident.dispatchMeta?.vehicleColour || "-")}</strong></p>
        <p><span>Markings/Branding</span><br><strong>${escapeHtml(incident.dispatchMeta?.vehicleBranding || "-")}</strong></p>
        <p><span>Trailer type</span><br><strong>${escapeHtml(incident.dispatchMeta?.trailerType || "-")}</strong></p>
        <p><span>Trailer markings/branding</span><br><strong>${escapeHtml(incident.dispatchMeta?.trailerBranding || "-")}</strong></p>
        ${(incident.additionalAssets || []).map((asset, index) => `
          <p class="wide"><span>Asset ${index + 2}</span><br><strong>${escapeHtml(asset.regNo || asset.trailerRegistration1 || asset.trailerRegistration2 || "-")}</strong></p>
          <p><span>Trailer regs</span><br><strong>${escapeHtml([asset.trailerRegistration1, asset.trailerRegistration2].filter(Boolean).join(" / ") || "-")}</strong></p>
          <p><span>Vehicle details</span><br><strong>${escapeHtml([asset.vehicleMake, asset.vehicleModel, asset.vehicleColour, asset.vehicleBranding].filter(Boolean).join(" / ") || "-")}</strong></p>
          <p><span>Trailer details</span><br><strong>${escapeHtml([asset.trailerType, asset.trailerBranding].filter(Boolean).join(" / ") || "-")}</strong></p>
          <p><span>No visible damages</span><br><strong>${asset.noVisibleDamages ? "Yes" : "No"}</strong></p>
        `).join("")}
        <p><span>Risk reference</span><br><strong>${escapeHtml(incident.RiskEventReference || "-")}</strong></p>
        <p><span>Driver</span><br><strong>${escapeHtml(incident.DriverName || "-")}</strong></p>
        <p><span>Driver contact</span><br><strong>${escapeHtml(incident.DriverContactNumber || "-")}</strong></p>
      </div>
    </section>

    <section class="detail-block">
      <h3>Dispatch Notes</h3>
      <p><strong>Reason:</strong> ${escapeHtml(incident.DispatchReason || "-")}</p>
      ${incident.ActualDispatchReason ? `<p><strong>Actual Reason for dispatch:</strong> ${escapeHtml(incident.ActualDispatchReason)}</p>` : ""}
      ${incident.PositiveVESA ? `<p><strong>Positive VESA:</strong> ${escapeHtml(incident.PositiveVESA)}</p>` : ""}
      <p class="muted-line"><strong>Operator notes:</strong> ${escapeHtml(incident.operatorNotesText || "-")}</p>
      <p class="muted-line"><strong>Flags:</strong> Trailer ${incident.dispatchMeta?.trailerApplicable ? "Yes" : "No"} | Stock ${incident.dispatchMeta?.stockApplicable ? "Yes" : "No"} | No visible damages ${incident.dispatchMeta?.noVisibleDamages ? "Yes" : "No"}</p>
      <p class="muted-line"><strong>Damage notes:</strong> ${escapeHtml(incident.dispatchMeta?.damageNotes || "-")}</p>
      ${incident.ApprovalComments ? `<p class="muted-line"><strong>Approval comments:</strong> ${escapeHtml(incident.ApprovalComments)}</p>` : ""}
      ${incident.RejectionReason ? `<p class="muted-line"><strong>Rejection reason:</strong> ${escapeHtml(incident.RejectionReason)}</p>` : ""}
    </section>

    ${isTrueFlag(incident.VehicleHistoryUnavailable) ? `
      <section class="detail-block">
        <h3>Vehicle History Exception</h3>
        <p><strong>Non-Pulsit unit — no vehicle history available</strong></p>
        <p class="muted-line"><strong>Reason:</strong> ${escapeHtml(incident.VehicleHistoryUnavailableReason || "-")}</p>
        <p class="muted-line"><strong>Recorded by:</strong> ${escapeHtml(incident.VehicleHistoryUnavailableBy || "-")} | ${escapeHtml(formatDate(incident.VehicleHistoryUnavailableAt))}</p>
      </section>
    ` : ""}

    <section class="detail-block">
      <h3>Uploaded Photos</h3>
      <div class="attachment-list">
        ${(detail.photos || []).length ? detail.photos.map((photo) => `
            <a href="${escapeHtml(downloadUrl(photo.downloadUrl))}" target="_blank" rel="noopener noreferrer">
            <strong>${escapeHtml(`${photo.AssetKey ? `Asset ${(incident.additionalAssets || []).findIndex((asset) => String(asset.key || "").toLowerCase() === String(photo.AssetKey).toLowerCase()) + 2}: ` : ""}${photoLabels[photo.PhotoCategory] || photo.PhotoCategory}`)}</strong><br>
            <small>${escapeHtml(photo.OriginalFileName)} | ${escapeHtml(photo.UploadedBy || "-")} | ${escapeHtml(formatDate(photo.UploadedAt))}</small>
          </a>
        `).join("") : `<p class="empty-copy">No photos uploaded yet.</p>`}
      </div>
    </section>

    ${["Closed", "Approved"].includes(incident.DispatchStatus) || incident.Status === "Approved" ? renderBisHistory(detail.bisHistory) : ""}

    <section class="detail-block">
      <h3>Audit Trail</h3>
      <div class="audit-list">
        ${(detail.audit || []).length ? detail.audit.map((item) => `
          <article>
            <strong>${escapeHtml(item.AuditAction)}</strong><br>
            <small>${escapeHtml(formatDate(item.CreatedAt))} | ${escapeHtml(item.AuditUsername || "-")}</small>
            <p>${escapeHtml(item.AuditMessage || "-")}</p>
            ${item.FieldName ? `
              <div class="audit-change">
                <span><b>Before</b>${escapeHtml(formatAuditValue(item.OldValue))}</span>
                <span><b>After</b>${escapeHtml(formatAuditValue(item.NewValue))}</span>
              </div>
            ` : ""}
          </article>
        `).join("") : `<p class="empty-copy">No audit entries yet.</p>`}
      </div>
    </section>
  `;

  renderValidationSummary(detail.validation);
  renderPhotoGallery(detail);
  renderUploadList(detail);
  renderHistoryUploadControls(detail);
  syncViewOnlyMode();
}

function renderBisHistory(history) {
  if (history?.error) return `<section class="detail-block"><h3>MSTrack History</h3><p class="empty-copy">MSTrack history could not be loaded: ${escapeHtml(history.error)}</p></section>`;
  if (!history?.configured) return `<section class="detail-block"><h3>MSTrack History</h3><p class="empty-copy">MSTrack history connector is not configured.</p></section>`;
  const rows = Array.isArray(history.rows) ? history.rows : [];
  const columns = ["DateTime", "Event", "Ignition", "Speed", "Location", "VehicleVoltage", "UnitVoltage", "Odometer"];
  return `<section class="detail-block"><h3>MSTrack History (last ${escapeHtml(String(history.hours || 24))} hours)</h3>
    ${rows.length ? `<div class="table-scroll"><table><thead><tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(row[column] == null ? "-" : String(row[column]))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : `<p class="empty-copy">No History</p>`}
  </section>`;
}

function syncViewOnlyMode() {
  syncCompletedViewerAccess();
  const dispatchStatus = state.selectedIncidentDetail?.incident?.DispatchStatus;
  const operationallyLocked = ["Closed", "Cancelled"].includes(dispatchStatus);
  if (!elements.form || (!state.viewOnly && !operationallyLocked)) return;
  elements.form.querySelector("[data-incident-notes-editor]")?.setAttribute("contenteditable", "false");
  for (const control of elements.form.elements) {
    control.disabled = true;
  }
  for (const trigger of elements.form.querySelectorAll("[data-communication-agent-trigger]")) {
    trigger.disabled = true;
  }
  closeAllCommunicationAgentSelects();
  for (const control of document.querySelectorAll("#submitApprovalButton, #saveDraftButton, #cancelEntryButton, #cancelDispatchButton, #addCommunicationRowButton, #addTimelineRowButton, [data-drag-communication-row], [data-duplicate-communication-row], [data-remove-communication-row], [data-remove-timeline-row], [data-upload-photo], .photo-file, .photo-notes, #historyExcelFile, #historyPdfFile")) {
    control.disabled = true;
  }
  for (const dragHandle of document.querySelectorAll("[data-drag-communication-row]")) {
    dragHandle.draggable = false;
  }
  if (elements.formTitle?.textContent && !elements.formTitle.textContent.startsWith("View ")) {
    elements.formTitle.textContent = elements.formTitle.textContent.replace(/^Edit /, "View ");
  }
  if (elements.formSubtitle) {
    elements.formSubtitle.textContent = operationallyLocked
      ? `This dispatch is ${String(dispatchStatus).toLowerCase()} and is read-only.`
      : "Read-only view. Use Edit from the completed list context menu to make changes.";
  }
}

function syncEtaEditability(incident) {
  const etaField = elements.form?.elements.eta;
  if (!etaField) return;
  const locked = Boolean(state.viewOnly)
    || ["Closed", "Cancelled"].includes(incident?.DispatchStatus)
    || !["Draft", "Rejected", "PendingApproval"].includes(incident?.Status || "Draft");
  etaField.readOnly = locked;
  etaField.classList.toggle("is-captured-locked", locked);
  delete etaField.dataset.capturedLock;
  if (locked) {
    etaField.setAttribute("aria-readonly", "true");
    etaField.title = "This dispatch is read-only.";
  } else {
    etaField.removeAttribute("aria-readonly");
    etaField.title = "Enter a positive distance in km, for example 12.5.";
  }
}

function normalizeCapturedEta(value) {
  const text = String(value ?? "").trim();
  if (/^[1-9]\d*\.0+$/.test(text)) return text.slice(0, text.indexOf("."));
  return text;
}

function populateForm(detail) {
  if (!elements.form) return;
  setDraftUnsavedChanges(false);
  const incident = detail?.incident;
  if (elements.cancelEntryButton) {
    const canCancelEntry = Boolean(
      incident
      && incident.Status === "Draft"
      && !["Closed", "Cancelled"].includes(incident.DispatchStatus)
    );
    elements.cancelEntryButton.hidden = !canCancelEntry;
    elements.cancelEntryButton.disabled = !canCancelEntry;
  }
  if (elements.cancelDispatchButton) {
    const canCancelDispatch = Boolean(
      incident
      && !state.viewOnly
      && !["Closed", "Cancelled"].includes(incident.DispatchStatus)
    );
    elements.cancelDispatchButton.hidden = !canCancelDispatch;
    elements.cancelDispatchButton.disabled = !canCancelDispatch;
  }
  elements.form.reset();
  renderAdditionalAssets(incident ? (detail?.incident?.additionalAssets || []) : [], detail);
  setZohoAccountAutopopulatedLock(elements.form.elements.zohoAccount, false);
  syncEtaEditability(incident);
  setIncidentNotes("");
  const approvalNotesEditor = document.querySelector("[data-approval-notes-editor]");
  if (approvalNotesEditor) {
    approvalNotesEditor.innerHTML = sanitizeIncidentNotesHtml(
      incident?.ApprovalComments || incident?.RejectionReason || ""
    );
  }
  if (!incident) {
    setIncidentDateTimeControls("", true);
    setDateTimePairControls("dispatchDateTime", "", true);
    setDateTimePairControls("recoveryDateTime", "", true);
    setDateTimePairControls("standDownDateTime", "");
    elements.formTitle.textContent = "New Dispatch Report";
    elements.formSubtitle.textContent = "Capture the incident details, supporting evidence, and timeline below.";
    state.selectedPhotoIndex = 0;
    state.removedHistoryFileIds.clear();
    releaseVehicleLookupAutofill();
    registrationLookupRequestId += 1;
    window.clearTimeout(registrationLookupTimer);
    resetRegistrationLookup();
    renderCommunicationLog([]);
    renderIncidentTimeline([]);
    renderPhotoGallery(null);
    renderHistoryUploadControls(null);
    renderDispatchHandover(null);
    updateDispatchPresentation(null);
    return;
  }

  const mappings = {
    eventDateTime: incident.EventDateTime ? String(incident.EventDateTime).slice(0, 16) : "",
    event: incident.Event,
    eta: normalizeCapturedEta(incident.dispatchMeta?.eta),
    incidentNotesHtml: incident.dispatchMeta?.incidentNotesHtml || "",
    unitId: incident.UnitId,
    regNo: incident.RegNo,
    company: incident.Company,
    fleetCode: incident.FleetCode,
    stockNumberWrc: incident.dispatchMeta?.stockNumberWrc || "",
    trailerRegistration1: incident.TrailerRegistration1 || "",
    trailerRegistration2: incident.TrailerRegistration2 || "",
    zohoAccount: incident.zoho_account,
    geoLocation: incident.GeoLocation,
    latitude: incident.Latitude,
    longitude: incident.Longitude,
    vehicleMake: incident.dispatchMeta?.vehicleMake || "",
    vehicleModel: incident.dispatchMeta?.vehicleModel || "",
    vehicleColour: incident.dispatchMeta?.vehicleColour || "",
    vehicleBranding: incident.dispatchMeta?.vehicleBranding || "",
    trailerType: incident.dispatchMeta?.trailerType || "",
    trailerBranding: incident.dispatchMeta?.trailerBranding || "",
    clientName: incident.dispatchMeta?.clientName || "",
    clientContactNumber: incident.dispatchMeta?.clientContactNumber || "",
    clientPo: incident.dispatchMeta?.clientPo || "",
    dlNumber: incident.dispatchMeta?.dlNumber || "",
    dispatchTeam: canonicalDispatchTeamName(incident.dispatchMeta?.dispatchTeam),
    dispatchDateTime: incident.dispatchMeta?.dispatchDateTime || "",
    obNumber: incident.dispatchMeta?.obNumber || "",
    standDownDateTime: incident.dispatchMeta?.standDownDateTime || "",
    vehicleRecovered: incident.dispatchMeta?.vehicleRecovered || "",
    recoveryDateTime: incident.dispatchMeta?.recoveryDateTime || "",
    loadRecovered: incident.dispatchMeta?.loadRecovered || "",
    vehicleKeyAvailable: incident.dispatchMeta?.vehicleKeyAvailable || "",
    trailersRecovered: incident.dispatchMeta?.trailersRecovered || "",
    driverOnScene: incident.dispatchMeta?.driverOnScene || "",
    trackingUnitStatus: incident.dispatchMeta?.trackingUnitStatus || "",
    vehicleHistoryUnavailableReason: incident.VehicleHistoryUnavailableReason || "",
    driverName: incident.DriverName,
    driverContactNumber: incident.DriverContactNumber,
    groundTeamDetails: incident.GroundTeamDetails,
    dispatchReason: incident.DispatchReason,
    actualDispatchReason: incident.ActualDispatchReason || "",
    positiveVesa: incident.PositiveVESA || "",
    operatorNotesText: incident.operatorNotesText,
    damageNotes: incident.dispatchMeta?.damageNotes || ""
  };

  for (const [name, value] of Object.entries(mappings)) {
    if (elements.form.elements[name]) {
      elements.form.elements[name].value = value || "";
    }
  }
  setIncidentDateTimeControls(mappings.eventDateTime);
  setDateTimePairControls("dispatchDateTime", mappings.dispatchDateTime, true);
  setDateTimePairControls("recoveryDateTime", mappings.recoveryDateTime, true);
  setDateTimePairControls("standDownDateTime", mappings.standDownDateTime);
  setIncidentNotes(mappings.incidentNotesHtml);
  syncLoadedZohoAccountLock();

  if (elements.form.elements.trailerApplicable) {
    elements.form.elements.trailerApplicable.checked = Boolean(incident.dispatchMeta?.trailerApplicable);
  }
  if (elements.form.elements.stockApplicable) {
    elements.form.elements.stockApplicable.checked = Boolean(incident.dispatchMeta?.stockApplicable);
  }
  if (elements.form.elements.noVisibleDamages) {
    elements.form.elements.noVisibleDamages.checked = Boolean(incident.dispatchMeta?.noVisibleDamages);
  }
  if (elements.form.elements.vehicleHistoryUnavailable) {
    elements.form.elements.vehicleHistoryUnavailable.checked = isTrueFlag(incident.VehicleHistoryUnavailable);
  }
  syncVehicleHistoryExceptionControls(detail);
  releaseVehicleLookupAutofill();
  resetRegistrationLookup();
  renderCommunicationLog(detail.communications || []);
  renderIncidentTimeline(detail.timeline || []);
  renderDispatchHandover(detail);
  updateDispatchPresentation(detail);
  syncViewOnlyMode();
  updateConditionalCompulsoryFields();
  updateDispatchSectionStatuses();
  const isEtaRequestDraft = incident.Status === "Draft"
    && String(incident.SaveRequestId || "").startsWith("ETA_REQUEST_");
  if (isEtaRequestDraft && String(incident.RegNo || "").trim()) {
    scheduleDispatchRegistrationLookup();
  }
}

function getIncidentPayloadFromForm() {
  if (!elements.form) return {};
  // Build the submitted value from the visible controls at the last possible
  // moment. Date pickers and browser autofill do not always emit the same
  // sequence of input/change events, so the hidden combined field may
  // otherwise be stale even though the displayed date and time are valid.
  syncIncidentDateTimeValue();
  normalizeCoordinateNotAvailable(elements.form.elements.latitude);
  normalizeCoordinateNotAvailable(elements.form.elements.longitude);
  const formData = new FormData(elements.form);
  const eventDate = String(formData.get("eventDate") || "").trim();
  const eventHour = String(formData.get("eventHour") || "").trim();
  const eventMinute = String(formData.get("eventMinute") || "").trim();
  const eventDateTime = /^\d{4}-\d{2}-\d{2}$/.test(eventDate)
    && /^(?:[01]\d|2[0-3])$/.test(eventHour)
    && /^[0-5]\d$/.test(eventMinute)
      ? `${eventDate}T${eventHour}:${eventMinute}`
      : "";
  const communicationLog = readCommunicationLogRows();
  const incidentTimeline = readTimelineRows();
  const selectedZohoAccount = findZohoAccount(formData.get("zohoAccount"));
  return {
    eventDateTime,
    event: formData.get("event"),
    eta: formData.get("eta"),
    incidentNotesHtml: formData.get("incidentNotesHtml"),
    unitId: formData.get("unitId"),
    regNo: formData.get("regNo"),
    company: formData.get("company"),
    fleetCode: formData.get("fleetCode"),
    stockNumberWrc: formData.get("stockNumberWrc"),
    trailerRegistration1: formData.get("trailerRegistration1"),
    trailerRegistration2: formData.get("trailerRegistration2"),
    zohoAccount: selectedZohoAccount ? (selectedZohoAccount.label || selectedZohoAccount.value) : "",
    geoLocation: formData.get("geoLocation"),
    latitude: formData.get("latitude"),
    longitude: formData.get("longitude"),
    vehicleMake: formData.get("vehicleMake"),
    vehicleModel: formData.get("vehicleModel"),
    vehicleColour: formData.get("vehicleColour"),
    vehicleBranding: formData.get("vehicleBranding"),
    trailerType: formData.get("trailerType"),
    trailerBranding: formData.get("trailerBranding"),
    clientName: formData.get("clientName"),
    clientContactNumber: formData.get("clientContactNumber"),
    clientPo: formData.get("clientPo"),
    dlNumber: formData.get("dlNumber"),
    dispatchTeam: dispatchTeamApiName(formData.get("dispatchTeam")),
    dispatchDateTime: formData.get("dispatchDateTime"),
    obNumber: formData.get("obNumber"),
    standDownDateTime: formData.get("standDownDateTime"),
    vehicleRecovered: formData.get("vehicleRecovered"),
    recoveryDateTime: formData.get("recoveryDateTime"),
    loadRecovered: formData.get("loadRecovered"),
    vehicleKeyAvailable: formData.get("vehicleKeyAvailable"),
    trailersRecovered: formData.get("trailersRecovered"),
    driverOnScene: formData.get("driverOnScene"),
    trackingUnitStatus: formData.get("trackingUnitStatus"),
    vehicleHistoryUnavailable: Boolean(elements.form.elements.vehicleHistoryUnavailable?.checked),
    vehicleHistoryUnavailableReason: formData.get("vehicleHistoryUnavailableReason") || "",
    driverName: formData.get("driverName"),
    driverContactNumber: formData.get("driverContactNumber"),
    groundTeamDetails: formData.get("groundTeamDetails"),
    dispatchReason: formData.get("dispatchReason"),
    actualDispatchReason: String(formData.get("actualDispatchReason") || "").trim(),
    positiveVesa: String(formData.get("positiveVesa") || "").trim(),
    operatorNotesText: formData.get("operatorNotesText"),
    damageNotes: formData.get("damageNotes") || "",
    trailerApplicable: Boolean(elements.form.elements.trailerApplicable?.checked),
    stockApplicable: Boolean(elements.form.elements.stockApplicable?.checked),
    noVisibleDamages: Boolean(elements.form.elements.noVisibleDamages?.checked),
    additionalAssetsJson: JSON.stringify(readAdditionalAssets()),
    communicationLogJson: JSON.stringify(communicationLog.rows),
    deletedCommunicationLogIds: communicationLog.deletedIds.join(","),
    incidentTimelineJson: JSON.stringify(incidentTimeline.rows),
    deletedTimelineEntryIds: incidentTimeline.deletedIds.join(",")
  };
}

async function loadCurrentUser() {
  const authPayload = globalThis.dispatchAuthReady
    ? await globalThis.dispatchAuthReady
    : await requestJson(api.currentUser);
  const { authenticated, user } = authPayload || {};
  if (authenticated !== true || !user) {
    redirectToSignIn();
    return new Promise(() => {});
  }
  state.currentUser = applyStandardEtaProfile(user);
  if (isCompletedDispatchViewer()) state.viewOnly = true;
  if (state.currentUser.etaRole === "DispatchTeam") {
    window.location.replace("team-dispatches.html");
    return new Promise(() => {});
  }
  if ((elements.cancelledRows || elements.vesaRows) && !isDispatchAdmin()) {
    window.location.replace("index.html");
    return new Promise(() => {});
  }
  renderCurrentUser();
  syncSidebarAccess();
  syncCompletedViewerAccess();
}

async function loadEtaRequestSummary() {
  if (isCompletedDispatchViewer()) return;
  try {
    const summary = await requestJson(api.etaRequestSummary);
    const count = Number(summary?.actionCount || 0);
    for (const badge of document.querySelectorAll("[data-eta-request-count]")) {
      badge.textContent = String(count);
      badge.hidden = count <= 0;
    }
  } catch (error) {
    console.warn("ETA request summary could not be loaded:", error);
  }
}

function renderTicketNavCounts(stats = {}) {
  const counts = {
    active: Number(stats.openCount || 0) + Number(stats.inProgressCount || 0) + Number(stats.waitingCount || 0),
    helpdesk: Number(stats.helpdeskCount || 0),
    callcentre: Number(stats.callCentreCount || 0),
    tad: Number(stats.tadCount || 0),
    pulscam: Number(stats.pulscamCount || 0)
  };
  for (const [key, value] of Object.entries(counts)) {
    for (const badge of document.querySelectorAll(`[data-nav-count="${key}"]`)) {
      badge.textContent = String(value);
    }
  }
}

async function loadTicketNavCounts() {
  if (isCompletedDispatchViewer()) return;
  try {
    const payload = await requestJson(`${api.ticketSummary}?_=${Date.now()}`);
    renderTicketNavCounts(payload?.stats || {});
  } catch (error) {
    console.warn("Ticket navigation counts could not be loaded:", error);
  }
}

function configureSchemaCompatibleEndpoints(additionalAssetsEnabled) {
  const folder = additionalAssetsEnabled === false ? `${apiBase}/compat` : apiBase;
  api.saveIncident = `${folder}/save_incident.sql`;
  api.incidentDetail = `${folder}/dispatch_incident_detail.sql`;
  api.submitIncident = `${folder}/submit_incident.sql`;
  api.uploadPhoto = `${folder}/upload_photo.sql`;
}

async function loadMetadata() {
  const metadata = await requestJson(isCompletedDispatchViewer() ? `${apiBase}/dispatch_completed_metadata.sql` : api.metadata);
  state.metadata = {
    ...state.metadata,
    ...(metadata || {}),
    photoCategories: Array.isArray(metadata?.photoCategories) ? metadata.photoCategories : [],
    dispatchTeams: Array.isArray(metadata?.dispatchTeams) ? metadata.dispatchTeams : [],
    staffUsers: Array.isArray(metadata?.staffUsers) ? metadata.staffUsers : [],
    zohoAccounts: Array.isArray(metadata?.zohoAccounts) ? metadata.zohoAccounts : [],
    zohoAccountMappings: Array.isArray(metadata?.zohoAccountMappings) ? metadata.zohoAccountMappings : []
  };
  configureSchemaCompatibleEndpoints(state.metadata.additionalAssetsEnabled);
  renderDispatchTeamOptions();
  renderZohoAccountOptions();
  updateClientPoRequirement();
  renderDispatchHandover(state.selectedIncidentDetail);
  renderUploadList(state.selectedIncidentDetail);
}

async function loadTeamQuotas() {
  if (isCompletedDispatchViewer()) return;
  const quota = await requestJson(`${api.teamQuotas}?_=${Date.now()}`);
  state.metadata.teamQuotas = {
    periodLabel: String(quota?.periodLabel || ""),
    teams: Array.isArray(quota?.teams) ? quota.teams : []
  };
  renderTeamQuota();
  renderDispatchTeamOptions();
}

async function loadIncidents() {
  if (elements.incidentRows) {
    elements.incidentRows.setAttribute("aria-busy", "true");
    elements.incidentRows.innerHTML = `<tr><td colspan="7" class="empty-row"><span class="dispatch-list-loading" role="status"><span class="dispatch-list-spinner" aria-hidden="true"></span><span>Loading dispatches...</span></span></td></tr>`;
  }
  try {
    const params = new URLSearchParams();
    if (elements.filters) {
      const formData = new FormData(elements.filters);
      for (const [key, value] of formData.entries()) {
        if (String(value || "").trim()) params.set(key, value);
      }
      // The main register contains active editable work only. Pending approval
      // records live in the dedicated approval section.
      params.set("view", "active");
    }
    const response = await requestJson(`${api.incidents}?${params.toString()}`);
    state.incidents = (response.incidents || []).filter((incident) => {
      const status = String(incident.Status || "").trim().toLowerCase();
      const dispatchStatus = String(incident.DispatchStatus || "").trim().toLowerCase();
      return !["pendingapproval", "approved", "rejected"].includes(status)
        && !["closed", "cancelled"].includes(dispatchStatus);
    });
    state.summary = {
      ...(response.summary || state.summary),
      draftCount: state.incidents.length,
      activeDispatchCount: state.incidents.length,
      ...(state.approvalsLoaded ? { pendingCount: state.pendingApprovals.length } : {})
    };
    renderSummary();
    renderIncidentRows();
  } catch (error) {
    state.incidents = [];
    renderIncidentError(error.message);
    throw error;
  }
}

async function loadPendingApprovals() {
  try {
    const [approvalResponse, closureResponse] = await Promise.all([
      requestJson(api.pendingApprovals),
      state.currentUser?.isApprover && state.currentUser?.closureWorkflowEnabled === true
        ? requestJson(api.pendingClosures).then((response) => {
            if (response.status !== "ok") throw new Error("Closure reviews could not be loaded. Please contact an administrator.");
            return response;
          })
        : Promise.resolve({ incidents: [] })
    ]);
    const approvals = (approvalResponse.incidents || []).map((incident) => ({ ...incident, QueueType: "Initial" }));
    const closures = (closureResponse.incidents || []).map((incident) => ({ ...incident, QueueType: "Closure" }));
    state.pendingApprovals = [...closures, ...approvals];
    state.approvalsLoaded = true;
    state.summary.pendingCount = state.pendingApprovals.length;
    renderSummary();
    renderApprovalRows();
  } catch (error) {
    state.pendingApprovals = [];
    state.approvalsLoaded = false;
    renderApprovalError(error.message);
    throw error;
  }
}

async function loadCompletedIncidents() {
  if (!elements.completedRows) return;
  try {
    const response = await requestJson(`${api.incidents}?status=Approved`);
    state.completedIncidents = (response.incidents || []).filter((incident) => incident.DispatchStatus !== "Cancelled");
    if (isCompletedDispatchViewer()) {
      state.summary.approvedCount = state.completedIncidents.length;
      renderSummary();
    }
    renderCompletedRows();
  } catch (error) {
    state.completedIncidents = [];
    renderCompletedError(error.message);
    throw error;
  }
}

async function loadVesaIncidents() {
  if (!elements.vesaRows) return;
  try {
    const response = await requestJson(`${api.vesaIncidents}?_=${Date.now()}`);
    if (response?.status !== "ok") {
      throw new Error(response?.status === "forbidden"
        ? "You do not have access to VESA dispatches."
        : "Your signed-in session is no longer active.");
    }
    state.vesaIncidents = response.incidents || [];
    renderVesaRows();
  } catch (error) {
    state.vesaIncidents = [];
    renderVesaError(error.message);
    throw error;
  }
}

async function loadCancelledIncidents() {
  if (!elements.cancelledRows) return;
  try {
    const response = await requestJson(`${api.cancelledDispatches}?_=${Date.now()}`);
    if (response?.status !== "ok") {
      throw new Error(response?.status === "forbidden"
        ? "Only administrators can view cancelled dispatches."
        : "Your signed-in session is no longer active.");
    }
    state.cancelledIncidents = response.incidents || [];
    state.summary.cancelledDispatchCount = state.cancelledIncidents.length;
    renderSummary();
    renderCancelledRows();
  } catch (error) {
    state.cancelledIncidents = [];
    renderCancelledError(error.message);
    throw error;
  }
}

async function loadIncidentDetail(id) {
  const detailParams = new URLSearchParams({ dispatchId: String(id), _: String(Date.now()) });
  const [detail, auditResponse, phase2Response] = await Promise.all([
    requestJson(`${api.incidentDetail}?${detailParams.toString()}`),
    requestJson(`${api.incidentAudit}?${detailParams.toString()}`).catch(() => ({ audit: [] })),
    state.currentUser?.closureWorkflowEnabled === true
      ? requestJson(`${api.incidentPhase2Detail}?${detailParams.toString()}`)
      : Promise.resolve({ assignments: [], closureReviews: [], managerComments: [] })
  ]);
  detail.audit = auditResponse.audit || [];
  detail.assignments = phase2Response.assignments || [];
  detail.closureReviews = phase2Response.closureReviews || [];
  detail.managerComments = phase2Response.managerComments || [];
  state.selectedIncidentId = id;
  state.selectedIncidentDetail = detail;
  if (["Closed", "Approved"].includes(detail.incident?.DispatchStatus) || detail.incident?.Status === "Approved") {
    try {
      detail.bisHistory = await requestJson(`${api.bisHistory}?incidentId=${encodeURIComponent(String(id))}&format=json`);
    } catch (error) {
      detail.bisHistory = { configured: true, rows: [], count: 0, error: error.message };
    }
  }
  state.saveRequestId = null;
  state.selectedPhotoIndex = 0;
  state.removedHistoryFileIds.clear();
  state.removedTimelineEntryIds.clear();
  populateForm(detail);
  renderIncidentRows();
  renderDetailPanel();
}

async function saveDispatchHandover() {
  const incidentId = Number(state.selectedIncidentId || state.selectedIncidentDetail?.incident?.id || 0);
  const handoverDateTime = String(elements.handoverDateTime?.value || "").trim();
  const targetOperatorUsername = String(elements.handoverTargetOperator?.value || "").trim();
  if (!incidentId) throw new Error("Save the dispatch before adding a handover.");
  if (!handoverDateTime) throw new Error("Enter the handover date and time.");
  if (!targetOperatorUsername) throw new Error("Select the operator receiving the dispatch.");

  const result = await requestJson(api.saveHandover, {
    method: "POST",
    body: { incidentId, handoverDateTime, targetOperatorUsername }
  });
  if (result?.status !== "ok") {
    throw new Error(result?.message || "The dispatch handover could not be recorded.");
  }

  if (elements.handoverDateTime) elements.handoverDateTime.value = "";
  if (elements.handoverTargetOperator) elements.handoverTargetOperator.value = "";
  await loadIncidentDetail(incidentId);
  setHandoverStatus(result.message || "Dispatch handover recorded.", "success");
  showNotice(result.message || "Dispatch handover recorded.");
}

function saveIncident() {
  if (state.draftSavePromise) return state.draftSavePromise;
  if (!elements.form) return Promise.resolve();
  // Capture FormData before disabling controls; disabled inputs are omitted.
  const saving = persistIncident();
  const controls = Array.from(new Set([
    ...elements.form.querySelectorAll("input, select, textarea, button"),
    elements.saveDraftButton, elements.saveDraftIconButton, elements.submitApprovalButton
  ].filter(Boolean)));
  const disabledBeforeSave = controls.map((control) => control.disabled);
  const editors = Array.from(elements.form.querySelectorAll("[contenteditable]"));
  const editableBeforeSave = editors.map((editor) => editor.getAttribute("contenteditable"));
  const dragHandles = Array.from(elements.form.querySelectorAll("[draggable]"));
  const draggableBeforeSave = dragHandles.map((handle) => handle.draggable);
  const saveButtons = [elements.saveDraftButton, elements.saveDraftIconButton].filter(Boolean);
  const saveButtonAttributes = saveButtons.map((button) => ({
    title: button.getAttribute("title"),
    label: button.getAttribute("aria-label")
  }));
  for (const control of controls) control.disabled = true;
  for (const editor of editors) editor.setAttribute("contenteditable", "false");
  for (const handle of dragHandles) handle.draggable = false;
  for (const button of saveButtons) {
    button.classList.add("is-saving");
    button.setAttribute("aria-busy", "true");
    button.setAttribute("aria-label", "Saving draft");
    button.setAttribute("title", "Saving draft...");
  }
  elements.form.setAttribute("aria-busy", "true");
  state.draftSavePromise = saving.finally(() => {
    controls.forEach((control, index) => { control.disabled = disabledBeforeSave[index]; });
    editors.forEach((editor, index) => { editor.setAttribute("contenteditable", editableBeforeSave[index]); });
    dragHandles.forEach((handle, index) => { handle.draggable = draggableBeforeSave[index]; });
    saveButtons.forEach((button, index) => {
      button.classList.remove("is-saving");
      button.removeAttribute("aria-busy");
      const { title, label } = saveButtonAttributes[index];
      if (title === null) button.removeAttribute("title");
      else button.setAttribute("title", title);
      if (label === null) button.removeAttribute("aria-label");
      else button.setAttribute("aria-label", label);
    });
    elements.form.removeAttribute("aria-busy");
    state.draftSavePromise = null;
    syncViewOnlyMode();
  });
  return state.draftSavePromise;
}

async function saveCommunicationRow(incidentId, row, recoverOnly = false) {
  const control = Array.from(elements.communicationLogRows?.querySelectorAll("tr") || [])
    .find((candidate) => candidate.dataset.communicationRowKey === row.rowKey);
  const body = {
    incidentId, communicationId: row.id || "", displayOrder: row.displayOrder,
    communicationDate: row.communicationDate, communicationTime: row.communicationTime,
    communicationType: row.communicationType, controlRoomAgent: row.controlRoomAgent,
    contactPerson: row.contactPerson, contactNumber: row.contactNumber,
    emailAddress: row.emailAddress, communicationNotes: row.communicationNotes
  };
  const send = async (requestBody) => {
    const response = await requestJson(api.saveCommunication, { method: "POST", body: requestBody });
    if (response?.status !== "ok") throw new Error(response?.message || response?.status || "The communication log could not be saved.");
    const id = Number(response.communicationId);
    if (!Number.isInteger(id) || id <= 0) throw new Error("The communication save did not return a log ID. Retry Save to recover it.");
    row.id = id;
    body.communicationId = id;
    if (control) {
      control.dataset.communicationLogId = String(id);
      delete control.dataset.communicationPendingSave;
    }
  };
  if (!row.id) {
    // Keep the original create payload until acknowledged. If the response is
    // lost, recover that same insert before applying subsequent user edits.
    const pending = row.pendingSave || body;
    if (control) control.dataset.communicationPendingSave = JSON.stringify(pending);
    setDraftUnsavedChanges(true);
    await send(pending);
    if (recoverOnly) return;
    if (JSON.stringify({ ...pending, communicationId: row.id }) === JSON.stringify(body)) return;
  }
  await send(body);
}

async function persistIncident() {
  if (isCompletedDispatchViewer()) throw new Error("This profile has read-only access to completed dispatches.");
  if (!elements.form) return;
  const waitForSaveRequests = async (requests) => {
    const results = await Promise.allSettled(requests);
    const failure = results.find((result) => result.status === "rejected");
    if (failure) throw failure.reason;
  };
  const payload = getIncidentPayloadFromForm();
  const captureErrors = getDispatchCaptureFieldErrors(payload);
  if (captureErrors.length) {
    const error = new Error(captureErrors[0]);
    error.details = { isValid: false, missingFields: captureErrors, missingPhotos: [] };
    throw error;
  }
  if (state.metadata?.additionalAssetsEnabled === false && JSON.parse(payload.additionalAssetsJson).length) {
    throw new Error("Additional assets are not available in this environment. Keep this draft until additional assets are enabled.");
  }
  for (const [index, asset] of JSON.parse(payload.additionalAssetsJson).entries()) {
    if (!asset.regNo && !asset.trailerRegistration1 && !asset.trailerRegistration2) {
      throw new Error(`Asset ${index + 2}: enter a registration or trailer registration before saving.`);
    }
  }
  // The current database columns are decimal, so the API stores the supported
  // N/A choice as NULL. Remember the user's explicit choice while the saved
  // draft is reloaded so it does not appear to have been cleared.
  const latitudeNotAvailable = String(payload.latitude || "").trim().toUpperCase() === "N/A";
  const longitudeNotAvailable = String(payload.longitude || "").trim().toUpperCase() === "N/A";
  if (payload.clientPo && !/^\d+$/.test(payload.clientPo)) {
    throw new Error("Client PO may contain numbers only.");
  }
  const detail = state.selectedIncidentDetail;
  const id = detail?.incident?.id;
  const saveRequestId = id
    ? ""
    : (state.saveRequestId ||= globalThis.crypto?.randomUUID?.() || `dispatch-${Date.now()}-${Math.random()}`);
  const dispatchMetaJson = JSON.stringify({
    trailerApplicable: payload.trailerApplicable,
    eta: payload.eta,
    incidentNotesHtml: payload.incidentNotesHtml,
    stockApplicable: payload.stockApplicable,
    noVisibleDamages: payload.noVisibleDamages,
    damageNotes: payload.damageNotes,
    vehicleMake: payload.vehicleMake,
    vehicleModel: payload.vehicleModel,
    vehicleColour: payload.vehicleColour,
    vehicleBranding: payload.vehicleBranding,
    trailerType: payload.trailerType,
    trailerBranding: payload.trailerBranding,
    clientName: payload.clientName,
    clientContactNumber: payload.clientContactNumber,
    clientPo: payload.clientPo,
    dlNumber: payload.dlNumber,
    stockNumberWrc: payload.stockNumberWrc,
    dispatchTeam: payload.dispatchTeam,
    dispatchDateTime: payload.dispatchDateTime,
    obNumber: payload.obNumber,
    standDownDateTime: payload.standDownDateTime,
    vehicleRecovered: payload.vehicleRecovered,
    recoveryDateTime: payload.recoveryDateTime,
    loadRecovered: payload.loadRecovered,
    vehicleKeyAvailable: payload.vehicleKeyAvailable,
    trailersRecovered: payload.trailersRecovered,
    driverOnScene: payload.driverOnScene,
    trackingUnitStatus: payload.trackingUnitStatus
  });
  const {
    communicationLogJson,
    deletedCommunicationLogIds,
    incidentTimelineJson,
    deletedTimelineEntryIds,
    ...incidentPayload
  } = payload;
  const saveResponse = await requestJson(api.saveIncident, {
    method: "POST",
    body: {
      id: id || "",
      saveRequestId,
      dispatchMetaJson,
      ...incidentPayload
    }
  });
  const result = Array.isArray(saveResponse) ? saveResponse[0] : saveResponse;
  if (result?.status && result.status !== "ok") {
    const error = new Error(result.message || result.status);
    error.details = result.details || null;
    throw error;
  }
  if (!result?.id) throw new Error("Dispatch Link API did not return a saved dispatch ID.");
  const savedDispatchUrl = new URL(window.location.href);
  savedDispatchUrl.searchParams.set("id", String(result.id));
  savedDispatchUrl.hash = "";
  window.history.replaceState({}, "", savedDispatchUrl);
  // Keep the parent ID even if a later child save fails, including for a new draft.
  state.selectedIncidentId = result.id;
  state.selectedIncidentDetail = {
    ...state.selectedIncidentDetail,
    incident: { ...state.selectedIncidentDetail?.incident, id: result.id }
  };
  const communicationRows = JSON.parse(communicationLogJson || "[]");
  const deletedCommunicationIds = String(deletedCommunicationLogIds || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Number(value))
    .filter(Number.isInteger);
  await waitForSaveRequests(deletedCommunicationIds.map(async (communicationId) => {
    const deleteResult = await requestJson(api.deleteCommunication, {
      method: "POST",
      body: { incidentId: result.id, communicationId }
    });
    if (deleteResult?.status && deleteResult.status !== "ok") {
      throw new Error(deleteResult.message || deleteResult.status);
    }
  }));
  // Sequential requests prevent a failed row from releasing the save lock
  // while other log inserts are still running.
  const saveCommunicationRows = async (entries, recoverOnly = false) => {
    for (const [index, row] of entries) {
      try {
        await saveCommunicationRow(result.id, row, recoverOnly);
      } catch (cause) {
        const rowNumber = index + 1;
        const message = `Communication row ${rowNumber}: ${cause.message || "Could not be saved."}`;
        const error = new Error(message, { cause });
        error.details = {
          isValid: false,
          missingFields: [message],
          missingPhotos: [],
          communicationErrors: [{ rowNumber, fieldName: "", message }]
        };
        throw error;
      }
    }
  };
  // Recover lost acknowledgements at their original positions first. Then move
  // existing records before creating new rows, so inserting an identical row
  // ahead of an existing row does not accidentally reuse the existing ID.
  await saveCommunicationRows(Array.from(communicationRows.entries())
    .filter(([, row]) => !row.id && row.pendingSave), true);
  await saveCommunicationRows(Array.from(communicationRows.entries())
    .sort(([, left], [, right]) => Number(Boolean(right.id)) - Number(Boolean(left.id))));
  const timelineRows = JSON.parse(incidentTimelineJson || "[]");
  const deletedTimelineIds = String(deletedTimelineEntryIds || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Number(value))
    .filter(Number.isInteger);
  await waitForSaveRequests(deletedTimelineIds.map(async (timelineEntryId) => {
    const deleteResult = await requestJson(api.deleteTimelineEntry, {
      method: "POST",
      body: { incidentId: result.id, timelineEntryId }
    });
    if (deleteResult?.status && deleteResult.status !== "ok") {
      throw new Error(deleteResult.message || deleteResult.status);
    }
  }));
  await waitForSaveRequests(timelineRows.map(async (row) => {
    const timelineResult = await requestJson(api.saveTimelineEntry, {
      method: "POST",
      body: {
        incidentId: result.id,
        timelineEntryId: row.id || "",
        eventDateTime: row.eventDateTime,
        eventType: row.eventType,
        entryText: row.entryText
      }
    });
    if (timelineResult?.status && timelineResult.status !== "ok") {
      throw new Error(timelineResult.message || timelineResult.status);
    }
  }));
  showNotice(id ? "Dispatch draft updated." : "Dispatch draft created.");
  state.selectedIncidentId = result.id;
  state.selectedIncidentDetail = await requestJson(`${api.incidentDetail}?${new URLSearchParams({ dispatchId: String(result.id), _: String(Date.now()) }).toString()}`);
  populateForm(state.selectedIncidentDetail);
  if (latitudeNotAvailable && elements.form.elements.latitude) {
    elements.form.elements.latitude.value = "N/A";
  }
  if (longitudeNotAvailable && elements.form.elements.longitude) {
    elements.form.elements.longitude.value = "N/A";
  }
  updateDispatchSectionStatuses();
  renderDetailPanel();
  await waitForSaveRequests([loadIncidents(), loadPendingApprovals(), loadCompletedIncidents(), loadTeamQuotas()]);
  state.saveRequestId = null;
  clearStoredBrowserDraft();
}

async function submitSelectedIncident() {
  if (!elements.form) return;
  const id = state.selectedIncidentDetail?.incident?.id;
  if (!id) {
    throw new Error("Save the dispatch draft before submitting it for approval.");
  }
  const currentIncident = state.selectedIncidentDetail?.incident || {};
  if (currentIncident.Status === "Approved" && state.currentUser?.closureWorkflowEnabled !== true) {
    throw new Error("This dispatch has already been approved and moved to Completed.");
  }
  if (currentIncident.Status === "Approved" && currentIncident.DispatchStatus === "Stood Down") {
    const closingComments = sanitizeIncidentNotesHtml(document.querySelector("[data-approval-notes-editor]")?.innerHTML || "");
    if (!closingComments.trim()) throw new Error("Add closing comments before requesting closure review.");
    const closureResult = await requestJson(api.requestClosure, { method: "POST", body: { incidentId: id, closingComments } });
    if (closureResult?.status && closureResult.status !== "ok") throw new Error(closureResult.message || closureResult.status);
    showNotice("Closure submitted for manager review.");
    state.selectedIncidentDetail = await requestJson(`${api.incidentDetail}?${new URLSearchParams({ dispatchId: String(id), _: String(Date.now()) }).toString()}`);
    populateForm(state.selectedIncidentDetail);
    renderDetailPanel();
    await Promise.all([loadIncidents(), loadPendingApprovals(), loadCompletedIncidents()]);
    return;
  }
  // Browser date/time controls and restored drafts do not always emit input or
  // change events. Rebuild the hidden combined value immediately before
  // submission validation so visible valid values cannot be reported missing.
  syncIncidentDateTimeValue();
  normalizeCoordinateNotAvailable(elements.form.elements.latitude);
  normalizeCoordinateNotAvailable(elements.form.elements.longitude);
  const formData = new FormData(elements.form);
  const requiredForCompletion = [
    ["eventDateTime", "Incident date/time"],
    ["event", "Incident Type"],
    ["eta", "First ETA (Km)"],
    ["dispatchReason", "Department"],
    ["regNo", "Registration"],
    ["unitId", "Unit ID"],
    ["company", "Company"],
    ["geoLocation", "Geolocation"],
    ["latitude", "Latitude"],
    ["longitude", "Longitude"],
    ["clientName", "Client Name"],
    ["clientContactNumber", "Client Contact Number"],
    ["dispatchTeam", "Dispatch Team"],
    ["dispatchDateTime", "Dispatch DateTime"],
    ["obNumber", "Dispatch Team OB No"],
    ["standDownDateTime", "Stand Down DateTime"],
    ["vehicleRecovered", "Vehicle Recovered"],
    ["loadRecovered", "Load Recovered"],
    ["vehicleKeyAvailable", "Vehicle Key Available"],
    ["trailersRecovered", "Trailers Recovered"],
    ["driverOnScene", "Driver on Scene"],
    ["trackingUnitStatus", "Tracking Unit Status"]
  ];
  const missingFields = requiredForCompletion
    .filter(([name]) => !String(formData.get(name) || "").trim())
    .map(([, label]) => `${label} is required.`);
  missingFields.push(...getDispatchCaptureFieldErrors({
    actualDispatchReason: formData.get("actualDispatchReason"),
    positiveVesa: formData.get("positiveVesa")
  }, requiresDispatchCaptureFields(currentIncident)));
  const eta = String(formData.get("eta") || "").trim();
  if (eta && (!/^\d+(?:\.\d+)?$/.test(eta) || !Number.isFinite(Number(eta)) || Number(eta) <= 0)) {
    missingFields.push("First ETA (Km) must be a positive number, for example 12.5.");
  }
  for (const [name, label, minimum, maximum] of [
    ["latitude", "Latitude", -90, 90],
    ["longitude", "Longitude", -180, 180]
  ]) {
    const rawCoordinate = String(formData.get(name) || "").trim();
    if (!rawCoordinate || rawCoordinate.toUpperCase() === "N/A") continue;
    const coordinate = Number(rawCoordinate);
    if (!Number.isFinite(coordinate) || coordinate < minimum || coordinate > maximum) {
      missingFields.push(`${label} must be between ${minimum} and ${maximum}, or N/A.`);
    }
  }
  const zohoAccount = findZohoAccount(formData.get("zohoAccount"));
  if (!zohoAccount) missingFields.push("Zoho Account must match an available account.");
  if (clientPoIsRequired(zohoAccount, formData.get("event"))
    && !String(formData.get("clientPo") || "").trim()) {
    missingFields.push("Client PO is required for this Zoho Account and incident type.");
  }
  if (formData.get("driverOnScene") === "Yes") {
    if (!String(formData.get("driverName") || "").trim()) missingFields.push("Driver Name is required when the driver is on scene.");
    if (!String(formData.get("driverContactNumber") || "").trim()) missingFields.push("Driver Contact Number is required when the driver is on scene.");
  }
  if (formData.get("vehicleRecovered") === "Yes") {
    if (!String(formData.get("recoveryDateTime") || "").trim()) missingFields.push("Recovery DateTime is required when the vehicle is recovered.");
    if (!String(formData.get("vehicleMake") || "").trim()) missingFields.push("Make is required when the vehicle is recovered.");
    if (!String(formData.get("vehicleModel") || "").trim()) missingFields.push("Model is required when the vehicle is recovered.");
    if (!String(formData.get("vehicleColour") || "").trim()) missingFields.push("Vehicle Colour is required when the vehicle is recovered.");
    if (!String(formData.get("vehicleBranding") || "").trim()) missingFields.push("Markings/Branding is required when the vehicle is recovered.");
  }
  if (formData.get("trailersRecovered") === "Yes") {
    if (!String(formData.get("trailerRegistration1") || "").trim()) missingFields.push("Trailer Reg 1 is required when trailers are recovered.");
    if (!String(formData.get("trailerType") || "").trim()) missingFields.push("Trailer Type is required when trailers are recovered.");
    if (!String(formData.get("trailerBranding") || "").trim()) missingFields.push("Trailer Markings/Branding is required when trailers are recovered.");
  }
  for (const [index, asset] of readAdditionalAssets().entries()) {
    if (!asset.regNo && !asset.trailerRegistration1 && !asset.trailerRegistration2) {
      missingFields.push(`Asset ${index + 2}: enter a registration or trailer registration.`);
    }
    if (asset.regNo && formData.get("vehicleRecovered") === "Yes") {
      for (const field of ["vehicleMake", "vehicleModel", "vehicleColour", "vehicleBranding"]) {
        if (!asset[field]) missingFields.push(`Asset ${index + 2}: ${additionalAssetFields.find(([name]) => name === field)?.[1] || field} is required.`);
      }
    }
    if ((asset.trailerRegistration1 || asset.trailerRegistration2) && formData.get("trailersRecovered") === "Yes") {
      for (const field of ["trailerType", "trailerBranding"]) {
        if (!asset[field]) missingFields.push(`Asset ${index + 2}: ${additionalAssetFields.find(([name]) => name === field)?.[1] || field} is required.`);
      }
    }
  }
  const missingPhotos = getMissingRequiredPhotoCategories();
  let mstrackRegistrationExists = currentIncident.MSTrackRegistrationExists === true
    || currentIncident.MSTrackRegistrationExists === 1
    || String(currentIncident.MSTrackRegistrationExists).toLowerCase() === "true";
  const formRegistration = String(formData.get("regNo") || "").trim();
  const savedRegistration = String(currentIncident.RegNo || "").trim();
  if (formRegistration.localeCompare(savedRegistration, undefined, { sensitivity: "accent" }) !== 0) {
    const lookup = await loadRegistrationLookup(formRegistration);
    mstrackRegistrationExists = lookup?.exactFound === true
      || lookup?.exactFound === 1
      || String(lookup?.exactFound).toLowerCase() === "true";
  }
  if (!mstrackRegistrationExists) {
    const historyUnavailable = Boolean(elements.form.elements.vehicleHistoryUnavailable?.checked);
    const historyUnavailableReason = String(formData.get("vehicleHistoryUnavailableReason") || "").trim();
    if (historyUnavailable) {
      if (!historyUnavailableReason) missingFields.push("A reason is required when vehicle history is unavailable for a non-Pulsit unit.");
      if (String(formData.get("trackingUnitStatus") || "") !== "Not fitted with Pulsit Tracking") {
        missingFields.push('Tracking Unit Status must be "Not fitted with Pulsit Tracking" when vehicle history is unavailable.');
      }
    } else {
      if (!getLatestHistoryFile("HistoryExcel")) missingFields.push("History Excel is required because the registration was not found on MSTrack.");
      if (!getLatestHistoryFile("HistoryPdf")) missingFields.push("History PDF is required because the registration was not found on MSTrack.");
    }
  }
  if (missingFields.length || missingPhotos.length) {
    const error = new Error("Complete all compulsory dispatch fields and evidence before submitting.");
    error.details = { isValid: false, missingFields, missingPhotos };
    throw error;
  }
  const latitudeNotAvailable = String(formData.get("latitude") || "").trim().toUpperCase() === "N/A";
  const longitudeNotAvailable = String(formData.get("longitude") || "").trim().toUpperCase() === "N/A";
  // Submission changes the saved record, not the values currently visible in
  // the form. Persist valid edits first so an older incomplete draft cannot be
  // moved into the approval queue.
  if (state.hasUnsavedChanges) {
    await saveIncident();
  }
  const result = await requestJson(api.submitIncident, {
    method: "POST",
    body: {
      incidentId: id,
      latitudeNotAvailable: latitudeNotAvailable ? "1" : "0",
      longitudeNotAvailable: longitudeNotAvailable ? "1" : "0"
    }
  });
  if (result?.status && result.status !== "ok") throw new Error(result.message || result.status);
  showNotice("Dispatch submitted for approval.");
  state.selectedIncidentDetail = await requestJson(`${api.incidentDetail}?${new URLSearchParams({ dispatchId: String(id), _: String(Date.now()) }).toString()}`);
  populateForm(state.selectedIncidentDetail);
  renderDetailPanel();
  await Promise.all([loadIncidents(), loadPendingApprovals(), loadCompletedIncidents()]);
}

async function uploadPhoto(category, row, file, assetKey = "") {
  if (!elements.form) return;
  const id = state.selectedIncidentDetail?.incident?.id;
  if (!id) throw new Error("Create or load a draft dispatch before uploading photos.");
  if (!file) throw new Error("Select a photo file first.");
  if (!isSupportedImageFile(file)) {
    throw new Error("Photo must be a JPG, JPEG, PNG, or WEBP image.");
  }

  const body = new FormData();
  body.append("incidentId", String(id));
  body.append("photoCategory", category);
  body.append("assetKey", assetKey);
  body.append("file", file);

  setPhotoCardBusy(row, true, file.name);
  const result = await requestJson(api.uploadPhoto, {
    method: "POST",
    body
  });
  if (result?.status && result.status !== "ok") throw new Error(result.message || result.status);
  setPhotoCardBusy(row, false);
  showNotice(`${photoLabels[category] || category} uploaded${assetKey ? " for additional asset" : ""}.`);
  const detail = await requestJson(`${api.incidentDetail}?${new URLSearchParams({ dispatchId: String(id), _: String(Date.now()) }).toString()}`);
  state.selectedIncidentDetail = detail;
  const uploadedIndex = getPhotoGalleryItems(detail).findIndex((photo) => photo.category === category &&
    String((detail.photos || []).find((item) => Number(item.id) === photo.id)?.AssetKey || "").toLowerCase() === assetKey.toLowerCase());
  if (uploadedIndex >= 0) state.selectedPhotoIndex = uploadedIndex;
  renderDetailPanel();
}

async function queuePhotoUpload(fileInput, file) {
  const row = fileInput?.closest("[data-photo-category]");
  const category = row?.dataset.photoCategory;
  if (!row || !category) return;
  if (state.viewOnly || fileInput.disabled) return;
  try {
    syncPhotoUploadFileName(fileInput);
    await uploadPhoto(category, row, file);
  } catch (error) {
    setPhotoCardBusy(row, false, file.name || "");
    fileInput.value = "";
    syncPhotoUploadFileName(fileInput);
    throw error;
  }
  fileInput.value = "";
}

async function uploadHistoryFile(fileType, fileInput) {
  if (!elements.form) return;
  const id = state.selectedIncidentDetail?.incident?.id;
  if (!id) throw new Error("Create or load a draft dispatch before uploading history files.");
  const file = fileInput.files?.[0];
  if (!file) throw new Error("Select a file first.");
  const card = document.querySelector(`[data-history-file-type="${fileType}"]`);
  const status = card?.querySelector("[data-history-status]");
  card?.classList.add("is-uploading");
  if (status) {
    status.innerHTML = `<span class="document-upload-status-empty">Uploading ${escapeHtml(file.name)}...</span>`;
  }
  const body = new FormData();
  body.append("incidentId", String(id));
  body.append("fileType", fileType);
  body.append("file", file);
  try {
    const result = await requestJson(api.uploadFile, { method: "POST", body });
    if (result?.status && result.status !== "ok") throw new Error(result.message || result.status);
    showNotice(`${fileType === "HistoryExcel" ? "History Excel" : "History PDF"} uploaded.`);
    state.selectedIncidentDetail = await requestJson(`${api.incidentDetail}?${new URLSearchParams({ dispatchId: String(id), _: String(Date.now()) }).toString()}`);
    fileInput.value = "";
    syncDocumentFileName(fileInput);
    renderDetailPanel();
  } finally {
    card?.classList.remove("is-uploading");
  }
}

async function approveSelectedIncident() {
  const id = state.selectedIncidentDetail?.incident?.id;
  if (!id) throw new Error("Select a dispatch first.");
  const approvalComments = sanitizeIncidentNotesHtml(document.querySelector("[data-approval-notes-editor]")?.innerHTML || "");
  if (!document.querySelector("[data-approval-notes-editor]")?.textContent.trim()) {
    throw new Error("Add approval comments before completing the report.");
  }
  const closureReviewId = (state.selectedIncidentDetail?.closureReviews || [])
    .find((review) => String(review.ReviewStatus || review.Decision || "").toLowerCase() === "pending")?.id;
  const result = closureReviewId
    ? await requestJson(api.reviewClosure, { method: "POST", body: { closureReviewId, decision: "Approved", managerComments: approvalComments } })
    : await requestJson(api.approveIncident, { method: "POST", body: { incidentId: id, approvalComments } });
  if (result?.status && result.status !== "ok") throw new Error(result.message || result.status);
  showNotice(closureReviewId ? "Dispatch closure approved." : "Dispatch completed and moved to Completed.");
  state.selectedIncidentDetail = await requestJson(`${api.incidentDetail}?${new URLSearchParams({ dispatchId: String(id), _: String(Date.now()) }).toString()}`);
  populateForm(state.selectedIncidentDetail);
  renderDetailPanel();
  await Promise.all([loadIncidents(), loadPendingApprovals(), loadCompletedIncidents()]);
}

async function rejectSelectedIncident() {
  const id = state.selectedIncidentDetail?.incident?.id;
  if (!id) throw new Error("Select a dispatch first.");
  const approvalNotesEditor = document.querySelector("[data-approval-notes-editor]");
  const rejectionReason = sanitizeIncidentNotesHtml(approvalNotesEditor?.innerHTML || "");
  if (!approvalNotesEditor?.textContent.trim()) {
    throw new Error("Add comments explaining the required revision.");
  }
  const closureReviewId = (state.selectedIncidentDetail?.closureReviews || [])
    .find((review) => String(review.ReviewStatus || review.Decision || "").toLowerCase() === "pending")?.id;
  const result = closureReviewId
    ? await requestJson(api.reviewClosure, { method: "POST", body: { closureReviewId, decision: "Rejected", managerComments: rejectionReason, rejectionReason } })
    : await requestJson(api.rejectIncident, { method: "POST", body: { incidentId: id, rejectionReason } });
  if (result?.status && result.status !== "ok") throw new Error(result.status);
  showNotice(closureReviewId ? "Closure rejected and returned to Stood Down." : "Dispatch sent back to the operator for revision.");
  state.selectedIncidentDetail = await requestJson(`${api.incidentDetail}?${new URLSearchParams({ dispatchId: String(id), _: String(Date.now()) }).toString()}`);
  populateForm(state.selectedIncidentDetail);
  renderDetailPanel();
  await Promise.all([loadIncidents(), loadPendingApprovals(), loadCompletedIncidents()]);
}

function bindStaticEvents() {
  elements.handoverForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    setHandoverStatus("");
    if (elements.addHandoverButton) {
      elements.addHandoverButton.disabled = true;
      elements.addHandoverButton.textContent = "Adding…";
    }
    saveDispatchHandover()
      .catch((error) => setHandoverStatus(error.message, "error"))
      .finally(() => {
        if (elements.addHandoverButton) {
          elements.addHandoverButton.textContent = "Add handover";
          renderDispatchHandover(state.selectedIncidentDetail);
        }
      });
  });

  elements.themeToggle?.addEventListener("change", (event) => {
    setTheme(event.target.checked ? "dark" : "light");
  });

  elements.sidebarCollapseButton?.addEventListener("click", () => {
    setSidebarCollapsed(!elements.appShell.classList.contains("sidebar-collapsed"));
  });

  compactSidebarQuery.addEventListener("change", (event) => {
    if (event.matches) setSidebarCollapsed(true);
  });

  document.querySelector(".sidebar-nav")?.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-sidebar-toggle]");
    const section = toggle?.closest("[data-sidebar-group]");
    if (!section) return;
    event.preventDefault();
    if (elements.appShell.classList.contains("sidebar-collapsed")) {
      setSidebarCollapsed(false);
      setSidebarGroupOpen(section, true);
      return;
    }
    setSidebarGroupOpen(section, !section.classList.contains("is-open"));
  });

  elements.filters?.addEventListener("input", () => {
    window.clearTimeout(bindStaticEvents.filterTimer);
    bindStaticEvents.filterTimer = window.setTimeout(() => {
      loadIncidents().catch((error) => showNotice(error.message, "error"));
    }, 250);
  });

  elements.completedFilters?.addEventListener("input", () => {
    state.completedPage = 0;
    renderCompletedRows();
  });

  elements.completedPreviousPage?.addEventListener("click", () => {
    if (state.completedPage === 0) return;
    state.completedPage -= 1;
    renderCompletedRows();
  });

  elements.completedNextPage?.addEventListener("click", () => {
    const pageCount = Math.ceil(getFilteredCompletedIncidents().length / 10);
    if (state.completedPage >= pageCount - 1) return;
    state.completedPage += 1;
    renderCompletedRows();
  });

  elements.vesaFilters?.addEventListener("submit", (event) => event.preventDefault());
  elements.vesaFilters?.addEventListener("input", () => {
    state.vesaPage = 0;
    renderVesaRows();
  });
  elements.vesaPreviousPage?.addEventListener("click", () => {
    if (state.vesaPage === 0) return;
    state.vesaPage -= 1;
    renderVesaRows();
  });
  elements.vesaNextPage?.addEventListener("click", () => {
    if ((state.vesaPage + 1) * 10 >= getFilteredVesaIncidents().length) return;
    state.vesaPage += 1;
    renderVesaRows();
  });
  elements.vesaRefreshButton?.addEventListener("click", async () => {
    elements.vesaRefreshButton.disabled = true;
    try {
      await loadVesaIncidents();
      showNotice("VESA dispatches refreshed.");
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      elements.vesaRefreshButton.disabled = false;
    }
  });

  elements.cancelledFilters?.addEventListener("input", () => {
    renderCancelledRows();
  });

  elements.cancelledRows?.addEventListener("click", (event) => {
    const recoverButton = event.target.closest("[data-recover-dispatch]");
    if (recoverButton) {
      setRecoverDispatchConfirmationOpen(true, recoverButton.dataset.recoverDispatch);
      return;
    }
    const row = event.target.closest("[data-incident-id]");
    if (row) openDispatch(row.dataset.incidentId, "view");
  });

  elements.recoverDispatchConfirmBack?.addEventListener("click", () => setRecoverDispatchConfirmationOpen(false));
  elements.recoverDispatchConfirmClose?.addEventListener("click", () => setRecoverDispatchConfirmationOpen(false));
  elements.recoverDispatchConfirmOverlay?.addEventListener("click", (event) => {
    if (event.target === elements.recoverDispatchConfirmOverlay) setRecoverDispatchConfirmationOpen(false);
  });
  elements.recoverDispatchConfirmAccept?.addEventListener("click", async () => {
    const button = elements.recoverDispatchConfirmAccept;
    button.disabled = true;
    button.textContent = "Recovering…";
    try {
      await recoverCancelledDispatch();
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      button.disabled = false;
      button.textContent = "Recover dispatch";
    }
  });

  elements.refreshButton?.addEventListener("click", () => {
    Promise.all([loadIncidents(), loadPendingApprovals(), loadCompletedIncidents()])
      .then(() => showNotice("Dispatch Link refreshed."))
      .catch((error) => showNotice(error.message, "error"));
  });
  window.addEventListener("hashchange", syncDispatchListView);

  elements.form?.addEventListener("invalid", (event) => {
    const control = event.target;
    if (!(control instanceof HTMLElement)) return;
    event.preventDefault();
    control.setAttribute("aria-invalid", "true");
    updateDispatchSectionStatuses();
    if (bindStaticEvents.invalidNavigationScheduled) return;

    bindStaticEvents.invalidNavigationScheduled = true;
    const label = String(control.closest("label")?.querySelector(".field-head")?.textContent || "")
      .replace(/\s*\*\s*$/, "")
      .trim();
    const validationMessage = String(control.validationMessage || "Complete this field before saving.");
    showNotice(label ? `${label}: ${validationMessage}` : validationMessage, "error");
    revealValidationControl(control);
    window.setTimeout(() => {
      bindStaticEvents.invalidNavigationScheduled = false;
    }, 0);
  }, true);

  elements.form?.addEventListener("submit", (event) => {
    event.preventDefault();
    clearInlineFieldErrors();
    saveIncident().catch((error) => {
      const shownInline = showCoordinateFormatError(error.message);
      showCommunicationLogErrors(error);
      if (!shownInline) showNotice(error.message, "error");
      if (error.details) renderValidationSummary(error.details);
    });
  });

  // Enter in a one-line field (for example latitude) must not implicitly save
  // the whole draft. Textareas retain their normal Enter/newline behaviour.
  elements.form?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (["submit", "button", "reset", "checkbox", "radio", "file"].includes(target.type)) return;
    event.preventDefault();
  });

  elements.form?.addEventListener("input", (event) => {
    if (event.target?.matches("[data-communication-agent-search]")) return;
    if (event.target?.name === "eventDate") syncIncidentDateTimeValue();
    if (event.target?.matches("[data-time-part]")) {
      event.target.value = event.target.value.replace(/\D/g, "").slice(0, 2);
      syncTimePairValue(event.target);
      if (["eventHour", "eventMinute"].includes(event.target.name)) {
        syncIncidentDateTimeValue();
      } else {
        syncDateTimePairValue(event.target);
      }
      renderIncidentTimeOptions(event.target, true);
    }
    if (event.target?.matches("[data-date-part]")) syncDateTimePairValue(event.target);
    if (event.target?.name === "communicationNotes") resizeCommunicationNotes(event.target);
    if (event.target?.matches("input[aria-invalid='true'], select[aria-invalid='true'], textarea[aria-invalid='true']")) {
      event.target.removeAttribute("aria-invalid");
      updateDispatchSectionStatuses();
    }
    if (event.target?.matches("[data-digits-only]")) {
      event.target.value = event.target.value.replace(/\D/g, "");
    }
    if (event.target?.matches("[data-communication-contact-number]")) {
      event.target.value = normalizeCommunicationContactNumber(event.target.value);
    }
    if (["latitude", "longitude"].includes(event.target?.name)) {
      normalizeCoordinateNotAvailable(event.target);
      const errorElement = event.target.closest("label")?.querySelector("[data-field-error]");
      event.target.removeAttribute("aria-invalid");
      if (errorElement) {
        errorElement.hidden = true;
        errorElement.textContent = "";
      }
      updateDispatchSectionStatuses();
    }
    const communicationRow = event.target?.closest("#communicationLogRows tr.is-validation-error");
    if (communicationRow) {
      event.target.removeAttribute("aria-invalid");
      event.target.removeAttribute("title");
      if (event.target.matches("[data-time-part]")) {
        for (const timePart of event.target.closest("[data-time-pair]")?.querySelectorAll("[data-time-part]") || []) {
          timePart.removeAttribute("aria-invalid");
          timePart.removeAttribute("title");
        }
      }
      const stillInvalid = communicationRow.querySelector("[aria-invalid='true']");
      if (!stillInvalid) {
        communicationRow.classList.remove("is-validation-error");
        communicationRow.removeAttribute("title");
        communicationRow.querySelector(".communication-log-error-marker")?.remove();
      }
    }
    if (event.target?.matches("[data-incident-notes-editor]")) {
      syncIncidentNotesInput();
    }
    updateDispatchPresentation();
    if (event.target?.name === "regNo") {
      scheduleDispatchRegistrationLookup();
    }
    if (event.target?.name === "company" || event.target?.name === "fleetCode") {
      autoPopulateZohoAccount();
    }
    if (event.target?.name === "zohoAccount") {
      event.target.dataset.autopopulated = "false";
    }
    if ([
      "driverOnScene",
      "vehicleRecovered",
      "vehicleKeyAvailable",
      "trailersRecovered",
      "loadRecovered",
      "noVisibleDamages"
    ].includes(event.target?.name)) {
      updateConditionalCompulsoryFields();
    }
    if (event.target?.name === "vehicleHistoryUnavailable") {
      if (event.target.checked && elements.form.elements.trackingUnitStatus) {
        elements.form.elements.trackingUnitStatus.value = "Not fitted with Pulsit Tracking";
      }
      syncVehicleHistoryExceptionControls();
      renderHistoryUploadControls();
    }
    updateDispatchSectionStatuses();
    if (event.target?.type !== "file") markDraftUnsaved();
  });

  elements.form?.addEventListener("change", (event) => {
    if (["event", "zohoAccount"].includes(event.target?.name)) {
      updateClientPoRequirement();
      updateDispatchSectionStatuses();
    }
    if (event.target?.name === "eventDate") syncIncidentDateTimeValue();
    if (event.target?.matches("[data-time-part]")) {
      normalizeIncidentTimePart(event.target);
      syncTimePairValue(event.target);
      if (["eventHour", "eventMinute"].includes(event.target.name)) {
        syncIncidentDateTimeValue();
      } else {
        syncDateTimePairValue(event.target);
      }
      updateDispatchPresentation();
      updateDispatchSectionStatuses();
    }
    if (event.target?.matches("[data-date-part]")) syncDateTimePairValue(event.target);
    if (event.target?.name === "dispatchTeam") renderSelectedTeamQuota();
    const changedDateTimeName = event.target?.closest?.("[data-date-time-pair]")
      ?.querySelector("[data-date-time-value]")?.name;
    if (["dispatchDateTime", "standDownDateTime"].includes(changedDateTimeName)) {
      updateDispatchDurationAlert();
    }
    if (event.target?.type !== "file") markDraftUnsaved();
  });

  elements.form?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-rich-command]");
    if (!button) return;
    const toolbar = button.closest(".rich-text-toolbar");
    const editor = toolbar?.dataset.editorTarget
      ? document.getElementById(toolbar.dataset.editorTarget)
      : elements.form.querySelector("[data-incident-notes-editor]");
    editor?.focus();
    document.execCommand(button.dataset.richCommand, false);
    if (editor?.matches("[data-incident-notes-editor]")) syncIncidentNotesInput();
    markDraftUnsaved();
  });

  document.querySelector("#completeApprovalButton")?.addEventListener("click", () => {
    approveSelectedIncident().catch((error) => {
      showNotice(error.message, "error");
      if (error.details) renderValidationSummary(error.details);
    });
  });

  document.querySelector("#sendBackForRevisionButton")?.addEventListener("click", () => {
    rejectSelectedIncident().catch((error) => showNotice(error.message, "error"));
  });

  elements.form?.elements.regNo?.addEventListener("change", () => {
    scheduleDispatchRegistrationLookup();
  });

  elements.submitApprovalButton?.addEventListener("click", () => {
    submitSelectedIncident().catch((error) => {
      showNotice(error.message, "error");
      if (error.details) renderValidationSummary(error.details);
    });
  });

  elements.cancelEntryButton?.addEventListener("click", () => setCancelEntryConfirmationOpen(true));
  elements.cancelEntryConfirmBack?.addEventListener("click", () => setCancelEntryConfirmationOpen(false));
  elements.cancelEntryConfirmClose?.addEventListener("click", () => setCancelEntryConfirmationOpen(false));
  elements.cancelEntryConfirmOverlay?.addEventListener("click", (event) => {
    if (event.target === elements.cancelEntryConfirmOverlay) setCancelEntryConfirmationOpen(false);
  });
  elements.cancelEntryConfirmAccept?.addEventListener("click", async () => {
    const button = elements.cancelEntryConfirmAccept;
    button.disabled = true;
    button.textContent = "Cancelling...";
    try {
      await cancelCurrentEntry();
    } catch (error) {
      setCancelEntryConfirmationOpen(false);
      showNotice(error.message, "error");
    } finally {
      button.disabled = false;
      button.textContent = "Cancel entry";
    }
  });

  elements.cancelDispatchButton?.addEventListener("click", () => setCancelDispatchConfirmationOpen(true));
  elements.cancelDispatchConfirmBack?.addEventListener("click", () => setCancelDispatchConfirmationOpen(false));
  elements.cancelDispatchConfirmClose?.addEventListener("click", () => setCancelDispatchConfirmationOpen(false));
  elements.cancelDispatchConfirmOverlay?.addEventListener("click", (event) => {
    if (event.target === elements.cancelDispatchConfirmOverlay) setCancelDispatchConfirmationOpen(false);
  });
  elements.cancelDispatchConfirmAccept?.addEventListener("click", async () => {
    const button = elements.cancelDispatchConfirmAccept;
    button.disabled = true;
    button.textContent = "Cancelling...";
    try {
      await cancelCurrentDispatch();
    } catch (error) {
      showNotice(error.message, "error");
      elements.cancelDispatchReason?.focus();
    } finally {
      button.disabled = false;
      button.textContent = "Cancel dispatch";
    }
  });

  elements.returnToApprovalsButton?.addEventListener("click", () => setReturnToApprovalsConfirmationOpen(true));
  elements.returnToApprovalsConfirmBack?.addEventListener("click", () => setReturnToApprovalsConfirmationOpen(false));
  elements.returnToApprovalsConfirmClose?.addEventListener("click", () => setReturnToApprovalsConfirmationOpen(false));
  elements.returnToApprovalsConfirmOverlay?.addEventListener("click", (event) => {
    if (event.target === elements.returnToApprovalsConfirmOverlay) setReturnToApprovalsConfirmationOpen(false);
  });
  elements.returnToApprovalsConfirmAccept?.addEventListener("click", async () => {
    if (returnToApprovalsInProgress) return;
    returnToApprovalsInProgress = true;
    const button = elements.returnToApprovalsConfirmAccept;
    button.disabled = true;
    button.textContent = "Returning...";
    elements.returnToApprovalsButton.disabled = true;
    try {
      await returnCurrentDispatchToApprovals();
    } catch (error) {
      returnToApprovalsInProgress = false;
      setReturnToApprovalsConfirmationOpen(false);
      showNotice(error.message, "error");
      button.disabled = false;
      button.textContent = "Return to Approvals";
      updateDispatchPresentation();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (elements.returnToApprovalsConfirmOverlay?.hidden === false) {
      event.preventDefault();
      setReturnToApprovalsConfirmationOpen(false);
      return;
    }
    if (elements.recoverDispatchConfirmOverlay?.hidden === false) {
      event.preventDefault();
      setRecoverDispatchConfirmationOpen(false);
      return;
    }
    if (elements.cancelEntryConfirmOverlay?.hidden === false) {
      event.preventDefault();
      setCancelEntryConfirmationOpen(false);
      return;
    }
    if (elements.cancelDispatchConfirmOverlay?.hidden !== false) return;
    event.preventDefault();
    setCancelDispatchConfirmationOpen(false);
  });

  elements.addCommunicationRowButton?.addEventListener("click", () => {
    addCommunicationRow();
    markDraftUnsaved();
    scrollCommunicationLogToBottom(elements.addCommunicationRowButton.closest(".communication-log-section"));
  });

  elements.addAssetButton?.addEventListener("click", () => {
    const assets = readAdditionalAssets();
    assets.push({ key: createAdditionalAssetKey() });
    renderAdditionalAssets(assets);
    updateConditionalCompulsoryFields();
    elements.additionalAssets?.lastElementChild?.querySelector('[data-asset-field="regNo"]')?.focus();
    markDraftUnsaved();
  });

  elements.additionalAssets?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-asset]");
    if (!button) return;
    button.closest("[data-asset-key]")?.remove();
    renderAdditionalAssetPhotos();
    markDraftUnsaved();
  });

  elements.additionalAssets?.addEventListener("input", (event) => {
    if (!event.target.matches("[data-asset-field]")) return;
    renderAdditionalAssetPhotos();
    if (["regNo", "trailerRegistration1", "trailerRegistration2"].includes(event.target.dataset.assetField)) {
      updateConditionalCompulsoryFields();
    }
    updateDispatchSectionStatuses();
    markDraftUnsaved();
  });

  elements.additionalAssets?.addEventListener("change", (event) => {
    const fileInput = event.target.closest('.additional-asset-photo input[type="file"]');
    if (!fileInput?.files?.[0]) return;
    const row = fileInput.closest("[data-photo-category]");
    const assetKey = fileInput.closest("[data-asset-key]")?.dataset.assetKey || "";
    uploadPhoto(row.dataset.photoCategory, row, fileInput.files[0], assetKey)
      .catch((error) => {
        setPhotoCardBusy(row, false);
        showNotice(error.message, "error");
      })
      .finally(() => { fileInput.value = ""; });
  });

  elements.communicationLogRows?.addEventListener("pointerdown", (event) => {
    const rightSideField = event.target.closest(
      '[name="communicationContactNumber"], [name="communicationEmailAddress"]'
    );
    if (!rightSideField) return;
    const tableWrap = rightSideField.closest(".communication-log-table-wrap");
    rightSideField.dataset.jumpTableToEnd = String(Boolean(tableWrap && tableWrap.scrollLeft <= 2));
  });

  elements.communicationLogRows?.addEventListener("dragstart", (event) => {
    const dragHandle = event.target.closest("[data-drag-communication-row]");
    const row = dragHandle?.closest("tr");
    if (!dragHandle || !row || state.viewOnly) {
      event.preventDefault();
      return;
    }
    draggedCommunicationRow = row;
    communicationDragStartIndex = Array.from(elements.communicationLogRows.children).indexOf(row);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", row.dataset.communicationLogId || `row-${communicationDragStartIndex + 1}`);
    window.requestAnimationFrame(() => row.classList.add("is-dragging"));
  });

  elements.communicationLogRows?.addEventListener("dragover", (event) => {
    if (!draggedCommunicationRow) return;
    const targetRow = event.target.closest("tr");
    if (!targetRow || targetRow === draggedCommunicationRow) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const targetBounds = targetRow.getBoundingClientRect();
    const insertAfter = event.clientY > targetBounds.top + targetBounds.height / 2;
    elements.communicationLogRows.insertBefore(
      draggedCommunicationRow,
      insertAfter ? targetRow.nextSibling : targetRow
    );
    syncCommunicationRowOrder();
  });

  elements.communicationLogRows?.addEventListener("drop", (event) => {
    if (draggedCommunicationRow) event.preventDefault();
  });

  elements.communicationLogRows?.addEventListener("dragend", () => {
    if (!draggedCommunicationRow) return;
    const currentIndex = Array.from(elements.communicationLogRows.children).indexOf(draggedCommunicationRow);
    draggedCommunicationRow.classList.remove("is-dragging");
    draggedCommunicationRow = null;
    if (currentIndex !== communicationDragStartIndex) markDraftUnsaved();
    communicationDragStartIndex = -1;
    syncCommunicationRowOrder();
  });

  elements.communicationLogRows?.addEventListener("click", (event) => {
    const agentControl = event.target.closest("[data-communication-agent-select]");
    const agentTrigger = event.target.closest("[data-communication-agent-trigger]");
    if (agentTrigger && agentControl) {
      const popup = agentControl.querySelector("[data-communication-agent-popup]");
      if (popup?.hidden) openCommunicationAgentSelect(agentControl);
      else closeCommunicationAgentSelect(agentControl);
      return;
    }
    const agentOption = event.target.closest("[data-communication-agent-value]");
    if (agentOption && agentControl) {
      selectCommunicationAgent(agentControl, agentOption);
      return;
    }

    const contactPersonField = event.target.closest('[name="communicationContactPerson"]');
    if (contactPersonField) {
      const tableWrap = contactPersonField.closest(".communication-log-table-wrap");
      window.requestAnimationFrame(() => {
        if (tableWrap) tableWrap.scrollLeft = tableWrap.scrollWidth - tableWrap.clientWidth;
      });
    }

    const rightSideField = event.target.closest(
      '[name="communicationContactNumber"], [name="communicationEmailAddress"]'
    );
    if (rightSideField?.dataset.jumpTableToEnd === "true") {
      const tableWrap = rightSideField.closest(".communication-log-table-wrap");
      rightSideField.dataset.jumpTableToEnd = "false";
      window.requestAnimationFrame(() => {
        if (tableWrap) tableWrap.scrollLeft = tableWrap.scrollWidth - tableWrap.clientWidth;
      });
    }

    const duplicateButton = event.target.closest("[data-duplicate-communication-row]");
    if (duplicateButton) {
      const sourceRow = duplicateButton.closest("tr");
      if (sourceRow && !duplicateButton.disabled) duplicateCommunicationRow(sourceRow);
      return;
    }

    const removeButton = event.target.closest("[data-remove-communication-row]");
    if (!removeButton) return;
    const row = removeButton.closest("tr");
    if (!row) return;
    const existingId = Number(row.dataset.communicationLogId || 0);
    if (existingId) state.removedCommunicationLogIds.add(existingId);
    row.remove();
    syncCommunicationRowOrder();
    markDraftUnsaved();
  });

  elements.communicationLogRows?.addEventListener("input", (event) => {
    const search = event.target.closest("[data-communication-agent-search]");
    if (!search) return;
    filterCommunicationAgents(search.closest("[data-communication-agent-select]"), search.value);
  });

  elements.communicationLogRows?.addEventListener("keydown", (event) => {
    const control = event.target.closest("[data-communication-agent-select]");
    if (!control) return;
    const trigger = event.target.closest("[data-communication-agent-trigger]");
    const search = event.target.closest("[data-communication-agent-search]");
    const option = event.target.closest("[data-communication-agent-value]");

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeCommunicationAgentSelect(control, { restoreFocus: true });
      return;
    }
    if (trigger && ["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      openCommunicationAgentSelect(control);
      return;
    }

    const visibleOptions = Array.from(control.querySelectorAll("[data-communication-agent-value]"))
      .filter((candidate) => !candidate.hidden);
    if (search && event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (visibleOptions[0]) selectCommunicationAgent(control, visibleOptions[0]);
      return;
    }
    if (search && event.key === "ArrowDown") {
      event.preventDefault();
      visibleOptions[0]?.focus();
      return;
    }
    if (option && ["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      const currentIndex = visibleOptions.indexOf(option);
      const nextIndex = event.key === "ArrowDown"
        ? Math.min(currentIndex + 1, visibleOptions.length - 1)
        : currentIndex - 1;
      if (nextIndex < 0) search?.focus();
      else visibleOptions[nextIndex]?.focus();
    }
  });

  elements.addTimelineRowButton?.addEventListener("click", () => {
    addTimelineRow();
    markDraftUnsaved();
  });

  elements.incidentTimelineRows?.addEventListener("change", (event) => {
    const select = event.target.closest('[name="timelineEventType"]');
    if (!select) return;
    const icon = select.closest(".incident-timeline-row")?.querySelector("[data-timeline-icon]");
    if (icon) icon.innerHTML = timelineIconMarkup(select.value);
  });

  elements.incidentTimelineRows?.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-remove-timeline-row]");
    if (!removeButton) return;
    const row = removeButton.closest(".incident-timeline-row");
    if (!row) return;
    const existingId = Number(row.dataset.timelineEntryId || 0);
    if (existingId) state.removedTimelineEntryIds.add(existingId);
    row.remove();
    if (!elements.incidentTimelineRows.children.length) addTimelineRow();
    markDraftUnsaved();
  });

  elements.incidentRows?.addEventListener("click", (event) => {
    const row = event.target.closest("[data-incident-id]");
    if (!row) return;
    window.location.href = `dispatch.html?id=${encodeURIComponent(row.dataset.incidentId)}`;
  });

  elements.approvalRows?.addEventListener("click", (event) => {
    const row = event.target.closest("[data-incident-id]");
    if (!row) return;
    window.location.href = `dispatch.html?id=${encodeURIComponent(row.dataset.incidentId)}`;
  });

  elements.completedRows?.addEventListener("click", (event) => {
    const reportLink = event.target.closest("[data-async-report-download]");
    if (reportLink) {
      event.preventDefault();
      event.stopPropagation();
      downloadReportWithProgress(reportLink).catch((error) => showNotice(error.message, "error"));
      return;
    }
    if (event.target.closest("[data-report-download]")) return;
    const row = event.target.closest("[data-incident-id]");
    if (!row) return;
    openDispatch(row.dataset.incidentId);
  });

  elements.completedRows?.addEventListener("contextmenu", (event) => {
    const row = event.target.closest("[data-incident-id]");
    if (!row) return;
    showRecordContextMenu(event, row.dataset.incidentId);
  });

  elements.recordContextMenu?.addEventListener("click", (event) => {
    const action = event.target.closest("[data-context-action]")?.dataset.contextAction;
    const id = state.contextIncidentId;
    hideRecordContextMenu();
    if (!action || !id) return;
    openDispatch(id, action === "view" ? "view" : "edit");
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-communication-agent-select]")) closeAllCommunicationAgentSelects();
    if (!elements.recordContextMenu || elements.recordContextMenu.hidden) return;
    if (!elements.recordContextMenu.contains(event.target)) hideRecordContextMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAllCommunicationAgentSelects();
      hideRecordContextMenu();
    }
  });

  window.addEventListener("resize", () => closeAllCommunicationAgentSelects());
  window.addEventListener("scroll", (event) => {
    if (event.target instanceof Element && event.target.closest("[data-communication-agent-popup]")) return;
    closeAllCommunicationAgentSelects();
  }, true);

  elements.photoUploadList?.addEventListener("change", (event) => {
    const fileInput = event.target.closest(".photo-file");
    if (!fileInput) return;
    const file = fileInput.files?.[0];
    if (!file) {
      syncPhotoUploadFileName(fileInput);
      return;
    }
    queuePhotoUpload(fileInput, file).catch((error) => showNotice(error.message, "error"));
  });

  elements.photoUploadList?.addEventListener("click", (event) => {
    // Allow the native file input click triggered by Browse/Edit image to open
    // the file picker instead of treating it as a gallery-card selection.
    if (event.target.closest(".photo-file")) return;
    const shell = event.target.closest(".photo-upload-shell");
    if (!shell) return;
    const row = shell.closest("[data-upload-gallery-index]");
    const wantsUpload = Boolean(event.target.closest(".browse-button, .photo-upload-edit"));
    if (wantsUpload) {
      event.preventDefault();
      if (!ensurePhotoUploadsAvailable()) return;
      shell.querySelector(".photo-file")?.click();
      return;
    }
    if (row && !wantsUpload) {
      event.preventDefault();
      state.selectedPhotoIndex = Number(row.dataset.uploadGalleryIndex) || 0;
      renderPhotoGallery();
      renderUploadList(state.selectedIncidentDetail);
      return;
    }
    if (ensurePhotoUploadsAvailable()) return;
    event.preventDefault();
  }, true);

  elements.photoUploadList?.addEventListener("keydown", (event) => {
    const dropzone = event.target.closest("[data-photo-dropzone]");
    if (!dropzone) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (!ensurePhotoUploadsAvailable()) return;
    dropzone.closest("[data-photo-category]")?.querySelector(".photo-file")?.click();
  });

  for (const eventName of ["dragenter", "dragover"]) {
    elements.photoUploadList?.addEventListener(eventName, (event) => {
      const dropzone = event.target.closest("[data-photo-dropzone]");
      if (!dropzone) return;
      if (!ensurePhotoUploadsAvailable()) return;
      event.preventDefault();
      const row = dropzone.closest("[data-photo-category]");
      row?.classList.add("is-dragover");
    });
  }

  elements.photoUploadList?.addEventListener("dragleave", (event) => {
    const dropzone = event.target.closest("[data-photo-dropzone]");
    if (!dropzone) return;
    const row = dropzone.closest("[data-photo-category]");
    if (!row) return;
    if (dropzone.contains(event.relatedTarget)) return;
    row.classList.remove("is-dragover");
  });

  elements.photoUploadList?.addEventListener("drop", (event) => {
    const dropzone = event.target.closest("[data-photo-dropzone]");
    if (!dropzone) return;
    event.preventDefault();
    if (!ensurePhotoUploadsAvailable()) return;
    const row = dropzone.closest("[data-photo-category]");
    const fileInput = row?.querySelector(".photo-file");
    const file = event.dataTransfer?.files?.[0];
    row?.classList.remove("is-dragover");
    if (!fileInput || !file) return;
    queuePhotoUpload(fileInput, file).catch((error) => showNotice(error.message, "error"));
  });

  elements.photoUploadList?.addEventListener("dragend", (event) => {
    const row = event.target.closest?.("[data-photo-category]");
    row?.classList.remove("is-dragover");
  });

  document.querySelectorAll("[data-photo-checklist-scroll]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!elements.photoUploadList || button.disabled) return;
      const direction = button.dataset.photoChecklistScroll === "previous" ? -1 : 1;
      const distance = direction * getPhotoCarouselStep(elements.photoUploadList);
      animateHorizontalScroll(elements.photoUploadList, elements.photoUploadList.scrollLeft + distance);
    });
  });

  elements.photoUploadList?.addEventListener("scroll", () => {
    updatePhotoChecklistScrollButtons();
    elements.photoUploadList.classList.add("is-scrolling");
    window.clearTimeout(elements.photoUploadList.scrollFlowTimer);
    elements.photoUploadList.scrollFlowTimer = window.setTimeout(() => {
      elements.photoUploadList.classList.remove("is-scrolling");
    }, 180);
  });

  elements.photoUploadList?.addEventListener("keydown", (event) => {
    if (event.target.closest("[data-photo-dropzone]")) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    const distance = direction * getPhotoCarouselStep(elements.photoUploadList);
    animateHorizontalScroll(elements.photoUploadList, elements.photoUploadList.scrollLeft + distance);
  });

  elements.photoGalleryPanel?.addEventListener("click", (event) => {
    const thumb = event.target.closest("[data-gallery-index]");
    if (thumb) {
      state.selectedPhotoIndex = Number(thumb.dataset.galleryIndex) || 0;
      renderPhotoGallery();
      return;
    }

    const scrollButton = event.target.closest("[data-gallery-scroll]");
    if (!scrollButton || scrollButton.disabled) return;
    const track = elements.photoGalleryPanel.querySelector("[data-gallery-track]");
    if (!track) return;
    const direction = scrollButton.dataset.galleryScroll === "previous" ? -1 : 1;
    track.scrollBy({ left: direction * Math.max(180, track.clientWidth * .72), behavior: "smooth" });
  });

  elements.photoGalleryPanel?.addEventListener("keydown", (event) => {
    const track = event.target.closest("[data-gallery-track]");
    if (!track) return;
    const photos = getPhotoGalleryItems();
    if (!photos.length) return;

    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const delta = event.key === "ArrowLeft" ? -1 : 1;
      state.selectedPhotoIndex = Math.min(Math.max(state.selectedPhotoIndex + delta, 0), photos.length - 1);
      renderPhotoGallery();
    }
  });

  elements.photoGalleryPanel?.addEventListener("scroll", (event) => {
    if (event.target.closest?.("[data-gallery-track]")) {
      updatePhotoGalleryScrollButtons();
    }
  }, true);

  elements.photoGalleryPanel?.addEventListener("load", (event) => {
    if (!event.target.matches(".gallery-preview-image")) return;
    event.target.closest("[data-image-gallery]")?.classList.remove("is-loading");
  }, true);

  window.addEventListener("resize", () => {
    updatePhotoGalleryScrollButtons();
    updatePhotoChecklistScrollButtons();
  });

  elements.historyExcelFile?.addEventListener("change", () => {
    syncDocumentFileName(elements.historyExcelFile);
    if (elements.historyExcelFile.files?.[0]) {
      uploadHistoryFile("HistoryExcel", elements.historyExcelFile).catch((error) => {
        showNotice(error.message, "error");
        elements.historyExcelFile.value = "";
        renderHistoryUploadControls();
      });
    }
  });

  elements.historyPdfFile?.addEventListener("change", () => {
    syncDocumentFileName(elements.historyPdfFile);
    if (elements.historyPdfFile.files?.[0]) {
      uploadHistoryFile("HistoryPdf", elements.historyPdfFile).catch((error) => {
        showNotice(error.message, "error");
        elements.historyPdfFile.value = "";
        renderHistoryUploadControls();
      });
    }
  });

  document.querySelector(".document-upload-grid")?.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-remove-history-file]");
    if (!removeButton) return;
    state.removedHistoryFileIds.add(Number(removeButton.dataset.removeHistoryFile));
    renderDetailPanel();
    showNotice("History file removed from this report view.");
  });

  if (elements.detailPanel) {
    elements.detailPanel.addEventListener("click", (event) => {
      if (event.target.closest("#approveIncidentButton")) {
        approveSelectedIncident().catch((error) => {
          showNotice(error.message, "error");
          if (error.details) renderValidationSummary(error.details);
        });
        return;
      }

      if (event.target.closest("#rejectIncidentButton")) {
        rejectSelectedIncident().catch((error) => showNotice(error.message, "error"));
      }
    });
  }
}

async function boot() {
  clearStoredBrowserDraft();
  syncThemeToggle();
  syncSidebarCollapsed();
  syncSidebarGroups();
  setupIncidentTimeComboboxes();
  bindStaticEvents();
  syncDispatchListView();
  setupDispatchSectionPanels();
  renderUploadList(null);
  startDispatchDurationAlertTimer();
  try {
    await loadCurrentUser();
    if (elements.vesaRows) {
      await Promise.all([
        loadVesaIncidents(),
        loadEtaRequestSummary(),
        loadTicketNavCounts(),
        requestJson(api.summary).then((summary) => {
          state.summary = summary;
          renderSummary();
        })
      ]);
      return;
    }
    await Promise.all([loadEtaRequestSummary(), loadTicketNavCounts()]);
    await loadMetadata();
    await loadTeamQuotas();
    const selectedId = new URLSearchParams(window.location.search).get("id");
    if (selectedId && elements.form) {
      try {
        await loadIncidentDetail(selectedId);
        const url = new URL(window.location.href);
        if (url.searchParams.get("returnedToApprovals") === "1") {
          if (state.selectedIncidentDetail?.incident?.Status === "PendingApproval") {
            showNotice("Dispatch returned to Approvals. Edit the report and save your changes before approving it again.");
          }
          url.searchParams.delete("returnedToApprovals");
          window.history.replaceState(null, "", url.href);
        }
      } catch (error) {
        // A malformed or temporarily unavailable record must not prevent the
        // independent navigation counts from loading for the CC user.
        populateForm(null);
        renderDetailPanel();
        showNotice(`This dispatch could not be loaded: ${error.message}`, "error");
      }
    } else {
      populateForm(null);
      renderDetailPanel();
    }
    await Promise.all([
      !isCompletedDispatchViewer() && (elements.incidentRows || document.querySelector("[data-summary-count]")) ? loadIncidents() : Promise.resolve(),
      !isCompletedDispatchViewer() && elements.approvalRows ? loadPendingApprovals() : Promise.resolve(),
      elements.completedRows ? loadCompletedIncidents() : Promise.resolve(),
      elements.cancelledRows ? loadCancelledIncidents() : Promise.resolve()
    ]);
    const reportError = historyReportErrorMessage(new URLSearchParams(window.location.search).get("reportError"));
    if (reportError) showNotice(reportError, "error");
  } catch (error) {
    renderIncidentError(error.message);
    renderApprovalError(error.message);
    renderCompletedError(error.message);
    renderVesaError(error.message);
    renderCancelledError(error.message);
    showNotice(error.message, "error");
  }
}

boot();
