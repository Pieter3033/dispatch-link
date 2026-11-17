const path = require("path");
const config = require("../config");
const { sql, getRequest, withTransaction } = require("../db/pool");
const {
  PHOTO_CATEGORIES,
  FILE_TYPES,
  INCIDENT_STATUSES,
  APPROVAL_STATUSES,
  buildOperatorNotes,
  canEditIncident,
  canSubmitIncident,
  computeIncidentValidation,
  ensureAllowedValue,
  normalizeNullable,
  normalizeText,
  parseOperatorNotes,
  toBoolean
} = require("../utils/dispatch");
const { createHttpError } = require("../utils/httpError");
const { qualifiedTable } = require("../utils/sql");

const incidentTable = qualifiedTable(config.db.database, "DispatchIncidents");
const photoTable = qualifiedTable(config.db.database, "DispatchIncidentPhotos");
const fileTable = qualifiedTable(config.db.database, "DispatchIncidentFiles");
const approvalTable = qualifiedTable(config.db.database, "DispatchApprovals");
const notificationTable = qualifiedTable(config.db.database, "DispatchNotifications");
const auditTable = qualifiedTable(config.db.database, "DispatchAuditLog");
const vehicleInfoTable = qualifiedTable("Risk", "vehicleinfo");
const unitInfoTable = qualifiedTable("Risk", "unitinfo");
const userInfoTable = qualifiedTable(config.db.authDatabase, "User_info");

function mapIncidentRecord(record) {
  if (!record) return null;
  const parsedNotes = parseOperatorNotes(record.OperatorNotes);
  return {
    ...record,
    operatorNotesText: parsedNotes.text,
    dispatchMeta: parsedNotes.meta
  };
}

function canEditWithUser(incident, user) {
  if (canEditIncident(incident.Status)) return true;
  return incident.Status === "PendingApproval" && Boolean(user?.isApprover);
}

function normalizeIncidentPayload(payload = {}) {
  return {
    RiskEventReference: normalizeNullable(payload.riskEventReference),
    EventDateTime: normalizeNullable(payload.eventDateTime),
    Event: normalizeNullable(payload.event),
    UnitId: normalizeNullable(payload.unitId),
    RegNo: normalizeNullable(payload.regNo),
    Company: normalizeNullable(payload.company),
    FleetCode: normalizeNullable(payload.fleetCode),
    Latitude: normalizeNullable(payload.latitude),
    Longitude: normalizeNullable(payload.longitude),
    GeoLocation: normalizeNullable(payload.geoLocation),
    DriverName: normalizeNullable(payload.driverName),
    DriverContactNumber: normalizeNullable(payload.driverContactNumber),
    GroundTeamDetails: normalizeNullable(payload.groundTeamDetails),
    DispatchReason: normalizeNullable(payload.dispatchReason),
    OperatorNotes: buildOperatorNotes(payload.operatorNotesText, {
      trailerApplicable: toBoolean(payload.trailerApplicable),
      eta: normalizeText(payload.eta),
      incidentNotesHtml: normalizeText(payload.incidentNotesHtml),
      stockApplicable: toBoolean(payload.stockApplicable),
      noVisibleDamages: toBoolean(payload.noVisibleDamages),
      damageNotes: normalizeText(payload.damageNotes),
      vehicleMake: normalizeText(payload.vehicleMake),
      vehicleModel: normalizeText(payload.vehicleModel),
      vehicleColour: normalizeText(payload.vehicleColour),
      vehicleBranding: normalizeText(payload.vehicleBranding),
      trailerType: normalizeText(payload.trailerType),
      trailerBranding: normalizeText(payload.trailerBranding),
      clientName: normalizeText(payload.clientName),
      clientContactNumber: normalizeText(payload.clientContactNumber),
      clientPo: normalizeText(payload.clientPo),
      dlNumber: normalizeText(payload.dlNumber),
      stockNumberWrc: normalizeText(payload.stockNumberWrc),
      dispatchTeam: normalizeText(payload.dispatchTeam),
      dispatchDateTime: normalizeText(payload.dispatchDateTime),
      obNumber: normalizeText(payload.obNumber),
      standDownDateTime: normalizeText(payload.standDownDateTime),
      vehicleRecovered: normalizeText(payload.vehicleRecovered),
      recoveryDateTime: normalizeText(payload.recoveryDateTime),
      loadRecovered: normalizeText(payload.loadRecovered),
      vehicleKeyAvailable: normalizeText(payload.vehicleKeyAvailable),
      trailersRecovered: normalizeText(payload.trailersRecovered),
      driverOnScene: normalizeText(payload.driverOnScene),
      trackingUnitStatus: normalizeText(payload.trackingUnitStatus)
    })
  };
}

function buildIncidentNumber(id) {
  return `DL-${String(id).padStart(6, "0")}`;
}

async function addAuditEntry(transaction, {
  dispatchId,
  action,
  oldStatus = null,
  newStatus = null,
  message,
  username
}) {
  const request = await getRequest(transaction);
  request.input("dispatchId", sql.Int, dispatchId);
  request.input("action", sql.NVarChar(100), action);
  request.input("oldStatus", sql.NVarChar(50), oldStatus);
  request.input("newStatus", sql.NVarChar(50), newStatus);
  request.input("message", sql.NVarChar(sql.MAX), message);
  request.input("username", sql.NVarChar(200), username);

  await request.query(`
    INSERT INTO ${auditTable} (
      dispatch_id,
      AuditAction,
      OldStatus,
      NewStatus,
      AuditMessage,
      AuditUsername,
      CreatedAt
    )
    VALUES (
      @dispatchId,
      @action,
      @oldStatus,
      @newStatus,
      @message,
      @username,
      SYSDATETIME()
    )
  `);
}

