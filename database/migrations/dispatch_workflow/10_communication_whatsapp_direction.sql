USE [CC];
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

BEGIN TRY
    BEGIN TRANSACTION;

    IF OBJECT_ID('dbo.DispatchCommunicationLog', 'U') IS NULL
        THROW 51040, 'dbo.DispatchCommunicationLog does not exist.', 1;

    IF OBJECT_ID('dbo.CK_DispatchCommunicationLog_Type', 'C') IS NOT NULL
        ALTER TABLE dbo.DispatchCommunicationLog
            DROP CONSTRAINT CK_DispatchCommunicationLog_Type;

    ALTER TABLE dbo.DispatchCommunicationLog WITH CHECK
        ADD CONSTRAINT CK_DispatchCommunicationLog_Type CHECK
        (
            CommunicationType IN
            (
                N'Call Made', N'Call Received', N'Email Sent', N'Email Received',
                N'SMS Sent', N'WhatsApp Sent', N'WhatsApp Received', N'Radio',
                N'Internal Note', N'Customer Update', N'Technician Update',
                N'WhatsApp'
            )
        );

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO
