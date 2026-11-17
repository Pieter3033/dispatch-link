-- Alert when a manager-approved dispatch still has no Zoho ID after 10 minutes.
-- Runs every five minutes. One successful/queued email per dispatch; failed mail is retried.
-- Intended for CC on SQL-SERVER-EXAMPLE. Requires Database Mail profile ExampleMailProfile.

IF DB_NAME() <> N'CC'
    THROW 51200, 'Run this migration in the CC database only.', 1;
IF OBJECT_ID(N'dbo.DispatchLinkZohoAlert', N'U') IS NOT NULL
    THROW 51201, 'DispatchLinkZohoAlert already exists; review it before rerunning.', 1;
IF OBJECT_ID(N'dbo.DispatchLink_CheckZohoAlerts', N'P') IS NOT NULL
    THROW 51202, 'DispatchLink_CheckZohoAlerts already exists; review it before rerunning.', 1;
IF EXISTS (SELECT 1 FROM msdb.dbo.sysjobs WHERE name = N'DispatchLink_Zoho_Alert')
    THROW 51203, 'DispatchLink_Zoho_Alert job already exists; review it before rerunning.', 1;
IF EXISTS (SELECT 1 FROM msdb.dbo.sysschedules WHERE name = N'DispatchLink_Zoho_Alert_Every_5_Minutes')
    THROW 51204, 'DispatchLink_Zoho_Alert schedule already exists; review it before rerunning.', 1;
IF NOT EXISTS (SELECT 1 FROM msdb.dbo.sysmail_profile WHERE name = N'ExampleMailProfile')
    THROW 51205, 'Database Mail profile ExampleMailProfile is unavailable.', 1;
GO

CREATE TABLE dbo.DispatchLinkZohoAlert
(
    DispatchId int NOT NULL CONSTRAINT PK_DispatchLinkZohoAlert PRIMARY KEY,
    MailItemId int NOT NULL,
    QueuedAt datetime2(3) NOT NULL CONSTRAINT DF_DispatchLinkZohoAlert_QueuedAt DEFAULT (SYSDATETIME()),
    RetryCount int NOT NULL CONSTRAINT DF_DispatchLinkZohoAlert_RetryCount DEFAULT (0)
);
GO

CREATE PROCEDURE dbo.DispatchLink_CheckZohoAlerts
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @lockResult int;
    EXEC @lockResult = sys.sp_getapplock
        @Resource = N'DispatchLink_CheckZohoAlerts',
        @LockMode = N'Exclusive',
        @LockOwner = N'Session',
        @LockTimeout = 0;
    IF @lockResult < 0 RETURN;

    BEGIN TRY
        DECLARE
            @dispatchId int,
            @incidentNumber nvarchar(100),
            @registration nvarchar(100),
            @obNumber nvarchar(100),
            @teamName nvarchar(255),
            @approvedAt datetime2(3),
            @subject nvarchar(255),
            @body nvarchar(max),
            @mailItemId int;

        DECLARE missing_zoho CURSOR LOCAL FAST_FORWARD FOR
            SELECT
                incident.id,
                CONVERT(nvarchar(100), incident.IncidentNumber),
                CONVERT(nvarchar(100), incident.RegNo),
                CONVERT(nvarchar(100), incident.OBNumber),
                CONVERT(nvarchar(255), incident.DispatchTeam),
                incident.ApprovedAt
            FROM dbo.DispatchIncidents incident
            LEFT JOIN dbo.DispatchLinkZohoAlert alert ON alert.DispatchId = incident.id
            LEFT JOIN msdb.dbo.sysmail_allitems mail ON mail.mailitem_id = alert.MailItemId
            WHERE incident.IsDeleted = 0
              AND incident.Status = N'Approved'
              AND incident.ApprovedAt <= DATEADD(MINUTE, -10, SYSDATETIME())
              AND NULLIF(LTRIM(RTRIM(incident.ZohoId)), N'') IS NULL
              AND (alert.DispatchId IS NULL OR mail.sent_status = N'failed')
            ORDER BY incident.ApprovedAt, incident.id;

        OPEN missing_zoho;
        FETCH NEXT FROM missing_zoho INTO
            @dispatchId, @incidentNumber, @registration, @obNumber, @teamName, @approvedAt;

        WHILE @@FETCH_STATUS = 0
        BEGIN
            -- The 30-second Zoho push may have completed after the cursor was opened.
            IF NOT EXISTS
            (
                SELECT 1 FROM dbo.DispatchIncidents current_incident
                WHERE current_incident.id = @dispatchId
                  AND current_incident.IsDeleted = 0
                  AND current_incident.Status = N'Approved'
                  AND NULLIF(LTRIM(RTRIM(current_incident.ZohoId)), N'') IS NULL
            )
            BEGIN
                FETCH NEXT FROM missing_zoho INTO
                    @dispatchId, @incidentNumber, @registration, @obNumber, @teamName, @approvedAt;
                CONTINUE;
            END;

            SET @subject = N'Dispatch Link: Zoho push overdue - '
                + COALESCE(NULLIF(@incidentNumber, N''), CONVERT(nvarchar(20), @dispatchId));
            SET @body =
                N'A manager-approved dispatch still has no Zoho ID after more than 10 minutes.'
                + NCHAR(13) + NCHAR(10) + NCHAR(13) + NCHAR(10)
                + N'Dispatch ID: ' + CONVERT(nvarchar(20), @dispatchId) + NCHAR(13) + NCHAR(10)
                + N'Incident number: ' + COALESCE(NULLIF(@incidentNumber, N''), N'—') + NCHAR(13) + NCHAR(10)
                + N'Registration: ' + COALESCE(NULLIF(@registration, N''), N'—') + NCHAR(13) + NCHAR(10)
                + N'Team OB: ' + COALESCE(NULLIF(@obNumber, N''), N'—') + NCHAR(13) + NCHAR(10)
                + N'Dispatch team: ' + COALESCE(NULLIF(@teamName, N''), N'—') + NCHAR(13) + NCHAR(10)
                + N'Approved at (server time): ' + COALESCE(CONVERT(nvarchar(19), @approvedAt, 120), N'—')
                + NCHAR(13) + NCHAR(10) + NCHAR(13) + NCHAR(10)
                + N'Please investigate the DispatchLink_Zoho_Push SQL Agent job and the dispatch record.';

            SET @mailItemId = NULL;
            EXEC msdb.dbo.sp_send_dbmail
                @profile_name = N'ExampleMailProfile',
                @recipients = N'notifications@example.invalid',
                @subject = @subject,
                @body = @body,
                @body_format = N'TEXT',
                @mailitem_id = @mailItemId OUTPUT;

            IF @mailItemId IS NULL
                THROW 51206, 'Database Mail did not return a mail item ID.', 1;

            UPDATE dbo.DispatchLinkZohoAlert
            SET MailItemId = @mailItemId,
                QueuedAt = SYSDATETIME(),
                RetryCount = RetryCount + 1
            WHERE DispatchId = @dispatchId;

            IF @@ROWCOUNT = 0
                INSERT dbo.DispatchLinkZohoAlert (DispatchId, MailItemId)
                VALUES (@dispatchId, @mailItemId);

            FETCH NEXT FROM missing_zoho INTO
                @dispatchId, @incidentNumber, @registration, @obNumber, @teamName, @approvedAt;
        END;

        CLOSE missing_zoho;
        DEALLOCATE missing_zoho;
        EXEC sys.sp_releaseapplock @Resource = N'DispatchLink_CheckZohoAlerts', @LockOwner = N'Session';
    END TRY
    BEGIN CATCH
        IF CURSOR_STATUS('local', 'missing_zoho') >= 0 CLOSE missing_zoho;
        IF CURSOR_STATUS('local', 'missing_zoho') > -3 DEALLOCATE missing_zoho;
        EXEC sys.sp_releaseapplock @Resource = N'DispatchLink_CheckZohoAlerts', @LockOwner = N'Session';
        THROW;
    END CATCH;
END;
GO

DECLARE @jobId uniqueidentifier;
EXEC msdb.dbo.sp_add_job
    @job_name = N'DispatchLink_Zoho_Alert',
    @enabled = 1,
    @description = N'Email Approver1 once per approved Dispatch Link incident that has no Zoho ID after 10 minutes; retry failed Database Mail items.',
    @job_id = @jobId OUTPUT;

EXEC msdb.dbo.sp_add_jobstep
    @job_id = @jobId,
    @step_name = N'Check approved dispatches missing Zoho ID',
    @subsystem = N'TSQL',
    @database_name = N'CC',
    @command = N'EXEC dbo.DispatchLink_CheckZohoAlerts;',
    @on_success_action = 1,
    @on_fail_action = 2;

EXEC msdb.dbo.sp_add_schedule
    @schedule_name = N'DispatchLink_Zoho_Alert_Every_5_Minutes',
    @enabled = 1,
    @freq_type = 4,
    @freq_interval = 1,
    @freq_subday_type = 4,
    @freq_subday_interval = 5,
    @active_start_date = 20260930,
    @active_start_time = 0;

EXEC msdb.dbo.sp_attach_schedule
    @job_id = @jobId,
    @schedule_name = N'DispatchLink_Zoho_Alert_Every_5_Minutes';

EXEC msdb.dbo.sp_add_jobserver
    @job_id = @jobId,
    @server_name = N'(LOCAL)';
GO