async function queueApprovalNotifications(transaction, incident, username) {
  for (const approver of config.approvers) {
    const request = await getRequest(transaction);
    request.input("dispatchId", sql.Int, incident.id);
    request.input("recipientName", sql.NVarChar(200), approver);
    request.input("recipientContact", sql.NVarChar(255), null);
    request.input("subject", sql.NVarChar(255), `Dispatch incident ${incident.IncidentNumber} requires approval`);
    request.input(
      "body",
      sql.NVarChar(sql.MAX),
      [
        `Dispatch Incident Number: ${incident.IncidentNumber}`,
        `Unit ID: ${incident.UnitId || "-"}`,
        `Registration Number: ${incident.RegNo || "-"}`,
        `Company: ${incident.Company || "-"}`,
        `Event: ${incident.Event || "-"}`,
        `Event Date/Time: ${incident.EventDateTime || "-"}`,
        `Submitted By: ${username}`,
        "Approval Link: /#approvals"
      ].join("\n")
    );
    request.input("createdBy", sql.NVarChar(200), username);
    await request.query(`
      INSERT INTO ${notificationTable} (
        dispatch_id,
        NotificationType,
        RecipientName,
        RecipientContact,
        MessageSubject,
        MessageBody,
        Status,
        AttemptCount,
        CreatedAt,
        CreatedBy
      )
      VALUES (
        @dispatchId,
        'Email',
        @recipientName,
        @recipientContact,
        @subject,
        @body,
        'Pending',
        0,
        SYSDATETIME(),
        @createdBy
      )
    `);
  }

  await addAuditEntry(transaction, {
    dispatchId: incident.id,
    action: "Notification queued",
    oldStatus: incident.Status,
    newStatus: incident.Status,
    message: `Approval notifications queued for ${config.approvers.join(", ")}`,
    username
  });
}

async function upsertApproval(transaction, dispatchId, status, username, values = {}) {
  ensureAllowedValue(status, APPROVAL_STATUSES, "ApprovalStatus");
  const checkRequest = await getRequest(transaction);
  checkRequest.input("dispatchId", sql.Int, dispatchId);
  const existing = await checkRequest.query(`
    SELECT TOP (1) id
    FROM ${approvalTable}
    WHERE dispatch_id = @dispatchId
    ORDER BY id DESC
  `);

  const recordId = existing.recordset[0]?.id;
  const request = await getRequest(transaction);
  request.input("dispatchId", sql.Int, dispatchId);
  request.input("status", sql.NVarChar(50), status);
  request.input("approvedBy", sql.NVarChar(200), status === "Approved" ? username : null);
  request.input("rejectedBy", sql.NVarChar(200), status === "Rejected" ? username : null);
  request.input("rejectionReason", sql.NVarChar(sql.MAX), values.rejectionReason || null);
  request.input("approvalComments", sql.NVarChar(sql.MAX), values.approvalComments || null);
  request.input("createdBy", sql.NVarChar(200), username);
  request.input("recordId", sql.Int, recordId || null);

  if (recordId) {
    await request.query(`
      UPDATE ${approvalTable}
      SET
        ApprovalStatus = @status,
        ApprovedAt = CASE WHEN @status = 'Approved' THEN SYSDATETIME() ELSE NULL END,
        ApprovedBy = @approvedBy,
        RejectedAt = CASE WHEN @status = 'Rejected' THEN SYSDATETIME() ELSE NULL END,
        RejectedBy = @rejectedBy,
        RejectionReason = @rejectionReason,
        ApprovalComments = @approvalComments
      WHERE id = @recordId
    `);
  } else {
    await request.query(`
      INSERT INTO ${approvalTable} (
        dispatch_id,
        ApprovalStatus,
        ApprovedAt,
        ApprovedBy,
        RejectedAt,
        RejectedBy,
        RejectionReason,
        ApprovalComments,
        CreatedAt,
        CreatedBy
      )
      VALUES (
        @dispatchId,
        @status,
        CASE WHEN @status = 'Approved' THEN SYSDATETIME() ELSE NULL END,
        @approvedBy,
        CASE WHEN @status = 'Rejected' THEN SYSDATETIME() ELSE NULL END,
        @rejectedBy,
        @rejectionReason,
        @approvalComments,
        SYSDATETIME(),
        @createdBy
      )
    `);
  }
}

