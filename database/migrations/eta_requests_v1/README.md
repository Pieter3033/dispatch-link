# ETA Requests V1 database setup

Run `01_eta_requests_v1.sql` against the `CC` SQL Server database before using
the ETA Requests page. The script is additive and creates exactly three tables:

1. `CC.dbo.DispatchTeams`
2. `CC.dbo.DispatchEtaRequests`
3. `CC.dbo.DispatchEtaResponses`

If the original five-table preview was already installed, do not rerun script
01. Run `02_upgrade_legacy_five_tables_to_three.sql` once instead. It refuses to
make changes when ETA workflow data exists, migrates the team usernames, and
removes the two unused empty preview tables.


The migration originally seeded these standard dispatch-team usernames:

- `eta_capital_air`
- `eta_csg`
- `eta_private_confidential`
- `eta_matrix`

After installing the three ETA tables, run `03_user_info_dispatch_team_code.sql`
against the `Jobcard` database. It adds the nullable `DispatchTeamCode` field to
`Jobcard.dbo.User_info` without assigning or updating any users.

Run `04_normalize_dispatch_team_codes.sql` against `CC` to normalize the user
allocation values to `CA`, `CSG`, `Matrix`, and `PanC` while preserving TeamId.

The current application assigns individual dispatch-team users through
`Jobcard.dbo.User_info`: `Usertype` must be 11 and `DispatchTeamCode` must
exactly match an active `DispatchTeams.TeamCode`. `GroupUsername` remains only
as a legacy configuration value. User types 7 and 8, plus helpdesk-enabled
type-1 users, receive Call Centre access. Unassigned type-11 users receive no
ETA access.

Creating an ETA request inserts one pending response for every active team.
Adding a future user requires an individual `User_info` profile with user type
11 and the relevant value in `DispatchTeamCode`. Multiple individual users can
share the same team without sharing credentials. `Company` remains ordinary
profile data and no longer grants ETA access.

Selecting an available response copies the chosen team and distance in
kilometres onto `DispatchEtaRequests`, then creates the linked dispatch draft.
The existing `DispatchAuditLog` records activity from draft creation onward.

Do not run the migration while active ETA traffic is being processed. Take a
normal database backup first and run it through the usual deployment process.
