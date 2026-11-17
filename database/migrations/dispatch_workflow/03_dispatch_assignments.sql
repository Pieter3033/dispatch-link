USE [CC];
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;

IF OBJECT_ID('dbo.DispatchIncidents', 'U') IS NULL
    THROW 51000, 'dbo.DispatchIncidents does not exist.', 1;

IF OBJECT_ID('dbo.DispatchAssignments', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.DispatchAssignments (
        id int IDENTITY(1,1) NOT NULL,
        dispatch_id int NOT NULL,
        SequenceNo tinyint NOT NULL,
        AssignedTeam nvarchar(80) NOT NULL,
        ETA datetime2(0) NULL,
        DispatchedAt datetime2(0) NULL,
        OBNumber nvarchar(100) NULL,
        TeamOnSceneAt datetime2(0) NULL,
        StoodDownAt datetime2(0) NULL,
        CreatedBy nvarchar(128) NOT NULL,
        CreatedAt datetime2(3) NOT NULL CONSTRAINT DF_DispatchAssignments_CreatedAt DEFAULT (SYSDATETIME()),
        UpdatedBy nvarchar(128) NULL,
        UpdatedAt datetime2(3) NULL,
        CONSTRAINT PK_DispatchAssignments PRIMARY KEY CLUSTERED (id),
        CONSTRAINT FK_DispatchAssignments_DispatchIncidents FOREIGN KEY (dispatch_id)
            REFERENCES dbo.DispatchIncidents(id),
        CONSTRAINT UQ_DispatchAssignments_Dispatch_Sequence UNIQUE (dispatch_id, SequenceNo),
        CONSTRAINT CK_DispatchAssignments_Sequence CHECK (SequenceNo BETWEEN 1 AND 3),
        CONSTRAINT CK_DispatchAssignments_Team CHECK (AssignedTeam IN ('Capital Air','Private & Confidential','CSG','Matrix')),
        CONSTRAINT CK_DispatchAssignments_OnSceneTime CHECK (
            TeamOnSceneAt IS NULL OR (DispatchedAt IS NOT NULL AND TeamOnSceneAt >= DispatchedAt)
        ),
        CONSTRAINT CK_DispatchAssignments_StandDownTime CHECK (
            StoodDownAt IS NULL OR (
                DispatchedAt IS NOT NULL
                AND StoodDownAt >= DispatchedAt
                AND (TeamOnSceneAt IS NULL OR StoodDownAt >= TeamOnSceneAt)
            )
        )
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.DispatchAssignments') AND name = 'IX_DispatchAssignments_Dispatch')
    CREATE INDEX IX_DispatchAssignments_Dispatch
        ON dbo.DispatchAssignments(dispatch_id, SequenceNo)
        INCLUDE (AssignedTeam, ETA, DispatchedAt, TeamOnSceneAt, StoodDownAt, OBNumber);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.DispatchAssignments') AND name = 'IX_DispatchAssignments_ETA')
    CREATE INDEX IX_DispatchAssignments_ETA
        ON dbo.DispatchAssignments(ETA)
        INCLUDE (dispatch_id, AssignedTeam, DispatchedAt)
        WHERE ETA IS NOT NULL;
GO
