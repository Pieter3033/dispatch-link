-- Apply to CC before deploying the additional-assets API and UI, with separate
-- database-change authorization. This file is not executed by development work.
USE [CC];
GO

IF COL_LENGTH('dbo.DispatchIncidents', 'AdditionalAssetsJson') IS NULL
    ALTER TABLE dbo.DispatchIncidents ADD AdditionalAssetsJson nvarchar(max) NULL;
GO

IF COL_LENGTH('dbo.DispatchIncidentPhotos', 'AssetKey') IS NULL
    ALTER TABLE dbo.DispatchIncidentPhotos ADD AssetKey uniqueidentifier NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_DispatchIncidents_AdditionalAssetsJson')
    ALTER TABLE dbo.DispatchIncidents ADD CONSTRAINT CK_DispatchIncidents_AdditionalAssetsJson
        CHECK (AdditionalAssetsJson IS NULL OR ISJSON(AdditionalAssetsJson) = 1);
GO
