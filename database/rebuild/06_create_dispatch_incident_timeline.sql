USE [CC];
GO

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.DispatchIncidentTimeline', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.DispatchIncidentTimeline
    (
        TimelineEntryID  int IDENTITY(1,1) NOT NULL,
        DispatchID       int NOT NULL,
        EventDateTime    datetime2(0) NOT NULL,
        EventType        nvarchar(30) NOT NULL,
        EntryText        nvarchar(1000) NOT NULL,
        CreatedAt        datetime2(3) NOT NULL
            CONSTRAINT DF_DispatchIncidentTimeline_CreatedAt DEFAULT (sysdatetime()),
        CreatedBy        nvarchar(128) NOT NULL,
        UpdatedAt        datetime2(3) NOT NULL
            CONSTRAINT DF_DispatchIncidentTimeline_UpdatedAt DEFAULT (sysdatetime()),
        UpdatedBy        nvarchar(128) NOT NULL,
        IsDeleted        bit NOT NULL
            CONSTRAINT DF_DispatchIncidentTimeline_IsDeleted DEFAULT (0),
        DeletedAt        datetime2(3) NULL,
        DeletedBy        nvarchar(128) NULL,
        RowVersion       rowversion NOT NULL,
        CONSTRAINT PK_DispatchIncidentTimeline PRIMARY KEY CLUSTERED (TimelineEntryID),
        CONSTRAINT FK_DispatchIncidentTimeline_DispatchIncidents
            FOREIGN KEY (DispatchID) REFERENCES dbo.DispatchIncidents(id),
        CONSTRAINT CK_DispatchIncidentTimeline_EventType CHECK
        (
            EventType IN
            (
                N'Alert', N'Client', N'Dispatch', N'Arrival', N'Search',
                N'Call', N'Confirmed', N'StandDown', N'Note'
            )
        )
    );

    CREATE INDEX IX_DispatchIncidentTimeline_Dispatch_EventDateTime
        ON dbo.DispatchIncidentTimeline
        (
            DispatchID,
            IsDeleted,
            EventDateTime ASC,
            TimelineEntryID ASC
        );
END;
GO
