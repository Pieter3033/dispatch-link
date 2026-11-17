/*
    Dispatch Link - ETA Requests V1

    Creates exactly three ETA tables:
      1. DispatchTeams
      2. DispatchEtaRequests
      3. DispatchEtaResponses

    This migration is additive. It does not delete or rewrite existing
    dispatch records. Run it in the CC database before enabling ETA Requests.
*/

USE [CC];
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

IF OBJECT_ID(N'dbo.DispatchIncidents', N'U') IS NULL
    THROW 51000, 'dbo.DispatchIncidents must exist before ETA Requests V1 is installed.', 1;
GO

IF OBJECT_ID(N'dbo.DispatchTeams', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.DispatchTeams
    (
        TeamId          int IDENTITY(1,1) NOT NULL,
        TeamCode        nvarchar(50) NOT NULL,
        TeamName        nvarchar(100) NOT NULL,
        GroupUsername   nvarchar(128) NOT NULL,
        IsActive        bit NOT NULL CONSTRAINT DF_DispatchTeams_IsActive DEFAULT (1),
        DisplayOrder    smallint NOT NULL CONSTRAINT DF_DispatchTeams_DisplayOrder DEFAULT (0),
        MonthlyDispatchLimit int NULL,
        CreatedAt       datetime2(3) NOT NULL CONSTRAINT DF_DispatchTeams_CreatedAt DEFAULT (SYSDATETIME()),
        CreatedBy       nvarchar(128) NOT NULL CONSTRAINT DF_DispatchTeams_CreatedBy DEFAULT (N'migration'),
        UpdatedAt       datetime2(3) NULL,
        UpdatedBy       nvarchar(128) NULL,
        CONSTRAINT PK_DispatchTeams PRIMARY KEY CLUSTERED (TeamId),
        CONSTRAINT UQ_DispatchTeams_TeamCode UNIQUE (TeamCode),
        CONSTRAINT UQ_DispatchTeams_TeamName UNIQUE (TeamName),
        CONSTRAINT UQ_DispatchTeams_GroupUsername UNIQUE (GroupUsername),
        CONSTRAINT CK_DispatchTeams_TeamCode CHECK (LEN(LTRIM(RTRIM(TeamCode))) > 0),
        CONSTRAINT CK_DispatchTeams_TeamName CHECK (LEN(LTRIM(RTRIM(TeamName))) > 0),
        CONSTRAINT CK_DispatchTeams_GroupUsername CHECK (LEN(LTRIM(RTRIM(GroupUsername))) > 0),
        CONSTRAINT CK_DispatchTeams_MonthlyLimit CHECK (MonthlyDispatchLimit IS NULL OR MonthlyDispatchLimit > 0)
    );
END;
GO

IF COL_LENGTH(N'dbo.DispatchTeams', N'MonthlyDispatchLimit') IS NULL
    ALTER TABLE dbo.DispatchTeams ADD MonthlyDispatchLimit int NULL;
GO

IF OBJECT_ID(N'dbo.CK_DispatchTeams_MonthlyLimit', N'C') IS NULL
    ALTER TABLE dbo.DispatchTeams WITH CHECK
        ADD CONSTRAINT CK_DispatchTeams_MonthlyLimit
        CHECK (MonthlyDispatchLimit IS NULL OR MonthlyDispatchLimit > 0);
GO

IF NOT EXISTS (SELECT 1 FROM dbo.DispatchTeams WHERE TeamCode = N'CA')
    INSERT INTO dbo.DispatchTeams (TeamCode, TeamName, GroupUsername, DisplayOrder)
    VALUES (N'CA', N'Capital Air', N'eta_capital_air', 10);
ELSE
    UPDATE dbo.DispatchTeams
    SET TeamName = N'Capital Air', GroupUsername = N'eta_capital_air',
        IsActive = 1, DisplayOrder = 10,
        UpdatedAt = SYSDATETIME(), UpdatedBy = N'migration'
    WHERE TeamCode = N'CA';
GO

IF NOT EXISTS (SELECT 1 FROM dbo.DispatchTeams WHERE TeamCode = N'CSG')
    INSERT INTO dbo.DispatchTeams (TeamCode, TeamName, GroupUsername, DisplayOrder)
    VALUES (N'CSG', N'CSG', N'eta_csg', 20);
ELSE
    UPDATE dbo.DispatchTeams
    SET TeamName = N'CSG', GroupUsername = N'eta_csg',
        IsActive = 1, DisplayOrder = 20,
        UpdatedAt = SYSDATETIME(), UpdatedBy = N'migration'
    WHERE TeamCode = N'CSG';
GO

IF NOT EXISTS (SELECT 1 FROM dbo.DispatchTeams WHERE TeamCode = N'PanC')
    INSERT INTO dbo.DispatchTeams (TeamCode, TeamName, GroupUsername, DisplayOrder)
    VALUES (N'PanC', N'Private & Confidential', N'eta_private_confidential', 30);
ELSE
    UPDATE dbo.DispatchTeams
    SET TeamName = N'Private & Confidential', GroupUsername = N'eta_private_confidential',
        IsActive = 1, DisplayOrder = 30,
        UpdatedAt = SYSDATETIME(), UpdatedBy = N'migration'
    WHERE TeamCode = N'PanC';
GO

IF NOT EXISTS (SELECT 1 FROM dbo.DispatchTeams WHERE TeamCode = N'Matrix')
    INSERT INTO dbo.DispatchTeams (TeamCode, TeamName, GroupUsername, DisplayOrder)
    VALUES (N'Matrix', N'Matrix', N'eta_matrix', 40);
ELSE
    UPDATE dbo.DispatchTeams
    SET TeamName = N'Matrix', GroupUsername = N'eta_matrix', MonthlyDispatchLimit = 150,
        IsActive = 1, DisplayOrder = 40,
        UpdatedAt = SYSDATETIME(), UpdatedBy = N'migration'
    WHERE TeamCode = N'Matrix';
GO

UPDATE dbo.DispatchTeams
SET MonthlyDispatchLimit = 150,
    UpdatedAt = SYSDATETIME(),
    UpdatedBy = N'migration'
WHERE TeamCode = N'Matrix'
  AND ISNULL(MonthlyDispatchLimit, 0) <> 150;
GO

IF OBJECT_ID(N'dbo.DispatchEtaRequests', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.DispatchEtaRequests
    (
        EtaRequestId        bigint IDENTITY(1,1) NOT NULL,
        RequestNumber       nvarchar(30) NULL,
        Latitude            decimal(9,6) NOT NULL,
        Longitude           decimal(9,6) NOT NULL,
        Registration        nvarchar(100) NOT NULL,
        ShortDescription    nvarchar(500) NOT NULL,
        RequestStatus       nvarchar(20) NOT NULL CONSTRAINT DF_DispatchEtaRequests_Status DEFAULT (N'Open'),
        ExpiresAt           datetime2(3) NOT NULL,
        SelectedTeamId      int NULL,
        SelectedDistanceKm  decimal(8,1) NULL,
        DispatchIncidentId  int NULL,
        SelectedAt          datetime2(3) NULL,
        SelectedBy          nvarchar(128) NULL,
        CancelledAt         datetime2(3) NULL,
        CancelledBy         nvarchar(128) NULL,
        CreatedAt           datetime2(3) NOT NULL CONSTRAINT DF_DispatchEtaRequests_CreatedAt DEFAULT (SYSDATETIME()),
        CreatedBy           nvarchar(128) NOT NULL,
        UpdatedAt           datetime2(3) NULL,
        UpdatedBy           nvarchar(128) NULL,
        RowVersion          rowversion NOT NULL,
        CONSTRAINT PK_DispatchEtaRequests PRIMARY KEY CLUSTERED (EtaRequestId),
        CONSTRAINT FK_DispatchEtaRequests_SelectedTeam FOREIGN KEY (SelectedTeamId) REFERENCES dbo.DispatchTeams(TeamId),
        CONSTRAINT FK_DispatchEtaRequests_Incident FOREIGN KEY (DispatchIncidentId) REFERENCES dbo.DispatchIncidents(id),
        CONSTRAINT CK_DispatchEtaRequests_Status CHECK (RequestStatus IN (N'Open', N'Selected', N'Cancelled')),
        CONSTRAINT CK_DispatchEtaRequests_Latitude CHECK (Latitude BETWEEN -90 AND 90),
        CONSTRAINT CK_DispatchEtaRequests_Longitude CHECK (Longitude BETWEEN -180 AND 180),
        CONSTRAINT CK_DispatchEtaRequests_Registration CHECK (LEN(LTRIM(RTRIM(Registration))) > 0),
        CONSTRAINT CK_DispatchEtaRequests_Description CHECK (LEN(LTRIM(RTRIM(ShortDescription))) > 0),
        CONSTRAINT CK_DispatchEtaRequests_Expiry CHECK (ExpiresAt > CreatedAt),
        CONSTRAINT CK_DispatchEtaRequests_Selection CHECK
        (
            (RequestStatus = N'Selected'
             AND SelectedTeamId IS NOT NULL
             AND SelectedDistanceKm > 0
             AND DispatchIncidentId IS NOT NULL
             AND SelectedAt IS NOT NULL
             AND SelectedBy IS NOT NULL)
            OR
            (RequestStatus <> N'Selected'
             AND SelectedTeamId IS NULL
             AND SelectedDistanceKm IS NULL
             AND DispatchIncidentId IS NULL
             AND SelectedAt IS NULL
             AND SelectedBy IS NULL)
        ),
        CONSTRAINT CK_DispatchEtaRequests_Cancellation CHECK
        (
            (RequestStatus = N'Cancelled' AND CancelledAt IS NOT NULL AND CancelledBy IS NOT NULL)
            OR
            (RequestStatus <> N'Cancelled' AND CancelledAt IS NULL AND CancelledBy IS NULL)
        )
    );
END;
GO

IF NOT EXISTS
(
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.DispatchEtaRequests')
      AND name = N'UX_DispatchEtaRequests_RequestNumber'
)
    CREATE UNIQUE INDEX UX_DispatchEtaRequests_RequestNumber
        ON dbo.DispatchEtaRequests(RequestNumber)
        WHERE RequestNumber IS NOT NULL;
GO

IF NOT EXISTS
(
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.DispatchEtaRequests')
      AND name = N'UX_DispatchEtaRequests_DispatchIncidentId'
)
    CREATE UNIQUE INDEX UX_DispatchEtaRequests_DispatchIncidentId
        ON dbo.DispatchEtaRequests(DispatchIncidentId)
        WHERE DispatchIncidentId IS NOT NULL;
GO

IF NOT EXISTS
(
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.DispatchEtaRequests')
      AND name = N'IX_DispatchEtaRequests_Status_ExpiresAt'
)
    CREATE INDEX IX_DispatchEtaRequests_Status_ExpiresAt
        ON dbo.DispatchEtaRequests(RequestStatus, ExpiresAt, CreatedAt DESC);
GO

IF OBJECT_ID(N'dbo.DispatchEtaResponses', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.DispatchEtaResponses
    (
        EtaResponseId   bigint IDENTITY(1,1) NOT NULL,
        EtaRequestId    bigint NOT NULL,
        TeamId          int NOT NULL,
        ResponseStatus  nvarchar(20) NOT NULL CONSTRAINT DF_DispatchEtaResponses_Status DEFAULT (N'Pending'),
        DistanceKm      decimal(8,1) NULL,
        RespondedAt     datetime2(3) NULL,
        RespondedBy     nvarchar(128) NULL,
        CreatedAt       datetime2(3) NOT NULL CONSTRAINT DF_DispatchEtaResponses_CreatedAt DEFAULT (SYSDATETIME()),
        UpdatedAt       datetime2(3) NULL,
        UpdatedBy       nvarchar(128) NULL,
        RowVersion      rowversion NOT NULL,
        CONSTRAINT PK_DispatchEtaResponses PRIMARY KEY CLUSTERED (EtaResponseId),
        CONSTRAINT FK_DispatchEtaResponses_Request FOREIGN KEY (EtaRequestId) REFERENCES dbo.DispatchEtaRequests(EtaRequestId),
        CONSTRAINT FK_DispatchEtaResponses_Team FOREIGN KEY (TeamId) REFERENCES dbo.DispatchTeams(TeamId),
        CONSTRAINT UQ_DispatchEtaResponses_RequestTeam UNIQUE (EtaRequestId, TeamId),
        CONSTRAINT CK_DispatchEtaResponses_Status CHECK
            (ResponseStatus IN (N'Pending', N'Available', N'Unavailable', N'Selected', N'NotSelected')),
        CONSTRAINT CK_DispatchEtaResponses_Distance CHECK
        (
            (ResponseStatus IN (N'Pending', N'Unavailable') AND DistanceKm IS NULL)
            OR (ResponseStatus IN (N'Available', N'Selected') AND DistanceKm > 0)
            OR (ResponseStatus = N'NotSelected' AND (DistanceKm IS NULL OR DistanceKm > 0))
        )
    );
END;
GO

IF NOT EXISTS
(
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.DispatchEtaResponses')
      AND name = N'IX_DispatchEtaResponses_Team_Status'
)
    CREATE INDEX IX_DispatchEtaResponses_Team_Status
        ON dbo.DispatchEtaResponses(TeamId, ResponseStatus, EtaRequestId DESC);
GO

PRINT 'ETA Requests V1 installed: DispatchTeams, DispatchEtaRequests, DispatchEtaResponses.';
GO
