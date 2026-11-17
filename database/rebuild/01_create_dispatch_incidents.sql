/* Dispatch Link rebuild: base incident table. Run in the CC database. */
USE [CC];
GO
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.DispatchIncidents', N'U') IS NOT NULL
    THROW 51000, 'dbo.DispatchIncidents already exists. This script will not overwrite it.', 1;
GO

CREATE TABLE dbo.DispatchIncidents
(
    id                       int IDENTITY(1,1) NOT NULL,
    IncidentNumber           nvarchar(30) NULL,
    SaveRequestId            nvarchar(100) NOT NULL,
    EventDateTime             datetime2(0) NOT NULL,
    Event                     nvarchar(255) NOT NULL,
    ETA                       nvarchar(100) NULL,
    DispatchReason            nvarchar(50) NULL,
    ActualDispatchReason      nvarchar(1000) NULL,
    PositiveVESA              nvarchar(20) NULL CONSTRAINT CK_DispatchIncidents_PositiveVESA CHECK (PositiveVESA IS NULL OR PositiveVESA COLLATE Latin1_General_100_BIN2 IN (N'Hijacked', N'Stolen', N'No')),
    DispatchCaptureVersion    tinyint NULL CONSTRAINT DF_DispatchIncidents_DispatchCaptureVersion DEFAULT (1) CONSTRAINT CK_DispatchIncidents_DispatchCaptureVersion CHECK (DispatchCaptureVersion IS NULL OR DispatchCaptureVersion = 1),
    IncidentNotesHtml         nvarchar(max) NULL,
    RiskEventReference        nvarchar(200) NULL,
    RegNo                     nvarchar(100) NULL,
    UnitId                    nvarchar(100) NULL,
    Company                   nvarchar(200) NULL,
    ZohoAccount               nvarchar(255) NULL,
    FleetCode                 nvarchar(100) NULL,
    StockNumberWrc            nvarchar(100) NULL,
    TrailerRegistration1      nvarchar(50) NULL,
    TrailerRegistration2      nvarchar(50) NULL,
    VehicleMake               nvarchar(120) NULL,
    VehicleModel              nvarchar(160) NULL,
    VehicleColour             nvarchar(120) NULL,
    VehicleBranding           nvarchar(200) NULL,
    TrailerType               nvarchar(160) NULL,
    TrailerBranding           nvarchar(200) NULL,
    GeoLocation               nvarchar(255) NULL,
    Latitude                  decimal(9,6) NULL,
    Longitude                 decimal(9,6) NULL,
    ClientName                nvarchar(200) NULL,
    ClientContactNumber       nvarchar(100) NULL,
    ClientPO                  nvarchar(100) NULL,
    DLNumber                  nvarchar(100) NULL,
    DriverName                nvarchar(200) NULL,
    DriverContactNumber       nvarchar(100) NULL,
    DispatchTeam              nvarchar(100) NULL,
    DispatchDateTime          datetime2(0) NULL,
    OBNumber                  nvarchar(100) NULL,
    StandDownDateTime         datetime2(0) NULL,
    VehicleRecovered          nvarchar(30) NULL,
    RecoveryDateTime          datetime2(0) NULL,
    LoadRecovered             nvarchar(30) NULL,
    VehicleKeyAvailable       nvarchar(30) NULL,
    TrailersRecovered         nvarchar(30) NULL,
    DriverOnScene             nvarchar(30) NULL,
    TrackingUnitStatus        nvarchar(100) NULL,
    TrailerApplicable         bit NOT NULL CONSTRAINT DF_DispatchIncidents_TrailerApplicable DEFAULT (0),
    StockApplicable           bit NOT NULL CONSTRAINT DF_DispatchIncidents_StockApplicable DEFAULT (0),
    NoVisibleDamages          bit NOT NULL CONSTRAINT DF_DispatchIncidents_NoVisibleDamages DEFAULT (0),
    DamageNotes               nvarchar(max) NULL,
    GroundTeamDetails         nvarchar(max) NULL,
    OperatorNotesText         nvarchar(max) NULL,
    Status                    nvarchar(30) NOT NULL CONSTRAINT DF_DispatchIncidents_Status DEFAULT (N'Draft'),
    DispatchStatus            nvarchar(30) NOT NULL CONSTRAINT DF_DispatchIncidents_DispatchStatus DEFAULT (N'Dispatch Requested'),
    ClosureApprovalStatus     nvarchar(30) NOT NULL CONSTRAINT DF_DispatchIncidents_ClosureApprovalStatus DEFAULT (N'Not Requested'),
    AssignedControlRoomAgent  nvarchar(128) NULL,
    SubmittedAt               datetime2(3) NULL,
    SubmittedBy               nvarchar(128) NULL,
    ApprovedAt                datetime2(3) NULL,
    ApprovedBy                nvarchar(128) NULL,
    RejectedAt                datetime2(3) NULL,
    RejectedBy                nvarchar(128) NULL,
    RejectionReason           nvarchar(max) NULL,
    ApprovalComments          nvarchar(max) NULL,
    PdfPath                   nvarchar(500) NULL,
    ZohoUpdate                bit NOT NULL CONSTRAINT DF_DispatchIncidents_ZohoUpdate DEFAULT (0),
    ZohoId                    nvarchar(100) NULL,
    zoho_ob                   nvarchar(20) NULL,
    CreatedAt                 datetime2(3) NOT NULL CONSTRAINT DF_DispatchIncidents_CreatedAt DEFAULT (sysdatetime()),
    CreatedBy                 nvarchar(128) NOT NULL,
    UpdatedAt                 datetime2(3) NOT NULL CONSTRAINT DF_DispatchIncidents_UpdatedAt DEFAULT (sysdatetime()),
    UpdatedBy                 nvarchar(128) NOT NULL,
    IsDeleted                 bit NOT NULL CONSTRAINT DF_DispatchIncidents_IsDeleted DEFAULT (0),
    DeletedAt                 datetime2(3) NULL,
    DeletedBy                 nvarchar(128) NULL,
    RowVersion                rowversion NOT NULL,
    CONSTRAINT PK_DispatchIncidents PRIMARY KEY CLUSTERED (id),
    CONSTRAINT UQ_DispatchIncidents_SaveRequestId UNIQUE (SaveRequestId),
    CONSTRAINT CK_DispatchIncidents_Status CHECK (Status IN (N'Draft', N'PendingApproval', N'Approved', N'Rejected')),
    CONSTRAINT CK_DispatchIncidents_Latitude CHECK (Latitude IS NULL OR Latitude BETWEEN -90 AND 90),
    CONSTRAINT CK_DispatchIncidents_Longitude CHECK (Longitude IS NULL OR Longitude BETWEEN -180 AND 180),
    CONSTRAINT CK_DispatchIncidents_VehicleRecovered CHECK (VehicleRecovered IS NULL OR VehicleRecovered IN (N'Yes', N'No', N'Recovery Cancelled', N'N/A')),
    CONSTRAINT CK_DispatchIncidents_LoadRecovered CHECK (LoadRecovered IS NULL OR LoadRecovered IN (N'Yes', N'No', N'N/A', N'Partial Recovery')),
    CONSTRAINT CK_DispatchIncidents_VehicleKeyAvailable CHECK (VehicleKeyAvailable IS NULL OR VehicleKeyAvailable IN (N'Yes', N'No', N'N/A')),
    CONSTRAINT CK_DispatchIncidents_TrailersRecovered CHECK (TrailersRecovered IS NULL OR TrailersRecovered IN (N'Yes', N'No', N'N/A')),
    CONSTRAINT CK_DispatchIncidents_DriverOnScene CHECK (DriverOnScene IS NULL OR DriverOnScene IN (N'Yes', N'No', N'N/A'))
);
GO

CREATE UNIQUE INDEX UX_DispatchIncidents_IncidentNumber
    ON dbo.DispatchIncidents (IncidentNumber)
    WHERE IncidentNumber IS NOT NULL;
GO

CREATE INDEX IX_DispatchIncidents_Status_UpdatedAt
    ON dbo.DispatchIncidents (Status, UpdatedAt DESC)
    INCLUDE (IncidentNumber, EventDateTime, Event, RegNo, Company, CreatedBy, IsDeleted);
GO

CREATE INDEX IX_DispatchIncidents_RegNo
    ON dbo.DispatchIncidents (RegNo)
    WHERE RegNo IS NOT NULL AND IsDeleted = 0;
GO
