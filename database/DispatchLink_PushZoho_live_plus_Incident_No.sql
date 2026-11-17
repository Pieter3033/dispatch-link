/*
    SOURCE: Exact live CC.dbo.DispatchLink_PushZoho definition read on 2026-07-27.
    LIVE SHA-256: 44A0B43094EAFD25A9C9BFBF4914097C20E389C6EB44D67D6A48822EFB0F0B17
    PREREQUISITE: DispatchIncidents.SummaryOfIncident from
      database/migrations/dispatch_workflow/02_incident_columns.sql.
    FUNCTIONAL ADDITIONS TO THE CAPTURED LIVE DEFINITION:
      - After a successful create, GET Call_Centre/{ZohoId}?fields=Incident_No
        and write data[0].Incident_No to CC.dbo.DispatchIncidents.zoho_ob.
      - Send the public dispatch evidence URL to Dispatch_Attachments_WAPP.
      - Send Department to Seat and resolve the selected Zoho Account to
        Accounts_ZOHO.zoho_id for the Lookup_1 (Company) lookup.
      - Send SummaryOfIncident followed by timeline descriptions, one sentence
        per line, to Summary_of_Incident1.
      - Resolve the dispatch creator (CreatedBy) through Jobcard.dbo.User_info
        and send Name + Surname to Operator_Name; the username is used only as
        a fallback, and the approver remains mapped separately to Comments_By.

    This script does not execute automatically when opened.
*/
USE [CC];
GO

CREATE OR ALTER PROCEDURE dbo.DispatchLink_PushZoho
    @DispatchId int = NULL,
    @DryRun bit = 0,
    @OperatorNameOnly bit = 0
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE
        @LockResult int,
        @LockAcquired bit = 0,
        @Action varchar(10),
        @Method varchar(10),
        @Url nvarchar(1000),
        @ZohoId nvarchar(100),
        @ReturnedZohoId nvarchar(100),
        @ZohoIncidentNo nvarchar(20),
        @LookupUrl nvarchar(1000),
        @LookupResponseJson nvarchar(max),
        @LookupResponseCode nvarchar(100),
        @LookupHttpStatus int,
        @AuthHeader nvarchar(2000),
        @AccessToken nvarchar(1800),
        @RecordJson nvarchar(max),
        @RequestJson nvarchar(max),
        @ResponseJson nvarchar(max),
        @ResponseStatus nvarchar(50),
        @ResponseCode nvarchar(100),
        @ResponseMessage nvarchar(2000),
        @HttpStatus int,
        @HttpObject int = NULL,
        @OaResult int,
        @OaSource varchar(255),
        @OaDescription varchar(4000),
        @Attempt tinyint = 1,
        @MaxAttempts tinyint = 2,
        @ErrorMessage nvarchar(2048);

    DECLARE @ResponseBuffer TABLE
    (
        ResponseText nvarchar(max)
    );

    BEGIN TRY
        EXEC @LockResult = sys.sp_getapplock
            @Resource = N'DispatchLink_PushZoho',
            @LockMode = N'Exclusive',
            @LockOwner = N'Session',
            @LockTimeout = 0;

        IF @LockResult < 0
            THROW 51100, 'Another Dispatch Link Zoho push is already running.', 1;

        SET @LockAcquired = 1;

        IF @OperatorNameOnly = 1 AND @DispatchId IS NULL
            THROW 51120, 'Operator-name-only updates require a specific dispatch ID.', 1;

        IF @DispatchId IS NULL
        BEGIN
            SELECT TOP (1)
                @DispatchId = incident.id
            FROM dbo.DispatchIncidents AS incident
            WHERE incident.Status = N'Approved'
              AND ISNULL(incident.IsDeleted, 0) = 0
              AND
              (
                  NULLIF(incident.ZohoId, N'') IS NULL
                  OR incident.ZohoUpdate = 1
              )
            ORDER BY
                CASE WHEN NULLIF(incident.ZohoId, N'') IS NULL THEN 0 ELSE 1 END,
                incident.ApprovedAt,
                incident.id;
        END;

        IF @DispatchId IS NULL
        BEGIN
            SELECT
                N'no_action' AS [status],
                N'No approved incident requires a Zoho push.' AS [message];

            EXEC sys.sp_releaseapplock
                @Resource = N'DispatchLink_PushZoho',
                @LockOwner = N'Session';
            RETURN;
        END;

        SELECT
            @ZohoId = NULLIF(LTRIM(RTRIM(incident.ZohoId)), N'')
        FROM dbo.DispatchIncidents AS incident
        WHERE incident.id = @DispatchId
          AND incident.Status = N'Approved'
          AND ISNULL(incident.IsDeleted, 0) = 0;

        IF @@ROWCOUNT = 0
            THROW 51101, 'The dispatch does not exist, is deleted, or has not been manager-approved.', 1;

        IF @ZohoId IS NULL
        BEGIN
            IF @OperatorNameOnly = 1
                THROW 51121, 'Operator-name-only updates require an existing Zoho record ID.', 1;

            SET @Action = 'create';
            SET @Method = 'POST';
            SET @Url = N'https://www.zohoapis.com/crm/v8/Call_Centre';
        END
        ELSE
        BEGIN
            IF @OperatorNameOnly = 0 AND NOT EXISTS
            (
                SELECT 1
                FROM dbo.DispatchIncidents
                WHERE id = @DispatchId
                  AND ZohoUpdate = 1
            )
            BEGIN
                SELECT
                    N'no_action' AS [status],
                    @DispatchId AS dispatch_id,
                    @ZohoId AS zoho_id,
                    N'The record already exists in Zoho and ZohoUpdate is 0.' AS [message];

                EXEC sys.sp_releaseapplock
                    @Resource = N'DispatchLink_PushZoho',
                    @LockOwner = N'Session';
                RETURN;
            END;

            SET @Action = 'update';
            SET @Method = 'PUT';
            SET @Url = N'https://www.zohoapis.com/crm/v8/Call_Centre/' + @ZohoId;
        END;

        /*
            Only confirmed API names are included here. FOR JSON omits NULL values,
            preventing an update from clearing fields unintentionally.

            Zoho DateTime fields require ISO-8601 with an offset. Dispatch Link times
            are South African local times, so +02:00 is appended.
        */
        SELECT @RecordJson =
        (
            SELECT
                CASE WHEN @Action = 'update' THEN @ZohoId END AS [id],
                LEFT
                (
                    CONCAT
                    (
                        COALESCE(NULLIF(LTRIM(RTRIM(incident.RegNo)), N''), N'Dispatch'),
                        N'_',
                        incident.Event
                    ),
                    255
                ) AS [Name],
                NULLIF(LTRIM(RTRIM(incident.RegNo)), N'') AS [Reg_No],
                CONVERT(varchar(19), incident.EventDateTime, 126) + '+02:00' AS [Date_Time_Case_Opened],
                N'Risk' AS [CC_Event_Type],
                NULLIF(LTRIM(RTRIM(incident.Event)), N'') AS [Incident_Type],
                NULLIF(LTRIM(RTRIM(incident.DispatchReason)), N'') AS [Seat],
                COALESCE
                (
                    (
                        SELECT TOP (1)
                            TRY_CONVERT(nvarchar(100), account.zoho_id)
                        FROM Pulsit_comparison.dbo.Accounts_ZOHO AS account
                        WHERE account.zoho_id IS NOT NULL
                          AND account.Account_Name =
                              NULLIF(LTRIM(RTRIM(incident.ZohoAccount)), N'')
                        ORDER BY account.zoho_id
                    ),
                    (
                        SELECT TOP (1)
                            TRY_CONVERT(nvarchar(100), account.zoho_id)
                        FROM Jobcard.dbo.Companies AS company
                        INNER JOIN Pulsit_comparison.dbo.Accounts_ZOHO AS account
                            ON account.zoho_id = company.escallation_no
                        WHERE LTRIM(RTRIM(company.Company)) =
                                  NULLIF(LTRIM(RTRIM(incident.Company)), N'')
                          AND LTRIM(RTRIM(company.Fleet_Code)) =
                                  NULLIF(LTRIM(RTRIM(incident.FleetCode)), N'')
                        ORDER BY account.zoho_id
                    )
                ) AS [Lookup_1],
                COALESCE
                (
                    (
                        SELECT TOP (1)
                            NULLIF
                            (
                                LTRIM(RTRIM(CONCAT(creator.Name, N' ', creator.Surname))),
                                N''
                            )
                        FROM Jobcard.dbo.User_info AS creator
                        WHERE LOWER(LTRIM(RTRIM(CONVERT(nvarchar(200), creator.Username)))) =
                              LOWER(LTRIM(RTRIM(incident.CreatedBy)))
                    ),
                    NULLIF(LTRIM(RTRIM(incident.CreatedBy)), N'')
                ) AS [Operator_Name],
                CASE
                    WHEN CONVERT(time(0), incident.EventDateTime) >= '05:00:00'
                     AND CONVERT(time(0), incident.EventDateTime) <  '13:00:00'
                        THEN N'Shift 1 (5am-1pm)'
                    WHEN CONVERT(time(0), incident.EventDateTime) >= '13:00:00'
                     AND CONVERT(time(0), incident.EventDateTime) <  '21:00:00'
                        THEN N'Shift 2 (1pm-9pm)'
                    ELSE N'Shift 3 (9pm-5am)'
                END AS [Shift_No],
                NULLIF(LTRIM(RTRIM(incident.ClientName)), N'') AS [CONTACT],
                NULLIF(LTRIM(RTRIM(incident.ClientContactNumber)), N'') AS [From_To_Alternative],
                TRY_CONVERT(bigint, NULLIF(LTRIM(RTRIM(incident.ClientPO)), N'')) AS [Client_O_N],
                NULLIF(LTRIM(RTRIM(incident.FleetCode)), N'') AS [FLEET_NUMBER],
                NULLIF(LTRIM(RTRIM(incident.StockNumberWrc)), N'') AS [Stock_Number],
                NULLIF(LTRIM(RTRIM(incident.TrailerRegistration1)), N'') AS [Trailer_Reg_1],
                NULLIF(LTRIM(RTRIM(incident.TrailerRegistration2)), N'') AS [Trailer_Reg_2],
                NULLIF(LTRIM(RTRIM(incident.VehicleMake)), N'') AS [Vehicle_Make],
                NULLIF(LTRIM(RTRIM(incident.VehicleModel)), N'') AS [Model1],
                NULLIF(LTRIM(RTRIM(incident.VehicleColour)), N'') AS [Colour],
                NULLIF(LTRIM(RTRIM(incident.TrailerType)), N'') AS [Trailer_Types],
                NULLIF(LTRIM(RTRIM(incident.VehicleBranding)), N'') AS [Markings_Branding],
                NULLIF(LTRIM(RTRIM(incident.TrailerBranding)), N'') AS [Trailer_Markings_Branding],
                CASE
                    WHEN incident.DispatchDateTime IS NOT NULL
                      OR NULLIF(LTRIM(RTRIM(incident.DispatchTeam)), N'') IS NOT NULL
                        THEN CAST(1 AS bit)
                END AS [Capital_Air_Dispatched1],
                CASE
                    WHEN incident.DispatchDateTime IS NOT NULL
                        THEN CONVERT(varchar(19), incident.DispatchDateTime, 126) + '+02:00'
                END AS [Capital_Air_Dispatched],
                NULLIF(LTRIM(RTRIM(incident.DispatchTeam)), N'') AS [Dispatched_Team],
                NULLIF(LTRIM(RTRIM(incident.OBNumber)), N'') AS [Capital_OB_No],
                CASE
                    WHEN incident.StandDownDateTime IS NOT NULL
                        THEN CONVERT(varchar(19), incident.StandDownDateTime, 126) + '+02:00'
                END AS [Capital_Air_Stand_Down],
                NULLIF(LTRIM(RTRIM(incident.VehicleRecovered)), N'') AS [Pick_List_6],
                NULLIF(LTRIM(RTRIM(incident.LoadRecovered)), N'') AS [Load_Recovered],
                NULLIF(LTRIM(RTRIM(incident.VehicleKeyAvailable)), N'') AS [Vehicle_Key_Available],
                NULLIF(LTRIM(RTRIM(incident.TrailersRecovered)), N'') AS [Trailer_s_Recovered],
                NULLIF(LTRIM(RTRIM(incident.DriverOnScene)), N'') AS [Driver_on_Scene],
                NULLIF(LTRIM(RTRIM(incident.TrackingUnitStatus)), N'') AS [Tracking_Unit_Status],
                NULLIF(LTRIM(RTRIM(incident.GeoLocation)), N'') AS [Incident_Address],
                CONCAT
                (
                    N'https://dispatch.example.invalid/dispatch_link/public/evidence.html?id=',
                    CONVERT(nvarchar(20), incident.id)
                ) AS [Dispatch_Attachments_WAPP],
                NULLIF
                (
                    CONCAT_WS
                    (
                        NCHAR(13) + NCHAR(10),
                        NULLIF(LTRIM(RTRIM(incident.SummaryOfIncident)), N''),
                        NULLIF(timeline_text.TimelineSummary, N'')
                    ),
                    N''
                ) AS [Summary_of_Incident1],
                NULLIF(LTRIM(RTRIM(incident.ApprovalComments)), N'') AS [Comments],
                NULLIF(LTRIM(RTRIM(incident.ApprovedBy)), N'') AS [Comments_By],
                CASE
                    WHEN incident.ApprovedAt IS NOT NULL
                        THEN CONVERT(varchar(19), incident.ApprovedAt, 126) + '+02:00'
                END AS [Date_Time_added],
                JSON_QUERY
                (
                    CASE
                        /*
                            Local communication rows are locked after manager approval.
                            Send the complete collection on create only; omitting it from
                            later PUT requests prevents Zoho from appending duplicates.
                        */
                        WHEN @Action = 'create' THEN
                        (
                            SELECT TOP
                                (
                                    CASE
                                        WHEN communication_summary.CommunicationCount > 100 THEN 1
                                        ELSE 2147483647
                                    END
                                )
                                CASE
                                    WHEN communication_summary.CommunicationCount > 100 THEN
                                        CONCAT
                                        (
                                            N'Open this link to download the communication log: ',
                                            N'https://dispatch.example.invalid/dispatch_link/api/generate_communication_log_report.sql?incidentId=',
                                            CONVERT(nvarchar(20), incident.id)
                                        )
                                    ELSE NULLIF(LTRIM(RTRIM(communication.CommunicationNotes)), N'')
                                END AS [CR_Event_Comments1],
                                NULLIF(LTRIM(RTRIM(communication.CommunicationType)), N'')
                                    AS [CR_Event_Type_of_Comms],
                                NULLIF(LTRIM(RTRIM(communication.ContactPerson)), N'')
                                    AS [CR_Event_Contact_Name],
                                NULLIF(
                                    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                                        LTRIM(RTRIM(communication.ContactNumber)) COLLATE Latin1_General_100_BIN2,
                                        N' ', N''), NCHAR(160), N''), NCHAR(8239), N''),
                                        NCHAR(9), N''), NCHAR(10), N''), NCHAR(13), N''),
                                    N''
                                )
                                    AS [CR_Event_Contact_No],
                                NULLIF(LTRIM(RTRIM(communication.ControlRoomAgent)), N'')
                                    AS [CR_Event_Control_Room_Agent],
                                CONVERT(varchar(10), communication.CommunicationDate, 23)
                                    + 'T'
                                    + CONVERT(varchar(8), communication.CommunicationTime, 108)
                                    + '+02:00'
                                    AS [CR_Event_Date_Time_of_Comms],
                                NULLIF(LTRIM(RTRIM(communication.EmailAddress)), N'')
                                    AS [Email_Address]
                            FROM dbo.DispatchCommunicationLog AS communication
                            WHERE communication.DispatchID = incident.id
                              AND ISNULL(communication.IsDeleted, 0) = 0
                            ORDER BY
                                CASE WHEN communication.DisplayOrder > 0 THEN communication.DisplayOrder ELSE 2147483647 END,
                                communication.CommunicationDate,
                                communication.CommunicationTime,
                                communication.CommunicationLogID
                            FOR JSON PATH
                        )
                    END
                ) AS [Communication_Log],
                CAST(1 AS bit) AS [CLOSED],
                CASE
                    WHEN incident.ApprovedAt IS NOT NULL
                        THEN CONVERT(varchar(19), incident.ApprovedAt, 126) + '+02:00'
                END AS [Date_Time_Event_Closed],
                N'Approved by Control Room Management.' AS [Summary_of_Incident],
                N'Dispatch Link (Automation)' AS [Closed_by_Control_Room_Operator]
            FROM dbo.DispatchIncidents AS incident
            OUTER APPLY
            (
                SELECT
                    STRING_AGG
                    (
                        CONVERT
                        (
                            nvarchar(max),
                            CASE
                                WHEN RIGHT(LTRIM(RTRIM(timeline_entry.EntryText)), 1)
                                     IN (N'.', N'!', N'?')
                                    THEN LTRIM(RTRIM(timeline_entry.EntryText))
                                ELSE LTRIM(RTRIM(timeline_entry.EntryText)) + N'.'
                            END
                        ),
                        NCHAR(13) + NCHAR(10)
                    ) WITHIN GROUP
                    (
                        ORDER BY
                            timeline_entry.EventDateTime,
                            timeline_entry.TimelineEntryID
                    ) AS TimelineSummary
                FROM dbo.DispatchIncidentTimeline AS timeline_entry
                WHERE timeline_entry.DispatchID = incident.id
                  AND ISNULL(timeline_entry.IsDeleted, 0) = 0
                  AND NULLIF(LTRIM(RTRIM(timeline_entry.EntryText)), N'') IS NOT NULL
                  AND NOT
                  (
                      timeline_entry.EventType = N'Note'
                      AND timeline_entry.EntryText LIKE N'HANDOVER:%'
                  )
            ) AS timeline_text
            OUTER APPLY
            (
                SELECT COUNT_BIG(*) AS CommunicationCount
                FROM dbo.DispatchCommunicationLog AS communication_count
                WHERE communication_count.DispatchID = incident.id
                  AND ISNULL(communication_count.IsDeleted, 0) = 0
            ) AS communication_summary
            WHERE incident.id = @DispatchId
            FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
        );

        IF @OperatorNameOnly = 1
        BEGIN
            IF NOT EXISTS
            (
                SELECT 1
                FROM dbo.DispatchIncidents AS incident
                WHERE incident.id = @DispatchId
                  AND NULLIF(LTRIM(RTRIM(incident.CreatedBy)), N'') IS NOT NULL
            )
                THROW 51122, 'Operator-name-only updates require a nonblank dispatch creator.', 1;

            SELECT @RecordJson =
            (
                SELECT
                    @ZohoId AS [id],
                    COALESCE
                    (
                        (
                            SELECT TOP (1)
                                NULLIF
                                (
                                    LTRIM(RTRIM(CONCAT(creator.Name, N' ', creator.Surname))),
                                    N''
                                )
                            FROM Jobcard.dbo.User_info AS creator
                            WHERE LOWER(LTRIM(RTRIM(CONVERT(nvarchar(200), creator.Username)))) =
                                  LOWER(LTRIM(RTRIM(incident.CreatedBy)))
                        ),
                        NULLIF(LTRIM(RTRIM(incident.CreatedBy)), N'')
                    ) AS [Operator_Name]
                FROM dbo.DispatchIncidents AS incident
                WHERE incident.id = @DispatchId
                FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
            );
        END;

        IF NULLIF(@RecordJson, N'') IS NULL
            THROW 51102, 'The Zoho JSON payload could not be built.', 1;

        IF @OperatorNameOnly = 1
            SET @RequestJson = N'{"data":[' + @RecordJson + N']}';
        ELSE
            SET @RequestJson =
                N'{"data":[' + @RecordJson
                + N'],"trigger":["approval","workflow","blueprint"]}';

        IF @DryRun = 1
        BEGIN
            SELECT
                N'dry_run' AS [status],
                @DispatchId AS dispatch_id,
                @Action AS zoho_action,
                @Method AS http_method,
                @Url AS request_url,
                @RequestJson AS request_json;

            EXEC sys.sp_releaseapplock
                @Resource = N'DispatchLink_PushZoho',
                @LockOwner = N'Session';
            RETURN;
        END;

        WHILE @Attempt <= @MaxAttempts
        BEGIN
            SET @AccessToken = NULL;
            SET @AuthHeader = NULL;
            SET @ResponseJson = NULL;
            SET @ResponseStatus = NULL;
            SET @ResponseCode = NULL;
            SET @ResponseMessage = NULL;
            SET @ReturnedZohoId = NULL;
            SET @HttpStatus = NULL;
            DELETE FROM @ResponseBuffer;

            /* Existing installation: Jobcard.dbo.Zoho_key is a one-column token table. */
            SET @AccessToken =
            (
                SELECT TOP (1) *
                FROM Jobcard.dbo.Zoho_key
            );

            IF NULLIF(LTRIM(RTRIM(@AccessToken)), N'') IS NULL
                THROW 51103, 'Jobcard.dbo.Zoho_key does not contain an access token.', 1;

            SET @AuthHeader = N'Zoho-oauthtoken ' + @AccessToken;

            EXEC @OaResult = sys.sp_OACreate
                'MSXML2.ServerXMLHTTP.6.0',
                @HttpObject OUT;

            IF @OaResult <> 0
            BEGIN
                EXEC sys.sp_OAGetErrorInfo @HttpObject, @OaSource OUT, @OaDescription OUT;
                SET @ErrorMessage = CONCAT(N'Unable to create the HTTP client. ', COALESCE(@OaDescription, N''));
                THROW 51104, @ErrorMessage, 1;
            END;

            EXEC @OaResult = sys.sp_OAMethod
                @HttpObject,
                'setTimeouts',
                NULL,
                10000,
                10000,
                30000,
                30000;

            IF @OaResult <> 0
            BEGIN
                EXEC sys.sp_OAGetErrorInfo @HttpObject, @OaSource OUT, @OaDescription OUT;
                SET @ErrorMessage = CONCAT(N'Unable to configure HTTP timeouts. ', COALESCE(@OaDescription, N''));
                THROW 51105, @ErrorMessage, 1;
            END;

            EXEC @OaResult = sys.sp_OAMethod
                @HttpObject,
                'open',
                NULL,
                @Method,
                @Url,
                false;

            IF @OaResult <> 0
            BEGIN
                EXEC sys.sp_OAGetErrorInfo @HttpObject, @OaSource OUT, @OaDescription OUT;
                SET @ErrorMessage = CONCAT(N'Unable to open the Zoho request. ', COALESCE(@OaDescription, N''));
                THROW 51106, @ErrorMessage, 1;
            END;

            EXEC @OaResult = sys.sp_OAMethod
                @HttpObject,
                'setRequestHeader',
                NULL,
                'Content-Type',
                'application/json';

            IF @OaResult <> 0
                THROW 51107, 'Unable to set the Zoho Content-Type header.', 1;

            EXEC @OaResult = sys.sp_OAMethod
                @HttpObject,
                'setRequestHeader',
                NULL,
                'Authorization',
                @AuthHeader;

            IF @OaResult <> 0
                THROW 51108, 'Unable to set the Zoho Authorization header.', 1;

            EXEC @OaResult = sys.sp_OAMethod
                @HttpObject,
                'send',
                NULL,
                @RequestJson;

            IF @OaResult <> 0
            BEGIN
                EXEC sys.sp_OAGetErrorInfo @HttpObject, @OaSource OUT, @OaDescription OUT;
                SET @ErrorMessage = CONCAT(N'Unable to send the Zoho request. ', COALESCE(@OaDescription, N''));
                THROW 51109, @ErrorMessage, 1;
            END;

            EXEC @OaResult = sys.sp_OAGetProperty
                @HttpObject,
                'status',
                @HttpStatus OUT;

            IF @OaResult <> 0
                THROW 51110, 'Unable to read the Zoho HTTP status.', 1;

            INSERT INTO @ResponseBuffer (ResponseText)
            EXEC @OaResult = sys.sp_OAGetProperty @HttpObject, 'responseText';

            IF @OaResult <> 0
                THROW 51111, 'Unable to read the Zoho response body.', 1;

            SELECT TOP (1)
                @ResponseJson = ResponseText
            FROM @ResponseBuffer;

            EXEC sys.sp_OADestroy @HttpObject;
            SET @HttpObject = NULL;

            IF ISNULL(ISJSON(@ResponseJson), 0) = 1
            BEGIN
                SELECT
                    @ReturnedZohoId = JSON_VALUE(@ResponseJson, '$.data[0].details.id'),
                    @ResponseStatus = COALESCE
                    (
                        JSON_VALUE(@ResponseJson, '$.data[0].status'),
                        JSON_VALUE(@ResponseJson, '$.status')
                    ),
                    @ResponseCode = COALESCE
                    (
                        JSON_VALUE(@ResponseJson, '$.data[0].code'),
                        JSON_VALUE(@ResponseJson, '$.code')
                    ),
                    @ResponseMessage = COALESCE
                    (
                        JSON_VALUE(@ResponseJson, '$.data[0].message'),
                        JSON_VALUE(@ResponseJson, '$.message')
                    );
            END;

            IF @ResponseCode = N'INVALID_TOKEN' AND @Attempt < @MaxAttempts
            BEGIN
                EXEC Jobcard.dbo.zoho_key_refresh;
                SET @Attempt += 1;
                CONTINUE;
            END;

            BREAK;
        END;

        IF @HttpStatus BETWEEN 200 AND 299
           AND @ResponseStatus = N'success'
           AND (@Action = 'update' OR @ReturnedZohoId IS NOT NULL)
        BEGIN
            SET @ReturnedZohoId = COALESCE(@ReturnedZohoId, @ZohoId);

            IF @Action = 'create'
            BEGIN
                /*
                    Save the returned Zoho ID before the follow-up GET so a lookup
                    failure cannot cause this dispatch to be created twice.
                */
                UPDATE dbo.DispatchIncidents
                SET
                    ZohoId = @ReturnedZohoId,
                    ZohoUpdate = 0
                WHERE id = @DispatchId;

                SET @LookupUrl =
                    N'https://www.zohoapis.com/crm/v8/Call_Centre/'
                    + @ReturnedZohoId
                    + N'?fields=Incident_No';
                SET @Attempt = 1;

                WHILE @Attempt <= @MaxAttempts
                BEGIN
                    SET @AccessToken = NULL;
                    SET @AuthHeader = NULL;
                    SET @LookupResponseJson = NULL;
                    SET @LookupResponseCode = NULL;
                    SET @LookupHttpStatus = NULL;
                    SET @ZohoIncidentNo = NULL;
                    DELETE FROM @ResponseBuffer;

                    SET @AccessToken =
                    (
                        SELECT TOP (1) *
                        FROM Jobcard.dbo.Zoho_key
                    );

                    IF NULLIF(LTRIM(RTRIM(@AccessToken)), N'') IS NULL
                        THROW 51112, 'Jobcard.dbo.Zoho_key does not contain an access token for the Incident_No lookup.', 1;

                    SET @AuthHeader = N'Zoho-oauthtoken ' + @AccessToken;

                    EXEC @OaResult = sys.sp_OACreate
                        'MSXML2.ServerXMLHTTP.6.0',
                        @HttpObject OUT;

                    IF @OaResult <> 0
                    BEGIN
                        EXEC sys.sp_OAGetErrorInfo @HttpObject, @OaSource OUT, @OaDescription OUT;
                        SET @ErrorMessage = CONCAT(N'Unable to create the Incident_No lookup HTTP client. ', COALESCE(@OaDescription, N''));
                        THROW 51113, @ErrorMessage, 1;
                    END;

                    EXEC @OaResult = sys.sp_OAMethod
                        @HttpObject,
                        'setTimeouts',
                        NULL,
                        10000,
                        10000,
                        30000,
                        30000;

                    IF @OaResult <> 0
                    BEGIN
                        EXEC sys.sp_OAGetErrorInfo @HttpObject, @OaSource OUT, @OaDescription OUT;
                        SET @ErrorMessage = CONCAT(N'Unable to configure Incident_No lookup timeouts. ', COALESCE(@OaDescription, N''));
                        THROW 51114, @ErrorMessage, 1;
                    END;

                    EXEC @OaResult = sys.sp_OAMethod
                        @HttpObject,
                        'open',
                        NULL,
                        'GET',
                        @LookupUrl,
                        false;

                    IF @OaResult <> 0
                    BEGIN
                        EXEC sys.sp_OAGetErrorInfo @HttpObject, @OaSource OUT, @OaDescription OUT;
                        SET @ErrorMessage = CONCAT(N'Unable to open the Incident_No lookup request. ', COALESCE(@OaDescription, N''));
                        THROW 51115, @ErrorMessage, 1;
                    END;

                    EXEC @OaResult = sys.sp_OAMethod
                        @HttpObject,
                        'setRequestHeader',
                        NULL,
                        'Authorization',
                        @AuthHeader;

                    IF @OaResult <> 0
                        THROW 51116, 'Unable to set the Incident_No lookup Authorization header.', 1;

                    EXEC @OaResult = sys.sp_OAMethod
                        @HttpObject,
                        'send',
                        NULL;

                    IF @OaResult <> 0
                    BEGIN
                        EXEC sys.sp_OAGetErrorInfo @HttpObject, @OaSource OUT, @OaDescription OUT;
                        SET @ErrorMessage = CONCAT(N'Unable to send the Incident_No lookup request. ', COALESCE(@OaDescription, N''));
                        THROW 51117, @ErrorMessage, 1;
                    END;

                    EXEC @OaResult = sys.sp_OAGetProperty
                        @HttpObject,
                        'status',
                        @LookupHttpStatus OUT;

                    IF @OaResult <> 0
                        THROW 51118, 'Unable to read the Incident_No lookup HTTP status.', 1;

                    INSERT INTO @ResponseBuffer (ResponseText)
                    EXEC @OaResult = sys.sp_OAGetProperty @HttpObject, 'responseText';

                    IF @OaResult <> 0
                        THROW 51119, 'Unable to read the Incident_No lookup response body.', 1;

                    SELECT TOP (1)
                        @LookupResponseJson = ResponseText
                    FROM @ResponseBuffer;

                    EXEC sys.sp_OADestroy @HttpObject;
                    SET @HttpObject = NULL;

                    IF ISNULL(ISJSON(@LookupResponseJson), 0) = 1
                    BEGIN
                        SELECT
                            @ZohoIncidentNo = NULLIF
                            (
                                LTRIM(RTRIM(JSON_VALUE(@LookupResponseJson, '$.data[0].Incident_No'))),
                                N''
                            ),
                            @LookupResponseCode = COALESCE
                            (
                                JSON_VALUE(@LookupResponseJson, '$.data[0].code'),
                                JSON_VALUE(@LookupResponseJson, '$.code')
                            );
                    END;

                    IF @LookupResponseCode = N'INVALID_TOKEN'
                       AND @Attempt < @MaxAttempts
                    BEGIN
                        EXEC Jobcard.dbo.zoho_key_refresh;
                        SET @Attempt += 1;
                        CONTINUE;
                    END;

                    BREAK;
                END;

                IF @LookupHttpStatus BETWEEN 200 AND 299
                   AND @ZohoIncidentNo IS NOT NULL
                BEGIN
                    UPDATE dbo.DispatchIncidents
                    SET zoho_ob = @ZohoIncidentNo
                    WHERE id = @DispatchId;
                END;
            END
            ELSE IF @OperatorNameOnly = 0
            BEGIN
                UPDATE dbo.DispatchIncidents
                SET
                    ZohoId = @ReturnedZohoId,
                    ZohoUpdate = 0
                WHERE id = @DispatchId;
            END;

            SELECT
                CASE
                    WHEN @Action = 'create' AND @ZohoIncidentNo IS NULL
                        THEN N'partial_success'
                    ELSE N'success'
                END AS [status],
                @DispatchId AS dispatch_id,
                @Action AS zoho_action,
                @OperatorNameOnly AS operator_name_only,
                @HttpStatus AS http_status,
                @ReturnedZohoId AS zoho_id,
                @ZohoIncidentNo AS zoho_incident_no,
                @LookupHttpStatus AS zoho_lookup_http_status,
                @LookupResponseCode AS zoho_lookup_code,
                @ResponseCode AS zoho_code,
                @ResponseMessage AS zoho_message,
                @ResponseJson AS zoho_response,
                @LookupResponseJson AS zoho_lookup_response;
        END
        ELSE
        BEGIN
            /* Keep ZohoUpdate unchanged so the record remains eligible for retry. */
            SELECT
                N'failed' AS [status],
                @DispatchId AS dispatch_id,
                @Action AS zoho_action,
                @OperatorNameOnly AS operator_name_only,
                @HttpStatus AS http_status,
                @ResponseCode AS zoho_code,
                @ResponseMessage AS zoho_message,
                @ResponseJson AS zoho_response;
        END;

        EXEC sys.sp_releaseapplock
            @Resource = N'DispatchLink_PushZoho',
            @LockOwner = N'Session';
        SET @LockAcquired = 0;
    END TRY
    BEGIN CATCH
        IF @HttpObject IS NOT NULL
        BEGIN
            EXEC sys.sp_OADestroy @HttpObject;
            SET @HttpObject = NULL;
        END;

        IF @LockAcquired = 1
        BEGIN
            EXEC sys.sp_releaseapplock
                @Resource = N'DispatchLink_PushZoho',
                @LockOwner = N'Session';
        END;

        THROW;
    END CATCH;
END;
GO
