USE [CC];
GO

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.DispatchIncidentPhotos', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.DispatchIncidentPhotos
    (
        id                int IDENTITY(1,1) NOT NULL,
        dispatch_id       int NOT NULL,
        PhotoCategory     nvarchar(50) NOT NULL,
        OriginalFileName  nvarchar(255) NOT NULL,
        StoredFileName    nvarchar(255) NULL,
        FilePath          nvarchar(1000) NOT NULL,
        MimeType          nvarchar(100) NULL,
        Bytes             bigint NULL,
        Notes             nvarchar(max) NULL,
        UploadedAt        datetime2(3) NOT NULL
            CONSTRAINT DF_DispatchIncidentPhotos_UploadedAt DEFAULT (sysdatetime()),
        UploadedBy        nvarchar(128) NOT NULL,
        CreatedAt         datetime2(3) NOT NULL
            CONSTRAINT DF_DispatchIncidentPhotos_CreatedAt DEFAULT (sysdatetime()),
        CreatedBy         nvarchar(128) NOT NULL,
        UpdatedAt         datetime2(3) NOT NULL
            CONSTRAINT DF_DispatchIncidentPhotos_UpdatedAt DEFAULT (sysdatetime()),
        UpdatedBy         nvarchar(128) NOT NULL,
        IsDeleted         bit NOT NULL
            CONSTRAINT DF_DispatchIncidentPhotos_IsDeleted DEFAULT (0),
        DeletedAt         datetime2(3) NULL,
        DeletedBy         nvarchar(128) NULL,
        RowVersion        rowversion NOT NULL,
        CONSTRAINT PK_DispatchIncidentPhotos PRIMARY KEY CLUSTERED (id),
        CONSTRAINT FK_DispatchIncidentPhotos_DispatchIncidents
            FOREIGN KEY (dispatch_id) REFERENCES dbo.DispatchIncidents(id),
        CONSTRAINT CK_DispatchIncidentPhotos_Category CHECK
        (
            PhotoCategory IN
            (
                N'LicenseDisk', N'FrontVehicleWithReg', N'BackVehicleWithReg',
                N'VehicleSides', N'TrailersWithReg', N'Stock', N'Damages',
                N'Dashboard', N'VehicleKeys', N'Odometer', N'Driver',
                N'DriverLicenseOrId'
            )
        )
    );

    CREATE INDEX IX_DispatchIncidentPhotos_Dispatch_Category_Uploaded
        ON dbo.DispatchIncidentPhotos
        (
            dispatch_id,
            IsDeleted,
            PhotoCategory,
            UploadedAt DESC,
            id DESC
        );
END;
GO
