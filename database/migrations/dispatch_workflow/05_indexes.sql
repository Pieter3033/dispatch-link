USE [CC];
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;

IF OBJECT_ID('dbo.DispatchIncidents', 'U') IS NULL
    THROW 51000, 'dbo.DispatchIncidents does not exist.', 1;

IF COL_LENGTH('dbo.DispatchIncidents', 'DispatchStatus') IS NULL
    THROW 51000, 'Run 02_incident_columns.sql before this script.', 1;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.DispatchIncidents') AND name = 'IX_DispatchIncidents_DispatchStatus_UpdatedAt')
    CREATE INDEX IX_DispatchIncidents_DispatchStatus_UpdatedAt
        ON dbo.DispatchIncidents(DispatchStatus, UpdatedAt)
        INCLUDE (IncidentNumber, EventDateTime, RegNo, Company, Event, AssignedControlRoomAgent, ClosureApprovalStatus)
        WHERE isdeleted = 0;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.DispatchIncidents') AND name = 'IX_DispatchIncidents_ClosureApproval_UpdatedAt')
    CREATE INDEX IX_DispatchIncidents_ClosureApproval_UpdatedAt
        ON dbo.DispatchIncidents(ClosureApprovalStatus, UpdatedAt)
        INCLUDE (IncidentNumber, DispatchStatus, RegNo, Company, AssignedControlRoomAgent)
        WHERE isdeleted = 0;
GO
