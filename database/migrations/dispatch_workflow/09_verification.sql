USE [CC];
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;

/* Read-only post-migration verification. */
SELECT
    ObjectName = required.ObjectName,
    ExistsFlag = CASE WHEN OBJECT_ID(required.ObjectName) IS NULL THEN 0 ELSE 1 END
FROM (VALUES
    ('dbo.DispatchIncidents'),
    ('dbo.DispatchAssignments'),
    ('dbo.DispatchClosureReviews'),
    ('dbo.DispatchManagerComments'),
    ('dbo.DispatchLink_RecalculateDispatchStatus'),
    ('dbo.DispatchLink_UpsertAssignment'),
    ('dbo.DispatchLink_DeleteAssignment'),
    ('dbo.DispatchLink_UpdateOperationalDetails'),
    ('dbo.DispatchLink_RequestClosure'),
    ('dbo.DispatchLink_ReviewClosure'),
    ('dbo.DispatchLink_AddManagerComment'),
    ('dbo.DispatchLink_CancelDispatch')
) required(ObjectName)
ORDER BY required.ObjectName;

SELECT
    ColumnName = required.ColumnName,
    ExistsFlag = CASE WHEN COL_LENGTH('dbo.DispatchIncidents', required.ColumnName) IS NULL THEN 0 ELSE 1 END
FROM (VALUES
    ('TrailerRegistration1'),('TrailerRegistration2'),('AssignedControlRoomAgent'),
    ('ClientContactName'),('ClientContactNumber'),('ClientPO'),('StockNumber'),
    ('SummaryOfIncident'),('PositiveHijacking'),('VehicleRecovered'),('LoadRecovered'),
    ('TrailersRecovered'),('VehicleKeyAvailable'),('DriverOnScene'),('TrackingUnitStatus'),
    ('DispatchStatus'),('ClosureApprovalStatus'),('ClosedAt'),('ClosedBy'),
    ('CancellationReason'),('CancelledAt'),('CancelledBy')
) required(ColumnName)
ORDER BY required.ColumnName;

SELECT
    TableName = OBJECT_NAME(constraint_object.parent_object_id),
    ConstraintName = constraint_object.name,
    ConstraintType = constraint_object.type_desc
FROM sys.objects constraint_object
WHERE constraint_object.parent_object_id IN (
    OBJECT_ID('dbo.DispatchIncidents'),
    OBJECT_ID('dbo.DispatchAssignments'),
    OBJECT_ID('dbo.DispatchClosureReviews'),
    OBJECT_ID('dbo.DispatchManagerComments')
)
AND constraint_object.type IN ('C','D','F','PK','UQ')
ORDER BY TableName, ConstraintType, ConstraintName;

SELECT
    TableName = OBJECT_NAME(indexes.object_id),
    IndexName = indexes.name,
    indexes.is_unique,
    indexes.filter_definition
FROM sys.indexes indexes
WHERE indexes.object_id IN (
    OBJECT_ID('dbo.DispatchIncidents'),
    OBJECT_ID('dbo.DispatchAssignments'),
    OBJECT_ID('dbo.DispatchClosureReviews'),
    OBJECT_ID('dbo.DispatchManagerComments')
)
AND indexes.index_id > 0
ORDER BY TableName, IndexName;

SELECT DispatchStatus, ClosureApprovalStatus, COUNT_BIG(*) AS RecordCount
FROM dbo.DispatchIncidents
GROUP BY DispatchStatus, ClosureApprovalStatus
ORDER BY DispatchStatus, ClosureApprovalStatus;

SELECT TOP (100)
    incident.id,
    incident.IncidentNumber,
    incident.Status AS LegacyWorkflowStatus,
    incident.DispatchStatus,
    incident.ClosureApprovalStatus,
    AssignmentCount = COUNT(assignment.id)
FROM dbo.DispatchIncidents incident
LEFT JOIN dbo.DispatchAssignments assignment ON assignment.dispatch_id = incident.id
GROUP BY incident.id, incident.IncidentNumber, incident.Status, incident.DispatchStatus, incident.ClosureApprovalStatus
ORDER BY incident.id DESC;
GO
