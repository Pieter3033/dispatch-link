USE [CC];
GO

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.DispatchAuditLog', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.DispatchAuditLog
    (
        id              bigint IDENTITY(1,1) NOT NULL,
        dispatch_id     int NOT NULL,
        AuditAction     nvarchar(100) NOT NULL,
        FieldName       nvarchar(128) NULL,
        OldValue        nvarchar(max) NULL,
        NewValue        nvarchar(max) NULL,
        OldStatus       nvarchar(30) NULL,
        NewStatus       nvarchar(30) NULL,
        AuditMessage    nvarchar(max) NULL,
        AuditUsername   nvarchar(128) NOT NULL,
        CreatedAt       datetime2(3) NOT NULL
            CONSTRAINT DF_DispatchAuditLog_CreatedAt DEFAULT (sysdatetime()),
        CONSTRAINT PK_DispatchAuditLog PRIMARY KEY CLUSTERED (id),
        CONSTRAINT FK_DispatchAuditLog_DispatchIncidents
            FOREIGN KEY (dispatch_id) REFERENCES dbo.DispatchIncidents(id)
    );

    CREATE INDEX IX_DispatchAuditLog_Dispatch_CreatedAt
        ON dbo.DispatchAuditLog (dispatch_id, CreatedAt DESC, id DESC);
END;
GO

