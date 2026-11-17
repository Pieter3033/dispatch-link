USE [CC];
GO

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.DispatchCommunicationLog', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.DispatchCommunicationLog
    (
        CommunicationLogID  int IDENTITY(1,1) NOT NULL,
        DispatchID          int NOT NULL,
        DisplayOrder        int NOT NULL
            CONSTRAINT DF_DispatchCommunicationLog_DisplayOrder DEFAULT (0),
        CommunicationDate   date NOT NULL,
        CommunicationTime   time(0) NOT NULL,
        CommunicationType   nvarchar(50) NOT NULL,
        ControlRoomAgent    nvarchar(128) NOT NULL,
        ContactPerson       nvarchar(150) NULL,
        ContactNumber       nvarchar(50) NULL,
        EmailAddress        nvarchar(255) NULL,
        CommunicationNotes  nvarchar(max) NULL,
        CreatedAt           datetime2(3) NOT NULL
            CONSTRAINT DF_DispatchCommunicationLog_CreatedAt DEFAULT (sysdatetime()),
        CreatedBy           nvarchar(128) NOT NULL,
        UpdatedAt           datetime2(3) NOT NULL
            CONSTRAINT DF_DispatchCommunicationLog_UpdatedAt DEFAULT (sysdatetime()),
        UpdatedBy           nvarchar(128) NOT NULL,
        IsDeleted           bit NOT NULL
            CONSTRAINT DF_DispatchCommunicationLog_IsDeleted DEFAULT (0),
        DeletedAt           datetime2(3) NULL,
        DeletedBy           nvarchar(128) NULL,
        RowVersion          rowversion NOT NULL,
        CONSTRAINT PK_DispatchCommunicationLog
            PRIMARY KEY CLUSTERED (CommunicationLogID),
        CONSTRAINT FK_DispatchCommunicationLog_DispatchIncidents
            FOREIGN KEY (DispatchID) REFERENCES dbo.DispatchIncidents(id),
        CONSTRAINT CK_DispatchCommunicationLog_Type CHECK
        (
            CommunicationType IN
            (
                N'Call Made', N'Call Received', N'Email Sent', N'Email Received',
                N'SMS Sent', N'WhatsApp Sent', N'WhatsApp Received', N'Radio', N'Internal Note',
                N'Customer Update', N'Technician Update'
            )
        )
    );

    CREATE INDEX IX_DispatchCommunicationLog_Dispatch_DateTime
        ON dbo.DispatchCommunicationLog
        (
            DispatchID,
            IsDeleted,
            CommunicationDate DESC,
            CommunicationTime DESC,
            CommunicationLogID DESC
        );

    CREATE INDEX IX_DispatchCommunicationLog_Dispatch_DisplayOrder
        ON dbo.DispatchCommunicationLog
        (
            DispatchID,
            IsDeleted,
            DisplayOrder,
            CommunicationLogID
        );
END;
GO
