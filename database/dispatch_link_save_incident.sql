-- Deploy this procedure before serving api/save_incident.sql.
CREATE OR ALTER PROCEDURE dbo.DispatchLink_SaveIncident
    @input_id NVARCHAR(MAX) = NULL,
    @input_trailerApplicable NVARCHAR(MAX) = NULL,
    @input_stockApplicable NVARCHAR(MAX) = NULL,
    @input_noVisibleDamages NVARCHAR(MAX) = NULL,
    @input_damageNotes NVARCHAR(MAX) = NULL,
    @input_vehicleMake NVARCHAR(MAX) = NULL,
    @input_vehicleModel NVARCHAR(MAX) = NULL,
    @input_vehicleColour NVARCHAR(MAX) = NULL,
    @input_vehicleBranding NVARCHAR(MAX) = NULL,
    @input_trailerType NVARCHAR(MAX) = NULL,
    @input_trailerBranding NVARCHAR(MAX) = NULL,
    @input_operatorNotesText NVARCHAR(MAX) = NULL,
    @input_communicationLogJson NVARCHAR(MAX) = NULL,
    @input_deletedCommunicationLogIds NVARCHAR(MAX) = NULL,
    @input_riskEventReference NVARCHAR(MAX) = NULL,
    @input_eventDateTime NVARCHAR(MAX) = NULL,
    @input_event NVARCHAR(MAX) = NULL,
    @input_unitId NVARCHAR(MAX) = NULL,
    @input_regNo NVARCHAR(MAX) = NULL,
    @input_company NVARCHAR(MAX) = NULL,
    @input_fleetCode NVARCHAR(MAX) = NULL,
    @input_latitude NVARCHAR(MAX) = NULL,
    @input_longitude NVARCHAR(MAX) = NULL,
    @input_geoLocation NVARCHAR(MAX) = NULL,
    @input_driverName NVARCHAR(MAX) = NULL,
    @input_driverContactNumber NVARCHAR(MAX) = NULL,
    @input_groundTeamDetails NVARCHAR(MAX) = NULL,
    @input_dispatchReason NVARCHAR(MAX) = NULL,
    @input_session NVARCHAR(MAX) = NULL,
    @input_username NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    
    DECLARE @id INT = TRY_CAST(NULLIF(@input_id, '') AS INT);
    DECLARE @username NVARCHAR(200) = @input_username;
    DECLARE @status NVARCHAR(50) = 'ok';
    DECLARE @message NVARCHAR(MAX) = NULL;
    DECLARE @details NVARCHAR(MAX) = NULL;
    DECLARE @meta NVARCHAR(MAX);
    DECLARE @operatorNotes NVARCHAR(MAX);
    DECLARE @communicationLogJson NVARCHAR(MAX) = COALESCE(NULLIF(@input_communicationLogJson, ''), '[]');
    DECLARE @deletedCommunicationLogIds NVARCHAR(MAX) = COALESCE(NULLIF(@input_deletedCommunicationLogIds, ''), '');
    
    DECLARE @validationMessages TABLE (
        MessageID INT IDENTITY(1, 1) PRIMARY KEY,
        Message NVARCHAR(400) NOT NULL
    );
    
    DECLARE @communicationRows TABLE (
        RowNumber INT NOT NULL,
        CommunicationLogID INT NULL,
        CommunicationDateText NVARCHAR(50) NULL,
        CommunicationTimeText NVARCHAR(50) NULL,
        CommunicationDate DATE NULL,
        CommunicationTime TIME(0) NULL,
        CommunicationType VARCHAR(50) NULL,
        ControlRoomAgent VARCHAR(100) NULL,
        ContactPerson VARCHAR(150) NULL,
        ContactNumber VARCHAR(50) NULL,
        EmailAddress VARCHAR(255) NULL,
        CommunicationNotes NVARCHAR(MAX) NULL
    );
    
    SELECT @meta = (
        SELECT
            CASE WHEN @input_trailerApplicable IN ('1', 'true', 'on') THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS trailerApplicable,
            CASE WHEN @input_stockApplicable IN ('1', 'true', 'on') THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS stockApplicable,
            CASE WHEN @input_noVisibleDamages IN ('1', 'true', 'on') THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS noVisibleDamages,
            COALESCE(@input_damageNotes, '') AS damageNotes,
            COALESCE(@input_vehicleMake, '') AS vehicleMake,
            COALESCE(@input_vehicleModel, '') AS vehicleModel,
            COALESCE(@input_vehicleColour, '') AS vehicleColour,
            COALESCE(@input_vehicleBranding, '') AS vehicleBranding,
            COALESCE(@input_trailerType, '') AS trailerType,
            COALESCE(@input_trailerBranding, '') AS trailerBranding
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    );
    
    SET @operatorNotes = COALESCE(@input_operatorNotesText, '') + CHAR(10) + CHAR(10) + '[DispatchLinkMeta]' + CHAR(10) + @meta;
    
    IF NOT EXISTS (SELECT 1 FROM Current_session WHERE session_id = @input_session)
    BEGIN
        SET @status = 'unauthorized';
        SET @message = 'You are not authorized to save this dispatch.';
    END;
    
    IF @status = 'ok' AND ISJSON(@communicationLogJson) <> 1
    BEGIN
        INSERT INTO @validationMessages (Message)
        VALUES ('Communication log payload is invalid.');
    END;
    
    IF @status = 'ok' AND ISJSON(@communicationLogJson) = 1
    BEGIN
        INSERT INTO @communicationRows (
            RowNumber,
            CommunicationLogID,
            CommunicationDateText,
            CommunicationTimeText,
            CommunicationDate,
            CommunicationTime,
            CommunicationType,
            ControlRoomAgent,
            ContactPerson,
            ContactNumber,
            EmailAddress,
            CommunicationNotes
        )
        SELECT
            TRY_CAST(j.[key] AS INT) + 1 AS RowNumber,
            TRY_CAST(NULLIF(LTRIM(RTRIM(item.id)), '') AS INT) AS CommunicationLogID,
            NULLIF(LTRIM(RTRIM(item.communicationDate)), '') AS CommunicationDateText,
            NULLIF(LTRIM(RTRIM(item.communicationTime)), '') AS CommunicationTimeText,
            TRY_CONVERT(DATE, NULLIF(LTRIM(RTRIM(item.communicationDate)), '')) AS CommunicationDate,
            TRY_CONVERT(TIME(0), NULLIF(LTRIM(RTRIM(item.communicationTime)), '')) AS CommunicationTime,
            CAST(NULLIF(LTRIM(RTRIM(item.communicationType)), '') AS VARCHAR(50)) AS CommunicationType,
            CAST(NULLIF(LTRIM(RTRIM(item.controlRoomAgent)), '') AS VARCHAR(100)) AS ControlRoomAgent,
            CAST(NULLIF(LTRIM(RTRIM(item.contactPerson)), '') AS VARCHAR(150)) AS ContactPerson,
            CAST(NULLIF(
                REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                    LTRIM(RTRIM(item.contactNumber)) COLLATE Latin1_General_100_BIN2,
                    N' ', N''), NCHAR(160), N''), NCHAR(8239), N''),
                    NCHAR(9), N''), NCHAR(10), N''), NCHAR(13), N''),
                ''
            ) AS VARCHAR(50)) AS ContactNumber,
            CAST(NULLIF(LTRIM(RTRIM(item.emailAddress)), '') AS VARCHAR(255)) AS EmailAddress,
            NULLIF(LTRIM(RTRIM(item.communicationNotes)), '') AS CommunicationNotes
        FROM OPENJSON(@communicationLogJson) j
        CROSS APPLY OPENJSON(j.[value])
        WITH (
            id NVARCHAR(50) '$.id',
            communicationDate NVARCHAR(50) '$.communicationDate',
            communicationTime NVARCHAR(50) '$.communicationTime',
            communicationType NVARCHAR(50) '$.communicationType',
            controlRoomAgent NVARCHAR(100) '$.controlRoomAgent',
            contactPerson NVARCHAR(150) '$.contactPerson',
            contactNumber NVARCHAR(50) '$.contactNumber',
            emailAddress NVARCHAR(255) '$.emailAddress',
            communicationNotes NVARCHAR(MAX) '$.communicationNotes'
        ) AS item;
    
        DELETE FROM @communicationRows
        WHERE CommunicationLogID IS NULL
          AND CommunicationDateText IS NULL
          AND CommunicationTimeText IS NULL
          AND CommunicationType IS NULL
          AND ControlRoomAgent IS NULL
          AND ContactPerson IS NULL
          AND ContactNumber IS NULL
          AND EmailAddress IS NULL
          AND CommunicationNotes IS NULL;
    
        INSERT INTO @validationMessages (Message)
        SELECT 'Communication row ' + CAST(RowNumber AS NVARCHAR(20)) + ': Date is required or invalid.'
        FROM @communicationRows
        WHERE CommunicationDate IS NULL;
    
        INSERT INTO @validationMessages (Message)
        SELECT 'Communication row ' + CAST(RowNumber AS NVARCHAR(20)) + ': Time is required or invalid.'
        FROM @communicationRows
        WHERE CommunicationTime IS NULL;
    
        INSERT INTO @validationMessages (Message)
        SELECT 'Communication row ' + CAST(RowNumber AS NVARCHAR(20)) + ': Communication Type is required.'
        FROM @communicationRows
        WHERE CommunicationType IS NULL;
    
        INSERT INTO @validationMessages (Message)
        SELECT 'Communication row ' + CAST(RowNumber AS NVARCHAR(20)) + ': Communication Type is not valid.'
        FROM @communicationRows
        WHERE CommunicationType IS NOT NULL
          AND CommunicationType NOT IN (
              'Call Made',
              'Call Received',
              'Email Sent',
              'Email Received',
              'SMS Sent',
              'WhatsApp Sent',
              'WhatsApp Received',
              'Radio',
              'Internal Note',
              'Customer Update',
              'Technician Update'
          );
    
        INSERT INTO @validationMessages (Message)
        SELECT 'Communication row ' + CAST(RowNumber AS NVARCHAR(20)) + ': Control Room Agent is required.'
        FROM @communicationRows
        WHERE ControlRoomAgent IS NULL;
    
        INSERT INTO @validationMessages (Message)
        SELECT 'Communication row ' + CAST(RowNumber AS NVARCHAR(20)) + ': Email Address is not valid.'
        FROM @communicationRows
        WHERE EmailAddress IS NOT NULL
          AND (
              EmailAddress LIKE '% %'
              OR EmailAddress NOT LIKE '%_@_%._%'
          );
    
        IF @id IS NULL
           AND EXISTS (SELECT 1 FROM @communicationRows WHERE CommunicationLogID IS NOT NULL)
        BEGIN
            INSERT INTO @validationMessages (Message)
            VALUES ('Communication log rows for a new dispatch cannot reference existing database IDs.');
        END;
    
        IF @id IS NOT NULL
           AND EXISTS (
               SELECT 1
               FROM @communicationRows r
               WHERE r.CommunicationLogID IS NOT NULL
                 AND NOT EXISTS (
                     SELECT 1
                     FROM CC.dbo.DispatchCommunicationLog c
                     WHERE c.CommunicationLogID = r.CommunicationLogID
                       AND c.DispatchID = @id
                 )
           )
        BEGIN
            INSERT INTO @validationMessages (Message)
            VALUES ('One or more communication log rows do not belong to this dispatch.');
        END;
    END;
    
    IF EXISTS (SELECT 1 FROM @validationMessages)
    BEGIN
        DECLARE @messagesJson NVARCHAR(MAX);
    
        SELECT @messagesJson = COALESCE(
            '["' + STUFF((
                SELECT '","' + STRING_ESCAPE(Message, 'json')
                FROM @validationMessages
                ORDER BY MessageID
                FOR XML PATH(''), TYPE
            ).value('.', 'NVARCHAR(MAX)'), 1, 3, '') + '"]',
            '[]'
        );
    
        SET @status = 'validation_error';
        SET @message = 'Communication log validation failed.';
        SELECT @details = (
            SELECT
                CAST(0 AS bit) AS isValid,
                JSON_QUERY(@messagesJson) AS missingFields,
                JSON_QUERY('[]') AS missingPhotos
            FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
        );
    END;
    
    IF @status = 'ok'
       AND @id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM CC.dbo.DispatchIncidents WHERE id = @id AND ISNULL(isdeleted, 0) = 0)
    BEGIN
        SET @status = 'not_found';
        SET @message = 'Dispatch incident was not found.';
    END;
    
    IF @status = 'ok'
       AND @id IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM CC.dbo.DispatchIncidents
           WHERE id = @id
             AND ISNULL(isdeleted, 0) = 0
             AND Status IN ('Draft', 'Rejected')
       )
    BEGIN
        SET @status = 'locked_status';
        SET @message = 'Dispatch incident cannot be edited in its current status.';
    END;
    
    IF @status = 'ok'
    BEGIN
        BEGIN TRY
            SET XACT_ABORT ON;
            BEGIN TRANSACTION;
    
            IF @id IS NULL
            BEGIN
                INSERT INTO CC.dbo.DispatchIncidents (
                    IncidentNumber,
                    RiskEventReference,
                    EventDateTime,
                    Event,
                    UnitId,
                    RegNo,
                    Company,
                    FleetCode,
                    Latitude,
                    Longitude,
                    GeoLocation,
                    DriverName,
                    DriverContactNumber,
                    GroundTeamDetails,
                    DispatchReason,
                    OperatorNotes,
                    Status,
                    CreatedBy,
                    CreatedAt,
                    UpdatedBy,
                    UpdatedAt,
                    isdeleted,
                    zoho_update
                )
                VALUES (
                    NULL,
                    NULLIF(@input_riskEventReference, ''),
                    TRY_CONVERT(DATETIME2, NULLIF(@input_eventDateTime, '')),
                    NULLIF(@input_event, ''),
                    NULLIF(@input_unitId, ''),
                    NULLIF(@input_regNo, ''),
                    NULLIF(@input_company, ''),
                    NULLIF(@input_fleetCode, ''),
                    NULLIF(@input_latitude, ''),
                    NULLIF(@input_longitude, ''),
                    NULLIF(@input_geoLocation, ''),
                    NULLIF(@input_driverName, ''),
                    NULLIF(@input_driverContactNumber, ''),
                    NULLIF(@input_groundTeamDetails, ''),
                    NULLIF(@input_dispatchReason, ''),
                    @operatorNotes,
                    'Draft',
                    @username,
                    SYSDATETIME(),
                    @username,
                    SYSDATETIME(),
                    0,
                    0
                );
    
                SET @id = SCOPE_IDENTITY();
    
                UPDATE CC.dbo.DispatchIncidents
                SET IncidentNumber = 'DL-' + RIGHT('000000' + CAST(@id AS NVARCHAR(20)), 6)
                WHERE id = @id;
    
                INSERT INTO CC.dbo.DispatchAuditLog (dispatch_id, AuditAction, NewStatus, AuditMessage, AuditUsername, CreatedAt)
                VALUES (@id, 'Incident created', 'Draft', 'Draft created from Dispatch Link.', @username, SYSDATETIME());
            END
            ELSE
            BEGIN
                UPDATE CC.dbo.DispatchIncidents
                SET
                    RiskEventReference = NULLIF(@input_riskEventReference, ''),
                    EventDateTime = TRY_CONVERT(DATETIME2, NULLIF(@input_eventDateTime, '')),
                    Event = NULLIF(@input_event, ''),
                    UnitId = NULLIF(@input_unitId, ''),
                    RegNo = NULLIF(@input_regNo, ''),
                    Company = NULLIF(@input_company, ''),
                    FleetCode = NULLIF(@input_fleetCode, ''),
                    Latitude = NULLIF(@input_latitude, ''),
                    Longitude = NULLIF(@input_longitude, ''),
                    GeoLocation = NULLIF(@input_geoLocation, ''),
                    DriverName = NULLIF(@input_driverName, ''),
                    DriverContactNumber = NULLIF(@input_driverContactNumber, ''),
                    GroundTeamDetails = NULLIF(@input_groundTeamDetails, ''),
                    DispatchReason = NULLIF(@input_dispatchReason, ''),
                    OperatorNotes = @operatorNotes,
                    UpdatedBy = @username,
                    UpdatedAt = SYSDATETIME()
                WHERE id = @id
                  AND ISNULL(isdeleted, 0) = 0
                  AND Status IN ('Draft', 'Rejected');
    
                INSERT INTO CC.dbo.DispatchAuditLog (dispatch_id, AuditAction, AuditMessage, AuditUsername, CreatedAt)
                VALUES (@id, 'Incident updated', 'Draft updated from Dispatch Link.', @username, SYSDATETIME());
            END;
    
            ;WITH deleted_ids AS (
                SELECT DISTINCT TRY_CAST(NULLIF(LTRIM(RTRIM(value)), '') AS INT) AS CommunicationLogID
                FROM STRING_SPLIT(@deletedCommunicationLogIds, ',')
                WHERE TRY_CAST(NULLIF(LTRIM(RTRIM(value)), '') AS INT) IS NOT NULL
            )
            DELETE c
            FROM CC.dbo.DispatchCommunicationLog c
            INNER JOIN deleted_ids d
                ON d.CommunicationLogID = c.CommunicationLogID
            WHERE c.DispatchID = @id;
    
            UPDATE c
            SET
                CommunicationDate = r.CommunicationDate,
                CommunicationTime = r.CommunicationTime,
                CommunicationType = r.CommunicationType,
                ControlRoomAgent = r.ControlRoomAgent,
                ContactPerson = r.ContactPerson,
                ContactNumber = r.ContactNumber,
                EmailAddress = r.EmailAddress,
                CommunicationNotes = r.CommunicationNotes,
                ModifiedDate = SYSDATETIME(),
                ModifiedBy = LEFT(CAST(@username AS VARCHAR(200)), 100)
            FROM CC.dbo.DispatchCommunicationLog c
            INNER JOIN @communicationRows r
                ON r.CommunicationLogID = c.CommunicationLogID
            WHERE c.DispatchID = @id
              AND r.CommunicationLogID IS NOT NULL;
    
            INSERT INTO CC.dbo.DispatchCommunicationLog (
                DispatchID,
                CommunicationDate,
                CommunicationTime,
                CommunicationType,
                ControlRoomAgent,
                ContactPerson,
                ContactNumber,
                EmailAddress,
                CommunicationNotes,
                CreatedBy
            )
            SELECT
                @id,
                r.CommunicationDate,
                r.CommunicationTime,
                r.CommunicationType,
                r.ControlRoomAgent,
                r.ContactPerson,
                r.ContactNumber,
                r.EmailAddress,
                r.CommunicationNotes,
                LEFT(CAST(@username AS VARCHAR(200)), 100)
            FROM @communicationRows r
            WHERE r.CommunicationLogID IS NULL;
    
            COMMIT TRANSACTION;
        END TRY
        BEGIN CATCH
            IF XACT_STATE() <> 0
            BEGIN
                ROLLBACK TRANSACTION;
            END;
    
            SET @status = 'error';
            SET @message = ERROR_MESSAGE();
        END CATCH;
    END;
    
    SELECT
        @status AS status,
        @id AS id,
        @message AS [message],
        JSON_QUERY(@details) AS details
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;
END;
GO