async function fetchIncidentById(id, transaction) {
  const request = await getRequest(transaction);
  request.input("id", sql.Int, id);
  const result = await request.query(`
    SELECT TOP (1)
      id,
      IncidentNumber,
      RiskEventReference,
      EventDateTime,
      DispatchDateTime,
      StandDownDateTime,
      ClosedAt,
      Event,
      UnitId,
      RegNo,
      Company,
      FleetCode,
      Latitude,
      Longitude,
      GeoLocation,
      DriverName,
      DriverContactNumber,
      GroundTeamDetails,
      DispatchReason,
      OperatorNotes,
      Status,
      SubmittedAt,
      SubmittedBy,
      COALESCE(
        NULLIF(LTRIM(RTRIM(CONCAT(submitter_info.Name, ' ', submitter_info.Surname))), ''),
        SubmittedBy
      ) AS SubmittedByDisplayName,
      ApprovedAt,
      ApprovedBy,
      RejectedAt,
      RejectedBy,
      RejectionReason,
      ApprovalComments,
      pdfpath,
      zoho_update,
      zoho_id,
      CreatedAt,
      CreatedBy,
      UpdatedAt,
      UpdatedBy,
      isdeleted
    FROM ${incidentTable}
    OUTER APPLY (
      SELECT TOP (1) user_row.Name, user_row.Surname
      FROM ${userInfoTable} user_row
      WHERE user_row.Username = SubmittedBy
    ) submitter_info
    WHERE id = @id
      AND ISNULL(isdeleted, 0) = 0
  `);

  return result.recordset[0] || null;
}

async function fetchIncidentPhotos(id, transaction) {
  const request = await getRequest(transaction);
  request.input("id", sql.Int, id);
  const result = await request.query(`
    SELECT
      id,
      dispatch_id,
      PhotoCategory,
      OriginalFileName,
      StoredFileName,
      FilePath,
      MimeType,
      bytes,
      Notes,
      UploadedAt,
      UploadedBy,
      ValidationStatus,
      CreatedAt,
      CreatedBy
    FROM ${photoTable}
    WHERE dispatch_id = @id
      AND ISNULL(IsDeleted, 0) = 0
    ORDER BY UploadedAt DESC, id DESC
  `);
  return result.recordset;
}

async function fetchIncidentFiles(id, transaction) {
  const request = await getRequest(transaction);
  request.input("id", sql.Int, id);
  const result = await request.query(`
    SELECT
      id,
      dispatch_id,
      FileType,
      OriginalFileName,
      StoredFileName,
      filepath,
      mimetype,
      bytes,
      UploadedAt,
      UploadedBy,
      CreatedAt,
      CreatedBy
    FROM ${fileTable}
    WHERE dispatch_id = @id
    ORDER BY UploadedAt DESC, id DESC
  `);
  return result.recordset;
}

async function fetchIncidentAudit(id, transaction) {
  const request = await getRequest(transaction);
  request.input("id", sql.Int, id);
  const result = await request.query(`
    SELECT
      id,
      dispatch_id,
      AuditAction,
      OldStatus,
      NewStatus,
      AuditMessage,
      AuditUsername,
      CreatedAt
    FROM ${auditTable}
    WHERE dispatch_id = @id
    ORDER BY CreatedAt DESC, id DESC
  `);
  return result.recordset;
}

async function fetchApprovalRecord(id, transaction) {
  const request = await getRequest(transaction);
  request.input("id", sql.Int, id);
  const result = await request.query(`
    SELECT TOP (1)
      id,
      dispatch_id,
      ApprovalStatus,
      ApprovedAt,
      ApprovedBy,
      RejectedAt,
      RejectedBy,
      RejectionReason,
      ApprovalComments,
      CreatedAt,
      CreatedBy
    FROM ${approvalTable}
    WHERE dispatch_id = @id
    ORDER BY id DESC
  `);
  return result.recordset[0] || null;
}

function attachPublicUrls(items, pathField) {
  return items.map((item) => ({
    ...item,
    downloadUrl: item[pathField]
      ? `/uploads/${String(item[pathField]).replace(/^\/+/, "").replace(/\\/g, "/")}`
      : null
  }));
}

async function getIncidentDetail(id) {
  const incident = await fetchIncidentById(id);
  if (!incident) {
    throw createHttpError(404, "Dispatch incident was not found.");
  }

  const [photos, files, audit, approval] = await Promise.all([
    fetchIncidentPhotos(id),
    fetchIncidentFiles(id),
    fetchIncidentAudit(id),
    fetchApprovalRecord(id)
  ]);

  const validation = computeIncidentValidation(incident, photos, files);
  return {
    incident: mapIncidentRecord(incident),
    photos: attachPublicUrls(photos, "FilePath"),
    files: attachPublicUrls(files, "filepath"),
    approval,
    audit,
    validation
  };
}

