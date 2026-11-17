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

-- SQLPage endpoint: cancel an open ETA request.

SET eta_cancel_username = (
    SELECT TOP (1) NULLIF(LTRIM(RTRIM(CAST(Username AS nvarchar(128)))), N'')
    FROM Current_session
    WHERE session_id = sqlpage.cookie('session')
);
SET eta_cancel_request_id = COALESCE(:requestId, '');
SET eta_cancel_status = (
    SELECT CASE
        WHEN NULLIF($eta_cancel_username, N'') IS NULL THEN N'unauthorized'
        WHEN NOT EXISTS (
            SELECT 1
            FROM Jobcard.dbo.User_info user_info
            WHERE LOWER(LTRIM(RTRIM(user_info.Username))) = LOWER($eta_cancel_username)
              AND (
                    TRY_CONVERT(int, user_info.Usertype) IN (7, 8, 14)
                 OR (TRY_CONVERT(int, user_info.Usertype) = 1 AND COALESCE(user_info.Helpdesk, 0) = 1)
              )
        ) THEN N'forbidden'
        WHEN TRY_CONVERT(bigint, NULLIF(LTRIM(RTRIM($eta_cancel_request_id)), N'')) IS NULL
          OR TRY_CONVERT(bigint, NULLIF(LTRIM(RTRIM($eta_cancel_request_id)), N'')) <= 0
            THEN N'invalid_request'
        WHEN NOT EXISTS (
            SELECT 1 FROM CC.dbo.DispatchEtaRequests
            WHERE EtaRequestId = TRY_CONVERT(bigint, $eta_cancel_request_id)
        ) THEN N'not_found'
        WHEN NOT EXISTS (
            SELECT 1 FROM CC.dbo.DispatchEtaRequests
            WHERE EtaRequestId = TRY_CONVERT(bigint, $eta_cancel_request_id)
              AND RequestStatus = N'Open'
        ) THEN N'closed'
        ELSE N'ok'
    END
);

UPDATE CC.dbo.DispatchEtaRequests
SET RequestStatus = N'Cancelled',
    CancelledAt = SYSDATETIME(),
    CancelledBy = $eta_cancel_username,
    UpdatedAt = SYSDATETIME(),
    UpdatedBy = $eta_cancel_username
WHERE EtaRequestId = TRY_CONVERT(bigint, $eta_cancel_request_id)
  AND RequestStatus = N'Open'
  AND $eta_cancel_status = N'ok';

SET eta_cancel_final_status = (
    SELECT CASE
        WHEN $eta_cancel_status <> N'ok' THEN $eta_cancel_status
        WHEN EXISTS (
            SELECT 1 FROM CC.dbo.DispatchEtaRequests
            WHERE EtaRequestId = TRY_CONVERT(bigint, $eta_cancel_request_id)
              AND RequestStatus = N'Cancelled'
              AND CancelledBy = $eta_cancel_username
        ) THEN N'ok'
        ELSE N'closed'
    END
);

SELECT (
    SELECT
        $eta_cancel_final_status AS status,
        TRY_CONVERT(bigint, $eta_cancel_request_id) AS id,
        CASE $eta_cancel_final_status
            WHEN N'ok' THEN N'ETA request cancelled.'
            WHEN N'unauthorized' THEN N'An active signed-in session is required.'
            WHEN N'forbidden' THEN N'Call Centre access is required.'
            WHEN N'invalid_request' THEN N'A valid ETA request is required.'
            WHEN N'not_found' THEN N'ETA request not found.'
            WHEN N'closed' THEN N'This ETA request is already closed.'
            ELSE N'The ETA request could not be cancelled.'
        END AS message
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
) AS json;
