-- BEGIN COMPLETED VIEWER ACCESS GUARD
-- This profile may only read completed dispatches, even through a direct API request.
SELECT 'redirect' AS component, '/dispatch_link/public/completed.html' AS link
WHERE EXISTS (
    SELECT 1 FROM Jobcard.dbo.Current_session restricted_session
    JOIN Jobcard.dbo.User_info restricted_user ON restricted_user.Username = restricted_session.Username
    WHERE restricted_user.Usertype = 15
      AND restricted_session.session_id IN (sqlpage.cookie('session'), sqlpage.cookie('session_admin'),
          sqlpage.cookie('session_tech'), sqlpage.cookie('session_inspect'),
          sqlpage.cookie('session_reload'), sqlpage.cookie('session_checklist'))
);
-- END COMPLETED VIEWER ACCESS GUARD

-- SQLPage 0.25-compatible endpoint: create or update a Dispatch Incident draft.
-- Used when dispatch_metadata.additionalAssetsEnabled is false. Keep core
-- behavior aligned with ../save_incident.sql, excluding additional-asset columns.
-- SQLPage parses each ordinary statement independently, so this file intentionally
-- avoids DECLARE, IF, BEGIN/END, EXEC, transactions, and INSERT OUTPUT.

UPDATE incident
SET
    EventDateTime = TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:eventDateTime, ''), 'T', ' '), 120),
    Event = NULLIF(:event, ''),
    ETA = CASE WHEN :eta IS NULL THEN incident.ETA ELSE NULLIF(LTRIM(RTRIM(:eta)), N'') END,
    DispatchReason = NULLIF(:dispatchReason, ''),
    ActualDispatchReason = CASE WHEN :actualDispatchReason IS NULL THEN incident.ActualDispatchReason ELSE NULLIF(LTRIM(RTRIM(:actualDispatchReason)) COLLATE Latin1_General_100_BIN2, N'') END,
    PositiveVESA = CASE WHEN :positiveVesa IS NULL THEN incident.PositiveVESA ELSE NULLIF(LTRIM(RTRIM(:positiveVesa)), N'') END,
    IncidentNotesHtml = NULLIF(:incidentNotesHtml, ''),
    RiskEventReference = NULLIF(:riskEventReference, ''),
    RegNo = NULLIF(:regNo, ''),
    UnitId = NULLIF(:unitId, ''),
    Company = NULLIF(:company, ''),
    ZohoAccount = NULLIF(:zohoAccount, ''),
    FleetCode = NULLIF(:fleetCode, ''),
    StockNumberWrc = NULLIF(:stockNumberWrc, ''),
    TrailerRegistration1 = NULLIF(:trailerRegistration1, ''),
    TrailerRegistration2 = NULLIF(:trailerRegistration2, ''),
    VehicleMake = NULLIF(:vehicleMake, ''),
    VehicleModel = NULLIF(:vehicleModel, ''),
    VehicleColour = NULLIF(:vehicleColour, ''),
    VehicleBranding = NULLIF(:vehicleBranding, ''),
    TrailerType = NULLIF(:trailerType, ''),
    TrailerBranding = NULLIF(:trailerBranding, ''),
    GeoLocation = NULLIF(:geoLocation, ''),
    Latitude = TRY_CONVERT(decimal(9,6), NULLIF(UPPER(LTRIM(RTRIM(:latitude))), 'N/A')),
    Longitude = TRY_CONVERT(decimal(9,6), NULLIF(UPPER(LTRIM(RTRIM(:longitude))), 'N/A')),
    ClientName = NULLIF(:clientName, ''),
    ClientContactNumber = NULLIF(:clientContactNumber, ''),
    ClientPO = NULLIF(:clientPo, ''),
    DLNumber = NULLIF(:dlNumber, ''),
    DriverName = NULLIF(:driverName, ''),
    DriverContactNumber = NULLIF(:driverContactNumber, ''),
    DispatchTeam = NULLIF(:dispatchTeam, ''),
    DispatchDateTime = TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:dispatchDateTime, ''), 'T', ' '), 120),
    OBNumber = NULLIF(:obNumber, ''),
    StandDownDateTime = TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:standDownDateTime, ''), 'T', ' '), 120),
    VehicleRecovered = NULLIF(:vehicleRecovered, ''),
    RecoveryDateTime = TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:recoveryDateTime, ''), 'T', ' '), 120),
    LoadRecovered = NULLIF(:loadRecovered, ''),
    VehicleKeyAvailable = NULLIF(:vehicleKeyAvailable, ''),
    TrailersRecovered = NULLIF(:trailersRecovered, ''),
    DriverOnScene = NULLIF(:driverOnScene, ''),
    TrackingUnitStatus = NULLIF(:trackingUnitStatus, ''),
    TrailerApplicable = CASE WHEN LOWER(COALESCE(:trailerApplicable, '')) IN ('1', 'true', 'yes', 'on') THEN 1 ELSE 0 END,
    StockApplicable = CASE WHEN LOWER(COALESCE(:stockApplicable, '')) IN ('1', 'true', 'yes', 'on') THEN 1 ELSE 0 END,
    NoVisibleDamages = CASE WHEN LOWER(COALESCE(:noVisibleDamages, '')) IN ('1', 'true', 'yes', 'on') THEN 1 ELSE 0 END,
    DamageNotes = NULLIF(:damageNotes, ''),
    GroundTeamDetails = NULLIF(:groundTeamDetails, ''),
    OperatorNotesText = NULLIF(
        COALESCE(:operatorNotesText, '')
        + CASE
            WHEN LOWER(COALESCE(:vehicleHistoryUnavailable, '')) IN ('1', 'true', 'yes', 'on')
                THEN CHAR(10) + CHAR(10) + N'[VehicleHistoryUnavailable]' + LTRIM(RTRIM(:vehicleHistoryUnavailableReason))
            ELSE N''
          END,
        ''
    ),
    UpdatedBy = COALESCE(NULLIF((
        SELECT TOP (1) CAST(Username AS nvarchar(128))
        FROM Current_session
        WHERE session_id = sqlpage.cookie('session')
    ), ''), 'SQLPage'),
    UpdatedAt = SYSDATETIME()
FROM CC.dbo.DispatchIncidents incident
WHERE incident.id = TRY_CONVERT(int, NULLIF(:id, ''))
  AND incident.IsDeleted = 0
  AND incident.Status IN ('Draft', 'Rejected', 'PendingApproval')
  AND incident.DispatchStatus NOT IN ('Closed', 'Cancelled')
  AND TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:eventDateTime, ''), 'T', ' '), 120) IS NOT NULL
  AND NULLIF(:event, '') IS NOT NULL
  -- Drafts may omit these values; supplied values must be valid.
  AND DATALENGTH(COALESCE(LTRIM(RTRIM(:actualDispatchReason)), N'')) <= 2000
  AND (
      NULLIF(LTRIM(RTRIM(:positiveVesa)), N'') IS NULL
      OR LTRIM(RTRIM(:positiveVesa)) COLLATE Latin1_General_100_BIN2 IN (N'Hijacked', N'Stolen', N'No')
  )
  AND (NULLIF(LTRIM(RTRIM(:latitude)), '') IS NULL OR UPPER(LTRIM(RTRIM(:latitude))) = 'N/A' OR TRY_CONVERT(decimal(9,6), :latitude) IS NOT NULL)
  AND (NULLIF(LTRIM(RTRIM(:longitude)), '') IS NULL OR UPPER(LTRIM(RTRIM(:longitude))) = 'N/A' OR TRY_CONVERT(decimal(9,6), :longitude) IS NOT NULL)
  AND (UPPER(LTRIM(RTRIM(:latitude))) = 'N/A' OR TRY_CONVERT(decimal(9,6), :latitude) IS NULL OR TRY_CONVERT(decimal(9,6), :latitude) BETWEEN -90 AND 90)
  AND (UPPER(LTRIM(RTRIM(:longitude))) = 'N/A' OR TRY_CONVERT(decimal(9,6), :longitude) IS NULL OR TRY_CONVERT(decimal(9,6), :longitude) BETWEEN -180 AND 180)
  AND (
      LOWER(COALESCE(:vehicleHistoryUnavailable, '')) NOT IN ('1', 'true', 'yes', 'on')
      OR (
          NULLIF(LTRIM(RTRIM(:vehicleHistoryUnavailableReason)), '') IS NOT NULL
          AND LEN(LTRIM(RTRIM(:vehicleHistoryUnavailableReason))) <= 500
          AND LTRIM(RTRIM(:trackingUnitStatus)) = N'Not fitted with Pulsit Tracking'
          AND NOT (
              EXISTS (
                  SELECT 1 FROM Risk.dbo.unitinfo unit_row
                  WHERE UPPER(LTRIM(RTRIM(unit_row.reg_no))) = UPPER(LTRIM(RTRIM(:regNo)))
                    AND LOWER(LTRIM(RTRIM(COALESCE(unit_row.ctrltype, N'')))) <> N'lmu ir'
              )
              AND EXISTS (
                  SELECT 1 FROM Risk.dbo.vehicleinfo vehicle_row
                  WHERE UPPER(LTRIM(RTRIM(vehicle_row.reg_no))) = UPPER(LTRIM(RTRIM(:regNo)))
              )
          )
      )
  )
  AND NOT EXISTS (
      SELECT 1
      FROM CC.dbo.DispatchTeams quota_team
      WHERE quota_team.IsActive = 1
        AND quota_team.MonthlyDispatchLimit IS NOT NULL
        AND LOWER(LTRIM(RTRIM(quota_team.TeamName))) = LOWER(LTRIM(RTRIM(NULLIF(:dispatchTeam, ''))))
        AND TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:dispatchDateTime, ''), 'T', ' '), 120) IS NOT NULL
        AND (
            SELECT COUNT(DISTINCT quota_incident.id)
            FROM CC.dbo.DispatchIncidents quota_incident
            WHERE quota_incident.IsDeleted = 0
              AND quota_incident.id <> incident.id
              AND (
                  LOWER(LTRIM(RTRIM(quota_incident.DispatchTeam))) = LOWER(LTRIM(RTRIM(quota_team.TeamName)))
                  OR (
                      LOWER(LTRIM(RTRIM(quota_team.TeamName))) = N'matrix'
                      AND LOWER(LTRIM(RTRIM(quota_incident.DispatchTeam))) = N'rentrak'
                  )
              )
              AND quota_incident.DispatchDateTime >= DATEFROMPARTS(
                    YEAR(TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:dispatchDateTime, ''), 'T', ' '), 120)),
                    MONTH(TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:dispatchDateTime, ''), 'T', ' '), 120)),
                    1
                  )
              AND quota_incident.DispatchDateTime < DATEADD(month, 1, DATEFROMPARTS(
                    YEAR(TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:dispatchDateTime, ''), 'T', ' '), 120)),
                    MONTH(TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:dispatchDateTime, ''), 'T', ' '), 120)),
                    1
                  ))
        ) >= quota_team.MonthlyDispatchLimit
  )
  AND EXISTS (
      SELECT 1
      FROM Current_session
      WHERE session_id = sqlpage.cookie('session')
  );

INSERT INTO CC.dbo.DispatchIncidents
(
    SaveRequestId, EventDateTime, Event, ETA, DispatchReason, ActualDispatchReason, PositiveVESA, DispatchCaptureVersion, IncidentNotesHtml, RiskEventReference,
    RegNo, UnitId, Company, ZohoAccount, FleetCode, StockNumberWrc, TrailerRegistration1, TrailerRegistration2,
    VehicleMake, VehicleModel, VehicleColour, VehicleBranding, TrailerType, TrailerBranding,
    GeoLocation, Latitude, Longitude, ClientName, ClientContactNumber, ClientPO, DLNumber,
    DriverName, DriverContactNumber, DispatchTeam, DispatchDateTime, OBNumber, StandDownDateTime,
    VehicleRecovered, RecoveryDateTime, LoadRecovered, VehicleKeyAvailable, TrailersRecovered, DriverOnScene, TrackingUnitStatus,
    TrailerApplicable, StockApplicable, NoVisibleDamages, DamageNotes, GroundTeamDetails, OperatorNotesText,
    Status, CreatedBy, UpdatedBy
)
SELECT
    NULLIF(:saveRequestId, ''),
    TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:eventDateTime, ''), 'T', ' '), 120),
    NULLIF(:event, ''),
    NULLIF(:eta, ''),
    NULLIF(:dispatchReason, ''),
    NULLIF(LTRIM(RTRIM(:actualDispatchReason)) COLLATE Latin1_General_100_BIN2, N''),
    NULLIF(LTRIM(RTRIM(:positiveVesa)), N''),
    1,
    NULLIF(:incidentNotesHtml, ''),
    NULLIF(:riskEventReference, ''),
    NULLIF(:regNo, ''),
    NULLIF(:unitId, ''),
    NULLIF(:company, ''),
    NULLIF(:zohoAccount, ''),
    NULLIF(:fleetCode, ''),
    NULLIF(:stockNumberWrc, ''),
    NULLIF(:trailerRegistration1, ''),
    NULLIF(:trailerRegistration2, ''),
    NULLIF(:vehicleMake, ''),
    NULLIF(:vehicleModel, ''),
    NULLIF(:vehicleColour, ''),
    NULLIF(:vehicleBranding, ''),
    NULLIF(:trailerType, ''),
    NULLIF(:trailerBranding, ''),
    NULLIF(:geoLocation, ''),
    TRY_CONVERT(decimal(9,6), NULLIF(UPPER(LTRIM(RTRIM(:latitude))), 'N/A')),
    TRY_CONVERT(decimal(9,6), NULLIF(UPPER(LTRIM(RTRIM(:longitude))), 'N/A')),
    NULLIF(:clientName, ''),
    NULLIF(:clientContactNumber, ''),
    NULLIF(:clientPo, ''),
    NULLIF(:dlNumber, ''),
    NULLIF(:driverName, ''),
    NULLIF(:driverContactNumber, ''),
    NULLIF(:dispatchTeam, ''),
    TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:dispatchDateTime, ''), 'T', ' '), 120),
    NULLIF(:obNumber, ''),
    TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:standDownDateTime, ''), 'T', ' '), 120),
    NULLIF(:vehicleRecovered, ''),
    TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:recoveryDateTime, ''), 'T', ' '), 120),
    NULLIF(:loadRecovered, ''),
    NULLIF(:vehicleKeyAvailable, ''),
    NULLIF(:trailersRecovered, ''),
    NULLIF(:driverOnScene, ''),
    NULLIF(:trackingUnitStatus, ''),
    CASE WHEN LOWER(COALESCE(:trailerApplicable, '')) IN ('1', 'true', 'yes', 'on') THEN 1 ELSE 0 END,
    CASE WHEN LOWER(COALESCE(:stockApplicable, '')) IN ('1', 'true', 'yes', 'on') THEN 1 ELSE 0 END,
    CASE WHEN LOWER(COALESCE(:noVisibleDamages, '')) IN ('1', 'true', 'yes', 'on') THEN 1 ELSE 0 END,
    NULLIF(:damageNotes, ''),
    NULLIF(:groundTeamDetails, ''),
    NULLIF(
        COALESCE(:operatorNotesText, '')
        + CASE
            WHEN LOWER(COALESCE(:vehicleHistoryUnavailable, '')) IN ('1', 'true', 'yes', 'on')
                THEN CHAR(10) + CHAR(10) + N'[VehicleHistoryUnavailable]' + LTRIM(RTRIM(:vehicleHistoryUnavailableReason))
            ELSE N''
          END,
        ''
    ),
    'Draft',
    COALESCE(NULLIF((
        SELECT TOP (1) CAST(Username AS nvarchar(128))
        FROM Current_session
        WHERE session_id = sqlpage.cookie('session')
    ), ''), 'SQLPage'),
    COALESCE(NULLIF((
        SELECT TOP (1) CAST(Username AS nvarchar(128))
        FROM Current_session
        WHERE session_id = sqlpage.cookie('session')
    ), ''), 'SQLPage')
