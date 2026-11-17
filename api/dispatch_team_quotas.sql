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

-- SQLPage JSON endpoint: current-month dispatch-team quota usage.

WITH auth AS
(
    SELECT TOP (1) CAST(Username AS nvarchar(128)) AS username
    FROM Current_session
    WHERE session_id = sqlpage.cookie('session')
),
period AS
(
    SELECT
        DATEFROMPARTS(YEAR(SYSDATETIME()), MONTH(SYSDATETIME()), 1) AS period_start,
        DATEADD(month, 1, DATEFROMPARTS(YEAR(SYSDATETIME()), MONTH(SYSDATETIME()), 1)) AS period_end
),
quota_usage AS
(
    SELECT
        team.TeamId,
        team.TeamCode,
        team.TeamName,
        team.MonthlyDispatchLimit,
        period.period_start,
        period.period_end,
        COUNT(DISTINCT CASE
            WHEN incident.DispatchDateTime >= period.period_start
             AND incident.DispatchDateTime < period.period_end
                THEN incident.id
        END) AS used_count,
        COUNT(DISTINCT CASE
            WHEN incident.DispatchDateTime IS NULL
             AND incident.CreatedAt >= period.period_start
             AND incident.CreatedAt < period.period_end
             AND incident.DispatchStatus NOT IN (N'Closed', N'Cancelled')
                THEN incident.id
        END) AS pending_count
    FROM CC.dbo.DispatchTeams team
    CROSS JOIN period
    LEFT JOIN CC.dbo.DispatchIncidents incident
      ON incident.IsDeleted = 0
     AND
     (
         LOWER(LTRIM(RTRIM(incident.DispatchTeam))) = LOWER(LTRIM(RTRIM(team.TeamName)))
         OR
         (
             LOWER(LTRIM(RTRIM(team.TeamName))) = N'matrix'
             AND LOWER(LTRIM(RTRIM(incident.DispatchTeam))) = N'rentrak'
         )
     )
    WHERE team.IsActive = 1
      AND team.MonthlyDispatchLimit IS NOT NULL
    GROUP BY
        team.TeamId,
        team.TeamCode,
        team.TeamName,
        team.MonthlyDispatchLimit,
        period.period_start,
        period.period_end
)
SELECT
    'json' AS component,
    (
        SELECT
            CONVERT(char(10), MIN(quota.period_start), 23) AS periodStart,
            CONVERT(char(10), MIN(quota.period_end), 23) AS periodEnd,
            CONCAT(DATENAME(month, MIN(quota.period_start)), N' ', YEAR(MIN(quota.period_start))) AS periodLabel,
            JSON_QUERY(COALESCE((
                SELECT
                    usage.TeamId AS teamId,
                    usage.TeamCode AS teamCode,
                    usage.TeamName AS teamName,
                    usage.MonthlyDispatchLimit AS monthlyLimit,
                    usage.used_count AS usedCount,
                    usage.pending_count AS pendingCount,
                    CASE
                        WHEN usage.MonthlyDispatchLimit - usage.used_count > 0
                            THEN usage.MonthlyDispatchLimit - usage.used_count
                        ELSE 0
                    END AS remainingCount,
                    CASE
                        WHEN usage.MonthlyDispatchLimit - usage.used_count - usage.pending_count > 0
                            THEN usage.MonthlyDispatchLimit - usage.used_count - usage.pending_count
                        ELSE 0
                    END AS availableCount,
                    CAST(ROUND(100.0 * usage.used_count / NULLIF(usage.MonthlyDispatchLimit, 0), 0) AS int) AS usagePercent,
                    CAST(CASE WHEN usage.used_count >= usage.MonthlyDispatchLimit THEN 1 ELSE 0 END AS bit) AS limitReached
                FROM quota_usage usage
                ORDER BY usage.TeamName
                FOR JSON PATH
            ), N'[]')) AS teams
        FROM quota_usage quota
        WHERE EXISTS (SELECT 1 FROM auth)
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    ) AS contents;
