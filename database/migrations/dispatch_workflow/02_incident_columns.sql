USE [CC];
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;

IF OBJECT_ID('dbo.DispatchIncidents', 'U') IS NULL
    THROW 51000, 'dbo.DispatchIncidents does not exist.', 1;

BEGIN TRY
    BEGIN TRANSACTION;

    IF COL_LENGTH('dbo.DispatchIncidents', 'TrailerRegistration1') IS NULL
        ALTER TABLE dbo.DispatchIncidents ADD TrailerRegistration1 nvarchar(50) NULL;
    IF COL_LENGTH('dbo.DispatchIncidents', 'TrailerRegistration2') IS NULL
        ALTER TABLE dbo.DispatchIncidents ADD TrailerRegistration2 nvarchar(50) NULL;
    IF COL_LENGTH('dbo.DispatchIncidents', 'AssignedControlRoomAgent') IS NULL
        ALTER TABLE dbo.DispatchIncidents ADD AssignedControlRoomAgent nvarchar(128) NULL;
    IF COL_LENGTH('dbo.DispatchIncidents', 'ClientContactName') IS NULL
        ALTER TABLE dbo.DispatchIncidents ADD ClientContactName nvarchar(150) NULL;
    IF COL_LENGTH('dbo.DispatchIncidents', 'ClientContactNumber') IS NULL
        ALTER TABLE dbo.DispatchIncidents ADD ClientContactNumber nvarchar(50) NULL;
    IF COL_LENGTH('dbo.DispatchIncidents', 'ClientPO') IS NULL
        ALTER TABLE dbo.DispatchIncidents ADD ClientPO nvarchar(100) NULL;
    IF COL_LENGTH('dbo.DispatchIncidents', 'StockNumber') IS NULL
        ALTER TABLE dbo.DispatchIncidents ADD StockNumber nvarchar(100) NULL;
    IF COL_LENGTH('dbo.DispatchIncidents', 'SummaryOfIncident') IS NULL
        ALTER TABLE dbo.DispatchIncidents ADD SummaryOfIncident nvarchar(max) NULL;
    IF COL_LENGTH('dbo.DispatchIncidents', 'PositiveHijacking') IS NULL
        ALTER TABLE dbo.DispatchIncidents ADD PositiveHijacking nvarchar(30) NULL;
    IF COL_LENGTH('dbo.DispatchIncidents', 'VehicleRecovered') IS NULL
        ALTER TABLE dbo.DispatchIncidents ADD VehicleRecovered nvarchar(30) NULL;
    IF COL_LENGTH('dbo.DispatchIncidents', 'RecoveryDateTime') IS NULL
        ALTER TABLE dbo.DispatchIncidents ADD RecoveryDateTime datetime2(0) NULL;
    IF COL_LENGTH('dbo.DispatchIncidents', 'LoadRecovered') IS NULL
        ALTER TABLE dbo.DispatchIncidents ADD LoadRecovered nvarchar(30) NULL;
    IF COL_LENGTH('dbo.DispatchIncidents', 'TrailersRecovered') IS NULL
        ALTER TABLE dbo.DispatchIncidents ADD TrailersRecovered nvarchar(30) NULL;
    IF COL_LENGTH('dbo.DispatchIncidents', 'VehicleKeyAvailable') IS NULL
        ALTER TABLE dbo.DispatchIncidents ADD VehicleKeyAvailable nvarchar(30) NULL;
    IF COL_LENGTH('dbo.DispatchIncidents', 'DriverOnScene') IS NULL
        ALTER TABLE dbo.DispatchIncidents ADD DriverOnScene nvarchar(30) NULL;
    IF COL_LENGTH('dbo.DispatchIncidents', 'TrackingUnitStatus') IS NULL
        ALTER TABLE dbo.DispatchIncidents ADD TrackingUnitStatus nvarchar(100) NULL;

    IF COL_LENGTH('dbo.DispatchIncidents', 'DispatchStatus') IS NULL
        ALTER TABLE dbo.DispatchIncidents
            ADD DispatchStatus nvarchar(30) NOT NULL
                CONSTRAINT DF_DispatchIncidents_DispatchStatus DEFAULT ('Dispatch Requested') WITH VALUES;

    IF COL_LENGTH('dbo.DispatchIncidents', 'ClosureApprovalStatus') IS NULL
        ALTER TABLE dbo.DispatchIncidents
            ADD ClosureApprovalStatus nvarchar(30) NOT NULL
                CONSTRAINT DF_DispatchIncidents_ClosureApprovalStatus DEFAULT ('Not Requested') WITH VALUES;

    IF COL_LENGTH('dbo.DispatchIncidents', 'ClosedAt') IS NULL
        ALTER TABLE dbo.DispatchIncidents ADD ClosedAt datetime2(3) NULL;
    IF COL_LENGTH('dbo.DispatchIncidents', 'ClosedBy') IS NULL
        ALTER TABLE dbo.DispatchIncidents ADD ClosedBy nvarchar(128) NULL;
    IF COL_LENGTH('dbo.DispatchIncidents', 'CancellationReason') IS NULL
        ALTER TABLE dbo.DispatchIncidents ADD CancellationReason nvarchar(max) NULL;
    IF COL_LENGTH('dbo.DispatchIncidents', 'CancelledAt') IS NULL
        ALTER TABLE dbo.DispatchIncidents ADD CancelledAt datetime2(3) NULL;
    IF COL_LENGTH('dbo.DispatchIncidents', 'CancelledBy') IS NULL
        ALTER TABLE dbo.DispatchIncidents ADD CancelledBy nvarchar(128) NULL;

    IF OBJECT_ID('dbo.CK_DispatchIncidents_DispatchStatus', 'C') IS NULL
        EXEC(N'ALTER TABLE dbo.DispatchIncidents WITH CHECK ADD CONSTRAINT CK_DispatchIncidents_DispatchStatus
            CHECK (DispatchStatus IN (''Dispatch Requested'',''Dispatched'',''On Scene'',''Recovered'',''Stood Down'',''Closed'',''Cancelled''));');

    IF OBJECT_ID('dbo.CK_DispatchIncidents_ClosureApprovalStatus', 'C') IS NULL
        EXEC(N'ALTER TABLE dbo.DispatchIncidents WITH CHECK ADD CONSTRAINT CK_DispatchIncidents_ClosureApprovalStatus
            CHECK (ClosureApprovalStatus IN (''Not Requested'',''Pending'',''Approved'',''Rejected''));');

    IF OBJECT_ID('dbo.CK_DispatchIncidents_PositiveHijacking', 'C') IS NULL
        EXEC(N'ALTER TABLE dbo.DispatchIncidents WITH CHECK ADD CONSTRAINT CK_DispatchIncidents_PositiveHijacking
            CHECK (PositiveHijacking IS NULL OR PositiveHijacking IN (''Yes'',''No'',''Not Applicable''));');
    IF OBJECT_ID('dbo.CK_DispatchIncidents_VehicleRecovered', 'C') IS NULL
        EXEC(N'ALTER TABLE dbo.DispatchIncidents WITH CHECK ADD CONSTRAINT CK_DispatchIncidents_VehicleRecovered
            CHECK (VehicleRecovered IS NULL OR VehicleRecovered IN (''Yes'',''No'',''Not Applicable'',''Vehicle Not On Scene''));');
    IF OBJECT_ID('dbo.CK_DispatchIncidents_LoadRecovered', 'C') IS NULL
        EXEC(N'ALTER TABLE dbo.DispatchIncidents WITH CHECK ADD CONSTRAINT CK_DispatchIncidents_LoadRecovered
            CHECK (LoadRecovered IS NULL OR LoadRecovered IN (''Yes'',''No'',''Not Applicable''));');
    IF OBJECT_ID('dbo.CK_DispatchIncidents_TrailersRecovered', 'C') IS NULL
        EXEC(N'ALTER TABLE dbo.DispatchIncidents WITH CHECK ADD CONSTRAINT CK_DispatchIncidents_TrailersRecovered
            CHECK (TrailersRecovered IS NULL OR TrailersRecovered IN (''Yes'',''No'',''Not Applicable''));');
    IF OBJECT_ID('dbo.CK_DispatchIncidents_VehicleKeyAvailable', 'C') IS NULL
        EXEC(N'ALTER TABLE dbo.DispatchIncidents WITH CHECK ADD CONSTRAINT CK_DispatchIncidents_VehicleKeyAvailable
            CHECK (VehicleKeyAvailable IS NULL OR VehicleKeyAvailable IN (''Yes'',''No'',''Not Applicable''));');
    IF OBJECT_ID('dbo.CK_DispatchIncidents_DriverOnScene', 'C') IS NULL
        EXEC(N'ALTER TABLE dbo.DispatchIncidents WITH CHECK ADD CONSTRAINT CK_DispatchIncidents_DriverOnScene
            CHECK (DriverOnScene IS NULL OR DriverOnScene IN (''Yes'',''No'',''Not Applicable''));');

    IF OBJECT_ID('dbo.CK_DispatchIncidents_TrackingUnitStatus', 'C') IS NULL
        EXEC(N'ALTER TABLE dbo.DispatchIncidents WITH CHECK ADD CONSTRAINT CK_DispatchIncidents_TrackingUnitStatus
            CHECK (TrackingUnitStatus IS NULL OR TrackingUnitStatus IN (
                ''Asset Lost - Unit Lost'',
                ''Asset Lost - Unit Found'',
                ''Asset Found - Unit Lost'',
                ''Asset Found - Unit Working'',
                ''Asset Found - Unit Not Working'',
                ''Dispatch Cancelled - Unit Working'',
                ''Dispatch Cancelled - Unit Not Working'',
                ''Mobile Unit'',
                ''Not fitted with Pulsit Tracking''
            ));');

    IF OBJECT_ID('dbo.CK_DispatchIncidents_ClosedDetails', 'C') IS NULL
        EXEC(N'ALTER TABLE dbo.DispatchIncidents WITH CHECK ADD CONSTRAINT CK_DispatchIncidents_ClosedDetails
            CHECK (DispatchStatus <> ''Closed'' OR (ClosedAt IS NOT NULL AND NULLIF(LTRIM(RTRIM(ClosedBy)), '''') IS NOT NULL));');

    IF OBJECT_ID('dbo.CK_DispatchIncidents_CancelledDetails', 'C') IS NULL
        EXEC(N'ALTER TABLE dbo.DispatchIncidents WITH CHECK ADD CONSTRAINT CK_DispatchIncidents_CancelledDetails
            CHECK (DispatchStatus <> ''Cancelled'' OR (
                CancelledAt IS NOT NULL
                AND NULLIF(LTRIM(RTRIM(CancelledBy)), '''') IS NOT NULL
                AND NULLIF(LTRIM(RTRIM(CancellationReason)), '''') IS NOT NULL
            ));');

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO
