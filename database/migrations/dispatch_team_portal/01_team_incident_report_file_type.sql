USE [CC];
GO

SET XACT_ABORT ON;
GO

IF OBJECT_ID(N'dbo.DispatchIncidentFiles', N'U') IS NULL
    THROW 51000, 'dbo.DispatchIncidentFiles must exist before enabling team incident reports.', 1;
GO

BEGIN TRY
    BEGIN TRANSACTION;

    IF OBJECT_ID(N'dbo.CK_DispatchIncidentFiles_FileType', N'C') IS NOT NULL
        ALTER TABLE dbo.DispatchIncidentFiles DROP CONSTRAINT CK_DispatchIncidentFiles_FileType;

    ALTER TABLE dbo.DispatchIncidentFiles WITH CHECK
        ADD CONSTRAINT CK_DispatchIncidentFiles_FileType
        CHECK (FileType IN (N'HistoryExcel', N'HistoryPdf', N'TeamIncidentReport'));

    ALTER TABLE dbo.DispatchIncidentFiles CHECK CONSTRAINT CK_DispatchIncidentFiles_FileType;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO
