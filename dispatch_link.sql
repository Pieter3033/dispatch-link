SELECT 'redirect' AS component, '/signin.sql?error' AS link
WHERE (SELECT session_id FROM Current_session WHERE session_id = sqlpage.cookie('session')) IS NULL;

SELECT
    'shell' AS component,
    'Dispatch Link' AS title,
    '/internaltickets/index.html' AS link,
    'Dispatch Link' AS description;

SELECT 'title' AS component, 'Dispatch Link' AS contents, 1 AS level;

SELECT
    'alert' AS component,
    'success' AS color,
    'Incident saved.' AS title,
    'The dispatch incident draft was created.' AS description
WHERE :created IS NOT NULL;

SELECT 'card' AS component, 4 AS columns;
SELECT
    'Drafts' AS title,
    CAST(COUNT(*) AS NVARCHAR(20)) AS description,
    'pencil' AS icon,
    'orange' AS color
FROM CC.dbo.DispatchIncidents
WHERE ISNULL(isdeleted, 0) = 0 AND Status = 'Draft';
SELECT
    'Pending Approval' AS title,
    CAST(COUNT(*) AS NVARCHAR(20)) AS description,
    'clock' AS icon,
    'blue' AS color
FROM CC.dbo.DispatchIncidents
WHERE ISNULL(isdeleted, 0) = 0 AND Status = 'PendingApproval';
SELECT
    'Approved' AS title,
    CAST(COUNT(*) AS NVARCHAR(20)) AS description,
    'circle-check' AS icon,
    'green' AS color
FROM CC.dbo.DispatchIncidents
WHERE ISNULL(isdeleted, 0) = 0 AND Status = 'Approved';
SELECT
    'Rejected' AS title,
    CAST(COUNT(*) AS NVARCHAR(20)) AS description,
    'circle-x' AS icon,
    'red' AS color
FROM CC.dbo.DispatchIncidents
WHERE ISNULL(isdeleted, 0) = 0 AND Status = 'Rejected';

SELECT
    'form' AS component,
    'dispatch_link_create.sql' AS action,
    'post' AS method,
    'Create Draft Incident' AS title,
    'Create Draft' AS validate;
SELECT 'riskEventReference' AS name, 'Risk Event Reference' AS label, 'text' AS type, 3 AS width, 1 AS required;
SELECT 'eventDateTime' AS name, 'Event Date/Time' AS label, 'datetime-local' AS type, 3 AS width, 1 AS required;
SELECT 'event' AS name, 'Event' AS label, 'textarea' AS type, 6 AS width, 1 AS required;
SELECT 'unitId' AS name, 'Unit ID' AS label, 'text' AS type, 3 AS width, 1 AS required;
SELECT 'regNo' AS name, 'Registration Number' AS label, 'text' AS type, 3 AS width, 1 AS required;
SELECT 'company' AS name, 'Company' AS label, 'text' AS type, 3 AS width;
SELECT 'fleetCode' AS name, 'Fleet Code' AS label, 'text' AS type, 3 AS width;
SELECT 'driverName' AS name, 'Driver Name' AS label, 'text' AS type, 3 AS width, 1 AS required;
SELECT 'driverContactNumber' AS name, 'Driver Contact Number' AS label, 'tel' AS type, 3 AS width;
SELECT 'groundTeamDetails' AS name, 'Ground Team Details' AS label, 'textarea' AS type, 6 AS width;
SELECT 'dispatchReason' AS name, 'Dispatch Reason' AS label, 'textarea' AS type, 6 AS width, 1 AS required;
SELECT 'operatorNotes' AS name, 'Operator Notes' AS label, 'textarea' AS type, 12 AS width;

SELECT 'title' AS component, 'Recent Dispatch Incidents' AS contents, 2 AS level;

SELECT 'table' AS component, 1 AS search, 1 AS sort, 1 AS hover;
SELECT TOP 50
    '<a href="/dispatch_link/dispatch_link_view.sql?id=' + CAST(id AS NVARCHAR(20)) + '">' + COALESCE(IncidentNumber, CAST(id AS NVARCHAR(20))) + '</a>' AS Incident,
    Status,
    RiskEventReference AS [Risk Event],
    UnitId AS [Unit],
    RegNo AS [Reg No],
    DriverName AS [Driver],
    CONVERT(NVARCHAR(19), EventDateTime, 120) AS [Event Time],
    CONVERT(NVARCHAR(19), UpdatedAt, 120) AS [Updated]
FROM CC.dbo.DispatchIncidents
WHERE ISNULL(isdeleted, 0) = 0
ORDER BY UpdatedAt DESC, id DESC;
