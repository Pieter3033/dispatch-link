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

-- SQLPage JSON endpoint: Dispatch Link metadata.

SELECT
    CAST(CASE
        WHEN COL_LENGTH('CC.dbo.DispatchIncidents', 'AdditionalAssetsJson') IS NOT NULL
         AND COL_LENGTH('CC.dbo.DispatchIncidentPhotos', 'AssetKey') IS NOT NULL
        THEN 1 ELSE 0
    END AS bit) AS additionalAssetsEnabled,
    JSON_QUERY('[
        "LicenseDisk",
        "FrontVehicleWithReg",
        "BackVehicleWithReg",
        "VehicleSides",
        "TrailersWithReg",
        "Stock",
        "Damages",
        "Dashboard",
        "VehicleKeys",
        "Odometer",
        "Driver",
        "DriverLicenseOrId"
    ]') AS photoCategories,
    JSON_QUERY('["Approver1","Approver2","Approver3"]') AS approvers,
    JSON_QUERY(COALESCE((
        SELECT
            team.TeamName AS [value],
            team.TeamName AS [label],
            team.TeamCode AS teamCode,
            team.MonthlyDispatchLimit AS monthlyLimit
        FROM CC.dbo.DispatchTeams team
        WHERE team.IsActive = 1
        ORDER BY team.DisplayOrder, team.TeamName
        FOR JSON PATH
    ), '[]')) AS dispatchTeams,
    JSON_QUERY('["Dispatch Requested","Dispatched","On Scene","Recovered","Stood Down","Closed","Cancelled"]') AS dispatchStatuses,
    JSON_QUERY('["Not Requested","Pending","Approved","Rejected"]') AS closureApprovalStatuses,
    JSON_QUERY('["Yes","No","Not Applicable"]') AS standardOutcomeOptions,
    JSON_QUERY('["Yes","No","Not Applicable","Vehicle Not On Scene"]') AS vehicleRecoveredOptions,
    JSON_QUERY('[
        "Asset Lost - Unit Lost",
        "Asset Lost - Unit Found",
        "Asset Found - Unit Lost",
        "Asset Found - Unit Working",
        "Asset Found - Unit Not Working",
        "Dispatch Cancelled - Unit Working",
        "Dispatch Cancelled - Unit Not Working",
        "Mobile Unit",
        "Not fitted with Pulsit Tracking"
    ]') AS trackingUnitStatuses,
    JSON_QUERY(COALESCE((
        SELECT TOP (500)
            LTRIM(RTRIM(u.Username)) AS username,
            LEFT(COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(u.Name, ' ', u.Surname))), ''), LTRIM(RTRIM(u.Username))), 100) AS [value],
            COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(u.Name, ' ', u.Surname))), ''), LTRIM(RTRIM(u.Username))) AS [label]
        FROM Jobcard.dbo.User_info u
        WHERE NULLIF(LTRIM(RTRIM(u.Username)), '') IS NOT NULL
          AND LOWER(LTRIM(RTRIM(u.Username))) <> 'eta_callcentre'
          AND (
              TRY_CONVERT(int, u.Usertype) IN (7, 8, 14)
              OR (TRY_CONVERT(int, u.Usertype) = 1 AND COALESCE(u.Helpdesk, 0) = 1)
          )
          AND UPPER(COALESCE(
              NULLIF(LTRIM(RTRIM(CONCAT(u.Name, ' ', u.Surname))), ''),
              LTRIM(RTRIM(u.Username))
          )) NOT IN ('CC CC', 'Approver1 ESCALATION', 'TEST TEST', 'EXAMPLE ESCALATION')
        ORDER BY
            COALESCE(NULLIF(LTRIM(RTRIM(u.Name)), ''), LTRIM(RTRIM(u.Username))),
            COALESCE(NULLIF(LTRIM(RTRIM(u.Surname)), ''), ''),
            LTRIM(RTRIM(u.Username))
        FOR JSON PATH
    ), '[]')) AS staffUsers,
    JSON_QUERY(COALESCE((
        SELECT
            TRY_CONVERT(NVARCHAR(100), account.zoho_id) AS id,
            account.Account_Name AS [value],
            account.Account_Name AS [label]
        FROM Pulsit_comparison.dbo.Accounts_ZOHO account
        WHERE account.zoho_id IS NOT NULL
          AND account.Account_no IS NOT NULL
          AND NULLIF(LTRIM(RTRIM(account.Account_Name)), '') IS NOT NULL
          AND account.Account_Name <> '...'
        ORDER BY account.Account_Name
        FOR JSON PATH
    ), '[]')) AS zohoAccounts,
    JSON_QUERY(COALESCE((
        SELECT
            company.Company AS company,
            company.Fleet_Code AS fleetCode,
            TRY_CONVERT(NVARCHAR(100), account.zoho_id) AS id,
            account.Account_Name AS [value],
            account.Account_Name AS [label]
        FROM Jobcard.dbo.Companies company
        INNER JOIN Pulsit_comparison.dbo.Accounts_ZOHO account
            ON account.zoho_id = company.escallation_no
        WHERE NULLIF(LTRIM(RTRIM(company.Company)), '') IS NOT NULL
          AND NULLIF(LTRIM(RTRIM(company.Fleet_Code)), '') IS NOT NULL
          AND NULLIF(LTRIM(RTRIM(account.Account_Name)), '') IS NOT NULL
        ORDER BY company.Company, company.Fleet_Code
        FOR JSON PATH
    ), '[]')) AS zohoAccountMappings
WHERE EXISTS (
    SELECT 1 FROM Current_session
    WHERE session_id = sqlpage.cookie('session')
)
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;
