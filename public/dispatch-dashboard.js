(() => {
  "use strict";
  const $ = selector => document.querySelector(selector);
  const elements = {
    workspace: $("#dashboardWorkspace"), denied: $("#dashboardDenied"), status: $("#dashboardStatus"),
    filters: $("#dashboardFilters"), from: $("#dateFrom"), to: $("#dateTo"), rows: $("#contributorRows"),
    download: $("#downloadSummary"), period: $("#reportPeriod")
  };
  const number = new Intl.NumberFormat("en-ZA"), percent = new Intl.NumberFormat("en-ZA", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
  let data = null, period = "", requestId = 0, controller = null, periodPreset = "Last 24 hours";
  const withSeconds = value => value.length === 16 ? `${value}:00` : value;
  function localDateTime(date) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  }
  function setPickerDefaultTime(input, time) {
    const date = input.value.slice(0, 10) || localDateTime(new Date()).slice(0, 10);
    input.value = `${date}T${time}`;
    periodPreset = "";
  }
  function setLast24Hours() {
    const end = new Date(Math.floor(Date.now() / 1000) * 1000);
    elements.from.value = localDateTime(new Date(end.getTime() - 24 * 60 * 60 * 1000));
    elements.to.value = localDateTime(end);
    periodPreset = "Last 24 hours";
  }
  function setLastMonth() {
    const [year, month] = localDateTime(new Date()).slice(0, 10).split("-").map(Number);
    const start = new Date(Date.UTC(year, month - 2, 1));
    const end = new Date(Date.UTC(year, month - 1, 1) - 1000);
    elements.from.value = start.toISOString().slice(0, 19);
    elements.to.value = end.toISOString().slice(0, 19);
    periodPreset = "Last month";
  }
  function showPeriod() {
    const format = value => value ? withSeconds(value).replace("T", " ") : "";
    period = elements.from.value || elements.to.value
      ? `${periodPreset || "Dispatch event period"} — ${format(elements.from.value) || "first recorded"} to ${format(elements.to.value) || "latest recorded"}`
      : "All dispatch event times";
    elements.period.textContent = period;
  }
  const flag = value => [true, 1, "1", "true"].includes(value);
  function normalize(value) {
    if (typeof value === "string" && /^[\[{]/.test(value.trim())) {
      try { return normalize(JSON.parse(value)); } catch { return value; }
    }
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
    return value;
  }
  function payload(value) {
    const parsed = normalize(value);
    if (Array.isArray(parsed)) return payload(parsed[0]);
    if (parsed?.contents != null) return payload(parsed.contents);
    return parsed;
  }
function dashboardLoaderMarkup() {
  return `
    <div class="dashboard-loading" aria-live="polite">
      <div aria-label="Orange and tan hamster running in a metal wheel" role="img" class="wheel-and-hamster">
        <div class="wheel"></div>
        <div class="hamster">
          <div class="hamster__body">
            <div class="hamster__head">
              <div class="hamster__ear"></div>
              <div class="hamster__eye"></div>
              <div class="hamster__nose"></div>
            </div>
            <div class="hamster__limb hamster__limb--fr"></div>
            <div class="hamster__limb hamster__limb--fl"></div>
            <div class="hamster__limb hamster__limb--br"></div>
            <div class="hamster__limb hamster__limb--bl"></div>
            <div class="hamster__tail"></div>
          </div>
        </div>
        <div class="spoke"></div>
      </div>
      <strong>Loading dispatch contributions…</strong>
    </div>
  `;
}

  function status(message, error = false) {
    elements.status.textContent = message;
    elements.status.dataset.error = String(error);
  }
  function clearReport() {
    data = null;
    elements.download.disabled = true;
    elements.rows.replaceChildren();
    for (const id of ["dispatchCount", "actionCount", "contributorCount"]) $(`#${id}`).textContent = "—";
  }
  function deny() {
    clearReport();
    elements.workspace.hidden = true;
    elements.denied.hidden = false;
    status("CC administrator access required.");
  }
  function initSidebar(user) {
    const type = String(user.user_type ?? user.userType ?? "").trim();
    for (const element of document.querySelectorAll("[data-hide-for-user-type], [data-show-for-user-type]")) {
      const hide = (element.dataset.hideForUserType || "").split(","), show = (element.dataset.showForUserType || "").split(",");
      element.hidden = !type || hide.includes(type) || (show[0] && !show.includes(type));
    }
    for (const element of document.querySelectorAll("[data-show-for-helpdesk]")) element.hidden = !flag(user.helpdesk);
    for (const element of document.querySelectorAll("[data-show-for-approver]")) element.hidden = type !== "7";
    for (const element of document.querySelectorAll("[data-show-for-dispatch-access], [data-show-for-dispatch-operations], [data-show-for-eta-access]")) element.hidden = !["7", "8"].includes(type) && !(type === "1" && flag(user.helpdesk));
    // Counts belong to their application views; this report does not fetch unrelated queues.
    for (const count of document.querySelectorAll(".nav-count")) count.hidden = true;
    const shell = $(".app-shell"), collapse = $("#sidebarCollapseButton");
    const setCollapsed = value => { shell.classList.toggle("sidebar-collapsed", value); collapse?.setAttribute("aria-expanded", String(!value)); };
    setCollapsed(window.matchMedia("(max-width: 1120px)").matches || localStorage.getItem("dispatch-dashboard-sidebar-collapsed") === "1");
    collapse?.addEventListener("click", () => { const value = !shell.classList.contains("sidebar-collapsed"); setCollapsed(value); localStorage.setItem("dispatch-dashboard-sidebar-collapsed", value ? "1" : "0"); });
    for (const section of document.querySelectorAll("[data-sidebar-group]")) {
      const toggle = section.querySelector("[data-sidebar-toggle]");
      if (!toggle) continue;
      const setOpen = value => { section.classList.toggle("is-open", value); toggle.setAttribute("aria-expanded", String(value)); };
      setOpen(section.dataset.sidebarGroup === "dashboards");
      toggle.addEventListener("click", () => setOpen(!section.classList.contains("is-open")));
      toggle.addEventListener("keydown", event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); toggle.click(); } });
    }
    const theme = $("#themeToggle");
    if (theme) {
      theme.checked = document.documentElement.dataset.theme !== "light";
      theme.addEventListener("change", () => { const value = theme.checked ? "dark" : "light"; document.documentElement.dataset.theme = value; localStorage.setItem("srf-jobcard-theme", value); });
    }
  }
  function render(result) {
    $("#dispatchCount").textContent = number.format(result.metrics.dispatches);
    $("#actionCount").textContent = number.format(result.metrics.actions);
    $("#contributorCount").textContent = number.format(result.metrics.contributors);
    const fragment = document.createDocumentFragment();
    for (const contributor of result.contributors) {
      const row = document.createElement("tr");
      for (const [index, [key]] of DispatchDashboardExport.columns.entries()) {
        const cell = document.createElement("td"), value = contributor[key];
        cell.textContent = [4, 6].includes(index) ? percent.format(Number(value) || 0) : index >= 3 ? number.format(Number(value) || 0) : String(value ?? "");
        row.append(cell);
      }
      fragment.append(row);
    }
    if (!result.contributors.length) {
      const row = document.createElement("tr"), cell = document.createElement("td");
      cell.colSpan = DispatchDashboardExport.columns.length; cell.textContent = "No contribution actions for these dispatch event dates."; row.append(cell); fragment.append(row);
    }
    elements.rows.replaceChildren(fragment);
    elements.period.textContent = period;
  }
  async function load() {
    const id = ++requestId;
    controller?.abort(); controller = new AbortController();
    clearReport();
    if (elements.from.value && elements.to.value && elements.from.value > elements.to.value) {
      elements.workspace.removeAttribute("aria-busy");
      showPeriod();
      status("The start date must be on or before the end date.", true); return;
    }
    const params = new URLSearchParams();
    if (elements.from.value) params.set("date_from", withSeconds(elements.from.value));
    if (elements.to.value) params.set("date_to", withSeconds(elements.to.value));
    if (!elements.from.value && !elements.to.value) params.set("all_dates", "1");
    showPeriod();
    status("Loading dispatch contributions…");
    const loadingRow = document.createElement("tr"), loadingCell = document.createElement("td");
    loadingCell.colSpan = DispatchDashboardExport.columns.length;
    loadingCell.innerHTML = dashboardLoaderMarkup();
    loadingRow.append(loadingCell); elements.rows.append(loadingRow);
    elements.workspace.setAttribute("aria-busy", "true");
    try {
      const response = await fetch(`/dispatch_link/api/dispatch_contributions.sql?${params}`, { credentials: "include", cache: "no-store", headers: { Accept: "application/json" }, signal: controller.signal });
      if (id !== requestId) return;
      if (response.status === 401) return globalThis.redirectDispatchToSignIn();
      if (response.status === 403) return deny();
      if (!response.ok) throw Error("Unable to load the contribution report. Please try again.");
      const text = await response.text();
      if (id !== requestId) return;
      let result;
      try { result = payload(JSON.parse(text)); } catch {
        const html = new DOMParser().parseFromString(text, "text/html");
        for (const cell of html.querySelectorAll("td")) { try { const candidate = payload(JSON.parse(cell.textContent)); if (candidate?.accessAllowed != null) { result = candidate; break; } } catch { /* next cell */ } }
      }
      if (!result || result.accessAllowed == null) throw Error("The contribution report returned an unexpected response. Please try again.");
      if (!flag(result.accessAllowed)) return deny();
      if (!flag(result.filtersValid)) throw Error("Choose a valid dispatch event date range.");
      // SQLPage may omit an empty JSON array; accept that only for a proven empty summary.
      if (result.contributors == null && result.metrics?.contributors === 0 && result.metrics?.actions === 0) result.contributors = [];
      if (result.openedDispatches == null && result.metrics?.openedDispatches === 0) result.openedDispatches = [];
      if (!result.metrics || !Array.isArray(result.contributors) || !Array.isArray(result.openedDispatches)
        || !Number.isInteger(result.metrics.openedDispatches)) throw Error("The contribution report is incomplete. Please try again.");
      data = result;
      render(result);
      elements.download.disabled = false;
      status(`Updated ${new Intl.DateTimeFormat("en-ZA", { timeStyle: "short" }).format(new Date())}. ${result.contributors.length} contributors shown.`);
    } catch (error) {
      if (id !== requestId || error.name === "AbortError") return;
      clearReport(); status(error.message || "Unable to load the contribution report. Please try again.", true);
    } finally { if (id === requestId) elements.workspace.removeAttribute("aria-busy"); }
  }
  for (const [input, time] of [[elements.from, "00:00:01"], [elements.to, "23:59:59"]]) {
    const setDefaultTime = () => setPickerDefaultTime(input, time);
    input.addEventListener("focus", setDefaultTime);
    // Set the time before the browser opens its native calendar picker.
    input.addEventListener("pointerdown", setDefaultTime);
  }
  elements.filters.addEventListener("submit", event => { event.preventDefault(); periodPreset = ""; void load(); });
  $("#resetFilters").addEventListener("click", () => { setLast24Hours(); void load(); });
  $("#lastMonth").addEventListener("click", () => { setLastMonth(); void load(); });
  $("#allDates").addEventListener("click", () => { elements.filters.reset(); periodPreset = ""; void load(); });
  setLast24Hours();
  showPeriod();
  elements.download.addEventListener("click", () => {
    if (!data || elements.download.disabled) return;
    const url = URL.createObjectURL(DispatchDashboardExport.workbook(data, period)), link = document.createElement("a");
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    link.href = url; link.download = `Dispatch Contribution Report - ${date}.xlsx`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  void (async () => {
    const session = await globalThis.dispatchAuthReady;
    if (!session?.user) return;
    initSidebar(session.user);
    if (String(session.user.user_type ?? session.user.userType ?? "").trim() !== "7") return deny();
    elements.workspace.hidden = false;
    await load();
  })();
})();
