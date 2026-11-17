(() => {
  "use strict";

  const photoLabels = {
    LicenseDisk: "License disk",
    FrontVehicleWithReg: "Front of vehicle with registration",
    BackVehicleWithReg: "Rear of vehicle with registration",
    VehicleSides: "Vehicle sides",
    TrailersWithReg: "Trailer with registration",
    Stock: "Load or stock",
    Damages: "Visible damage",
    Dashboard: "Dashboard",
    VehicleKeys: "Vehicle keys",
    Odometer: "Odometer",
    Driver: "Driver",
    DriverLicenseOrId: "Driver licence or ID"
  };

  const elements = {
    loading: document.querySelector("#loadingState"),
    error: document.querySelector("#errorState"),
    errorMessage: document.querySelector("#errorMessage"),
    record: document.querySelector("#evidenceRecord"),
    incidentNumber: document.querySelector("#incidentNumber"),
    heroSummary: document.querySelector("#heroSummary"),
    headlineFacts: document.querySelector("#headlineFacts"),
    photoCount: document.querySelector("#photoCount"),
    photoGallery: document.querySelector("#photoGallery"),
    emptyPhotos: document.querySelector("#emptyPhotos"),
    recordReference: document.querySelector("#recordReference"),
    viewer: document.querySelector("#photoViewer"),
    viewerImage: document.querySelector("#viewerImage"),
    viewerTitle: document.querySelector("#viewerTitle"),
    viewerMeta: document.querySelector("#viewerMeta"),
    viewerNotes: document.querySelector("#viewerNotes"),
    closeViewer: document.querySelector("#closeViewer"),
    previousPhoto: document.querySelector("#previousPhoto"),
    nextPhoto: document.querySelector("#nextPhoto")
  };

  const state = { photos: [], selectedPhotoIndex: 0 };

  function dispatchLinkBase() {
    const path = window.location.pathname;
    const marker = "/dispatch_link/";
    const index = path.toLowerCase().indexOf(marker);
    return index === -1 ? "/dispatch_link" : path.slice(0, index + marker.length - 1);
  }

  function hasValue(value) {
    return value !== null && value !== undefined && String(value).trim() !== "";
  }

  function display(value, fallback = "Not recorded") {
    return hasValue(value) ? String(value).trim() : fallback;
  }

  function sentenceCase(value) {
    if (!hasValue(value)) return "Not recorded";
    return String(value)
      .replace(/[_-]+/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseDispatchDate(value) {
    if (!hasValue(value)) return null;
    const source = String(value).trim();
    const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(source)
      ? `${source}+02:00`
      : source;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function formatDateTime(value) {
    const date = parseDispatchDate(value);
    if (!date) return "Not recorded";
    return new Intl.DateTimeFormat("en-ZA", {
      timeZone: "Africa/Johannesburg",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date).replace(",", " ·");
  }

  function buildFact(label, value) {
    const wrapper = document.createElement("div");
    wrapper.className = "fact";
    const caption = document.createElement("span");
    caption.textContent = label;
    const content = document.createElement("strong");
    content.textContent = display(value);
    wrapper.append(caption, content);
    return wrapper;
  }

  function renderDetailRows(target, rows) {
    target.replaceChildren();
    rows.forEach(([label, value]) => {
      const row = document.createElement("div");
      row.className = "detail-row";
      const term = document.createElement("dt");
      term.textContent = label;
      const description = document.createElement("dd");
      description.textContent = display(value);
      row.append(term, description);
      target.append(row);
    });
  }

  function normalizedImageUrl(value) {
    if (!hasValue(value)) return "";
    return String(value).replace(/\\/g, "/");
  }

  function photoTitle(photo) {
    return photoLabels[photo.PhotoCategory] || sentenceCase(photo.PhotoCategory) || "Evidence photograph";
  }

  function renderViewer() {
    const photo = state.photos[state.selectedPhotoIndex];
    if (!photo) return;
    elements.viewerImage.src = normalizedImageUrl(photo.imageUrl);
    elements.viewerImage.alt = photoTitle(photo);
    elements.viewerTitle.textContent = photoTitle(photo);
    elements.viewerMeta.textContent = `${state.selectedPhotoIndex + 1} of ${state.photos.length} · ${formatDateTime(photo.UploadedAt)}`;
    elements.viewerNotes.textContent = hasValue(photo.Notes) ? String(photo.Notes).trim() : "";
    elements.viewerNotes.hidden = !hasValue(photo.Notes);
    elements.previousPhoto.disabled = state.photos.length < 2;
    elements.nextPhoto.disabled = state.photos.length < 2;
  }

  function openViewer(index) {
    state.selectedPhotoIndex = index;
    renderViewer();
    if (typeof elements.viewer.showModal === "function") elements.viewer.showModal();
  }

  function changePhoto(direction) {
    if (state.photos.length < 2) return;
    state.selectedPhotoIndex = (state.selectedPhotoIndex + direction + state.photos.length) % state.photos.length;
    renderViewer();
  }

  function renderPhotos(photos) {
    state.photos = Array.isArray(photos) ? photos : [];
    elements.photoGallery.replaceChildren();
    const count = state.photos.length;
    elements.photoCount.textContent = `${count} ${count === 1 ? "photo" : "photos"}`;
    elements.emptyPhotos.hidden = count > 0;

    state.photos.forEach((photo, index) => {
      const card = document.createElement("button");
      card.className = "photo-card";
      card.type = "button";
      card.setAttribute("aria-label", `Open ${photoTitle(photo)}`);

      const frame = document.createElement("div");
      frame.className = "photo-frame";
      const image = document.createElement("img");
      image.src = normalizedImageUrl(photo.imageUrl);
      image.alt = photoTitle(photo);
      image.loading = index < 2 ? "eager" : "lazy";
      const zoom = document.createElement("span");
      zoom.className = "zoom-label";
      zoom.textContent = "View full size";
      frame.append(image, zoom);

      const caption = document.createElement("div");
      caption.className = "photo-caption";
      const title = document.createElement("strong");
      title.textContent = photoTitle(photo);
      const meta = document.createElement("span");
      meta.textContent = formatDateTime(photo.UploadedAt);
      caption.append(title, meta);
      if (hasValue(photo.Notes)) {
        const notes = document.createElement("p");
        notes.textContent = String(photo.Notes).trim();
        caption.append(notes);
      }

      card.append(frame, caption);
      card.addEventListener("click", () => openViewer(index));
      elements.photoGallery.append(card);
    });
  }

  function renderRecord(data) {
    const incident = data.incident;
    const incidentNumber = display(incident.IncidentNumber, `Dispatch ${incident.id}`);
    const displayTitle = display(incident.RegNo, incidentNumber);
    elements.incidentNumber.textContent = displayTitle;
    elements.heroSummary.textContent = display(incident.Event);
    elements.recordReference.textContent = incident.zoho_ob
      ? `Zoho OB ${incident.zoho_ob}`
      : incidentNumber;
    document.title = `${displayTitle} | Dispatch Evidence`;

    elements.headlineFacts.replaceChildren(
      buildFact("Event date", formatDateTime(incident.EventDateTime)),
      buildFact("Registration", incident.RegNo),
      buildFact("Dispatch team", incident.DispatchTeam),
      buildFact("Location", incident.GeoLocation)
    );

    renderPhotos(data.photos);
    elements.loading.hidden = true;
    elements.error.hidden = true;
    elements.record.hidden = false;
  }

  function showError(message) {
    elements.loading.hidden = true;
    elements.record.hidden = true;
    elements.errorMessage.textContent = message;
    elements.error.hidden = false;
  }

  async function loadEvidence() {
    const params = new URLSearchParams(window.location.search);
    const id = Number(params.get("id") || params.get("dispatchId"));
    if (!Number.isInteger(id) || id <= 0) {
      showError("This evidence link does not contain a valid dispatch reference.");
      return;
    }

    try {
      const endpoint = `${dispatchLinkBase()}/api/public_dispatch_evidence.sql?dispatchId=${encodeURIComponent(id)}`;
      const response = await fetch(endpoint, { credentials: "omit", cache: "no-store" });
      if (!response.ok) throw new Error(`Request failed with status ${response.status}.`);
      const data = await response.json();
      if (!data?.incident) {
        showError("The dispatch was not found or has not been approved for public viewing.");
        return;
      }
      renderRecord(data);
    } catch (_error) {
      showError("The dispatch evidence could not be loaded. Please try again later.");
    }
  }

  elements.closeViewer.addEventListener("click", () => elements.viewer.close());
  elements.previousPhoto.addEventListener("click", () => changePhoto(-1));
  elements.nextPhoto.addEventListener("click", () => changePhoto(1));
  elements.viewer.addEventListener("click", (event) => {
    if (event.target === elements.viewer) elements.viewer.close();
  });
  document.addEventListener("keydown", (event) => {
    if (!elements.viewer.open) return;
    if (event.key === "ArrowLeft") changePhoto(-1);
    if (event.key === "ArrowRight") changePhoto(1);
  });

  loadEvidence();
})();