async function listIncidents(filters = {}) {
  const request = await getRequest();
  request.input("status", sql.NVarChar(50), normalizeNullable(filters.status));
  request.input("search", sql.NVarChar(200), normalizeNullable(filters.search));
  request.input("createdBy", sql.NVarChar(200), normalizeNullable(filters.createdBy));

  const whereClauses = [
    "ISNULL(isdeleted, 0) = 0",
    "(@status IS NULL OR Status = @status)",
    `(
      @search IS NULL
      OR IncidentNumber LIKE '%' + @search + '%'
      OR UnitId LIKE '%' + @search + '%'
      OR RegNo LIKE '%' + @search + '%'
      OR Company LIKE '%' + @search + '%'
      OR Event LIKE '%' + @search + '%'
    )`,
    "(@createdBy IS NULL OR CreatedBy = @createdBy)"
  ];

  const result = await request.query(`
    SELECT
      id,
      IncidentNumber,
      EventDateTime,
      Event,
      UnitId,
      RegNo,
      Company,
      Status,
      SubmittedAt,
      SubmittedBy,
      COALESCE(
        NULLIF(LTRIM(RTRIM(CONCAT(submitter_info.Name, ' ', submitter_info.Surname))), ''),
        SubmittedBy
      ) AS SubmittedByDisplayName,
      ApprovedAt,
      ApprovedBy,
      RejectedAt,
      RejectedBy,
      RejectionReason,
      CreatedAt,
      CreatedBy,
      UpdatedAt,
      UpdatedBy,
      CAST(CASE
        WHEN EXISTS (
          SELECT 1
          FROM ${unitInfoTable} unit_row
          WHERE NULLIF(LTRIM(RTRIM(RegNo)), '') IS NOT NULL
            AND UPPER(LTRIM(RTRIM(unit_row.reg_no))) = UPPER(LTRIM(RTRIM(RegNo)))
            AND LOWER(LTRIM(RTRIM(COALESCE(unit_row.ctrltype, '')))) <> 'lmu ir'
        )
        AND EXISTS (
          SELECT 1
          FROM ${vehicleInfoTable} vehicle_row
          WHERE NULLIF(LTRIM(RTRIM(RegNo)), '') IS NOT NULL
            AND UPPER(LTRIM(RTRIM(vehicle_row.reg_no))) = UPPER(LTRIM(RTRIM(RegNo)))
        )
        THEN 1 ELSE 0
      END AS BIT) AS MSTrackRegistrationExists
    FROM ${incidentTable}
    OUTER APPLY (
      SELECT TOP (1) user_row.Name, user_row.Surname
      FROM ${userInfoTable} user_row
      WHERE user_row.Username = SubmittedBy
    ) submitter_info
    WHERE ${whereClauses.join("\n      AND ")}
    ORDER BY CreatedAt DESC, id DESC
  `);

  const summaryResult = await request.query(`
    SELECT
      SUM(CASE WHEN Status = 'Draft' THEN 1 ELSE 0 END) AS draftCount,
      SUM(CASE WHEN Status IN ('PendingApproval', 'Rejected') THEN 1 ELSE 0 END) AS pendingCount,
      SUM(CASE WHEN Status = 'Approved' THEN 1 ELSE 0 END) AS approvedCount,
      SUM(CASE WHEN Status = 'Rejected' THEN 1 ELSE 0 END) AS rejectedCount
    FROM ${incidentTable}
    WHERE ISNULL(isdeleted, 0) = 0
  `);

  return {
    incidents: result.recordset,
    summary: summaryResult.recordset[0] || {
      draftCount: 0,
      pendingCount: 0,
      approvedCount: 0,
      rejectedCount: 0
    }
  };
}

async function listPendingApprovals() {
  const request = await getRequest();
  const result = await request.query(`
    SELECT
      i.id,
      i.IncidentNumber,
      i.EventDateTime,
      i.Event,
      i.UnitId,
      i.RegNo,
      i.Company,
      i.Status,
      i.SubmittedAt,
      i.SubmittedBy,
      i.CreatedAt,
      i.CreatedBy,
      COALESCE(
        NULLIF(LTRIM(RTRIM(CONCAT(user_info.Name, ' ', user_info.Surname))), ''),
        i.CreatedBy
      ) AS CreatedByDisplayName
    FROM ${incidentTable} i
    OUTER APPLY (
      SELECT TOP (1) user_row.Name, user_row.Surname
      FROM ${userInfoTable} user_row
      WHERE user_row.Username = i.CreatedBy
    ) user_info
    WHERE ISNULL(i.isdeleted, 0) = 0
      AND i.Status IN ('PendingApproval', 'Rejected')
    ORDER BY i.SubmittedAt DESC, i.id DESC
  `);

  return result.recordset;
}