WHERE NULLIF(:id, '') IS NULL
  AND NULLIF(:saveRequestId, '') IS NOT NULL
  AND TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:eventDateTime, ''), 'T', ' '), 120) IS NOT NULL
  AND NULLIF(:event, '') IS NOT NULL
  -- Drafts may omit these values; supplied values must be valid.
  AND DATALENGTH(COALESCE(LTRIM(RTRIM(:actualDispatchReason)), N'')) <= 2000
  AND (
      NULLIF(LTRIM(RTRIM(:positiveVesa)), N'') IS NULL
      OR LTRIM(RTRIM(:positiveVesa)) COLLATE Latin1_General_100_BIN2 IN (N'Hijacked', N'Stolen', N'No')
  )
  AND (NULLIF(LTRIM(RTRIM(:latitude)), '') IS NULL OR UPPER(LTRIM(RTRIM(:latitude))) = 'N/A' OR TRY_CONVERT(decimal(9,6), :latitude) IS NOT NULL)
  AND (NULLIF(LTRIM(RTRIM(:longitude)), '') IS NULL OR UPPER(LTRIM(RTRIM(:longitude))) = 'N/A' OR TRY_CONVERT(decimal(9,6), :longitude) IS NOT NULL)
  AND (UPPER(LTRIM(RTRIM(:latitude))) = 'N/A' OR TRY_CONVERT(decimal(9,6), :latitude) IS NULL OR TRY_CONVERT(decimal(9,6), :latitude) BETWEEN -90 AND 90)
  AND (UPPER(LTRIM(RTRIM(:longitude))) = 'N/A' OR TRY_CONVERT(decimal(9,6), :longitude) IS NULL OR TRY_CONVERT(decimal(9,6), :longitude) BETWEEN -180 AND 180)
  AND (
      LOWER(COALESCE(:vehicleHistoryUnavailable, '')) NOT IN ('1', 'true', 'yes', 'on')
      OR (
          NULLIF(LTRIM(RTRIM(:vehicleHistoryUnavailableReason)), '') IS NOT NULL
          AND LEN(LTRIM(RTRIM(:vehicleHistoryUnavailableReason))) <= 500
          AND LTRIM(RTRIM(:trackingUnitStatus)) = N'Not fitted with Pulsit Tracking'
          AND NOT (
              EXISTS (
                  SELECT 1 FROM Risk.dbo.unitinfo unit_row
                  WHERE UPPER(LTRIM(RTRIM(unit_row.reg_no))) = UPPER(LTRIM(RTRIM(:regNo)))
                    AND LOWER(LTRIM(RTRIM(COALESCE(unit_row.ctrltype, N'')))) <> N'lmu ir'
              )
              AND EXISTS (
                  SELECT 1 FROM Risk.dbo.vehicleinfo vehicle_row
                  WHERE UPPER(LTRIM(RTRIM(vehicle_row.reg_no))) = UPPER(LTRIM(RTRIM(:regNo)))
              )
          )
      )
  )
  AND NOT EXISTS (
      SELECT 1
      FROM CC.dbo.DispatchTeams quota_team
      WHERE quota_team.IsActive = 1
        AND quota_team.MonthlyDispatchLimit IS NOT NULL
        AND LOWER(LTRIM(RTRIM(quota_team.TeamName))) = LOWER(LTRIM(RTRIM(NULLIF(:dispatchTeam, ''))))
        AND TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:dispatchDateTime, ''), 'T', ' '), 120) IS NOT NULL
        AND (
            SELECT COUNT(DISTINCT quota_incident.id)
            FROM CC.dbo.DispatchIncidents quota_incident
            WHERE quota_incident.IsDeleted = 0
              AND (
                  LOWER(LTRIM(RTRIM(quota_incident.DispatchTeam))) = LOWER(LTRIM(RTRIM(quota_team.TeamName)))
                  OR (
                      LOWER(LTRIM(RTRIM(quota_team.TeamName))) = N'matrix'
                      AND LOWER(LTRIM(RTRIM(quota_incident.DispatchTeam))) = N'rentrak'
                  )
              )
              AND quota_incident.DispatchDateTime >= DATEFROMPARTS(
                    YEAR(TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:dispatchDateTime, ''), 'T', ' '), 120)),
                    MONTH(TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:dispatchDateTime, ''), 'T', ' '), 120)),
                    1
                  )
              AND quota_incident.DispatchDateTime < DATEADD(month, 1, DATEFROMPARTS(
                    YEAR(TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:dispatchDateTime, ''), 'T', ' '), 120)),
                    MONTH(TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:dispatchDateTime, ''), 'T', ' '), 120)),
                    1
                  ))
        ) >= quota_team.MonthlyDispatchLimit
  )
  AND EXISTS (
      SELECT 1
      FROM Current_session
      WHERE session_id = sqlpage.cookie('session')
  )
  AND NOT EXISTS (
      SELECT 1
      FROM CC.dbo.DispatchIncidents
      WHERE SaveRequestId = NULLIF(:saveRequestId, '')
  );

