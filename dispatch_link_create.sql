SELECT 'redirect' AS component, '/signin.sql?error' AS link
WHERE (SELECT session_id FROM Current_session WHERE session_id = sqlpage.cookie('session')) IS NULL;

INSERT INTO CC.dbo.DispatchIncidents (
    IncidentNumber,
    RiskEventReference,
    EventDateTime,
    Event,
    UnitId,
    RegNo,
    Company,
    FleetCode,
    DriverName,
    DriverContactNumber,
    GroundTeamDetails,
    DispatchReason,
    OperatorNotes,
    Status,
    CreatedBy,
    CreatedAt,
    UpdatedBy,
    UpdatedAt,
    isdeleted,
    zoho_update
)
SELECT
    'DL-' + FORMAT(SYSDATETIME(), 'yyyyMMddHHmmss') + '-' + RIGHT(REPLACE(CONVERT(NVARCHAR(36), NEWID()), '-', ''), 6),
    :riskEventReference,
    TRY_CONVERT(DATETIME2, :eventDateTime),
    :event,
    :unitId,
    :regNo,
    :company,
    :fleetCode,
    :driverName,
    :driverContactNumber,
    :groundTeamDetails,
    :dispatchReason,
    :operatorNotes,
    'Draft',
    COALESCE(NULLIF(sqlpage.cookie('username'), ''), 'SQLPage'),
    SYSDATETIME(),
    COALESCE(NULLIF(sqlpage.cookie('username'), ''), 'SQLPage'),
    SYSDATETIME(),
    0,
    0;

INSERT INTO CC.dbo.DispatchAuditLog (
    dispatch_id,
    AuditAction,
    AuditMessage,
    AuditUsername,
    CreatedAt
)
SELECT TOP 1
    id,
    'Incident created',
    'Draft created from SQLPage Dispatch Link',
    COALESCE(NULLIF(sqlpage.cookie('username'), ''), 'SQLPage'),
    SYSDATETIME()
FROM CC.dbo.DispatchIncidents
WHERE CreatedBy = COALESCE(NULLIF(sqlpage.cookie('username'), ''), 'SQLPage')
ORDER BY CreatedAt DESC, id DESC;

SELECT 'redirect' AS component, '/dispatch_link/dispatch_link.sql?created=1' AS link;
