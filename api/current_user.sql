-- SQLPage JSON endpoint: current Dispatch Link user.
-- Resolve identity from the same active session used by Internal Tickets.

WITH cookie_user AS
(
    SELECT TOP (1)
        NULLIF(LTRIM(RTRIM(CAST(current_session.Username AS NVARCHAR(200)))), '') AS username
    FROM Current_session current_session
    WHERE current_session.session_id = sqlpage.cookie('session')
),
cookie_identity AS
(
    SELECT
        cookie_user.username,
        LOWER(
            CASE
                WHEN cookie_parts.login_name IS NULL THEN NULL
                WHEN CHARINDEX('@', cookie_parts.login_name) > 0 THEN LEFT(cookie_parts.login_name, CHARINDEX('@', cookie_parts.login_name) - 1)
                ELSE cookie_parts.login_name
            END
        ) AS canonical_username
    FROM cookie_user
    CROSS APPLY
    (
        SELECT
            CASE
                WHEN cookie_user.username IS NULL THEN NULL
                WHEN CHARINDEX('\', cookie_user.username) > 0 THEN RIGHT(cookie_user.username, CHARINDEX('\', REVERSE(cookie_user.username)) - 1)
                WHEN CHARINDEX('/', cookie_user.username) > 0 THEN RIGHT(cookie_user.username, CHARINDEX('/', REVERSE(cookie_user.username)) - 1)
                ELSE cookie_user.username
            END AS login_name
    ) cookie_parts
),
normal_resolved_user AS
(
    SELECT TOP (1)
        user_info.Seqno,
        user_info.Username,
        user_info.Name,
        user_info.Surname,
        user_info.Usertype,
        user_info.Helpdesk,
        user_info.DispatchTeamCode
    FROM cookie_identity
    JOIN Jobcard.dbo.User_info user_info
        ON cookie_identity.username IS NOT NULL
    CROSS APPLY
    (
        SELECT NULLIF(LTRIM(RTRIM(CAST(user_info.Username AS NVARCHAR(200)))), '') AS username
    ) db_user
    CROSS APPLY
    (
        SELECT
            CASE
                WHEN db_user.username IS NULL THEN NULL
                WHEN CHARINDEX('\', db_user.username) > 0 THEN RIGHT(db_user.username, CHARINDEX('\', REVERSE(db_user.username)) - 1)
                WHEN CHARINDEX('/', db_user.username) > 0 THEN RIGHT(db_user.username, CHARINDEX('/', REVERSE(db_user.username)) - 1)
                ELSE db_user.username
            END AS login_name
    ) db_parts
    CROSS APPLY
    (
        SELECT LOWER(
            CASE
                WHEN db_parts.login_name IS NULL THEN NULL
                WHEN CHARINDEX('@', db_parts.login_name) > 0 THEN LEFT(db_parts.login_name, CHARINDEX('@', db_parts.login_name) - 1)
                ELSE db_parts.login_name
            END
        ) AS canonical_username
    ) db_canonical
    WHERE db_user.username = cookie_identity.username
       OR LOWER(db_user.username) = cookie_identity.canonical_username
       OR db_canonical.canonical_username = cookie_identity.canonical_username
    ORDER BY
        CASE
            WHEN db_user.username = cookie_identity.username THEN 0
            WHEN LOWER(db_user.username) = cookie_identity.canonical_username THEN 1
            WHEN db_canonical.canonical_username = cookie_identity.canonical_username THEN 2
            ELSE 3
        END,
        user_info.Seqno
),
resolved_user AS (
    SELECT n.* FROM normal_resolved_user n WHERE n.Usertype <> 15
      AND NOT EXISTS (SELECT reader_user.Username, reader_user.Seqno, reader_user.Name, reader_user.Surname,
        reader_user.Usertype, reader_user.Helpdesk, reader_user.DispatchTeamCode
    FROM Jobcard.dbo.Current_session reader_session
    JOIN Jobcard.dbo.User_info reader_user ON reader_user.Username = reader_session.Username
    WHERE reader_session.session_id = sqlpage.cookie('session') AND reader_user.Usertype = 15)
    UNION ALL
    SELECT r.Seqno, r.Username, r.Name, r.Surname, r.Usertype, r.Helpdesk, r.DispatchTeamCode
    FROM (SELECT reader_user.Username, reader_user.Seqno, reader_user.Name, reader_user.Surname,
        reader_user.Usertype, reader_user.Helpdesk, reader_user.DispatchTeamCode
    FROM Jobcard.dbo.Current_session reader_session
    JOIN Jobcard.dbo.User_info reader_user ON reader_user.Username = reader_session.Username
    WHERE reader_session.session_id = sqlpage.cookie('session') AND reader_user.Usertype = 15) r
)
SELECT
    CAST(1 AS bit) AS [authenticated],
    JSON_QUERY((
        SELECT
            resolved_user.Username AS username,
            resolved_user.Name AS name,
            resolved_user.Surname AS surname,
            resolved_user.Usertype AS userType,
            resolved_user.Usertype AS user_type,
            resolved_user.Helpdesk AS helpdesk,
            CAST(CASE WHEN resolved_user.Usertype = 15 THEN 1 ELSE 0 END AS bit) AS completedDispatchOnly,
            CAST(CASE WHEN resolved_user.Usertype = 15 OR resolved_user.Usertype IN (7,8,14)
                OR (resolved_user.Usertype = 1 AND COALESCE(resolved_user.Helpdesk,0) = 1) THEN 1 ELSE 0 END AS bit) AS canViewCompletedDispatches,
            resolved_user.Seqno AS seqNo,
            COALESCE(NULLIF(CONCAT(resolved_user.Name, ' ', resolved_user.Surname), ' '), resolved_user.Username) AS displayName,
            CASE
                WHEN TRY_CONVERT(int, resolved_user.Usertype) = 11 AND team.TeamId IS NOT NULL THEN N'DispatchTeam'
                WHEN TRY_CONVERT(int, resolved_user.Usertype) IN (7, 8, 14)
                  OR (TRY_CONVERT(int, resolved_user.Usertype) = 1 AND COALESCE(resolved_user.Helpdesk, 0) = 1)
                    THEN N'CallCentre'
                ELSE N'None'
            END AS etaRole,
            team.TeamId AS etaTeamId,
            team.TeamCode AS etaTeamCode,
            team.TeamName AS etaTeamName,
            COALESCE(team.IsActive, 0) AS etaTeamIsActive,
            CASE
                WHEN TRY_CONVERT(int, resolved_user.Usertype) IN (7, 8, 14)
                  OR (TRY_CONVERT(int, resolved_user.Usertype) = 1 AND COALESCE(resolved_user.Helpdesk, 0) = 1)
                    THEN CAST(1 AS bit)
                ELSE CAST(0 AS bit)
            END AS canViewDispatchOperations,
            CASE
                WHEN TRY_CONVERT(int, resolved_user.Usertype) = 7 THEN CAST(1 AS bit)
                ELSE CAST(0 AS bit)
            END AS isApprover,
            -- Separate closure review is not part of the deployed database/workflow.
            -- Keep it disabled until its schema and endpoints have a verified release.
            CAST(0 AS bit) AS closureWorkflowEnabled,
            CAST(0 AS bit) AS canApproveClosure
        FROM resolved_user
        LEFT JOIN CC.dbo.DispatchTeams team
          ON TRY_CONVERT(int, resolved_user.Usertype) = 11
         AND LOWER(LTRIM(RTRIM(team.TeamCode))) = LOWER(LTRIM(RTRIM(resolved_user.DispatchTeamCode)))
        FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
    )) AS [user]
WHERE EXISTS (SELECT 1 FROM resolved_user)

UNION ALL
SELECT
    CAST(0 AS bit) AS [authenticated],
    NULL AS [user]
WHERE NOT EXISTS (SELECT 1 FROM resolved_user)
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;