async function lookupRegistration(registration) {
  const reg = normalizeText(registration);
  if (!reg) {
    throw createHttpError(422, "Registration number is required.");
  }

  const request = await getRequest();
  request.input("reg", sql.NVarChar(50), reg);

  const result = await request.query(`
    WITH request_data AS (
      SELECT
        NULLIF(LTRIM(RTRIM(@reg)), '') AS reg,
        CASE
          WHEN CHARINDEX('_', NULLIF(LTRIM(RTRIM(@reg)), '')) > 0
          THEN LEFT(NULLIF(LTRIM(RTRIM(@reg)), ''), CHARINDEX('_', NULLIF(LTRIM(RTRIM(@reg)), '')) - 1)
          ELSE NULLIF(LTRIM(RTRIM(@reg)), '')
        END AS base_reg
    )
    SELECT
      request_data.reg AS registration,
      CAST(CASE WHEN vehicle_match.reg_no IS NOT NULL THEN 1 ELSE 0 END AS BIT) AS vehicleInfoExists,
      CAST(CASE WHEN unit_match.unit_id IS NOT NULL THEN 1 ELSE 0 END AS BIT) AS unitInfoExists,
      unit_match.unit_id AS unit_id,
      vehicle_match.reg_no,
      vehicle_match.vehdesc,
      vehicle_match.company,
      vehicle_match.fleet_Code,
      vehicle_match.MakeDesc,
      vehicle_match.Colour AS color,
      vehicle_match.ChassisNo AS chassisno,
      vehicle_match.EngineNo AS engineno
    FROM request_data
    OUTER APPLY (
      SELECT TOP (1)
        vehicle_row.reg_no,
        vehicle_row.vehdesc,
        vehicle_row.company,
        vehicle_row.fleet_Code,
        vehicle_row.MakeDesc,
        vehicle_row.Colour,
        vehicle_row.ChassisNo,
        vehicle_row.EngineNo
      FROM ${vehicleInfoTable} vehicle_row
      WHERE request_data.reg IS NOT NULL
        AND UPPER(LTRIM(RTRIM(vehicle_row.reg_no))) = UPPER(LTRIM(RTRIM(request_data.reg)))
      ORDER BY vehicle_row.reg_no
    ) vehicle_match
    OUTER APPLY (
      SELECT TOP (1)
        unit_lookup.unit_id
      FROM ${unitInfoTable} unit_lookup
      WHERE request_data.reg IS NOT NULL
        AND UPPER(LTRIM(RTRIM(unit_lookup.reg_no))) = UPPER(LTRIM(RTRIM(request_data.reg)))
        AND LOWER(LTRIM(RTRIM(COALESCE(unit_lookup.ctrltype, '')))) <> 'lmu ir'
      ORDER BY unit_lookup.unit_id
    ) unit_match
  `);

  const row = result.recordset[0] || {};
  const vehicleInfoExists = Boolean(row.vehicleInfoExists);
  const unitInfoExists = Boolean(row.unitInfoExists);
  const exactFound = vehicleInfoExists && unitInfoExists;

  let similarRegistrations = [];
  const similarRequest = await getRequest();
  similarRequest.input("reg", sql.NVarChar(50), reg);
  const similarResult = await similarRequest.query(`
    WITH request_data AS (
      SELECT
        CASE
          WHEN CHARINDEX('_', NULLIF(LTRIM(RTRIM(@reg)), '')) > 0
          THEN LEFT(NULLIF(LTRIM(RTRIM(@reg)), ''), CHARINDEX('_', NULLIF(LTRIM(RTRIM(@reg)), '')) - 1)
          ELSE NULLIF(LTRIM(RTRIM(@reg)), '')
        END AS base_reg
    )
    SELECT similar.reg_no
    FROM (
      SELECT DISTINCT CAST(vehicle_match.reg_no AS NVARCHAR(50)) AS reg_no
      FROM ${vehicleInfoTable} vehicle_match
      CROSS JOIN request_data
      WHERE request_data.base_reg IS NOT NULL
        AND (
          UPPER(LTRIM(RTRIM(vehicle_match.reg_no))) = UPPER(LTRIM(RTRIM(request_data.base_reg)))
          OR UPPER(LTRIM(RTRIM(vehicle_match.reg_no))) LIKE UPPER(LTRIM(RTRIM(request_data.base_reg))) + '\\_%' ESCAPE '\\'
        )
      UNION
      SELECT DISTINCT CAST(unit_match.reg_no AS NVARCHAR(50)) AS reg_no
      FROM ${unitInfoTable} unit_match
      CROSS JOIN request_data
      WHERE request_data.base_reg IS NOT NULL
        AND LOWER(LTRIM(RTRIM(COALESCE(unit_match.ctrltype, '')))) <> 'lmu ir'
        AND (
          UPPER(LTRIM(RTRIM(unit_match.reg_no))) = UPPER(LTRIM(RTRIM(request_data.base_reg)))
          OR UPPER(LTRIM(RTRIM(unit_match.reg_no))) LIKE UPPER(LTRIM(RTRIM(request_data.base_reg))) + '\\_%' ESCAPE '\\'
        )
    ) similar
    ORDER BY similar.reg_no
  `);
  similarRegistrations = similarResult.recordset;

  return {
    registration: row.registration || reg,
    exactFound,
    vehicleInfoExists,
    unitInfoExists,
    vehicle: exactFound ? {
      unit_id: row.unit_id,
      reg_no: row.reg_no,
      vehdesc: row.vehdesc,
      company: row.company,
      fleet_Code: row.fleet_Code,
      MakeDesc: row.MakeDesc,
      color: row.color,
      chassisno: row.chassisno,
      engineno: row.engineno
    } : null,
    similarRegistrations
  };
}

