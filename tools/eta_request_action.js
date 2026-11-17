const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
process.chdir(projectRoot);

const sql = require("mssql");
const config = require("../src/config");

const messages = {
  unauthorized: "An active signed-in session is required.",
  forbiddenCallCentre: "Call Centre access is required.",
  forbiddenTeam: "An active dispatch-team profile is required."
};

function poolConfig() {
  return {
    server: config.db.server,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    options: {
      encrypt: config.db.options.encrypt,
      trustServerCertificate: config.db.options.trustServerCertificate,
      enableArithAbort: true
    }
  };
}

function result(status, message, values = {}) {
  return { status, ...values, message };
}

async function resolveUsername(pool, sessionId) {
  const request = pool.request();
  request.input("sessionId", sql.NVarChar(500), String(sessionId || ""));
  const response = await request.query(`
    SELECT TOP (1)
      NULLIF(LTRIM(RTRIM(CAST(Username AS nvarchar(128)))), N'') AS username
    FROM Jobcard.dbo.Current_session
    WHERE session_id = @sessionId
  `);
  return response.recordset[0]?.username || null;
}

async function resolveTeam(pool, username, activeOnly = false) {
  const request = pool.request();
  request.input("username", sql.NVarChar(128), username);
  const response = await request.query(`
    SELECT TOP (1) TeamId, TeamName, IsActive
    FROM CC.dbo.DispatchTeams
    WHERE LOWER(GroupUsername) = LOWER(@username)
      ${activeOnly ? "AND IsActive = 1" : ""}
  `);
  return response.recordset[0] || null;
}

async function withTransaction(pool, handler) {
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const value = await handler(transaction);
    await transaction.commit();
    return value;
  } catch (error) {
    if (!transaction._aborted) await transaction.rollback();
    throw error;
  }
}

