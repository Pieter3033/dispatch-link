-- Read-only display metadata for the completed-dispatch viewer.
SELECT CAST(CASE WHEN COL_LENGTH('CC.dbo.DispatchIncidents','AdditionalAssetsJson') IS NOT NULL
    AND COL_LENGTH('CC.dbo.DispatchIncidentPhotos','AssetKey') IS NOT NULL THEN 1 ELSE 0 END AS bit) AS additionalAssetsEnabled
WHERE EXISTS (SELECT reader_user.Username, reader_user.Seqno, reader_user.Name, reader_user.Surname,
        reader_user.Usertype, reader_user.Helpdesk, reader_user.DispatchTeamCode
    FROM Jobcard.dbo.Current_session reader_session
    JOIN Jobcard.dbo.User_info reader_user ON reader_user.Username = reader_session.Username
    WHERE reader_session.session_id = sqlpage.cookie('session') AND reader_user.Usertype = 15)
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;
