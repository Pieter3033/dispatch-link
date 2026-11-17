(async function () {
  "use strict";

  if (globalThis.dispatchAuthReady) await globalThis.dispatchAuthReady;

  const path = window.location.pathname;
  const marker = "/dispatch_link/";
  const markerIndex = path.toLowerCase().indexOf(marker);
  const dispatchLinkBase = markerIndex !== -1 ? path.slice(0, markerIndex + marker.length - 1) : "/dispatch_link";
  const apiBase = `${dispatchLinkBase}/api`;
  const endpoints = {
    list: `${apiBase}/eta_requests.sql`,
    history: `${apiBase}/eta_history.sql`,
    dispatchSummary: `${apiBase}/dispatch_summary.sql`,
    ticketSummary: "/internaltickets/api_tickets.sql",
    teamActiveDispatches: `${apiBase}/team_active_dispatches.sql`,
    teamQuotas: `${apiBase}/dispatch_team_quotas.sql`,
    create: `${apiBase}/create_eta_request.sql`,
    respond: `${apiBase}/save_eta_response.sql`,
    select: `${apiBase}/select_eta_response.sql`,
    cancel: `${apiBase}/cancel_eta_request.sql`
  };
  const sidebarGroupStorageKey = "pulsit-sidebar-groups";

  const state = {
    context: null,
    summary: { openCount: 0, actionCount: 0, selectedCount: 0 },
    dispatchSummary: { draftCount: 0, pendingCount: 0, approvedCount: 0, cancelledDispatchCount: 0 },
    teamActiveSummary: { activeCount: 0, completedCount: 0 },
    teamQuotas: { periodLabel: "", teams: [] },
    requests: [],
    historyRequests: [],
    historyTotal: 0,
    historyPage: 1,
    historySearch: "",
    historyLoading: false,
    historyError: false,
    loading: false
  };

  const elements = {
    appShell: document.querySelector(".app-shell"),
    sidebarCollapseButton: document.querySelector("#sidebarCollapseButton"),
    themeToggle: document.querySelector("#themeToggle"),
    sidebarProfile: document.querySelector("#etaSidebarProfile"),
    userAvatar: document.querySelector("#userAvatar"),
    userDisplayName: document.querySelector("#userDisplayName"),
    userRoleLabel: document.querySelector("#userRoleLabel"),
    notice: document.querySelector("#etaNotice"),
    accessDenied: document.querySelector("#etaAccessDenied"),
    setupRequired: document.querySelector("#etaSetupRequired"),
    workspace: document.querySelector("#etaWorkspace"),
    matrixQuota: document.querySelector("#etaMatrixQuota"),
    profilePill: document.querySelector("#etaProfilePill"),
    pageSubtitle: document.querySelector("#etaPageSubtitle"),
    openCount: document.querySelector("#etaOpenCount"),
    actionCount: document.querySelector("#etaActionCount"),
    actionLabel: document.querySelector("#etaActionLabel"),
    actionHelp: document.querySelector("#etaActionHelp"),
    selectedCount: document.querySelector("#etaSelectedCount"),
    createPanel: document.querySelector("#etaCreatePanel"),
    requestForm: document.querySelector("#etaRequestForm"),
    createButton: document.querySelector("#etaCreateButton"),
    registerTitle: document.querySelector("#etaRegisterTitle"),
    refreshButton: document.querySelector("#etaRefreshButton"),
    requestList: document.querySelector("#etaRequestList"),
    historyCount: document.querySelector("#etaHistoryCount"),
    historyHead: document.querySelector("#etaHistoryHead"),
    historyBody: document.querySelector("#etaHistoryBody"),
    historySearch: document.querySelector("#etaHistorySearch"),
    historyPagination: document.querySelector("#etaHistoryPagination"),
    historyPrevious: document.querySelector("#etaHistoryPrevious"),
    historyNext: document.querySelector("#etaHistoryNext"),
    historyPageStatus: document.querySelector("#etaHistoryPageStatus"),
    confirmOverlay: document.querySelector("#etaConfirmOverlay"),
    confirmDialog: document.querySelector("#etaConfirmDialog"),
    confirmTitle: document.querySelector("#etaConfirmTitle"),
    confirmMessage: document.querySelector("#etaConfirmMessage"),
    confirmAccept: document.querySelector("#etaConfirmAccept"),
    confirmCancel: document.querySelector("#etaConfirmCancel"),
    confirmClose: document.querySelector("#etaConfirmClose")
  };

  let activeConfirmation = null;
  let historyRequestSequence = 0;
  let historySearchTimer = null;

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function canonicalDispatchTeamName(value) {
    const name = String(value ?? "").trim();
    const legacyName = ["ren", "trak"].join("");
    return name.toLowerCase() === legacyName ? "Matrix" : name;
  }

  function parseJsonResponse(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) return {};
    try {
      return JSON.parse(trimmed);
    } catch (_error) {
      const responseDocument = new DOMParser().parseFromString(trimmed, "text/html");
      const tableChunks = Array.from(responseDocument.querySelectorAll("tbody td"))
        .map((cell) => cell.textContent || "")
        .join("");
      const documentText = responseDocument.body.textContent || "";
      for (const candidate of [tableChunks, documentText]) {
        const start = candidate.indexOf("{");
        const end = candidate.lastIndexOf("}");
        if (start === -1 || end <= start) continue;
        try {
          return JSON.parse(candidate.slice(start, end + 1));
        } catch (_nestedError) {}
      }
      return {};
    }
  }

  async function requestJson(url, options = {}) {
    const body = options.body instanceof FormData
      ? new URLSearchParams(Array.from(options.body.entries()).map(([key, value]) => [key, String(value)]))
      : options.body;
    const response = await fetch(url, {
      credentials: "include",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {})
      },
      ...options,
      body
    });
    const payload = parseJsonResponse(await response.text());
    if (response.status === 401 || payload?.status === "unauthorized") {
      globalThis.redirectDispatchToSignIn?.();
      throw new Error(payload?.message || "Your signed-in session is no longer active.");
    }
    if (!response.ok) throw new Error(payload?.message || `Request failed with HTTP ${response.status}.`);
    return payload;
  }

  function showNotice(message, type = "success") {
    elements.notice.textContent = message;
    elements.notice.className = `notice ${type}`;
    elements.notice.hidden = false;
    window.clearTimeout(showNotice.timer);
    showNotice.timer = window.setTimeout(() => { elements.notice.hidden = true; }, 5500);
  }

  function closeConfirmation(confirmed) {
    if (!activeConfirmation) return;
    const confirmation = activeConfirmation;
    activeConfirmation = null;
    elements.confirmOverlay.hidden = true;
    document.body.classList.remove("eta-modal-open");
    confirmation.previousFocus?.focus?.();
    confirmation.resolve(confirmed);
  }

  function requestConfirmation({
    title,
    message,
    confirmLabel = "Confirm",
    cancelLabel = "Go back",
    tone = "default"
  }) {
    if (activeConfirmation) closeConfirmation(false);

    elements.confirmTitle.textContent = title;
    elements.confirmMessage.textContent = message;
    elements.confirmAccept.textContent = confirmLabel;
    elements.confirmCancel.textContent = cancelLabel;
    elements.confirmDialog.dataset.tone = tone;
    elements.confirmAccept.classList.toggle("is-danger", tone === "danger");
    elements.confirmOverlay.hidden = false;
    document.body.classList.add("eta-modal-open");

    return new Promise((resolve) => {
      activeConfirmation = { resolve, previousFocus: document.activeElement };
      window.requestAnimationFrame(() => elements.confirmAccept.focus());
    });
  }

  elements.confirmAccept.addEventListener("click", () => closeConfirmation(true));
  elements.confirmCancel.addEventListener("click", () => closeConfirmation(false));
  elements.confirmClose.addEventListener("click", () => closeConfirmation(false));
  elements.confirmOverlay.addEventListener("click", (event) => {
    if (event.target === elements.confirmOverlay) closeConfirmation(false);
  });

  document.addEventListener("keydown", (event) => {
    if (!activeConfirmation) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeConfirmation(false);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(elements.confirmDialog.querySelectorAll("button:not([disabled])"));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("en-ZA", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
    }).format(date);
  }

  function secondsRemaining(request) {
    if (request.status !== "Open") return 0;
    return Math.max(0, Math.floor((new Date(request.expiresAt).getTime() - Date.now()) / 1000));
  }

  function countdownLabel(request) {
    const seconds = secondsRemaining(request);
    if (!seconds) return request.status === "Open" ? "Overdue" : request.status;
    const minutes = Math.floor(seconds / 60);
    return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }

  function statusClass(status) {
    return `eta-status eta-status-${String(status || "pending").toLowerCase().replace(/[^a-z]/g, "")}`;
  }

  function mapUrl(request) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${request.latitude},${request.longitude}`)}`;
  }

  function canViewDispatchLink() {
    const userType = String(state.context?.userType ?? state.context?.user_type ?? "").trim();
    const isHelpdeskUser = [true, 1, "1", "true"].includes(state.context?.helpdesk);
    return userType === "7" || userType === "8" || userType === "14" || (userType === "1" && isHelpdeskUser);
  }

  function renderContext() {
    const role = state.context?.role || "None";
    const isDispatchTeam = role === "DispatchTeam";
    const allowed = role === "CallCentre" || (isDispatchTeam && Boolean(state.context?.teamIsActive));
    elements.accessDenied.hidden = allowed;
    elements.setupRequired.hidden = true;
    elements.workspace.hidden = !allowed;
    if (!allowed) {
      elements.profilePill.textContent = isDispatchTeam ? "Inactive dispatch team" : "No ETA group";
      elements.userDisplayName.textContent = state.context?.username || "Signed-in profile";
      elements.userRoleLabel.textContent = isDispatchTeam ? "Dispatch team is inactive" : "ETA access not assigned";
      for (const element of document.querySelectorAll("[data-show-for-dispatch-access], [data-show-for-eta-access], [data-show-for-dispatch-operations], [data-show-for-dispatch-team], [data-show-for-call-centre], [data-hide-for-user-type], [data-show-for-user-type]")) {
        element.hidden = true;
      }
      return;
    }

    const isCallCentre = role === "CallCentre";
    const hasDispatchAccess = canViewDispatchLink() || isDispatchTeam;
    if (elements.sidebarProfile) elements.sidebarProfile.hidden = isCallCentre;
    for (const element of document.querySelectorAll("[data-show-for-dispatch-access]")) {
      element.hidden = !hasDispatchAccess;
    }
    for (const element of document.querySelectorAll("[data-show-for-eta-access]")) {
      element.hidden = false;
    }
    for (const element of document.querySelectorAll("[data-show-for-dispatch-operations]")) {
      element.hidden = !hasDispatchAccess || !isCallCentre;
    }
    for (const element of document.querySelectorAll("[data-show-for-dispatch-team]")) {
      element.hidden = !isDispatchTeam;
    }
    for (const element of document.querySelectorAll("[data-show-for-call-centre]")) {
      element.hidden = !isCallCentre;
    }
    const userType = String(state.context?.userType ?? "").trim();
    for (const element of document.querySelectorAll("[data-hide-for-user-type], [data-show-for-user-type]")) {
      const hiddenUserTypes = String(element.dataset.hideForUserType || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const shownUserTypes = String(element.dataset.showForUserType || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const restrictedToCallCentre = element.hasAttribute("data-show-for-call-centre");
      element.hidden = !userType
        || (restrictedToCallCentre && !isCallCentre)
        || hiddenUserTypes.includes(userType)
        || (shownUserTypes.length > 0 && (!isCallCentre || !shownUserTypes.includes(userType)));
    }
    syncSidebarGroups();
    const contextTeamName = canonicalDispatchTeamName(state.context?.teamName);
    const username = state.context?.username || (isCallCentre ? "Call Centre" : contextTeamName);
    elements.userDisplayName.textContent = username;
    elements.userRoleLabel.textContent = isCallCentre ? "Call Centre ETA access" : `${contextTeamName || "Dispatch team"} ETA access`;
    elements.userAvatar.textContent = String(isCallCentre ? "CC" : contextTeamName || "ETA")
      .split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
    elements.profilePill.textContent = isCallCentre ? "Call Centre" : contextTeamName || "Dispatch Team";
    elements.createPanel.hidden = !isCallCentre;
    elements.pageSubtitle.textContent = isCallCentre
      ? "Send coordinates to all active dispatch teams and select the nearest available response."
      : "Confirm whether your nearest ground team is available and enter its distance in kilometres.";
    elements.registerTitle.textContent = isCallCentre ? "Live team responses" : "Requests sent to your team";
    if (elements.actionLabel) elements.actionLabel.textContent = isCallCentre ? "Awaiting Selection" : "Needs Response";
    if (elements.actionHelp) elements.actionHelp.textContent = isCallCentre ? "Open requests requiring coordination" : "Open requests your team has not answered";
  }

  function renderSummary() {
    if (elements.openCount) elements.openCount.textContent = String(state.summary.openCount || 0);
    if (elements.actionCount) elements.actionCount.textContent = String(state.summary.actionCount || 0);
    if (elements.selectedCount) elements.selectedCount.textContent = String(state.summary.selectedCount || 0);
    for (const badge of document.querySelectorAll("[data-eta-request-count]")) {
      const count = Number(state.summary.actionCount || 0);
      badge.textContent = String(count);
      badge.hidden = count <= 0;
    }
    for (const badge of document.querySelectorAll("[data-team-active-dispatch-count]")) {
      const count = Number(state.teamActiveSummary.activeCount || 0);
      badge.textContent = String(count);
      badge.hidden = count <= 0;
    }
    for (const badge of document.querySelectorAll("[data-team-completed-dispatch-count]")) {
      const count = Number(state.teamActiveSummary.completedCount || 0);
      badge.textContent = String(count);
      badge.hidden = count <= 0;
    }
  }

  function getTeamQuota(teamName) {
    const normalizedName = canonicalDispatchTeamName(teamName).toLowerCase();
    return (Array.isArray(state.teamQuotas?.teams) ? state.teamQuotas.teams : [])
      .find((team) => canonicalDispatchTeamName(team?.teamName).toLowerCase() === normalizedName) || null;
  }

  function quotaTone(quota) {
    const usedPercent = Number(quota?.usagePercent || 0);
    const available = Number(quota?.availableCount || 0);
    if (available <= 0 || usedPercent >= 95) return "critical";
    if (usedPercent >= 80) return "warning";
    return "normal";
  }

  function renderTeamQuota() {
    const quota = getTeamQuota("Matrix");
    if (!elements.matrixQuota) return;
    const isCallCentre = state.context?.role === "CallCentre";
    elements.matrixQuota.hidden = !isCallCentre || !quota;
    elements.matrixQuota.classList.remove("is-warning", "is-critical");
    if (!isCallCentre || !quota) return;
    const tone = quotaTone(quota);
    if (tone !== "normal") elements.matrixQuota.classList.add(`is-${tone}`);
    const values = {
      etaMatrixRemaining: quota.remainingCount,
      etaMatrixLimit: quota.monthlyLimit,
      etaMatrixPeriod: state.teamQuotas.periodLabel || "this month",
      etaMatrixUsed: quota.usedCount,
      etaMatrixPending: quota.pendingCount,
      etaMatrixAvailable: quota.availableCount
    };
    for (const [id, value] of Object.entries(values)) {
      const element = document.getElementById(id);
      if (element) element.textContent = String(value ?? 0);
    }
    const progress = document.querySelector("#etaMatrixProgress");
    if (progress) progress.style.width = `${Math.min(100, Math.max(0, Number(quota.usagePercent || 0)))}%`;
  }

  function renderDispatchSummary() {
    for (const [key, value] of Object.entries(state.dispatchSummary)) {
      for (const badge of document.querySelectorAll(`[data-summary-count="${key}"]`)) {
        badge.textContent = String(value ?? 0);
      }
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

  function responseMarkup(request, response, nearestResponseId) {
    const isAvailable = ["Available", "Selected", "NotSelected"].includes(response.status);
    const isSelected = response.status === "Selected";
    const teamName = canonicalDispatchTeamName(response.teamName);
    const quota = getTeamQuota(teamName);
    const hasCapacity = !quota || Number(quota.availableCount || 0) > 0;
    const canSelect = state.context.role === "CallCentre" && request.status === "Open" && response.status === "Available" && hasCapacity;
    const quotaLabel = quota
      ? (hasCapacity ? `${quota.remainingCount} remaining · ${quota.pendingCount} pending` : "Monthly capacity reserved")
      : "";
    const quotaClass = quota ? quotaTone(quota) : "normal";
    return `
      <article class="eta-response ${isSelected ? "is-selected" : ""}">
        <div class="eta-response-team">
          <strong>${escapeHtml(teamName)}</strong>
          ${response.id === nearestResponseId && response.status === "Available" ? '<span class="eta-nearest">Nearest</span>' : ""}
          ${quota ? `<span class="eta-team-quota ${quotaClass === "normal" ? "" : `is-${quotaClass}`}">${escapeHtml(quotaLabel)}</span>` : ""}
        </div>
        <div>
          <span class="${statusClass(response.status)}">${escapeHtml(response.status)}</span>
          <small>${response.respondedAt ? `Responded ${escapeHtml(formatDate(response.respondedAt))}` : "Waiting for response"}</small>
        </div>
        <div class="eta-distance-value">${isAvailable && response.distanceKm != null ? `<strong>${escapeHtml(response.distanceKm)}</strong><span>km</span>` : "—"}</div>
        ${canSelect ? `<button class="filter-button compact" type="button" data-select-response="${response.id}" data-request-id="${request.id}" data-team-name="${escapeHtml(teamName)}" data-distance="${escapeHtml(response.distanceKm)}">Select team</button>` : ""}
      </article>`;
  }

  function locationStripMarkup(request, dateLabel) {
    const coordinates = `${request.latitude}, ${request.longitude}`;
    return `
      <div class="eta-location-strip">
        <div class="eta-location-details">
          <span><b>Coordinates</b> ${escapeHtml(request.latitude)}, ${escapeHtml(request.longitude)}</span>
          <span><b>${escapeHtml(dateLabel)}</b> ${escapeHtml(formatDate(request.createdAt))}</span>
        </div>
        <div class="eta-location-actions" aria-label="Coordinate actions">
          <a class="eta-location-action" href="${escapeHtml(mapUrl(request))}" target="_blank" rel="noopener noreferrer" aria-label="Open coordinates in map" title="Open coordinates in map">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"></path><path d="M9 3v15M15 6v15"></path></svg>
            <span class="sr-only">Open coordinates in map</span>
          </a>
          <button class="eta-location-action eta-copy-action" type="button" data-copy-coordinates="${escapeHtml(coordinates)}" aria-label="Copy coordinates" title="Copy coordinates">
            <svg class="eta-copy-default-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path></svg>
            <svg class="eta-copy-success-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"></path></svg>
            <svg class="eta-copy-error-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg>
            <span class="sr-only" data-copy-status>Copy coordinates</span>
          </button>
        </div>
      </div>`;
  }

  function callCentreCardMarkup(request) {
    const responses = Array.isArray(request.responses) ? request.responses : [];
    const available = responses.filter((response) => response.status === "Available" && Number(response.distanceKm) > 0);
    const nearestResponseId = available.sort((a, b) => Number(a.distanceKm) - Number(b.distanceKm))[0]?.id;
    return `
      <article class="eta-request-card" data-request-card="${request.id}">
        <header class="eta-request-header">
          <div>
            <div class="eta-request-number">${escapeHtml(request.requestNumber)}</div>
            <h3>${escapeHtml(request.registration)}</h3>
            <p><b>Incident type</b> ${escapeHtml(request.shortDescription)}</p>
          </div>
          <div class="eta-request-state">
            <span class="${statusClass(request.status)}">${escapeHtml(request.status)}</span>
            <strong class="eta-countdown ${request.isOverdue ? "is-overdue" : ""}" data-expires-at="${escapeHtml(request.expiresAt)}" data-request-status="${escapeHtml(request.status)}">${escapeHtml(countdownLabel(request))}</strong>
          </div>
        </header>
        ${locationStripMarkup(request, "Created")}
        <div class="eta-response-grid">
          ${responses.length ? responses.map((response) => responseMarkup(request, response, nearestResponseId)).join("") : '<p class="eta-empty-response">No dispatch teams were assigned.</p>'}
        </div>
        <footer class="eta-request-footer">
          ${request.status === "Open" ? `<button class="eta-text-button danger" type="button" data-cancel-request="${request.id}">Cancel request</button>` : ""}
          ${request.dispatchIncidentId ? `<a class="filter-button compact" href="dispatch.html?id=${encodeURIComponent(request.dispatchIncidentId)}">Open dispatch draft</a>` : ""}
          <span>Requested by ${escapeHtml(request.createdBy || "—")}</span>
        </footer>
      </article>`;
  }

  function teamCardMarkup(request) {
    const response = Array.isArray(request.responses) ? request.responses[0] : null;
    const editable = request.status === "Open";
    const currentStatus = response?.status === "Unavailable" ? "Unavailable" : "Available";
    return `
      <article class="eta-request-card eta-team-request" data-request-card="${request.id}">
        <header class="eta-request-header">
          <div>
            <div class="eta-request-number">${escapeHtml(request.requestNumber)}</div>
            <h3>${escapeHtml(request.registration)}</h3>
            <p><b>Incident type</b> ${escapeHtml(request.shortDescription)}</p>
          </div>
          <div class="eta-request-state">
            <span class="${statusClass(request.status)}">${escapeHtml(request.status)}</span>
            <strong class="eta-countdown ${request.isOverdue ? "is-overdue" : ""}" data-expires-at="${escapeHtml(request.expiresAt)}" data-request-status="${escapeHtml(request.status)}">${escapeHtml(countdownLabel(request))}</strong>
          </div>
        </header>
        ${locationStripMarkup(request, "Requested")}
        <form class="eta-team-response-form" data-response-form data-request-id="${request.id}">
          <label>
            <span>Availability</span>
            <select name="availability" ${editable ? "" : "disabled"}>
              <option value="Available" ${currentStatus === "Available" ? "selected" : ""}>Available</option>
              <option value="Unavailable" ${currentStatus === "Unavailable" ? "selected" : ""}>Unavailable</option>
            </select>
          </label>
          <label data-distance-field>
            <span>Nearest team distance (km)</span>
            <input name="distanceKm" type="text" inputmode="decimal" pattern="[0-9]{1,7}(?:[.][0-9])?" maxlength="9" value="${escapeHtml(response?.distanceKm ?? "")}" placeholder="e.g. 12.5" title="Use numbers only, with up to one decimal place." autocomplete="off" ${editable ? "" : "disabled"}>
          </label>
          ${editable ? '<button class="filter-button" type="submit">Save response</button>' : ""}
          <div class="eta-current-response">
            <span>Current response</span>
            <strong class="${statusClass(response?.status || "Pending")}">${escapeHtml(response?.status || "Pending")}</strong>
          </div>
        </form>
      </article>`;
  }

  function renderRequests() {
    const requests = state.requests.filter((request) => request.status === "Open");
    if (!requests.length) {
      elements.requestList.innerHTML = `
        <div class="eta-empty-state">
          <div class="eta-empty-icon" aria-hidden="true">✓</div>
          <h3>No active ETA requests</h3>
          <p>${state.context?.role === "CallCentre" ? "Create a request above when ground-team distances are needed." : "Your team has no requests awaiting a response."}</p>
        </div>`;
      return;
    }
    elements.requestList.innerHTML = requests
      .map((request) => state.context.role === "CallCentre" ? callCentreCardMarkup(request) : teamCardMarkup(request))
      .join("");
    syncAvailabilityControls();
  }

  function historicalOutcome(request) {
    const responses = Array.isArray(request.responses) ? request.responses : [];
    const selected = responses.find((response) => response.status === "Selected");
    if (selected || request.selectedTeamName) {
      const teamName = canonicalDispatchTeamName(selected?.teamName || request.selectedTeamName);
      const distance = selected?.distanceKm ?? request.selectedDistanceKm;
      return `${escapeHtml(teamName)}${distance != null ? ` · ${escapeHtml(distance)} km` : ""}`;
    }
    const available = responses
      .filter((response) => ["Available", "NotSelected"].includes(response.status) && Number(response.distanceKm) > 0)
      .sort((a, b) => Number(a.distanceKm) - Number(b.distanceKm))[0];
    if (available) return `${escapeHtml(canonicalDispatchTeamName(available.teamName))} available · ${escapeHtml(available.distanceKm)} km`;
    if (responses.some((response) => response.status === "Unavailable")) return "No available team";
    return "No responses";
  }

  function historyRowsMarkup(requests) {
    const isCallCentre = state.context?.role === "CallCentre";
    if (!requests.length) {
      return `<tr><td class="eta-history-empty" colspan="8">No historical ETA requests yet.</td></tr>`;
    }
    return requests.map((request) => {
      const response = Array.isArray(request.responses) ? request.responses[0] : null;
      const coordinates = `${request.latitude}, ${request.longitude}`;
      const commonCells = `
        <td><strong>${escapeHtml(request.requestNumber)}</strong></td>
        <td>${escapeHtml(request.registration)}</td>
        <td>${escapeHtml(request.shortDescription)}</td>
        <td><a href="${escapeHtml(mapUrl(request))}" target="_blank" rel="noopener noreferrer">${escapeHtml(coordinates)}</a></td>
        <td><span class="${statusClass(request.status)}">${escapeHtml(request.status)}</span></td>`;
      if (isCallCentre) {
        return `<tr>${commonCells}
          <td>${historicalOutcome(request)}</td>
          <td>${escapeHtml(formatDate(request.createdAt))}</td>
          <td>${request.dispatchIncidentId ? `<a class="eta-history-draft" href="dispatch.html?id=${encodeURIComponent(request.dispatchIncidentId)}">Open draft</a>` : "—"}</td>
        </tr>`;
      }
      return `<tr>${commonCells}
        <td><span class="${statusClass(response?.status || "Pending")}">${escapeHtml(response?.status || "Pending")}</span></td>
        <td>${response?.distanceKm != null ? `${escapeHtml(response.distanceKm)} km` : "—"}</td>
        <td>${escapeHtml(formatDate(request.createdAt))}</td>
      </tr>`;
    }).join("");
  }

  function renderHistory() {
    const requests = state.historyRequests;
    const isCallCentre = state.context?.role === "CallCentre";
    elements.historyCount.textContent = String(state.historyTotal);
    elements.historyHead.innerHTML = `<tr>
      <th>Request</th>
      <th>Registration</th>
      <th>Incident type</th>
      <th>Coordinates</th>
      <th>Status</th>
      <th>${isCallCentre ? "Outcome" : "Your response"}</th>
      <th>${isCallCentre ? "Requested" : "Distance"}</th>
      <th>${isCallCentre ? "Draft" : "Requested"}</th>
    </tr>`;
    elements.historyBody.innerHTML = state.historyLoading
      ? `<tr><td class="eta-history-empty" colspan="8">Loading history…</td></tr>`
      : state.historyError
        ? `<tr><td class="eta-history-empty" colspan="8">Could not load ETA history. Refresh to try again.</td></tr>`
        : requests.length
          ? historyRowsMarkup(requests)
          : `<tr><td class="eta-history-empty" colspan="8">${state.historySearch ? "No registrations match this filter." : "No historical ETA requests yet."}</td></tr>`;
    const pageCount = Math.max(1, Math.ceil(state.historyTotal / 10));
    elements.historyPagination.hidden = state.historyTotal <= 10;
    elements.historyPrevious.disabled = state.historyLoading || state.historyPage <= 1;
    elements.historyNext.disabled = state.historyLoading || state.historyPage >= pageCount;
    elements.historyPageStatus.textContent = `Page ${state.historyPage} of ${pageCount}`;
  }

  async function loadHistory() {
    if (!state.context || !["CallCentre", "DispatchTeam"].includes(state.context.role)) return;
    const sequence = ++historyRequestSequence;
    state.historyLoading = true;
    state.historyError = false;
    renderHistory();
    const query = new URLSearchParams({ page: String(state.historyPage), search: state.historySearch, _: String(Date.now()) });
    try {
      const payload = await requestJson(`${endpoints.history}?${query}`);
      if (!Array.isArray(payload?.requests) || !Number.isFinite(Number(payload?.totalCount))) {
        throw new Error("ETA history API returned an invalid response.");
      }
      if (sequence !== historyRequestSequence) return;
      state.historyRequests = payload.requests;
      state.historyTotal = Number(payload.totalCount);
      state.historyError = false;
      if (state.historyPage > 1 && !state.historyRequests.length && state.historyTotal > 0) {
        state.historyPage = Math.max(1, Math.ceil(state.historyTotal / 10));
        return loadHistory();
      }
    } catch (error) {
      if (sequence !== historyRequestSequence) return;
      console.warn("ETA history could not be loaded:", error);
      state.historyError = true;
    } finally {
      if (sequence === historyRequestSequence) {
        state.historyLoading = false;
        renderHistory();
      }
    }
  }

  function syncAvailabilityControls(scope = document) {
    for (const form of scope.querySelectorAll("[data-response-form]")) {
      const availability = form.elements.availability?.value;
      const distance = form.elements.distanceKm;
      if (!distance) continue;
      const unavailable = availability === "Unavailable";
      distance.disabled = unavailable || form.elements.availability.disabled;
      distance.required = !unavailable && !distance.disabled;
      if (unavailable) distance.value = "";
      form.querySelector("[data-distance-field]")?.classList.toggle("is-disabled", unavailable);
    }
  }

  function sanitizeDistanceValue(value) {
    let sanitized = String(value || "")
      .replace(",", ".")
      .replace(/[^0-9.]/g, "");
    if (sanitized.startsWith(".")) sanitized = `0${sanitized}`;
    const decimalIndex = sanitized.indexOf(".");
    if (decimalIndex === -1) return sanitized.slice(0, 7);
    const whole = sanitized.slice(0, decimalIndex).slice(0, 7);
    const decimal = sanitized.slice(decimalIndex + 1).replaceAll(".", "").slice(0, 1);
    return `${whole}.${decimal}`;
  }

  function validateDistanceInput(input) {
    if (!input || input.disabled || !input.required || !input.value) {
      input?.setCustomValidity("");
      return;
    }
    const valid = /^[0-9]{1,7}(?:\.[0-9])?$/.test(input.value) && Number(input.value) > 0;
    input.setCustomValidity(valid ? "" : "Enter a distance greater than zero using numbers only.");
  }

  function render() {
    renderContext();
    renderSummary();
    renderTeamQuota();
    if (state.context?.role === "CallCentre" || state.context?.role === "DispatchTeam") {
      renderRequests();
      renderHistory();
    }
  }

  async function loadRequests(options = {}) {
    if (state.loading) return;
    state.loading = true;
    elements.refreshButton.disabled = true;
    try {
      const payload = await requestJson(`${endpoints.list}?_=${Date.now()}`);
      if (!payload?.context || !Array.isArray(payload?.requests) || !payload?.summary) {
        throw new Error("ETA Requests API returned an invalid response.");
      }
      state.context = payload.context || { role: "None" };
      state.summary = payload.summary || state.summary;
      state.requests = Array.isArray(payload.requests) ? payload.requests : [];
      render();
      globalThis.dispatchEtaNotifications?.update(state.context, state.requests.filter((request) =>
        request.status === "Open" && request.responses?.some((response) =>
          Number(response.teamId) === Number(state.context.teamId) && response.status === "Pending")));
      loadHistory();
      if (!options.silent) showNotice("ETA requests refreshed.");
    } catch (error) {
      elements.workspace.hidden = true;
      elements.accessDenied.hidden = true;
      elements.setupRequired.hidden = false;
      elements.profilePill.textContent = "Service unavailable";
      elements.userDisplayName.textContent = "ETA Requests";
      elements.userRoleLabel.textContent = "Could not load requests";
      for (const element of document.querySelectorAll("[data-show-for-dispatch-access], [data-show-for-eta-access], [data-show-for-dispatch-team]")) {
        element.hidden = true;
      }
      for (const element of document.querySelectorAll("[data-show-for-dispatch-operations]")) {
        element.hidden = true;
      }
      showNotice(error.message, "error");
    } finally {
      state.loading = false;
      elements.refreshButton.disabled = false;
    }
  }

  async function loadDispatchSummary() {
    try {
      const payload = await requestJson(`${endpoints.dispatchSummary}?_=${Date.now()}`);
      state.dispatchSummary = { ...state.dispatchSummary, ...(payload || {}) };
      renderDispatchSummary();
    } catch (error) {
      console.warn("Dispatch summary could not be loaded:", error);
    }
  }

  async function loadTicketNavCounts() {
    try {
      const payload = await requestJson(`${endpoints.ticketSummary}?_=${Date.now()}`);
      renderTicketNavCounts(payload?.stats || {});
    } catch (error) {
      console.warn("Ticket navigation counts could not be loaded:", error);
    }
  }

  async function loadTeamActiveSummary() {
    try {
      const payload = await requestJson(`${endpoints.teamActiveDispatches}?_=${Date.now()}`);
      state.teamActiveSummary = { ...state.teamActiveSummary, ...(payload?.summary || {}) };
      renderSummary();
    } catch (error) {
      console.warn("Team active dispatch summary could not be loaded:", error);
    }
  }

  async function loadTeamQuotas() {
    try {
      const payload = await requestJson(`${endpoints.teamQuotas}?_=${Date.now()}`);
      state.teamQuotas = {
        periodLabel: String(payload?.periodLabel || ""),
        teams: Array.isArray(payload?.teams) ? payload.teams : []
      };
      renderTeamQuota();
      if (state.context?.role === "CallCentre" || state.context?.role === "DispatchTeam") renderRequests();
    } catch (error) {
      console.warn("Dispatch team quotas could not be loaded:", error);
    }
  }

  async function submitAction(endpoint, formData, workingMessage) {
    const payload = await requestJson(endpoint, { method: "POST", body: formData });
    if (!["ok", "already_selected"].includes(payload.status)) throw new Error(payload.message || workingMessage);
    showNotice(payload.message || workingMessage);
    await Promise.all([loadRequests({ silent: true }), loadDispatchSummary(), loadTeamActiveSummary(), loadTeamQuotas()]);
    return payload;
  }

  elements.requestForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!elements.requestForm.reportValidity()) return;
    elements.createButton.disabled = true;
    try {
      const payload = await submitAction(endpoints.create, new FormData(elements.requestForm), "ETA request could not be created.");
      if (payload.status === "ok") {
        elements.requestForm.reset();
      }
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      elements.createButton.disabled = false;
    }
  });

  elements.requestForm.elements.registration.addEventListener("input", (event) => {
    const cursor = event.target.selectionStart;
    event.target.value = event.target.value.toUpperCase();
    event.target.setSelectionRange(cursor, cursor);
  });

  elements.requestList.addEventListener("change", (event) => {
    if (event.target.matches('select[name="availability"]')) syncAvailabilityControls(event.target.form);
  });

  elements.requestList.addEventListener("input", (event) => {
    if (!event.target.matches('input[name="distanceKm"]')) return;
    event.target.value = sanitizeDistanceValue(event.target.value);
    validateDistanceInput(event.target);
  });

  elements.requestList.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-response-form]");
    if (!form) return;
    event.preventDefault();
    syncAvailabilityControls(form);
    validateDistanceInput(form.elements.distanceKm);
    if (!form.reportValidity()) return;
    const formData = new FormData(form);
    formData.set("requestId", form.dataset.requestId);
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await submitAction(endpoints.respond, formData, "ETA response saved.");
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      button.disabled = false;
    }
  });

  elements.requestList.addEventListener("click", async (event) => {
    const copyButton = event.target.closest("[data-copy-coordinates]");
    if (copyButton) {
      window.clearTimeout(copyButton.copyStateTimer);
      const status = copyButton.querySelector("[data-copy-status]");
      try {
        await navigator.clipboard.writeText(copyButton.dataset.copyCoordinates);
        copyButton.classList.remove("is-copy-error");
        copyButton.classList.add("is-copied");
        copyButton.setAttribute("aria-label", "Coordinates copied");
        copyButton.title = "Coordinates copied";
        if (status) status.textContent = "Coordinates copied";
      } catch (_error) {
        copyButton.classList.remove("is-copied");
        copyButton.classList.add("is-copy-error");
        copyButton.setAttribute("aria-label", "Could not copy coordinates");
        copyButton.title = "Could not copy coordinates";
        if (status) status.textContent = "Could not copy coordinates";
      }
      copyButton.copyStateTimer = window.setTimeout(() => {
        if (!copyButton.isConnected) return;
        copyButton.classList.remove("is-copied", "is-copy-error");
        copyButton.setAttribute("aria-label", "Copy coordinates");
        copyButton.title = "Copy coordinates";
        if (status) status.textContent = "Copy coordinates";
      }, 1800);
      return;
    }

    const selectButton = event.target.closest("[data-select-response]");
    if (selectButton) {
      const confirmed = await requestConfirmation({
        title: "Create dispatch draft?",
        message: `Select ${selectButton.dataset.teamName} at ${selectButton.dataset.distance} km? This will create a new dispatch draft.`,
        confirmLabel: "Select team"
      });
      if (!confirmed) return;
      selectButton.disabled = true;
      try {
        const data = new FormData();
        data.set("requestId", selectButton.dataset.requestId);
        data.set("responseId", selectButton.dataset.selectResponse);
        const payload = await submitAction(endpoints.select, data, "Dispatch draft created.");
        if (payload.dispatchIncidentId) {
          const openDraft = await requestConfirmation({
            title: "Dispatch draft created",
            message: "The dispatch draft is ready. Would you like to open it now?",
            confirmLabel: "Open draft",
            cancelLabel: "Stay here"
          });
          if (openDraft) window.location.href = `dispatch.html?id=${encodeURIComponent(payload.dispatchIncidentId)}`;
        }
      } catch (error) {
        showNotice(error.message, "error");
      } finally {
        selectButton.disabled = false;
      }
      return;
    }

    const cancelButton = event.target.closest("[data-cancel-request]");
    if (cancelButton) {
      const confirmed = await requestConfirmation({
        title: "Cancel ETA request?",
        message: "This will cancel the request for all dispatch teams.",
        confirmLabel: "Cancel request",
        cancelLabel: "Keep request",
        tone: "danger"
      });
      if (!confirmed) return;
      cancelButton.disabled = true;
      try {
        const data = new FormData();
        data.set("requestId", cancelButton.dataset.cancelRequest);
        await submitAction(endpoints.cancel, data, "ETA request cancelled.");
      } catch (error) {
        showNotice(error.message, "error");
      } finally {
        cancelButton.disabled = false;
      }
    }
  });

  elements.refreshButton.addEventListener("click", () => {
    loadRequests();
    loadDispatchSummary();
    loadTicketNavCounts();
    loadTeamQuotas();
  });

  elements.historySearch.addEventListener("input", () => {
    clearTimeout(historySearchTimer);
    historySearchTimer = setTimeout(() => {
      state.historySearch = elements.historySearch.value.trim();
      state.historyPage = 1;
      loadHistory();
    }, 250);
  });
  elements.historyPrevious.addEventListener("click", () => {
    if (state.historyPage <= 1) return;
    state.historyPage -= 1;
    loadHistory();
  });
  elements.historyNext.addEventListener("click", () => {
    if (state.historyPage * 10 >= state.historyTotal) return;
    state.historyPage += 1;
    loadHistory();
  });

  function setSidebarCollapsed(collapsed) {
    elements.appShell.classList.toggle("sidebar-collapsed", collapsed);
    localStorage.setItem("pulsit-sidebar-collapsed", collapsed ? "1" : "0");
    elements.sidebarCollapseButton.setAttribute("aria-expanded", String(!collapsed));
  }

  function getSidebarGroupState() {
    try {
      return JSON.parse(localStorage.getItem(sidebarGroupStorageKey) || "{}");
    } catch (_error) {
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
      const group = section.dataset.sidebarGroup;
      const hasActiveChild = Boolean(section.querySelector(".active, .is-active"));
      const defaultOpen = group === "tickets" || group === "escalations" || group === "dispatch" || hasActiveChild;
      setSidebarGroupOpen(section, saved[group] ?? defaultOpen, false);
    }
  }

  elements.sidebarCollapseButton.addEventListener("click", () => {
    setSidebarCollapsed(!elements.appShell.classList.contains("sidebar-collapsed"));
  });

  document.querySelector(".sidebar-nav").addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-sidebar-toggle]");
    const section = toggle?.closest("[data-sidebar-group]");
    if (!section) return;
    const open = !section.classList.contains("is-open");
    setSidebarGroupOpen(section, open);
  });

  function syncThemeToggle() {
    const theme = localStorage.getItem("srf-jobcard-theme") === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    elements.themeToggle.checked = theme === "dark";
  }

  syncThemeToggle();
  elements.themeToggle.addEventListener("change", () => {
    const theme = elements.themeToggle.checked ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("srf-jobcard-theme", theme);
  });

  syncSidebarGroups();
  setSidebarCollapsed(window.matchMedia("(max-width: 980px)").matches || localStorage.getItem("pulsit-sidebar-collapsed") !== "0");

  window.setInterval(() => {
    for (const countdown of document.querySelectorAll(".eta-countdown")) {
      const expiresAt = new Date(countdown.dataset.expiresAt).getTime();
      if (countdown.dataset.requestStatus !== "Open") continue;
      const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      countdown.textContent = remaining
        ? `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`
        : "Overdue";
      countdown.classList.toggle("is-overdue", !remaining);
    }
  }, 1000);

  window.setInterval(() => {
    loadRequests({ silent: true });
    loadDispatchSummary();
    loadTicketNavCounts();
    loadTeamActiveSummary();
    loadTeamQuotas();
  }, 15000);
  loadTeamQuotas().finally(() => loadRequests({ silent: true }));
  loadDispatchSummary();
  loadTicketNavCounts();
  loadTeamActiveSummary();
})();
