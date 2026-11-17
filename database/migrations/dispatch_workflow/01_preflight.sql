USE [CC];
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;

/* Read-only preflight. This script makes no database changes. */
SELECT
    DB_NAME() AS DatabaseName,
    CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(100)) AS ProductVersion,
    CAST(SERVERPROPERTY('Edition') AS nvarchar(200)) AS Edition;

SELECT
    RequiredObject = required.ObjectName,
    ObjectType = required.ObjectType,
    ExistsFlag = CASE required.ObjectType
        WHEN 'U' THEN CASE WHEN OBJECT_ID(required.ObjectName, 'U') IS NOT NULL THEN 1 ELSE 0 END
        WHEN 'P' THEN CASE WHEN OBJECT_ID(required.ObjectName, 'P') IS NOT NULL THEN 1 ELSE 0 END
    END
FROM (VALUES
    ('dbo.DispatchIncidents', 'U'),
    ('dbo.DispatchAuditLog', 'U'),
    ('dbo.DispatchApprovals', 'U'),
    ('dbo.DispatchCommunicationLog', 'U'),
    ('dbo.DispatchLink_SaveIncident', 'P')
) required(ObjectName, ObjectType);

SELECT
    c.column_id AS Ordinal,
    c.name AS ColumnName,
    TYPE_NAME(c.user_type_id) AS DataType,
    c.max_length AS MaxLengthBytes,
    c.is_nullable AS IsNullable
FROM sys.columns c
WHERE c.object_id = OBJECT_ID('dbo.DispatchIncidents')
ORDER BY c.column_id;

SELECT Status, COUNT_BIG(*) AS RecordCount
FROM dbo.DispatchIncidents
GROUP BY Status
ORDER BY Status;

SELECT
    MigrationObject = objects.ObjectName,
    AlreadyExists = CASE WHEN OBJECT_ID(objects.ObjectName) IS NULL THEN 0 ELSE 1 END
FROM (VALUES
    ('dbo.DispatchAssignments'),
    ('dbo.DispatchClosureReviews'),
    ('dbo.DispatchManagerComments'),
    ('dbo.DispatchLink_RecalculateDispatchStatus'),
    ('dbo.DispatchLink_RequestClosure'),
    ('dbo.DispatchLink_ReviewClosure'),
    ('dbo.DispatchLink_CancelDispatch')
) objects(ObjectName);
GO
