USE [CC];
GO

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.DispatchIncidentFiles', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.DispatchIncidentFiles
    (
        id                int IDENTITY(1,1) NOT NULL,
        dispatch_id       int NOT NULL,
        FileType          nvarchar(30) NOT NULL,
        OriginalFileName  nvarchar(255) NOT NULL,
        StoredFileName    nvarchar(255) NULL,
        FilePath          nvarchar(1000) NOT NULL,
        MimeType          nvarchar(150) NULL,
        Bytes             bigint NULL,
        UploadedAt        datetime2(3) NOT NULL
            CONSTRAINT DF_DispatchIncidentFiles_UploadedAt DEFAULT (sysdatetime()),
        UploadedBy        nvarchar(128) NOT NULL,
        CreatedAt         datetime2(3) NOT NULL
            CONSTRAINT DF_DispatchIncidentFiles_CreatedAt DEFAULT (sysdatetime()),
        CreatedBy         nvarchar(128) NOT NULL,
        UpdatedAt         datetime2(3) NOT NULL
            CONSTRAINT DF_DispatchIncidentFiles_UpdatedAt DEFAULT (sysdatetime()),
        UpdatedBy         nvarchar(128) NOT NULL,
        IsDeleted         bit NOT NULL
            CONSTRAINT DF_DispatchIncidentFiles_IsDeleted DEFAULT (0),
        DeletedAt         datetime2(3) NULL,
        DeletedBy         nvarchar(128) NULL,
        RowVersion        rowversion NOT NULL,
        CONSTRAINT PK_DispatchIncidentFiles PRIMARY KEY CLUSTERED (id),
        CONSTRAINT FK_DispatchIncidentFiles_DispatchIncidents
            FOREIGN KEY (dispatch_id) REFERENCES dbo.DispatchIncidents(id),
        CONSTRAINT CK_DispatchIncidentFiles_FileType CHECK
            (FileType IN (N'HistoryExcel', N'HistoryPdf', N'TeamIncidentReport'))
    );

    CREATE INDEX IX_DispatchIncidentFiles_Dispatch_Type_Uploaded
        ON dbo.DispatchIncidentFiles
        (
            dispatch_id,
            IsDeleted,
            FileType,
            UploadedAt DESC,
            id DESC
        );
END;
GO
