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

-- Read-only VESA register, using SQLPage's active configured connection.
-- Only the existing Admin role (user type 7) may access the register.
-- The confirmed Positive VESA outcome controls eligibility, regardless of the initial incident type.
-- Blank/unrecorded outcomes and No are excluded, including historical dispatches without a value.
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
resolved_user AS
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
access_check AS
(
    SELECT CASE
        WHEN NOT EXISTS (SELECT 1 FROM resolved_user) THEN N'unauthorized'
        WHEN EXISTS (
            SELECT 1 FROM resolved_user
            WHERE TRY_CONVERT(int, Usertype) = 7
        ) THEN N'ok'
        ELSE N'forbidden'
    END AS status
)
SELECT
    access_check.status,
    JSON_QUERY(COALESCE((
        SELECT i.RegNo, i.Company, i.OBNumber, i.zoho_ob, i.CreatedAt
        FROM CC.dbo.DispatchIncidents i
        WHERE access_check.status = N'ok'
          AND i.IsDeleted = 0
          AND i.Status = N'Approved'
          AND COALESCE(i.DispatchStatus, N'') <> N'Cancelled'
          AND i.PositiveVESA COLLATE Latin1_General_100_BIN2 IN (N'Hijacked', N'Stolen')
        ORDER BY i.CreatedAt DESC, i.id DESC
        FOR JSON PATH
    ), N'[]')) AS incidents
FROM access_check
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;
