USE [CC];
GO

SET XACT_ABORT ON;
GO

BEGIN TRANSACTION;

IF COL_LENGTH(N'dbo.DispatchCommunicationLog', N'DisplayOrder') IS NULL
BEGIN
    EXEC sys.sp_executesql N'
        ALTER TABLE dbo.DispatchCommunicationLog
            ADD DisplayOrder int NULL;
    ';

    EXEC sys.sp_executesql N'
        ;WITH ordered AS
        (
            SELECT
                CommunicationLogID,
                ROW_NUMBER() OVER
                (
                    PARTITION BY DispatchID
                    ORDER BY CommunicationDate, CommunicationTime, CommunicationLogID
                ) AS RowOrder
            FROM dbo.DispatchCommunicationLog
        )
        UPDATE communication
        SET DisplayOrder = ordered.RowOrder
        FROM dbo.DispatchCommunicationLog communication
        INNER JOIN ordered ON ordered.CommunicationLogID = communication.CommunicationLogID;
    ';

    EXEC sys.sp_executesql N'
        ALTER TABLE dbo.DispatchCommunicationLog
            ALTER COLUMN DisplayOrder int NOT NULL;

        ALTER TABLE dbo.DispatchCommunicationLog
            ADD CONSTRAINT DF_DispatchCommunicationLog_DisplayOrder DEFAULT (0) FOR DisplayOrder;
    ';
END;

IF NOT EXISTS
(
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.DispatchCommunicationLog')
      AND name = N'IX_DispatchCommunicationLog_Dispatch_DisplayOrder'
)
BEGIN
    EXEC sys.sp_executesql N'
        CREATE INDEX IX_DispatchCommunicationLog_Dispatch_DisplayOrder
            ON dbo.DispatchCommunicationLog (DispatchID, IsDeleted, DisplayOrder, CommunicationLogID);
    ';
END;

COMMIT TRANSACTION;
GO
