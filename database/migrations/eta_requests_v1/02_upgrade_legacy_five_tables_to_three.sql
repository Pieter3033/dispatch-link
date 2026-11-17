/*
    Dispatch Link - ETA Requests V1
    One-time upgrade from the original five-table preview to the final
    three-table V1 model.

    Safety rule: this script stops before changing anything when ETA requests,
    responses, or audit rows already exist. It is intended for the empty preview
    schema only.
*/

USE [CC];
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

IF OBJECT_ID(N'dbo.DispatchTeams', N'U') IS NULL
   OR OBJECT_ID(N'dbo.DispatchEtaRequests', N'U') IS NULL
   OR OBJECT_ID(N'dbo.DispatchEtaResponses', N'U') IS NULL
   OR OBJECT_ID(N'dbo.DispatchEtaUserGroups', N'U') IS NULL
   OR OBJECT_ID(N'dbo.DispatchEtaAuditLog', N'U') IS NULL
    THROW 51010, 'The complete legacy five-table ETA preview schema was not found.', 1;
GO

IF EXISTS (SELECT 1 FROM dbo.DispatchEtaRequests)
   OR EXISTS (SELECT 1 FROM dbo.DispatchEtaResponses)
   OR EXISTS (SELECT 1 FROM dbo.DispatchEtaAuditLog)
    THROW 51011, 'ETA workflow data exists. Stop and use a data-preserving migration instead.', 1;
GO

BEGIN TRY
    BEGIN TRANSACTION;

    IF COL_LENGTH(N'dbo.DispatchTeams', N'GroupUsername') IS NULL
        ALTER TABLE dbo.DispatchTeams ADD GroupUsername nvarchar(128) NULL;

    IF COL_LENGTH(N'dbo.DispatchTeams', N'MonthlyDispatchLimit') IS NULL
        ALTER TABLE dbo.DispatchTeams ADD MonthlyDispatchLimit int NULL;

    EXEC sys.sp_executesql N'
        UPDATE team
        SET team.GroupUsername = LOWER(LTRIM(RTRIM(access_group.Username))),
            team.UpdatedAt = SYSDATETIME(),
            team.UpdatedBy = N''eta-v1-three-table-upgrade''
        FROM dbo.DispatchTeams team
        JOIN dbo.DispatchEtaUserGroups access_group
          ON access_group.TeamId = team.TeamId
         AND access_group.AccessRole = N''DispatchTeam''
         AND access_group.IsActive = 1;

        IF EXISTS
        (
            SELECT 1
            FROM dbo.DispatchTeams
            WHERE GroupUsername IS NULL OR LEN(LTRIM(RTRIM(GroupUsername))) = 0
        )
            THROW 51012, ''Every dispatch team must have one active DispatchTeam username before upgrading.'', 1;

        IF EXISTS
        (
            SELECT GroupUsername
            FROM dbo.DispatchTeams
            GROUP BY GroupUsername
            HAVING COUNT(*) > 1
        )
            THROW 51013, ''Dispatch-team usernames must be unique before upgrading.'', 1;
    ';

    EXEC sys.sp_executesql N'
        ALTER TABLE dbo.DispatchTeams
            ALTER COLUMN GroupUsername nvarchar(128) NOT NULL;
    ';

    IF OBJECT_ID(N'dbo.UQ_DispatchTeams_GroupUsername', N'UQ') IS NULL
        EXEC sys.sp_executesql N'
            ALTER TABLE dbo.DispatchTeams
                ADD CONSTRAINT UQ_DispatchTeams_GroupUsername UNIQUE (GroupUsername);
        ';

    IF OBJECT_ID(N'dbo.CK_DispatchTeams_GroupUsername', N'C') IS NULL
        EXEC sys.sp_executesql N'
            ALTER TABLE dbo.DispatchTeams
                ADD CONSTRAINT CK_DispatchTeams_GroupUsername
                    CHECK (LEN(LTRIM(RTRIM(GroupUsername))) > 0);
        ';

    IF OBJECT_ID(N'dbo.FK_DispatchEtaRequests_SelectedResponse', N'F') IS NOT NULL
        ALTER TABLE dbo.DispatchEtaRequests
            DROP CONSTRAINT FK_DispatchEtaRequests_SelectedResponse;

    IF COL_LENGTH(N'dbo.DispatchEtaRequests', N'SelectedResponseId') IS NOT NULL
        ALTER TABLE dbo.DispatchEtaRequests DROP COLUMN SelectedResponseId;

    IF COL_LENGTH(N'dbo.DispatchEtaRequests', N'SelectedTeamId') IS NULL
        ALTER TABLE dbo.DispatchEtaRequests ADD SelectedTeamId int NULL;

    IF COL_LENGTH(N'dbo.DispatchEtaRequests', N'SelectedDistanceKm') IS NULL
        ALTER TABLE dbo.DispatchEtaRequests ADD SelectedDistanceKm decimal(8,1) NULL;

    IF OBJECT_ID(N'dbo.FK_DispatchEtaRequests_SelectedTeam', N'F') IS NULL
        EXEC sys.sp_executesql N'
            ALTER TABLE dbo.DispatchEtaRequests WITH CHECK
                ADD CONSTRAINT FK_DispatchEtaRequests_SelectedTeam
                    FOREIGN KEY (SelectedTeamId) REFERENCES dbo.DispatchTeams(TeamId);
        ';

    IF OBJECT_ID(N'dbo.CK_DispatchEtaRequests_Selection', N'C') IS NULL
        EXEC sys.sp_executesql N'
            ALTER TABLE dbo.DispatchEtaRequests WITH CHECK
                ADD CONSTRAINT CK_DispatchEtaRequests_Selection CHECK
                (
                    (RequestStatus = N''Selected''
                     AND SelectedTeamId IS NOT NULL
                     AND SelectedDistanceKm > 0
                     AND DispatchIncidentId IS NOT NULL
                     AND SelectedAt IS NOT NULL
                     AND SelectedBy IS NOT NULL)
                    OR
                    (RequestStatus <> N''Selected''
                     AND SelectedTeamId IS NULL
                     AND SelectedDistanceKm IS NULL
                     AND DispatchIncidentId IS NULL
                     AND SelectedAt IS NULL
                     AND SelectedBy IS NULL)
                );
        ';

    IF OBJECT_ID(N'dbo.CK_DispatchEtaRequests_Cancellation', N'C') IS NULL
        ALTER TABLE dbo.DispatchEtaRequests WITH CHECK
            ADD CONSTRAINT CK_DispatchEtaRequests_Cancellation CHECK
            (
                (RequestStatus = N'Cancelled' AND CancelledAt IS NOT NULL AND CancelledBy IS NOT NULL)
                OR
                (RequestStatus <> N'Cancelled' AND CancelledAt IS NULL AND CancelledBy IS NULL)
            );

    DROP TABLE dbo.DispatchEtaAuditLog;
    DROP TABLE dbo.DispatchEtaUserGroups;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
GO

SELECT
    t.name AS EtaTable,
    COUNT(c.column_id) AS ColumnCount
FROM sys.tables t
JOIN sys.columns c ON c.object_id = t.object_id
WHERE t.name IN (N'DispatchTeams', N'DispatchEtaRequests', N'DispatchEtaResponses')
GROUP BY t.name
ORDER BY t.name;
GO

PRINT 'Legacy ETA preview upgraded successfully to the three-table V1 model.';
GO