CREATE OR ALTER TRIGGER dbo.trg_DispatchIncidents_Audit
ON dbo.DispatchIncidents
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    INSERT INTO dbo.DispatchAuditLog
    (
        dispatch_id,
        AuditAction,
        FieldName,
        OldValue,
        NewValue,
        OldStatus,
        NewStatus,
        AuditMessage,
        AuditUsername,
        CreatedAt
    )
    SELECT
        current_row.id,
        CASE
            WHEN changes.FieldName IN (N'Status', N'Dispatch Status', N'Closure Approval Status')
                THEN N'Workflow status changed'
            ELSE N'Draft field changed'
        END,
        changes.FieldName,
        changes.OldValue,
        changes.NewValue,
        previous_row.Status,
        current_row.Status,
        changes.FieldName + N' changed.',
        COALESCE(NULLIF(current_row.UpdatedBy, N''), N'SQL Server'),
        sysdatetime()
    FROM inserted current_row
    INNER JOIN deleted previous_row ON previous_row.id = current_row.id
    CROSS APPLY
    (
        VALUES
            (N'Incident Date/Time', CONVERT(nvarchar(max), previous_row.EventDateTime, 126), CONVERT(nvarchar(max), current_row.EventDateTime, 126)),
            (N'Incident Type', CAST(previous_row.Event AS nvarchar(max)), CAST(current_row.Event AS nvarchar(max))),
            (N'ETA', CAST(previous_row.ETA AS nvarchar(max)), CAST(current_row.ETA AS nvarchar(max))),
            (N'Dispatch Reason', CAST(previous_row.DispatchReason AS nvarchar(max)), CAST(current_row.DispatchReason AS nvarchar(max))),
            (N'Incident Notes', CAST(previous_row.IncidentNotesHtml AS nvarchar(max)), CAST(current_row.IncidentNotesHtml AS nvarchar(max))),
            (N'Risk Event Reference', CAST(previous_row.RiskEventReference AS nvarchar(max)), CAST(current_row.RiskEventReference AS nvarchar(max))),
            (N'Registration', CAST(previous_row.RegNo AS nvarchar(max)), CAST(current_row.RegNo AS nvarchar(max))),
            (N'Unit ID', CAST(previous_row.UnitId AS nvarchar(max)), CAST(current_row.UnitId AS nvarchar(max))),
            (N'Company', CAST(previous_row.Company AS nvarchar(max)), CAST(current_row.Company AS nvarchar(max))),
            (N'Zoho Account', CAST(previous_row.ZohoAccount AS nvarchar(max)), CAST(current_row.ZohoAccount AS nvarchar(max))),
            (N'Fleet Code', CAST(previous_row.FleetCode AS nvarchar(max)), CAST(current_row.FleetCode AS nvarchar(max))),
            (N'Stock Number / WRC', CAST(previous_row.StockNumberWrc AS nvarchar(max)), CAST(current_row.StockNumberWrc AS nvarchar(max))),
            (N'Trailer Registration 1', CAST(previous_row.TrailerRegistration1 AS nvarchar(max)), CAST(current_row.TrailerRegistration1 AS nvarchar(max))),
            (N'Trailer Registration 2', CAST(previous_row.TrailerRegistration2 AS nvarchar(max)), CAST(current_row.TrailerRegistration2 AS nvarchar(max))),
            (N'Vehicle Make', CAST(previous_row.VehicleMake AS nvarchar(max)), CAST(current_row.VehicleMake AS nvarchar(max))),
            (N'Vehicle Model', CAST(previous_row.VehicleModel AS nvarchar(max)), CAST(current_row.VehicleModel AS nvarchar(max))),
            (N'Vehicle Colour', CAST(previous_row.VehicleColour AS nvarchar(max)), CAST(current_row.VehicleColour AS nvarchar(max))),
            (N'Vehicle Markings / Branding', CAST(previous_row.VehicleBranding AS nvarchar(max)), CAST(current_row.VehicleBranding AS nvarchar(max))),
            (N'Trailer Type', CAST(previous_row.TrailerType AS nvarchar(max)), CAST(current_row.TrailerType AS nvarchar(max))),
            (N'Trailer Markings / Branding', CAST(previous_row.TrailerBranding AS nvarchar(max)), CAST(current_row.TrailerBranding AS nvarchar(max))),
            (N'Geo Location', CAST(previous_row.GeoLocation AS nvarchar(max)), CAST(current_row.GeoLocation AS nvarchar(max))),
            (N'Latitude', CONVERT(nvarchar(max), previous_row.Latitude), CONVERT(nvarchar(max), current_row.Latitude)),
            (N'Longitude', CONVERT(nvarchar(max), previous_row.Longitude), CONVERT(nvarchar(max), current_row.Longitude)),
            (N'Client Name', CAST(previous_row.ClientName AS nvarchar(max)), CAST(current_row.ClientName AS nvarchar(max))),
            (N'Client Contact Number', CAST(previous_row.ClientContactNumber AS nvarchar(max)), CAST(current_row.ClientContactNumber AS nvarchar(max))),
            (N'Client PO', CAST(previous_row.ClientPO AS nvarchar(max)), CAST(current_row.ClientPO AS nvarchar(max))),
            (N'DL Number', CAST(previous_row.DLNumber AS nvarchar(max)), CAST(current_row.DLNumber AS nvarchar(max))),
            (N'Driver Name', CAST(previous_row.DriverName AS nvarchar(max)), CAST(current_row.DriverName AS nvarchar(max))),
            (N'Driver Contact Number', CAST(previous_row.DriverContactNumber AS nvarchar(max)), CAST(current_row.DriverContactNumber AS nvarchar(max))),
            (N'Dispatch Team', CAST(previous_row.DispatchTeam AS nvarchar(max)), CAST(current_row.DispatchTeam AS nvarchar(max))),
            (N'Dispatch Date/Time', CONVERT(nvarchar(max), previous_row.DispatchDateTime, 126), CONVERT(nvarchar(max), current_row.DispatchDateTime, 126)),
            (N'OB Number', CAST(previous_row.OBNumber AS nvarchar(max)), CAST(current_row.OBNumber AS nvarchar(max))),
            (N'Stand Down Date/Time', CONVERT(nvarchar(max), previous_row.StandDownDateTime, 126), CONVERT(nvarchar(max), current_row.StandDownDateTime, 126)),
            (N'Vehicle Recovered', CAST(previous_row.VehicleRecovered AS nvarchar(max)), CAST(current_row.VehicleRecovered AS nvarchar(max))),
            (N'Recovery DateTime', CONVERT(nvarchar(30), previous_row.RecoveryDateTime, 126), CONVERT(nvarchar(30), current_row.RecoveryDateTime, 126)),
            (N'Load Recovered', CAST(previous_row.LoadRecovered AS nvarchar(max)), CAST(current_row.LoadRecovered AS nvarchar(max))),
            (N'Vehicle Key Available', CAST(previous_row.VehicleKeyAvailable AS nvarchar(max)), CAST(current_row.VehicleKeyAvailable AS nvarchar(max))),
            (N'Trailers Recovered', CAST(previous_row.TrailersRecovered AS nvarchar(max)), CAST(current_row.TrailersRecovered AS nvarchar(max))),
            (N'Driver on Scene', CAST(previous_row.DriverOnScene AS nvarchar(max)), CAST(current_row.DriverOnScene AS nvarchar(max))),
            (N'Tracking Unit Status', CAST(previous_row.TrackingUnitStatus AS nvarchar(max)), CAST(current_row.TrackingUnitStatus AS nvarchar(max))),
            (N'Trailer Applicable', CONVERT(nvarchar(max), previous_row.TrailerApplicable), CONVERT(nvarchar(max), current_row.TrailerApplicable)),
            (N'Stock Applicable', CONVERT(nvarchar(max), previous_row.StockApplicable), CONVERT(nvarchar(max), current_row.StockApplicable)),
            (N'No Visible Damages', CONVERT(nvarchar(max), previous_row.NoVisibleDamages), CONVERT(nvarchar(max), current_row.NoVisibleDamages)),
            (N'Damage Notes', CAST(previous_row.DamageNotes AS nvarchar(max)), CAST(current_row.DamageNotes AS nvarchar(max))),
            (N'Ground Team Details', CAST(previous_row.GroundTeamDetails AS nvarchar(max)), CAST(current_row.GroundTeamDetails AS nvarchar(max))),
            (N'Operator Notes', CAST(previous_row.OperatorNotesText AS nvarchar(max)), CAST(current_row.OperatorNotesText AS nvarchar(max))),
            (N'Status', CAST(previous_row.Status AS nvarchar(max)), CAST(current_row.Status AS nvarchar(max))),
            (N'Dispatch Status', CAST(previous_row.DispatchStatus AS nvarchar(max)), CAST(current_row.DispatchStatus AS nvarchar(max))),
            (N'Closure Approval Status', CAST(previous_row.ClosureApprovalStatus AS nvarchar(max)), CAST(current_row.ClosureApprovalStatus AS nvarchar(max))),
            (N'Assigned Control Room Agent', CAST(previous_row.AssignedControlRoomAgent AS nvarchar(max)), CAST(current_row.AssignedControlRoomAgent AS nvarchar(max))),
            (N'Approval Comments', CAST(previous_row.ApprovalComments AS nvarchar(max)), CAST(current_row.ApprovalComments AS nvarchar(max))),
            (N'Rejection Reason', CAST(previous_row.RejectionReason AS nvarchar(max)), CAST(current_row.RejectionReason AS nvarchar(max))),
            (N'Zoho Update', CONVERT(nvarchar(max), previous_row.ZohoUpdate), CONVERT(nvarchar(max), current_row.ZohoUpdate)),
            (N'Zoho ID', CAST(previous_row.ZohoId AS nvarchar(max)), CAST(current_row.ZohoId AS nvarchar(max)))
    ) changes(FieldName, OldValue, NewValue)
    WHERE ISNULL(changes.OldValue, N'') <> ISNULL(changes.NewValue, N'');
END;
GO