async function createDraft(user, payload) {
  const normalized = normalizeIncidentPayload(payload);
  const detailId = await withTransaction(async (transaction) => {
    const request = await getRequest(transaction);
    request.input("RiskEventReference", sql.NVarChar(200), normalized.RiskEventReference);
    request.input("EventDateTime", sql.NVarChar(50), normalized.EventDateTime);
    request.input("Event", sql.NVarChar(255), normalized.Event);
    request.input("UnitId", sql.NVarChar(100), normalized.UnitId);
    request.input("RegNo", sql.NVarChar(100), normalized.RegNo);
    request.input("Company", sql.NVarChar(200), normalized.Company);
    request.input("FleetCode", sql.NVarChar(100), normalized.FleetCode);
    request.input("Latitude", sql.NVarChar(50), normalized.Latitude);
    request.input("Longitude", sql.NVarChar(50), normalized.Longitude);
    request.input("GeoLocation", sql.NVarChar(255), normalized.GeoLocation);
    request.input("DriverName", sql.NVarChar(200), normalized.DriverName);
    request.input("DriverContactNumber", sql.NVarChar(100), normalized.DriverContactNumber);
    request.input("GroundTeamDetails", sql.NVarChar(sql.MAX), normalized.GroundTeamDetails);
    request.input("DispatchReason", sql.NVarChar(sql.MAX), normalized.DispatchReason);
    request.input("OperatorNotes", sql.NVarChar(sql.MAX), normalized.OperatorNotes);
    request.input("CreatedBy", sql.NVarChar(200), user.username);

    const insertResult = await request.query(`
      INSERT INTO ${incidentTable} (
        IncidentNumber,
        RiskEventReference,
        EventDateTime,
        Event,
        UnitId,
        RegNo,
        Company,
        FleetCode,
        Latitude,
        Longitude,
        GeoLocation,
        DriverName,
        DriverContactNumber,
        GroundTeamDetails,
        DispatchReason,
        OperatorNotes,
        Status,
        pdfpath,
        zoho_update,
        zoho_id,
        CreatedAt,
        CreatedBy,
        UpdatedAt,
        UpdatedBy,
        isdeleted
      )
      OUTPUT INSERTED.id
      VALUES (
        '',
        @RiskEventReference,
        @EventDateTime,
        @Event,
        @UnitId,
        @RegNo,
        @Company,
        @FleetCode,
        @Latitude,
        @Longitude,
        @GeoLocation,
        @DriverName,
        @DriverContactNumber,
        @GroundTeamDetails,
        @DispatchReason,
        @OperatorNotes,
        'Draft',
        NULL,
        0,
        NULL,
        SYSDATETIME(),
        @CreatedBy,
        SYSDATETIME(),
        @CreatedBy,
        0
      )
    `);

    const id = insertResult.recordset[0].id;
    const incidentNumber = buildIncidentNumber(id);

    const updateRequest = await getRequest(transaction);
    updateRequest.input("id", sql.Int, id);
    updateRequest.input("IncidentNumber", sql.NVarChar(50), incidentNumber);
    await updateRequest.query(`
      UPDATE ${incidentTable}
      SET IncidentNumber = @IncidentNumber
      WHERE id = @id
    `);

    await addAuditEntry(transaction, {
      dispatchId: id,
      action: "Incident created",
      oldStatus: null,
      newStatus: "Draft",
      message: `Draft incident ${incidentNumber} created.`,
      username: user.username
    });

    return id;
  });
  return getIncidentDetail(detailId);
}

async function updateDraft(id, user, payload) {
  const existing = await fetchIncidentById(id);
  if (!existing) {
    throw createHttpError(404, "Dispatch incident was not found.");
  }
  if (!canEditWithUser(existing, user)) {
    throw createHttpError(409, `Incident cannot be edited while status is ${existing.Status}.`);
  }

  const normalized = normalizeIncidentPayload(payload);

  const detailId = await withTransaction(async (transaction) => {
    const request = await getRequest(transaction);
    request.input("id", sql.Int, id);
    request.input("RiskEventReference", sql.NVarChar(200), normalized.RiskEventReference);
    request.input("EventDateTime", sql.NVarChar(50), normalized.EventDateTime);
    request.input("Event", sql.NVarChar(255), normalized.Event);
    request.input("UnitId", sql.NVarChar(100), normalized.UnitId);
    request.input("RegNo", sql.NVarChar(100), normalized.RegNo);
    request.input("Company", sql.NVarChar(200), normalized.Company);
    request.input("FleetCode", sql.NVarChar(100), normalized.FleetCode);
    request.input("Latitude", sql.NVarChar(50), normalized.Latitude);
    request.input("Longitude", sql.NVarChar(50), normalized.Longitude);
    request.input("GeoLocation", sql.NVarChar(255), normalized.GeoLocation);
    request.input("DriverName", sql.NVarChar(200), normalized.DriverName);
    request.input("DriverContactNumber", sql.NVarChar(100), normalized.DriverContactNumber);
    request.input("GroundTeamDetails", sql.NVarChar(sql.MAX), normalized.GroundTeamDetails);
    request.input("DispatchReason", sql.NVarChar(sql.MAX), normalized.DispatchReason);
    request.input("OperatorNotes", sql.NVarChar(sql.MAX), normalized.OperatorNotes);
    request.input("UpdatedBy", sql.NVarChar(200), user.username);

    await request.query(`
      UPDATE ${incidentTable}
      SET
        RiskEventReference = @RiskEventReference,
        EventDateTime = @EventDateTime,
        Event = @Event,
        UnitId = @UnitId,
        RegNo = @RegNo,
        Company = @Company,
        FleetCode = @FleetCode,
        Latitude = @Latitude,
        Longitude = @Longitude,
        GeoLocation = @GeoLocation,
        DriverName = @DriverName,
        DriverContactNumber = @DriverContactNumber,
        GroundTeamDetails = @GroundTeamDetails,
        DispatchReason = @DispatchReason,
        OperatorNotes = @OperatorNotes,
        UpdatedAt = SYSDATETIME(),
        UpdatedBy = @UpdatedBy
      WHERE id = @id
    `);

    await addAuditEntry(transaction, {
      dispatchId: id,
      action: "Incident updated",
      oldStatus: existing.Status,
      newStatus: existing.Status,
      message: `Incident ${existing.IncidentNumber} updated.`,
      username: user.username
    });

    return id;
  });
  return getIncidentDetail(detailId);
}

