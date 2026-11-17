USE [CC];
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;

/*
Read-only review of existing records. Do not convert legacy Approved records to
Closed: the old approval represented a different workflow.
*/
SELECT
    Status,
    isdeleted,
    COUNT_BIG(*) AS RecordCount,
    MIN(CreatedAt) AS EarliestCreatedAt,
    MAX(CreatedAt) AS LatestCreatedAt
FROM dbo.DispatchIncidents
GROUP BY Status, isdeleted
ORDER BY Status, isdeleted;

SELECT
    DispatchStatus,
    ClosureApprovalStatus,
    COUNT_BIG(*) AS RecordCount
FROM dbo.DispatchIncidents
GROUP BY DispatchStatus, ClosureApprovalStatus
ORDER BY DispatchStatus, ClosureApprovalStatus;

SELECT
    ApprovalStatus,
    COUNT_BIG(*) AS RecordCount
FROM dbo.DispatchApprovals
GROUP BY ApprovalStatus
ORDER BY ApprovalStatus;

SELECT
    ExistingApprovedWithoutClosure = COUNT_BIG(*)
FROM dbo.DispatchIncidents
WHERE Status = 'Approved'
  AND ClosureApprovalStatus = 'Not Requested';

/* Expected initialization: all legacy records remain Dispatch Requested / Not Requested. */
SELECT
    id,
    IncidentNumber,
    Status AS LegacyWorkflowStatus,
    DispatchStatus,
    ClosureApprovalStatus,
    isdeleted
FROM dbo.DispatchIncidents
ORDER BY id;
GO