UPDATE CC.dbo.DispatchIncidents
SET IncidentNumber = 'DL-' + RIGHT('000000' + CAST(id AS nvarchar(20)), 6)
WHERE SaveRequestId = NULLIF(:saveRequestId, '')
  AND IncidentNumber IS NULL;

-- Use SQLPage's JSON component so a successful INSERT/UPDATE cannot leave the
-- browser with an HTML/table response instead of the JSON save result.
SELECT
    'json' AS component,
    (
        SELECT
            CAST(CASE
                WHEN NOT EXISTS (
                    SELECT 1 FROM Current_session
                    WHERE session_id = sqlpage.cookie('session')
                ) THEN 'unauthorized'
                WHEN TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:eventDateTime, ''), 'T', ' '), 120) IS NULL THEN 'validation_error'
                WHEN NULLIF(:event, '') IS NULL THEN 'validation_error'
                WHEN DATALENGTH(COALESCE(LTRIM(RTRIM(:actualDispatchReason)), N'')) > 2000 THEN 'validation_error'
                WHEN NULLIF(LTRIM(RTRIM(:positiveVesa)), N'') IS NOT NULL
                     AND LTRIM(RTRIM(:positiveVesa)) COLLATE Latin1_General_100_BIN2 NOT IN (N'Hijacked', N'Stolen', N'No') THEN 'validation_error'
                WHEN LOWER(COALESCE(:vehicleHistoryUnavailable, '')) IN ('1', 'true', 'yes', 'on')
                     AND (
                         NULLIF(LTRIM(RTRIM(:vehicleHistoryUnavailableReason)), '') IS NULL
                         OR LEN(LTRIM(RTRIM(:vehicleHistoryUnavailableReason))) > 500
                     ) THEN 'validation_error'
                WHEN LOWER(COALESCE(:vehicleHistoryUnavailable, '')) IN ('1', 'true', 'yes', 'on')
                     AND COALESCE(LTRIM(RTRIM(:trackingUnitStatus)), N'') <> N'Not fitted with Pulsit Tracking'
                    THEN 'validation_error'
                WHEN LOWER(COALESCE(:vehicleHistoryUnavailable, '')) IN ('1', 'true', 'yes', 'on')
                     AND EXISTS (
                         SELECT 1 FROM Risk.dbo.unitinfo unit_row
                         WHERE UPPER(LTRIM(RTRIM(unit_row.reg_no))) = UPPER(LTRIM(RTRIM(:regNo)))
                           AND LOWER(LTRIM(RTRIM(COALESCE(unit_row.ctrltype, N'')))) <> N'lmu ir'
                     )
                     AND EXISTS (
                         SELECT 1 FROM Risk.dbo.vehicleinfo vehicle_row
                         WHERE UPPER(LTRIM(RTRIM(vehicle_row.reg_no))) = UPPER(LTRIM(RTRIM(:regNo)))
                     ) THEN 'validation_error'
                WHEN NULLIF(LTRIM(RTRIM(:latitude)), '') IS NOT NULL AND UPPER(LTRIM(RTRIM(:latitude))) <> 'N/A' AND TRY_CONVERT(decimal(9,6), :latitude) IS NULL THEN 'validation_error'
                WHEN NULLIF(LTRIM(RTRIM(:longitude)), '') IS NOT NULL AND UPPER(LTRIM(RTRIM(:longitude))) <> 'N/A' AND TRY_CONVERT(decimal(9,6), :longitude) IS NULL THEN 'validation_error'
                WHEN UPPER(LTRIM(RTRIM(:latitude))) <> 'N/A' AND TRY_CONVERT(decimal(9,6), :latitude) IS NOT NULL AND TRY_CONVERT(decimal(9,6), :latitude) NOT BETWEEN -90 AND 90 THEN 'validation_error'
                WHEN UPPER(LTRIM(RTRIM(:longitude))) <> 'N/A' AND TRY_CONVERT(decimal(9,6), :longitude) IS NOT NULL AND TRY_CONVERT(decimal(9,6), :longitude) NOT BETWEEN -180 AND 180 THEN 'validation_error'
                WHEN NULLIF(:id, '') IS NOT NULL AND TRY_CONVERT(int, :id) IS NULL THEN 'validation_error'
                WHEN NULLIF(:id, '') IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM CC.dbo.DispatchIncidents
                    WHERE id = TRY_CONVERT(int, :id)
                      AND IsDeleted = 0
                ) THEN 'not_found'
                WHEN NULLIF(:id, '') IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM CC.dbo.DispatchIncidents
                    WHERE id = TRY_CONVERT(int, :id)
                      AND IsDeleted = 0
                      AND Status IN ('Draft', 'Rejected', 'PendingApproval')
                      AND DispatchStatus NOT IN ('Closed', 'Cancelled')
                ) THEN 'locked_status'
                WHEN NULLIF(:id, '') IS NULL AND NULLIF(:saveRequestId, '') IS NULL THEN 'validation_error'
                WHEN EXISTS (
                    SELECT 1
                    FROM CC.dbo.DispatchTeams quota_team
                    WHERE quota_team.IsActive = 1
                      AND quota_team.MonthlyDispatchLimit IS NOT NULL
                      AND LOWER(LTRIM(RTRIM(quota_team.TeamName))) = LOWER(LTRIM(RTRIM(NULLIF(:dispatchTeam, ''))))
                      AND TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:dispatchDateTime, ''), 'T', ' '), 120) IS NOT NULL
                      AND (
                          SELECT COUNT(DISTINCT quota_incident.id)
                          FROM CC.dbo.DispatchIncidents quota_incident
                          WHERE quota_incident.IsDeleted = 0
                            AND (NULLIF(:id, '') IS NULL OR quota_incident.id <> TRY_CONVERT(int, :id))
                            AND (
                                LOWER(LTRIM(RTRIM(quota_incident.DispatchTeam))) = LOWER(LTRIM(RTRIM(quota_team.TeamName)))
                                OR (
                                    LOWER(LTRIM(RTRIM(quota_team.TeamName))) = N'matrix'
                                    AND LOWER(LTRIM(RTRIM(quota_incident.DispatchTeam))) = N'rentrak'
                                )
                            )
                            AND quota_incident.DispatchDateTime >= DATEFROMPARTS(
                                  YEAR(TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:dispatchDateTime, ''), 'T', ' '), 120)),
                                  MONTH(TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:dispatchDateTime, ''), 'T', ' '), 120)),
                                  1
                                )
                            AND quota_incident.DispatchDateTime < DATEADD(month, 1, DATEFROMPARTS(
                                  YEAR(TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:dispatchDateTime, ''), 'T', ' '), 120)),
                                  MONTH(TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:dispatchDateTime, ''), 'T', ' '), 120)),
                                  1
                                ))
                      ) >= quota_team.MonthlyDispatchLimit
                ) THEN 'quota_reached'
                WHEN NULLIF(:id, '') IS NULL AND NOT EXISTS (
                    SELECT 1 FROM CC.dbo.DispatchIncidents
                    WHERE SaveRequestId = NULLIF(:saveRequestId, '')
                ) THEN 'create_failed'
                ELSE 'ok'
            END AS nvarchar(30)) AS [status],
            (
                SELECT TOP (1) id
                FROM CC.dbo.DispatchIncidents
                WHERE (NULLIF(:id, '') IS NOT NULL AND id = TRY_CONVERT(int, :id))
                   OR (NULLIF(:id, '') IS NULL AND SaveRequestId = NULLIF(:saveRequestId, ''))
            ) AS [id],
            (
                SELECT TOP (1) IncidentNumber
                FROM CC.dbo.DispatchIncidents
                WHERE (NULLIF(:id, '') IS NOT NULL AND id = TRY_CONVERT(int, :id))
                   OR (NULLIF(:id, '') IS NULL AND SaveRequestId = NULLIF(:saveRequestId, ''))
            ) AS [incidentNumber],
            CAST(CASE
                WHEN NOT EXISTS (
                    SELECT 1 FROM Current_session
                    WHERE session_id = sqlpage.cookie('session')
                ) THEN 'An authenticated session is required.'
                WHEN TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:eventDateTime, ''), 'T', ' '), 120) IS NULL THEN 'Incident date/time is required and must be valid.'
                WHEN NULLIF(:event, '') IS NULL THEN 'Incident Type is required.'
                WHEN DATALENGTH(COALESCE(LTRIM(RTRIM(:actualDispatchReason)), N'')) > 2000 THEN 'Actual Reason for dispatch may not exceed 1000 characters.'
                WHEN NULLIF(LTRIM(RTRIM(:positiveVesa)), N'') IS NOT NULL
                     AND LTRIM(RTRIM(:positiveVesa)) COLLATE Latin1_General_100_BIN2 NOT IN (N'Hijacked', N'Stolen', N'No')
                    THEN 'Positive VESA must be Hijacked, Stolen, or No.'
                WHEN LOWER(COALESCE(:vehicleHistoryUnavailable, '')) IN ('1', 'true', 'yes', 'on')
                     AND NULLIF(LTRIM(RTRIM(:vehicleHistoryUnavailableReason)), '') IS NULL
                    THEN 'Explain why vehicle history is unavailable for this non-Pulsit unit.'
                WHEN LOWER(COALESCE(:vehicleHistoryUnavailable, '')) IN ('1', 'true', 'yes', 'on')
                     AND LEN(LTRIM(RTRIM(:vehicleHistoryUnavailableReason))) > 500
                    THEN 'The vehicle history exception reason may not exceed 500 characters.'
                WHEN LOWER(COALESCE(:vehicleHistoryUnavailable, '')) IN ('1', 'true', 'yes', 'on')
                     AND COALESCE(LTRIM(RTRIM(:trackingUnitStatus)), N'') <> N'Not fitted with Pulsit Tracking'
                    THEN 'Tracking Unit Status must be "Not fitted with Pulsit Tracking" for the vehicle history exception.'
                WHEN LOWER(COALESCE(:vehicleHistoryUnavailable, '')) IN ('1', 'true', 'yes', 'on')
                     AND EXISTS (
                         SELECT 1 FROM Risk.dbo.unitinfo unit_row
                         WHERE UPPER(LTRIM(RTRIM(unit_row.reg_no))) = UPPER(LTRIM(RTRIM(:regNo)))
                           AND LOWER(LTRIM(RTRIM(COALESCE(unit_row.ctrltype, N'')))) <> N'lmu ir'
                     )
                     AND EXISTS (
                         SELECT 1 FROM Risk.dbo.vehicleinfo vehicle_row
                         WHERE UPPER(LTRIM(RTRIM(vehicle_row.reg_no))) = UPPER(LTRIM(RTRIM(:regNo)))
                     ) THEN 'This registration exists on MSTrack, so the non-Pulsit vehicle history exception cannot be used.'
                WHEN NULLIF(LTRIM(RTRIM(:latitude)), '') IS NOT NULL AND UPPER(LTRIM(RTRIM(:latitude))) <> 'N/A' AND TRY_CONVERT(decimal(9,6), :latitude) IS NULL THEN 'Incorrect format for Latitude/Longitude.'
                WHEN NULLIF(LTRIM(RTRIM(:longitude)), '') IS NOT NULL AND UPPER(LTRIM(RTRIM(:longitude))) <> 'N/A' AND TRY_CONVERT(decimal(9,6), :longitude) IS NULL THEN 'Incorrect format for Latitude/Longitude.'
                WHEN UPPER(LTRIM(RTRIM(:latitude))) <> 'N/A' AND TRY_CONVERT(decimal(9,6), :latitude) IS NOT NULL AND TRY_CONVERT(decimal(9,6), :latitude) NOT BETWEEN -90 AND 90 THEN 'Incorrect format for Latitude/Longitude.'
                WHEN UPPER(LTRIM(RTRIM(:longitude))) <> 'N/A' AND TRY_CONVERT(decimal(9,6), :longitude) IS NOT NULL AND TRY_CONVERT(decimal(9,6), :longitude) NOT BETWEEN -180 AND 180 THEN 'Incorrect format for Latitude/Longitude.'
                WHEN NULLIF(:id, '') IS NOT NULL AND TRY_CONVERT(int, :id) IS NULL THEN 'Dispatch ID must be numeric.'
                WHEN NULLIF(:id, '') IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM CC.dbo.DispatchIncidents
                    WHERE id = TRY_CONVERT(int, :id)
                      AND IsDeleted = 0
                ) THEN 'The dispatch could not be found.'
                WHEN NULLIF(:id, '') IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM CC.dbo.DispatchIncidents
                    WHERE id = TRY_CONVERT(int, :id)
                      AND IsDeleted = 0
                      AND Status IN ('Draft', 'Rejected', 'PendingApproval')
                      AND DispatchStatus NOT IN ('Closed', 'Cancelled')
                ) THEN 'Only active Draft, Rejected, or Pending Approval dispatches can be edited.'
                WHEN NULLIF(:id, '') IS NULL AND NULLIF(:saveRequestId, '') IS NULL THEN 'Save request ID is required.'
                WHEN EXISTS (
                    SELECT 1
                    FROM CC.dbo.DispatchTeams quota_team
                    WHERE quota_team.IsActive = 1
                      AND quota_team.MonthlyDispatchLimit IS NOT NULL
                      AND LOWER(LTRIM(RTRIM(quota_team.TeamName))) = LOWER(LTRIM(RTRIM(NULLIF(:dispatchTeam, ''))))
                      AND TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:dispatchDateTime, ''), 'T', ' '), 120) IS NOT NULL
                      AND (
                          SELECT COUNT(DISTINCT quota_incident.id)
                          FROM CC.dbo.DispatchIncidents quota_incident
                          WHERE quota_incident.IsDeleted = 0
                            AND (NULLIF(:id, '') IS NULL OR quota_incident.id <> TRY_CONVERT(int, :id))
                            AND (
                                LOWER(LTRIM(RTRIM(quota_incident.DispatchTeam))) = LOWER(LTRIM(RTRIM(quota_team.TeamName)))
                                OR (
                                    LOWER(LTRIM(RTRIM(quota_team.TeamName))) = N'matrix'
                                    AND LOWER(LTRIM(RTRIM(quota_incident.DispatchTeam))) = N'rentrak'
                                )
                            )
                            AND quota_incident.DispatchDateTime >= DATEFROMPARTS(
                                  YEAR(TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:dispatchDateTime, ''), 'T', ' '), 120)),
                                  MONTH(TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:dispatchDateTime, ''), 'T', ' '), 120)),
                                  1
                                )
                            AND quota_incident.DispatchDateTime < DATEADD(month, 1, DATEFROMPARTS(
                                  YEAR(TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:dispatchDateTime, ''), 'T', ' '), 120)),
                                  MONTH(TRY_CONVERT(datetime2(0), REPLACE(NULLIF(:dispatchDateTime, ''), 'T', ' '), 120)),
                                  1
                                ))
                      ) >= quota_team.MonthlyDispatchLimit
                ) THEN 'Matrix has reached its monthly dispatch limit. Choose another team or contact a manager.'
                WHEN NULLIF(:id, '') IS NULL AND NOT EXISTS (
                    SELECT 1 FROM CC.dbo.DispatchIncidents
                    WHERE SaveRequestId = NULLIF(:saveRequestId, '')
                ) THEN 'The dispatch incident could not be created.'
                ELSE NULL
            END AS nvarchar(500)) AS [message]
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    ) AS contents;
