(async function () {
  "use strict";

  if (globalThis.dispatchAuthReady) await globalThis.dispatchAuthReady;

  const path = window.location.pathname;
  const marker = "/dispatch_link/";
  const markerIndex = path.toLowerCase().indexOf(marker);
  const dispatchLinkBase = markerIndex !== -1 ? path.slice(0, markerIndex + marker.length - 1) : "/dispatch_link";
  const apiBase = `${dispatchLinkBase}/api`;
  const endpoints = {
    activeDispatches: `${apiBase}/team_active_dispatches.sql`,
    etaSummary: `${apiBase}/eta_team_notifications.sql`,
    saveDetails: `${apiBase}/save_team_dispatch_details.sql`,
    uploadReport: `${apiBase}/upload_team_incident_report.sql`,
    replaceReport: `${apiBase}/replace_team_incident_report.sql`
  };
  const sidebarGroupStorageKey = "pulsit-sidebar-groups";
  const completedView = new URLSearchParams(window.location.search).get("view") === "completed";

  const state = {
    context: null,
    summary: { activeCount: 0, completedCount: 0, filteredCount: 0, pageNumber: 1, pageSize: 10 },
    dispatches: [],
    expandedDispatchIds: new Set(),
    search: "",
    page: 1,
    requestId: 0,
    apiUpgradeRequired: false,
    loading: false
  };

  const elements = {
    appShell: document.querySelector(".app-shell"),
    sidebarCollapseButton: document.querySelector("#sidebarCollapseButton"),
    themeToggle: document.querySelector("#themeToggle"),
    dispatchNav: document.querySelector("#teamDispatchNav"),
    completedNav: document.querySelector("#teamCompletedNav"),
    sidebarProfile: document.querySelector("#teamSidebarProfile"),
    userAvatar: document.querySelector("#teamUserAvatar"),
    userDisplayName: document.querySelector("#teamUserDisplayName"),
    userRoleLabel: document.querySelector("#teamUserRoleLabel"),
    profilePill: document.querySelector("#teamProfilePill"),
    pageTitle: document.querySelector("#teamDispatchPageTitle"),
    listTitle: document.querySelector("#teamDispatchListTitle"),
    listDescription: document.querySelector("#teamDispatchListDescription"),
    notice: document.querySelector("#teamDispatchNotice"),
    accessDenied: document.querySelector("#teamDispatchAccessDenied"),
    setupRequired: document.querySelector("#teamDispatchSetupRequired"),
    workspace: document.querySelector("#teamDispatchWorkspace"),
    activeCountNav: document.querySelector("#teamActiveCountNav"),
    completedCountNav: document.querySelector("#teamCompletedCountNav"),
    etaCount: document.querySelector("#teamEtaCount"),
    list: document.querySelector("#teamDispatchList"),
    refreshButton: document.querySelector("#teamDispatchRefreshButton"),
    searchInput: document.querySelector("#teamDispatchSearch"),
    pagination: document.querySelector("#teamDispatchPagination"),
    previousButton: document.querySelector("#teamDispatchPrevious"),
    nextButton: document.querySelector("#teamDispatchNext"),
    pageStatus: document.querySelector("#teamDispatchPageStatus")
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
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
    const body = options.body;
    const isUrlEncoded = body instanceof URLSearchParams;
    const response = await fetch(url, {
      credentials: "include",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(isUrlEncoded ? { "Content-Type": "application/x-www-form-urlencoded" } : {})
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

  function formatDate(value) {
    if (!value) return "Not recorded";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("en-ZA", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function valueOrDash(value) {
    const text = String(value ?? "").trim();
    return text || "—";
  }

  function formatDateTimeInput(value) {
    const text = String(value || "").trim();
    const match = text.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
    return match ? `${match[1]}T${match[2]}` : "";
  }

  function mapUrl(dispatch) {
    if (dispatch.latitude === null || dispatch.latitude === undefined || dispatch.longitude === null || dispatch.longitude === undefined) return "";
    const latitude = Number(dispatch.latitude);
    const longitude = Number(dispatch.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return "";
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`;
  }

  function coordinatesText(dispatch) {
    if (!mapUrl(dispatch)) return "";
    return `${Number(dispatch.latitude)}, ${Number(dispatch.longitude)}`;
  }

  function showNotice(message, type = "success") {
    elements.notice.textContent = message;
    elements.notice.className = `notice ${type}`;
    elements.notice.hidden = false;
    window.clearTimeout(showNotice.timer);
    showNotice.timer = window.setTimeout(() => { elements.notice.hidden = true; }, 4500);
  }

  function renderContext() {
    const allowed = state.context?.role === "DispatchTeam" && Boolean(state.context?.teamIsActive);
    elements.dispatchNav.hidden = !allowed;
    elements.workspace.hidden = !allowed;
    elements.accessDenied.hidden = allowed;
    elements.setupRequired.hidden = true;

    const username = state.context?.username || "Signed-in profile";
    const teamName = state.context?.teamName || "Dispatch team";
    elements.userDisplayName.textContent = username;
    elements.userRoleLabel.textContent = allowed ? `${teamName} dispatch access` : "Dispatch access not assigned";
    elements.userAvatar.textContent = teamName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "DT";
    elements.profilePill.textContent = allowed ? teamName : "No dispatch team";
    elements.pageTitle.textContent = completedView ? "Completed Dispatches" : "Active Dispatches";
    elements.listTitle.textContent = completedView ? "Completed dispatches" : "Dispatches assigned to your team";
    elements.listDescription.textContent = completedView
      ? "Both the team OB number and dispatch-team incident report have been provided."
      : "A dispatch remains active until both its team OB number and dispatch-team incident report are provided.";
    const activeNav = elements.activeCountNav.closest(".nav-sublink");
    activeNav.classList.toggle("active", !completedView);
    elements.completedNav.classList.toggle("active", completedView);
    activeNav.removeAttribute("aria-current");
    elements.completedNav.removeAttribute("aria-current");
    (completedView ? elements.completedNav : activeNav).setAttribute("aria-current", "page");
    if (allowed) syncSidebarGroups();
  }

  function renderSummary() {
    const activeCount = Number(state.summary.activeCount || 0);
    const completedCount = Number(state.summary.completedCount || 0);
    const filteredCount = Number(state.summary.filteredCount || 0);
    const pageSize = Number(state.summary.pageSize || 10);
    elements.activeCountNav.textContent = String(activeCount);
    elements.activeCountNav.hidden = activeCount <= 0;
    elements.completedCountNav.textContent = String(completedCount);
    elements.completedCountNav.hidden = state.apiUpgradeRequired || completedCount <= 0;
    elements.pagination.hidden = filteredCount <= pageSize;
    elements.previousButton.disabled = state.page <= 1;
    elements.nextButton.disabled = state.page * pageSize >= filteredCount;
    elements.pageStatus.textContent = `Page ${state.page} of ${Math.max(1, Math.ceil(filteredCount / pageSize))}`;
  }

  function renderDispatches() {
    if (state.apiUpgradeRequired) {
      elements.list.innerHTML = `
        <div class="eta-empty-state">
          <div class="eta-empty-icon" aria-hidden="true">!</div>
          <h3>Completed dispatches are unavailable</h3>
          <p>The dispatch data endpoint needs the completed-list update before this view can load.</p>
        </div>`;
      return;
    }
    if (!state.dispatches.length) {
      elements.list.innerHTML = `
        <div class="eta-empty-state">
          <div class="eta-empty-icon" aria-hidden="true">✓</div>
          <h3>${state.search ? "No matching dispatches" : completedView ? "No completed dispatches" : "No active dispatches"}</h3>
          <p>${state.search ? "Try another registration or team OB number." : completedView ? "Dispatches appear here after both a team OB number and dispatch-team incident report are provided." : "No dispatches are currently assigned to your team's active queue."}</p>
        </div>`;
      return;
    }

    elements.list.innerHTML = state.dispatches.map((dispatch) => {
      const dispatchId = Number(dispatch.id);
      const isExpanded = state.expandedDispatchIds.has(dispatchId);
      const mapLink = mapUrl(dispatch);
      const coordinates = coordinatesText(dispatch);
      const registration = valueOrDash(dispatch.registration);
      const distance = dispatch.acceptedDistanceKm === null || dispatch.acceptedDistanceKm === undefined
        ? "—"
        : `${Number(dispatch.acceptedDistanceKm).toLocaleString("en-ZA", { maximumFractionDigits: 1 })} km`;
      const reports = Array.isArray(dispatch.reports) ? dispatch.reports : [];
      const reportMarkup = reports.length
        ? reports.map((report, index) => `
            <a class="team-report-link" href="${escapeHtml(report.downloadUrl)}" target="_blank" rel="noopener noreferrer">
              <span class="team-report-link-label">${index === 0 ? "Open current report" : "Open earlier report"}</span>
              <strong>${escapeHtml(valueOrDash(report.originalFileName))}</strong>
              <small>Saved ${escapeHtml(formatDate(report.uploadedAt))} · Opens in a new tab</small>
            </a>`).join("")
        : '<p class="team-report-empty">No dispatch-team report uploaded yet.</p>';
      return `
        <article class="team-dispatch-card ${isExpanded ? "is-expanded" : ""}" data-dispatch-id="${dispatchId}">
          <header class="team-dispatch-card-header" data-toggle-dispatch-surface>
            <div>
              <h3>${escapeHtml(registration)}</h3>
              <p class="team-dispatch-card-meta">
                <span>${escapeHtml(valueOrDash(dispatch.incidentType))}</span>
                <span>Dispatch DateTime: <strong>${escapeHtml(formatDate(dispatch.dispatchDateTime))}</strong></span>
                <span>OB: <strong>${escapeHtml(valueOrDash(dispatch.obNumber))}</strong></span>
              </p>
            </div>
            <div class="team-dispatch-header-actions">
              ${mapLink ? `
                <div class="team-dispatch-location-actions" aria-label="Coordinate actions">
                <a class="team-dispatch-location-action" href="${escapeHtml(mapLink)}" target="_blank" rel="noopener noreferrer" aria-label="Open coordinates in map" title="Open coordinates in map">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"></path><path d="M9 3v15M15 6v15"></path></svg>
                  <span class="sr-only">Open coordinates in map</span>
                </a>
                <button class="team-dispatch-location-action eta-copy-action" type="button" data-copy-coordinates="${escapeHtml(coordinates)}" aria-label="Copy coordinates" title="Copy coordinates">
                  <svg class="eta-copy-default-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path></svg>
                  <svg class="eta-copy-success-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"></path></svg>
                  <svg class="eta-copy-error-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg>
                  <span class="sr-only" data-copy-status>Copy coordinates</span>
                </button>
                </div>` : ""}
              <button class="team-dispatch-expand-button" type="button" data-toggle-dispatch aria-expanded="${isExpanded}" aria-controls="teamDispatchBody-${dispatchId}" aria-label="${isExpanded ? "Collapse" : "Expand"} ${escapeHtml(registration)}">
                <span data-toggle-label>${isExpanded ? "Hide details" : "View details"}</span>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>
              </button>
            </div>
          </header>
          <div class="team-dispatch-card-body" id="teamDispatchBody-${dispatchId}" ${isExpanded ? "" : "hidden"}>
          <div class="team-dispatch-facts">
            <div><span>Accepted</span><strong>${escapeHtml(formatDate(dispatch.acceptedAt))}</strong></div>
            <div><span>Accepted distance</span><strong>${escapeHtml(distance)}</strong></div>
            <div><span>Dispatch time</span><strong>${escapeHtml(formatDate(dispatch.dispatchDateTime))}</strong></div>
            <div><span>Stand down</span><strong>${escapeHtml(formatDate(dispatch.standDownDateTime))}</strong></div>
            <div><span>Closure status</span><strong>${escapeHtml(valueOrDash(dispatch.closureApprovalStatus))}</strong></div>
            <div><span>Dispatch Team OB</span><strong>${escapeHtml(valueOrDash(dispatch.obNumber))}</strong></div>
          </div>
          <section class="team-dispatch-actions" aria-label="Details for ${escapeHtml(registration)}">
            <div class="team-dispatch-action-block">
              <div class="team-dispatch-action-heading">
                <div><span>Team update</span><h4>Operational details</h4></div>
              </div>
              ${completedView ? `
              <div class="team-dispatch-readonly">
                <p>Operational details are read-only after both the team OB number and dispatch-team incident report are provided.</p>
                <div><span>Team OB number</span><strong>${escapeHtml(valueOrDash(dispatch.obNumber))}</strong></div>
                <div><span>Stand down</span><strong>${escapeHtml(formatDate(dispatch.standDownDateTime))}</strong></div>
              </div>` : `<form class="team-dispatch-update-form" data-team-dispatch-update>
                <input type="hidden" name="incidentId" value="${Number(dispatch.id)}">
                <label>
                  <span>Dispatch Team OB No (Enter N/A if no OB was created)</span>
                  <input name="obNumber" maxlength="100" value="${escapeHtml(dispatch.obNumber || "")}" placeholder="Enter OB number">
                </label>
                <label>
                  <span>Stand Down DateTime</span>
                  <input name="standDownDateTime" type="datetime-local" value="${escapeHtml(formatDateTimeInput(dispatch.standDownDateTime))}">
                </label>
                <button class="filter-button compact" type="submit">Save team details</button>
              </form>`}
            </div>
            <div class="team-dispatch-action-block">
              <div class="team-dispatch-action-heading">
                <div><span>Team document</span><h4>Incident report</h4></div>
                <small>PDF only</small>
              </div>
              <form class="team-report-upload-form" data-team-report-upload enctype="multipart/form-data">
                <input type="hidden" name="incidentId" value="${Number(dispatch.id)}">
                <label class="team-report-picker">
                  <span>${reports.length ? "Replace current incident report" : "Choose incident report"}</span>
                  <input name="file" type="file" accept=".pdf,application/pdf" required>
                </label>
                <div class="team-report-pending" data-report-pending hidden>
                  <span data-report-pending-name></span>
                  <button type="button" data-clear-report-file aria-label="Remove selected report" title="Remove selected report">×</button>
                </div>
                ${reports.length ? '<p class="team-report-replace-note">Saving a new PDF replaces the current report.</p>' : ""}
                <button class="filter-button secondary compact" type="submit" data-report-replacement="${reports.length ? "true" : "false"}">Save</button>
              </form>
              <div class="team-report-list">${reportMarkup}</div>
            </div>
          </section>
          <footer class="team-dispatch-card-footer">
            <span>ETA request ${escapeHtml(valueOrDash(dispatch.etaRequestNumber))}</span>
          </footer>
          </div>
        </article>`;
    }).join("");
  }

  function render() {
    renderContext();
    renderSummary();
    if (state.context?.role === "DispatchTeam" && state.context?.teamIsActive) renderDispatches();
  }

  async function loadEtaSummary() {
    try {
      const payload = await requestJson(`${endpoints.etaSummary}?_=${Date.now()}`);
      globalThis.dispatchEtaNotifications?.update(payload, payload?.pendingRequests);
      const count = Number(payload?.actionCount || 0);
      elements.etaCount.textContent = String(count);
      elements.etaCount.hidden = count <= 0;
    } catch (error) {
      console.warn("ETA request summary could not be loaded:", error);
    }
  }

  async function loadDispatches(options = {}) {
    if (options.silent && elements.list.querySelector(".team-dispatch-card.is-editing, .team-dispatch-card.is-report-editing")) return;
    const requestId = ++state.requestId;
    state.loading = true;
    elements.refreshButton.disabled = true;
    try {
      const query = new URLSearchParams({
        view: completedView ? "completed" : "active",
        search: state.search,
        page: String(state.page),
        _: String(Date.now())
      });
      const payload = await requestJson(`${endpoints.activeDispatches}?${query}`);
      if (requestId !== state.requestId) return;
      if (options.silent && elements.list.querySelector(".team-dispatch-card.is-editing, .team-dispatch-card.is-report-editing")) return;
      if (!payload?.context || !payload?.summary || !Array.isArray(payload?.dispatches)) {
        throw new Error("Team dispatches API returned an invalid response.");
      }
      const supportsFilters = payload.summary.completedCount !== undefined
        && payload.summary.filteredCount !== undefined
        && payload.summary.pageSize !== undefined;
      const searchText = state.search.toLocaleLowerCase();
      const filteredDispatches = supportsFilters ? payload.dispatches : payload.dispatches.filter((dispatch) =>
        !searchText
        || String(dispatch.registration || "").toLocaleLowerCase().includes(searchText)
        || String(dispatch.obNumber || "").toLocaleLowerCase().includes(searchText)
      );
      const summary = supportsFilters ? payload.summary : {
        ...payload.summary,
        completedCount: 0,
        filteredCount: filteredDispatches.length,
        pageNumber: state.page,
        pageSize: 10
      };
      const lastPage = Math.max(1, Math.ceil(Number(summary.filteredCount || 0) / Number(summary.pageSize || 10)));
      if (state.page > lastPage) {
        state.page = lastPage;
        loadDispatches({ silent: true });
        return;
      }
      state.context = payload.context;
      state.summary = summary;
      state.apiUpgradeRequired = completedView && !supportsFilters;
      state.dispatches = state.apiUpgradeRequired ? [] : supportsFilters
        ? filteredDispatches
        : filteredDispatches.slice((state.page - 1) * 10, state.page * 10);
      render();
      if (!options.silent) showNotice(`${completedView ? "Completed" : "Active"} dispatches refreshed.`);
    } catch (error) {
      if (requestId !== state.requestId) return;
      elements.workspace.hidden = true;
      elements.accessDenied.hidden = true;
      elements.setupRequired.hidden = false;
      elements.dispatchNav.hidden = true;
      elements.profilePill.textContent = "Service unavailable";
      elements.userDisplayName.textContent = "Team Dispatches";
      elements.userRoleLabel.textContent = "Could not load dispatches";
      showNotice(error.message, "error");
    } finally {
      if (requestId === state.requestId) {
        state.loading = false;
        elements.refreshButton.disabled = false;
      }
    }
  }

  function actionError(payload, fallback) {
    const messages = {
      unauthorized: "Your signed-in session is no longer active.",
      forbidden: "This profile is not assigned to an active dispatch team.",
      validation_error: "A valid dispatch is required.",
      not_assigned: "This dispatch is not assigned to your logged-in team.",
      locked_status: "Closed or cancelled dispatches can no longer be updated.",
      completed_dispatch: "Operational details are read-only after both the team OB number and dispatch-team incident report are provided.",
      invalid_ob_number: "The OB number must be 100 characters or fewer.",
      invalid_stand_down_time: "Enter a valid stand-down date and time.",
      invalid_stand_down_order: "Stand-down time cannot be earlier than dispatch time.",
      missing_file: "Choose a PDF incident report before uploading.",
      invalid_file_type: "The incident report must be a PDF file.",
      db_error: "The update could not be saved. Please try again."
    };
    return payload?.message || messages[payload?.status] || fallback;
  }

  async function saveTeamDetails(form) {
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const body = new URLSearchParams(new FormData(form));
      const payload = await requestJson(endpoints.saveDetails, { method: "POST", body });
      if (payload?.status !== "ok") throw new Error(actionError(payload, "Team details could not be saved."));
      showNotice("Dispatch team OB number and stand-down time saved.");
      form.closest(".team-dispatch-card")?.classList.remove("is-editing");
      await loadDispatches({ silent: true });
    } finally {
      button.disabled = false;
    }
  }

  async function uploadTeamReport(form) {
    const fileInput = form.elements.file;
    const file = fileInput?.files?.[0];
    if (!file) throw new Error("Choose a PDF incident report before uploading.");
    if (!/\.pdf$/i.test(file.name)) throw new Error("The incident report must be a PDF file.");
    const button = form.querySelector('button[type="submit"]');
    const isReplacement = button.dataset.reportReplacement === "true";
    const card = form.closest(".team-dispatch-card");
    button.disabled = true;
    try {
      const endpoint = isReplacement ? endpoints.replaceReport : endpoints.uploadReport;
      const payload = await requestJson(endpoint, { method: "POST", body: new FormData(form) });
      if (payload?.status !== "ok") throw new Error(actionError(payload, "The incident report could not be saved."));
      showNotice(isReplacement ? "Dispatch team incident report replaced." : "Dispatch team incident report saved.");
      card?.classList.remove("is-report-editing");
      await loadDispatches({ silent: true });
    } finally {
      button.disabled = false;
    }
  }

  function setSidebarCollapsed(collapsed) {
    elements.appShell.classList.toggle("sidebar-collapsed", collapsed);
    localStorage.setItem("pulsit-sidebar-collapsed", collapsed ? "1" : "0");
    elements.sidebarCollapseButton.setAttribute("aria-expanded", String(!collapsed));
  }

  function getSavedSidebarGroups() {
    try {
      return JSON.parse(localStorage.getItem(sidebarGroupStorageKey) || "{}");
    } catch (_error) {
      return {};
    }
  }

  function setSidebarGroup(section, open, persist = true) {
    const toggle = section.querySelector("[data-sidebar-toggle]");
    section.classList.toggle("is-open", open);
    toggle?.setAttribute("aria-expanded", String(open));
    if (!persist) return;
    const saved = getSavedSidebarGroups();
    saved[section.dataset.sidebarGroup] = open;
    localStorage.setItem(sidebarGroupStorageKey, JSON.stringify(saved));
  }

  function syncSidebarGroups() {
    const saved = getSavedSidebarGroups();
    for (const section of document.querySelectorAll("[data-sidebar-group]")) {
      const group = section.dataset.sidebarGroup;
      const defaultOpen = section.querySelector("[data-sidebar-toggle]")?.getAttribute("aria-expanded") !== "false";
      setSidebarGroup(section, Object.prototype.hasOwnProperty.call(saved, group) ? Boolean(saved[group]) : defaultOpen, false);
    }
  }

  elements.sidebarCollapseButton.addEventListener("click", () => {
    setSidebarCollapsed(!elements.appShell.classList.contains("sidebar-collapsed"));
  });

  document.querySelector(".sidebar-nav").addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-sidebar-toggle]");
    const section = toggle?.closest("[data-sidebar-group]");
    if (!section) return;
    setSidebarGroup(section, !section.classList.contains("is-open"));
  });

  document.querySelector(".sidebar-nav").addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key)) return;
    const toggle = event.target.closest("[data-sidebar-toggle]");
    const section = toggle?.closest("[data-sidebar-group]");
    if (!section) return;
    event.preventDefault();
    setSidebarGroup(section, !section.classList.contains("is-open"));
  });

  const theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  elements.themeToggle.checked = theme === "dark";
  elements.themeToggle.addEventListener("change", () => {
    const nextTheme = elements.themeToggle.checked ? "dark" : "light";
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem("srf-jobcard-theme", nextTheme);
  });

  elements.list.addEventListener("input", (event) => {
    if (event.target.closest("[data-team-dispatch-update]")) {
      event.target.closest(".team-dispatch-card")?.classList.add("is-editing");
    }
  });

  elements.list.addEventListener("change", (event) => {
    if (event.target.matches('[data-team-report-upload] input[type="file"]')) {
      const form = event.target.closest("[data-team-report-upload]");
      const pending = form?.querySelector("[data-report-pending]");
      const pendingName = pending?.querySelector("[data-report-pending-name]");
      const file = event.target.files?.[0];
      if (pendingName) pendingName.textContent = file?.name || "";
      if (pending) pending.hidden = !file;
      event.target.closest(".team-dispatch-card")?.classList.toggle("is-report-editing", Boolean(file));
    }
  });

  elements.list.addEventListener("cancel", (event) => {
    if (event.target.matches('[data-team-report-upload] input[type="file"]')) {
      event.target.closest(".team-dispatch-card")?.classList.remove("is-report-editing");
    }
  });

  elements.list.addEventListener("click", async (event) => {
    const clearReportButton = event.target.closest("[data-clear-report-file]");
    if (clearReportButton) {
      event.preventDefault();
      const form = clearReportButton.closest("[data-team-report-upload]");
      const fileInput = form?.querySelector('input[type="file"]');
      const pending = form?.querySelector("[data-report-pending]");
      const pendingName = pending?.querySelector("[data-report-pending-name]");
      if (fileInput) fileInput.value = "";
      if (pendingName) pendingName.textContent = "";
      if (pending) pending.hidden = true;
      form?.closest(".team-dispatch-card")?.classList.remove("is-report-editing");
      return;
    }

    const reportFileInput = event.target.closest('[data-team-report-upload] input[type="file"]');
    if (reportFileInput) {
      reportFileInput.closest(".team-dispatch-card")?.classList.add("is-report-editing");
    }

    const toggleButton = event.target.closest("[data-toggle-dispatch]");
    const toggleSurface = event.target.closest("[data-toggle-dispatch-surface]");
    const clickedInteractiveControl = event.target.closest("a, button, input, select, textarea, label");
    if (toggleButton || (toggleSurface && !clickedInteractiveControl)) {
      const card = (toggleButton || toggleSurface).closest(".team-dispatch-card");
      const dispatchId = Number(card?.dataset.dispatchId);
      const cardBody = card?.querySelector(".team-dispatch-card-body");
      if (!card || !cardBody || !Number.isFinite(dispatchId)) return;
      const cardToggleButton = card.querySelector("[data-toggle-dispatch]");
      const isExpanded = !state.expandedDispatchIds.has(dispatchId);
      if (isExpanded) state.expandedDispatchIds.add(dispatchId);
      else state.expandedDispatchIds.delete(dispatchId);
      card.classList.toggle("is-expanded", isExpanded);
      cardBody.hidden = !isExpanded;
      cardToggleButton?.setAttribute("aria-expanded", String(isExpanded));
      cardToggleButton?.setAttribute("aria-label", `${isExpanded ? "Collapse" : "Expand"} ${card.querySelector("h3")?.textContent || "dispatch"}`);
      const label = cardToggleButton?.querySelector("[data-toggle-label]");
      if (label) label.textContent = isExpanded ? "Hide details" : "View details";
      return;
    }

    const copyButton = event.target.closest("[data-copy-coordinates]");
    if (!copyButton) return;
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
  });

  elements.list.addEventListener("submit", async (event) => {
    const updateForm = event.target.closest("[data-team-dispatch-update]");
    const reportForm = event.target.closest("[data-team-report-upload]");
    if (!updateForm && !reportForm) return;
    event.preventDefault();
    try {
      if (updateForm) await saveTeamDetails(updateForm);
      if (reportForm) await uploadTeamReport(reportForm);
    } catch (error) {
      showNotice(error.message, "error");
    }
  });

  elements.refreshButton.addEventListener("click", () => Promise.all([loadDispatches(), loadEtaSummary()]));
  elements.searchInput.addEventListener("input", () => {
    window.clearTimeout(elements.searchInput.searchTimer);
    elements.searchInput.searchTimer = window.setTimeout(() => {
      state.search = elements.searchInput.value.trim();
      state.page = 1;
      loadDispatches({ silent: true });
    }, 250);
  });
  elements.previousButton.addEventListener("click", () => {
    if (state.page <= 1) return;
    state.page -= 1;
    loadDispatches({ silent: true });
  });
  elements.nextButton.addEventListener("click", () => {
    if (state.page * Number(state.summary.pageSize || 10) >= Number(state.summary.filteredCount || 0)) return;
    state.page += 1;
    loadDispatches({ silent: true });
  });
  syncSidebarGroups();
  setSidebarCollapsed(window.matchMedia("(max-width: 980px)").matches || localStorage.getItem("pulsit-sidebar-collapsed") !== "0");
  window.setInterval(() => {
    loadDispatches({ silent: true });
    loadEtaSummary();
  }, 15000);
  loadDispatches({ silent: true });
  loadEtaSummary();
})();