async function submitIncident(id, user) {
  const existing = await fetchIncidentById(id);
  if (!existing) {
    throw createHttpError(404, "Dispatch incident was not found.");
  }
  if (!canSubmitIncident(existing.Status)) {
    throw createHttpError(409, `Incident cannot be submitted while status is ${existing.Status}.`);
  }

  const [photos, files] = await Promise.all([
    fetchIncidentPhotos(id),
    fetchIncidentFiles(id)
  ]);
  const validation = computeIncidentValidation(existing, photos, files);
  if (!validation.isValid) {
    throw createHttpError(422, "Incident is missing required data or photos.", validation);
  }

  const detailId = await withTransaction(async (transaction) => {
    const request = await getRequest(transaction);
    request.input("id", sql.Int, id);
    request.input("submittedBy", sql.NVarChar(200), user.username);
    await request.query(`
      UPDATE ${incidentTable}
      SET
        Status = 'PendingApproval',
        SubmittedAt = SYSDATETIME(),
        SubmittedBy = @submittedBy,
        UpdatedAt = SYSDATETIME(),
        UpdatedBy = @submittedBy
      WHERE id = @id
    `);

    await upsertApproval(transaction, id, "Pending", user.username, {});
    await addAuditEntry(transaction, {
      dispatchId: id,
      action: "Submitted for approval",
      oldStatus: existing.Status,
      newStatus: "PendingApproval",
      message: `Incident ${existing.IncidentNumber} submitted for approval.`,
      username: user.username
    });

    await queueApprovalNotifications(transaction, existing, user.username);
    return id;
  });
  return getIncidentDetail(detailId);
}

async function approveIncident(id, user, approvalComments) {
  const existing = await fetchIncidentById(id);
  if (!existing) throw createHttpError(404, "Dispatch incident was not found.");
  if (existing.Status !== "PendingApproval") {
    throw createHttpError(409, `Only pending incidents can be approved. Current status: ${existing.Status}.`);
  }

  const [photos, files] = await Promise.all([
    fetchIncidentPhotos(id),
    fetchIncidentFiles(id)
  ]);
  const validation = computeIncidentValidation(existing, photos, files);
  if (!validation.isValid) {
    throw createHttpError(422, "Incident cannot be approved until required data and files are complete.", validation);
  }

  const detailId = await withTransaction(async (transaction) => {
    const request = await getRequest(transaction);
    request.input("id", sql.Int, id);
    request.input("approvedBy", sql.NVarChar(200), user.username);
    request.input("approvalComments", sql.NVarChar(sql.MAX), normalizeNullable(approvalComments));
    await request.query(`
      UPDATE ${incidentTable}
      SET
        Status = 'Approved',
        ApprovedAt = SYSDATETIME(),
        ApprovedBy = @approvedBy,
        ApprovalComments = @approvalComments,
        UpdatedAt = SYSDATETIME(),
        UpdatedBy = @approvedBy
      WHERE id = @id
    `);

    await upsertApproval(transaction, id, "Approved", user.username, {
      approvalComments: normalizeNullable(approvalComments)
    });

    await addAuditEntry(transaction, {
      dispatchId: id,
      action: "Approved",
      oldStatus: existing.Status,
      newStatus: "Approved",
      message: `Incident ${existing.IncidentNumber} approved.`,
      username: user.username
    });

    return id;
  });
  return getIncidentDetail(detailId);
}

async function rejectIncident(id, user, rejectionReason) {
  const existing = await fetchIncidentById(id);
  if (!existing) throw createHttpError(404, "Dispatch incident was not found.");
  if (existing.Status !== "PendingApproval") {
    throw createHttpError(409, `Only pending incidents can be rejected. Current status: ${existing.Status}.`);
  }

  const reason = normalizeText(rejectionReason);
  if (!reason) {
    throw createHttpError(422, "Rejection reason is required.");
  }

  const detailId = await withTransaction(async (transaction) => {
    const request = await getRequest(transaction);
    request.input("id", sql.Int, id);
    request.input("rejectedBy", sql.NVarChar(200), user.username);
    request.input("rejectionReason", sql.NVarChar(sql.MAX), reason);
    await request.query(`
      UPDATE ${incidentTable}
      SET
        Status = 'Rejected',
        RejectedAt = SYSDATETIME(),
        RejectedBy = @rejectedBy,
        RejectionReason = @rejectionReason,
        UpdatedAt = SYSDATETIME(),
        UpdatedBy = @rejectedBy
      WHERE id = @id
    `);

    await upsertApproval(transaction, id, "Rejected", user.username, {
      rejectionReason: reason
    });

    await addAuditEntry(transaction, {
      dispatchId: id,
      action: "Rejected",
      oldStatus: existing.Status,
      newStatus: "Rejected",
      message: `Incident ${existing.IncidentNumber} rejected.`,
      username: user.username
    });

    return id;
  });
  return getIncidentDetail(detailId);
}