function decimal(value) {
  if (value == null || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const incidentTypes = new Set([
  "Accident", "After Hours Movement", "Armed Robbery", "Attempted Hijacking", "Battery Critical",
  "Battery Disconnect", "Breakdown", "Breaking Convoy", "Bureau Update", "Camera Cover", "Canopy Lock",
  "Canopy Unlock", "Capital Air Dispatch", "Cargo Area Panic", "Cargo Door Lock", "Cargo Door Unlock",
  "Convoy Break", "Customer Request", "C_Lock - Lock", "C_Lock - Unlock", "Door Possible Hijack",
  "Escort Request", "ETA Request", "Fatigue Event", "Fuel Drop", "Gate Jamming Detected",
  "Guarding Services", "Harness Tamper", "Hijacking", "Jamming Detected", "Jamming Timer Expired",
  "Limp Geofence Entrance", "Maglock Locked", "Maglock Unlocked", "Max Time Exceeded",
  "Moving Into Geofence", "Moving Out Of Geofence", "Net Alarm", "Off Route", "OTA Limp mode",
  "OTA Limp Mode Test", "Panic", "Panic Test", "Protest Action", "PTO Disabled", "PTO Enabled",
  "Reload", "Reload Copper Tracking - Clamped", "Reload Dispatch", "Removed Received", "Tailgate Locked",
  "Tailgate Unlocked", "Tamper", "Technical Event", "Tilt", "Trailer Disconnect", "Travel Stop",
  "Unauthorised Driving", "Unit Not Updating", "Unlimp Vehicle", "Upliftment", "Vehicle Theft"
]);

async function createRequest(pool, sessionId, latitudeInput, longitudeInput, registrationInput, incidentTypeInput) {
  const username = await resolveUsername(pool, sessionId);
  if (!username) return result("unauthorized", messages.unauthorized);
  if (await resolveTeam(pool, username)) {
    return result("forbidden", "Call Centre access is required to create ETA requests.");
  }

  const latitude = decimal(latitudeInput);
  const longitude = decimal(longitudeInput);
  const registration = String(registrationInput || "").trim().toUpperCase();
  const incidentType = String(incidentTypeInput || "").trim();
  if (latitude == null || latitude < -90 || latitude > 90) return result("invalid_latitude", "Enter a latitude between -90 and 90.");
  if (longitude == null || longitude < -180 || longitude > 180) return result("invalid_longitude", "Enter a longitude between -180 and 180.");
  if (!registration) return result("registration_required", "Registration is required.");
  if (!incidentTypes.has(incidentType)) return result("incident_type_required", "Select a valid incident type.");

  const teamCheck = await pool.request().query("SELECT COUNT(*) AS teamCount FROM CC.dbo.DispatchTeams WHERE IsActive = 1");
  if (!Number(teamCheck.recordset[0]?.teamCount)) return result("no_active_teams", "No active dispatch teams are configured.");

  return withTransaction(pool, async (transaction) => {
    const insert = new sql.Request(transaction);
    insert.input("latitude", sql.Decimal(9, 6), latitude);
    insert.input("longitude", sql.Decimal(9, 6), longitude);
    insert.input("registration", sql.NVarChar(100), registration);
    // V1 keeps the three-table schema; this legacy column stores the selected incident type.
    insert.input("incidentType", sql.NVarChar(500), incidentType);
    insert.input("username", sql.NVarChar(128), username);
    const inserted = await insert.query(`
      INSERT INTO CC.dbo.DispatchEtaRequests
      (
        Latitude, Longitude, Registration, ShortDescription,
        RequestStatus, ExpiresAt, CreatedAt, CreatedBy
      )
      OUTPUT INSERTED.EtaRequestId
      VALUES
      (
        @latitude, @longitude, @registration, @incidentType,
        N'Open', DATEADD(MINUTE, 10, SYSDATETIME()), SYSDATETIME(), @username
      )
    `);
    const requestId = Number(inserted.recordset[0].EtaRequestId);

    const broadcast = new sql.Request(transaction);
    broadcast.input("requestId", sql.BigInt, requestId);
    await broadcast.query(`
      UPDATE CC.dbo.DispatchEtaRequests
      SET RequestNumber = N'ETA-' + RIGHT(REPLICATE(N'0', 12) + CONVERT(nvarchar(20), @requestId), 12)
      WHERE EtaRequestId = @requestId;

      INSERT INTO CC.dbo.DispatchEtaResponses (EtaRequestId, TeamId, ResponseStatus, CreatedAt)
      SELECT @requestId, TeamId, N'Pending', SYSDATETIME()
      FROM CC.dbo.DispatchTeams
      WHERE IsActive = 1;
    `);

    return result("ok", "ETA request sent to all active dispatch teams.", { id: requestId });
  });
}

async function saveResponse(pool, sessionId, requestIdInput, availabilityInput, distanceInput) {
  const username = await resolveUsername(pool, sessionId);
  if (!username) return result("unauthorized", messages.unauthorized);
  const team = await resolveTeam(pool, username, true);
  if (!team) return result("forbidden", messages.forbiddenTeam);

  const requestId = Number(requestIdInput);
  const availability = String(availabilityInput || "").trim();
  const distanceText = String(distanceInput || "").trim();
  let distanceKm = decimal(distanceText);
  if (!Number.isSafeInteger(requestId) || requestId <= 0) return result("invalid_request", "A valid ETA request is required.");
  if (!["Available", "Unavailable"].includes(availability)) return result("invalid_availability", "Select available or unavailable.");
  if (availability === "Available" && (!/^[0-9]{1,7}(?:\.[0-9])?$/.test(distanceText) || distanceKm == null || distanceKm <= 0)) {
    return result("distance_required", "Enter a distance greater than zero using numbers only.");
  }
  if (availability === "Unavailable") distanceKm = null;

  return withTransaction(pool, async (transaction) => {
    const lock = new sql.Request(transaction);
    lock.input("requestId", sql.BigInt, requestId);
    lock.input("teamId", sql.Int, team.TeamId);
    const request = await lock.query(`
      SELECT request.RequestStatus
      FROM CC.dbo.DispatchEtaRequests request WITH (UPDLOCK, HOLDLOCK)
      JOIN CC.dbo.DispatchEtaResponses response ON response.EtaRequestId = request.EtaRequestId
      WHERE request.EtaRequestId = @requestId AND response.TeamId = @teamId
    `);
    const row = request.recordset[0];
    if (!row) return result("not_found", "This ETA request is not assigned to your team.", { id: requestId });
    if (row.RequestStatus !== "Open") {
      return result("closed", "This ETA request is already closed.", { id: requestId });
    }

    const update = new sql.Request(transaction);
    update.input("requestId", sql.BigInt, requestId);
    update.input("teamId", sql.Int, team.TeamId);
    update.input("availability", sql.NVarChar(20), availability);
    update.input("distanceKm", sql.Decimal(8, 1), distanceKm);
    update.input("username", sql.NVarChar(128), username);
    await update.query(`
      UPDATE CC.dbo.DispatchEtaResponses
      SET ResponseStatus = @availability,
          DistanceKm = @distanceKm,
          RespondedAt = SYSDATETIME(),
          RespondedBy = @username,
          UpdatedAt = SYSDATETIME(),
          UpdatedBy = @username
      WHERE EtaRequestId = @requestId AND TeamId = @teamId
    `);
    return result("ok", "Your ETA response has been saved.", { id: requestId });
  });
}

async function cancelRequest(pool, sessionId, requestIdInput) {
  const username = await resolveUsername(pool, sessionId);
  if (!username) return result("unauthorized", messages.unauthorized);
  if (await resolveTeam(pool, username)) return result("forbidden", messages.forbiddenCallCentre);
  const requestId = Number(requestIdInput);
  if (!Number.isSafeInteger(requestId) || requestId <= 0) return result("invalid_request", "A valid ETA request is required.");

  return withTransaction(pool, async (transaction) => {
    const lock = new sql.Request(transaction);
    lock.input("requestId", sql.BigInt, requestId);
    const found = await lock.query(`
      SELECT RequestStatus
      FROM CC.dbo.DispatchEtaRequests WITH (UPDLOCK, HOLDLOCK)
      WHERE EtaRequestId = @requestId
    `);
    const row = found.recordset[0];
    if (!row) return result("not_found", "ETA request not found.", { id: requestId });
    if (row.RequestStatus !== "Open") {
      return result("closed", "This ETA request is already closed.", { id: requestId });
    }

    const update = new sql.Request(transaction);
    update.input("requestId", sql.BigInt, requestId);
    update.input("username", sql.NVarChar(128), username);
    await update.query(`
      UPDATE CC.dbo.DispatchEtaRequests
      SET RequestStatus = N'Cancelled',
          CancelledAt = SYSDATETIME(),
          CancelledBy = @username,
          UpdatedAt = SYSDATETIME(),
          UpdatedBy = @username
      WHERE EtaRequestId = @requestId
    `);
    return result("ok", "ETA request cancelled.", { id: requestId });
  });
}

async function selectResponse(pool, sessionId, requestIdInput, responseIdInput) {
  const username = await resolveUsername(pool, sessionId);
  if (!username) return result("unauthorized", messages.unauthorized);
  if (await resolveTeam(pool, username)) return result("forbidden", messages.forbiddenCallCentre);
  const requestId = Number(requestIdInput);
  const responseId = Number(responseIdInput);
  if (!Number.isSafeInteger(requestId) || requestId <= 0 || !Number.isSafeInteger(responseId) || responseId <= 0) {
    return result("invalid_selection", "Select a valid available response.");
  }

  return withTransaction(pool, async (transaction) => {
    const lock = new sql.Request(transaction);
    lock.input("requestId", sql.BigInt, requestId);
    const requestResult = await lock.query(`
      SELECT RequestNumber, Latitude, Longitude, Registration, ShortDescription,
             RequestStatus, CreatedAt, DispatchIncidentId
      FROM CC.dbo.DispatchEtaRequests WITH (UPDLOCK, HOLDLOCK)
      WHERE EtaRequestId = @requestId
    `);
    const eta = requestResult.recordset[0];
    if (!eta) return result("not_found", "ETA request not found.", { id: requestId });
    if (eta.DispatchIncidentId) {
      return result("already_selected", "This ETA request already has a dispatch draft.", {
        id: requestId, dispatchIncidentId: eta.DispatchIncidentId
      });
    }
    if (eta.RequestStatus !== "Open") {
      return result("closed", "This ETA request is already closed.", { id: requestId });
    }

    const responseRequest = new sql.Request(transaction);
    responseRequest.input("requestId", sql.BigInt, requestId);
    responseRequest.input("responseId", sql.BigInt, responseId);
    const responseResult = await responseRequest.query(`
      SELECT response.TeamId, response.DistanceKm, team.TeamName
      FROM CC.dbo.DispatchEtaResponses response WITH (UPDLOCK, HOLDLOCK)
      JOIN CC.dbo.DispatchTeams team ON team.TeamId = response.TeamId AND team.IsActive = 1
      WHERE response.EtaResponseId = @responseId
        AND response.EtaRequestId = @requestId
        AND response.ResponseStatus = N'Available'
        AND response.DistanceKm > 0
    `);
    const selected = responseResult.recordset[0];
    if (!selected) return result("response_unavailable", "The selected team is not currently available for this request.", { id: requestId });

    const saveRequestId = `ETA_REQUEST_${requestId}`;
    const existingDraft = new sql.Request(transaction);
    existingDraft.input("saveRequestId", sql.NVarChar(100), saveRequestId);
    const existing = await existingDraft.query(`
      SELECT id FROM CC.dbo.DispatchIncidents WITH (UPDLOCK, HOLDLOCK)
      WHERE SaveRequestId = @saveRequestId
    `);
    let draftId = existing.recordset[0]?.id || null;

    if (!draftId) {
      const draft = new sql.Request(transaction);
      draft.input("saveRequestId", sql.NVarChar(100), saveRequestId);
      draft.input("eventDateTime", sql.DateTime2(0), eta.CreatedAt);
      draft.input("incidentType", sql.NVarChar(100), eta.ShortDescription);
      draft.input("distanceKm", sql.NVarChar(30), String(selected.DistanceKm));
      draft.input("requestNumber", sql.NVarChar(30), eta.RequestNumber);
      draft.input("registration", sql.NVarChar(100), eta.Registration);
      draft.input("latitude", sql.Decimal(9, 6), eta.Latitude);
      draft.input("longitude", sql.Decimal(9, 6), eta.Longitude);
      draft.input("teamName", sql.NVarChar(100), selected.TeamName);
      draft.input("username", sql.NVarChar(128), username);
      const inserted = await draft.query(`
        INSERT INTO CC.dbo.DispatchIncidents
        (
          SaveRequestId, EventDateTime, Event, ETA,
          RiskEventReference, RegNo, GeoLocation, Latitude, Longitude,
          DispatchTeam, DispatchDateTime,
          Status, CreatedAt, CreatedBy, UpdatedAt, UpdatedBy
        )
        OUTPUT INSERTED.id
        VALUES
        (
          @saveRequestId, @eventDateTime, @incidentType, @distanceKm,
          @requestNumber, @registration, NULL, @latitude, @longitude,
          @teamName, SYSDATETIME(),
          N'Draft', SYSDATETIME(), @username, SYSDATETIME(), @username
        )
      `);
      draftId = Number(inserted.recordset[0].id);

      const audit = new sql.Request(transaction);
      audit.input("draftId", sql.Int, draftId);
      audit.input("incidentNumber", sql.NVarChar(30), `DL-${String(draftId).padStart(6, "0")}`);
      audit.input("requestNumber", sql.NVarChar(30), eta.RequestNumber);
      audit.input("username", sql.NVarChar(128), username);
      await audit.query(`
        UPDATE CC.dbo.DispatchIncidents SET IncidentNumber = @incidentNumber WHERE id = @draftId;
        INSERT INTO CC.dbo.DispatchAuditLog
          (dispatch_id, AuditAction, NewStatus, AuditMessage, AuditUsername, CreatedAt)
        VALUES
          (@draftId, N'Incident created', N'Draft', CONCAT(N'Draft created from ETA request ', @requestNumber, N'.'), @username, SYSDATETIME());
      `);
    }

    const finish = new sql.Request(transaction);
    finish.input("requestId", sql.BigInt, requestId);
    finish.input("responseId", sql.BigInt, responseId);
    finish.input("teamId", sql.Int, selected.TeamId);
    finish.input("distanceKm", sql.Decimal(8, 1), selected.DistanceKm);
    finish.input("draftId", sql.Int, draftId);
    finish.input("username", sql.NVarChar(128), username);
    await finish.query(`
      UPDATE CC.dbo.DispatchEtaResponses
      SET ResponseStatus = CASE WHEN EtaResponseId = @responseId THEN N'Selected' ELSE N'NotSelected' END,
          UpdatedAt = SYSDATETIME(), UpdatedBy = @username
      WHERE EtaRequestId = @requestId
        AND ResponseStatus IN (N'Pending', N'Available', N'Unavailable');

      UPDATE CC.dbo.DispatchEtaRequests
      SET RequestStatus = N'Selected',
          SelectedTeamId = @teamId,
          SelectedDistanceKm = @distanceKm,
          DispatchIncidentId = @draftId,
          SelectedAt = SYSDATETIME(),
          SelectedBy = @username,
          UpdatedAt = SYSDATETIME(),
          UpdatedBy = @username
      WHERE EtaRequestId = @requestId;
    `);

    return result("ok", "Dispatch team selected and draft created.", { id: requestId, dispatchIncidentId: draftId });
  });
}

async function main() {
  const [action, sessionId, ...args] = process.argv.slice(2);
  const pool = await new sql.ConnectionPool(poolConfig()).connect();
  try {
    let payload;
    if (action === "create") payload = await createRequest(pool, sessionId, ...args);
    else if (action === "respond") payload = await saveResponse(pool, sessionId, ...args);
    else if (action === "cancel") payload = await cancelRequest(pool, sessionId, ...args);
    else if (action === "select") payload = await selectResponse(pool, sessionId, ...args);
    else payload = result("invalid_action", "Unknown ETA request action.");
    process.stdout.write(JSON.stringify(payload));
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  process.stdout.write(JSON.stringify(result("db_error", error.message || "The ETA request action failed.")));
});