async function addPhotoUpload(id, user, upload, relativePath, payload = {}) {
  ensureAllowedValue(payload.photoCategory, PHOTO_CATEGORIES, "PhotoCategory");
  const incident = await fetchIncidentById(id);
  if (!incident) {
    throw createHttpError(404, "Dispatch incident was not found.");
  }
  if (!canEditWithUser(incident, user)) {
    throw createHttpError(409, `Photo upload is not allowed while status is ${incident.Status}.`);
  }

  const detailId = await withTransaction(async (transaction) => {
    const request = await getRequest(transaction);
    request.input("dispatchId", sql.Int, id);
    request.input("photoCategory", sql.NVarChar(100), payload.photoCategory);
    request.input("originalFileName", sql.NVarChar(255), upload.originalFileName);
    request.input("storedFileName", sql.NVarChar(255), upload.storedFileName);
    request.input("filePath", sql.NVarChar(400), relativePath);
    request.input("mimeType", sql.NVarChar(150), upload.mimeType);
    request.input("bytes", sql.Int, upload.bytes);
    request.input("notes", sql.NVarChar(sql.MAX), normalizeNullable(payload.notes));
    request.input("uploadedBy", sql.NVarChar(200), user.username);

    await request.query(`
      UPDATE ${photoTable}
      SET
        IsDeleted = 1,
        DeletedAt = SYSDATETIME(),
        DeletedBy = @uploadedBy,
        UpdatedAt = SYSDATETIME(),
        UpdatedBy = @uploadedBy
      WHERE dispatch_id = @dispatchId
        AND PhotoCategory = @photoCategory
        AND ISNULL(IsDeleted, 0) = 0;

      INSERT INTO ${photoTable} (
        dispatch_id,
        PhotoCategory,
        OriginalFileName,
        StoredFileName,
        FilePath,
        MimeType,
        bytes,
        Notes,
        UploadedAt,
        UploadedBy,
        ValidationStatus,
        CreatedAt,
        CreatedBy
      )
      VALUES (
        @dispatchId,
        @photoCategory,
        @originalFileName,
        @storedFileName,
        @filePath,
        @mimeType,
        @bytes,
        @notes,
        SYSDATETIME(),
        @uploadedBy,
        'Valid',
        SYSDATETIME(),
        @uploadedBy
      )
    `);

    await addAuditEntry(transaction, {
      dispatchId: id,
      action: "Photo uploaded",
      oldStatus: incident.Status,
      newStatus: incident.Status,
      message: `${payload.photoCategory} photo uploaded.`,
      username: user.username
    });

    return id;
  });
  return getIncidentDetail(detailId);
}

async function addHistoryFile(id, user, upload, relativePath, fileType) {
  ensureAllowedValue(fileType, FILE_TYPES.slice(0, 2), "FileType");
  const incident = await fetchIncidentById(id);
  if (!incident) {
    throw createHttpError(404, "Dispatch incident was not found.");
  }
  if (!canEditWithUser(incident, user)) {
    throw createHttpError(409, `File upload is not allowed while status is ${incident.Status}.`);
  }

  const detailId = await withTransaction(async (transaction) => {
    const request = await getRequest(transaction);
    request.input("dispatchId", sql.Int, id);
    request.input("fileType", sql.NVarChar(100), fileType);
    request.input("originalFileName", sql.NVarChar(255), upload.originalFileName);
    request.input("storedFileName", sql.NVarChar(255), upload.storedFileName);
    request.input("filePath", sql.NVarChar(400), relativePath);
    request.input("mimeType", sql.NVarChar(150), upload.mimeType);
    request.input("bytes", sql.Int, upload.bytes);
    request.input("uploadedBy", sql.NVarChar(200), user.username);

    await request.query(`
      INSERT INTO ${fileTable} (
        dispatch_id,
        FileType,
        OriginalFileName,
        StoredFileName,
        filepath,
        mimetype,
        bytes,
        UploadedAt,
        UploadedBy,
        CreatedAt,
        CreatedBy
      )
      VALUES (
        @dispatchId,
        @fileType,
        @originalFileName,
        @storedFileName,
        @filePath,
        @mimeType,
        @bytes,
        SYSDATETIME(),
        @uploadedBy,
        SYSDATETIME(),
        @uploadedBy
      )
    `);

    await addAuditEntry(transaction, {
      dispatchId: id,
      action: "File uploaded",
      oldStatus: incident.Status,
      newStatus: incident.Status,
      message: `${fileType} uploaded.`,
      username: user.username
    });

    return id;
  });
  return getIncidentDetail(detailId);
}

async function getAuditTrail(id) {
  const incident = await fetchIncidentById(id);
  if (!incident) {
    throw createHttpError(404, "Dispatch incident was not found.");
  }
  return fetchIncidentAudit(id);
}

async function getBisHistoryIncident(id) {
  if (!Number.isInteger(id) || id <= 0) {
    throw createHttpError(422, "A valid dispatch incident ID is required.");
  }
  const request = await getRequest();
  request.input("id", sql.Int, id);
  const result = await request.query(`
    SELECT TOP (1)
      id,
      IncidentNumber,
      RegNo,
      DATEADD(hour, -2, EventDateTime) AS EventDateTime,
      DATEADD(hour, -2, DispatchDateTime) AS DispatchDateTime,
      DATEADD(hour, -2, StandDownDateTime) AS StandDownDateTime,
      CAST(NULL AS datetime2) AS ClosedAt,
      DATEADD(hour, -2, UpdatedAt) AS UpdatedAt,
      Status,
      DispatchStatus
    FROM ${incidentTable}
    WHERE id = @id
      AND ISNULL(isdeleted, 0) = 0
  `);
  const incident = result.recordset[0] || null;
  if (!incident) throw createHttpError(404, "Dispatch incident was not found.");
  return incident;
}

module.exports = {
  FILE_TYPES,
  INCIDENT_STATUSES,
  PHOTO_CATEGORIES,
  addHistoryFile,
  addPhotoUpload,
  approveIncident,
  createDraft,
  getAuditTrail,
  getBisHistoryIncident,
  getIncidentDetail,
  listIncidents,
  listPendingApprovals,
  lookupRegistration,
  rejectIncident,
  submitIncident,
  updateDraft
};
