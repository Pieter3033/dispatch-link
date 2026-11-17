# ETA Requests V1 API

All endpoints use the existing SQLPage session cookie. A `Jobcard.dbo.User_info`
profile with `Usertype = 11` is assigned to the active dispatch team whose
`DispatchTeams.TeamCode` matches `User_info.DispatchTeamCode`. Call Centre
access is limited to user types 7 and 8, plus helpdesk-enabled type-1 profiles.
An unassigned type-11 profile receives no ETA access and is never treated as
Call Centre. `User_info.Company` is not used for ETA authorization.

## Three-table model

- `DispatchTeams` stores team configuration. Individual users are assigned by
  matching `User_info.DispatchTeamCode` to `DispatchTeams.TeamCode`.
- `DispatchEtaRequests` stores the request and the selected team/distance.
- `DispatchEtaResponses` stores one availability/distance response per team.

No separate ETA user-group or ETA audit table is required in V1. User and time
columns on the request/response rows record the ETA workflow. The existing
`DispatchAuditLog` is used after the linked draft is created.

## Read endpoints

- `GET eta_requests.sql` returns the current ETA access context, role-scoped
  requests, visible responses, and summary counts.
- `GET eta_request_summary.sql` returns the lightweight sidebar action count.

Call Centre profiles see all team responses. Dispatch-team profiles see only
the response row assigned to their own team.

## Write endpoints

The write endpoints execute directly through SQLPage and SQL Server; no
external Node helper or deployment-specific filesystem path is required.
Multi-step operations use deterministic IDs and idempotent statements so a
retry can safely finish an interrupted request.

- `POST create_eta_request.sql` accepts `latitude`, `longitude`, `registration`,
  and `incidentType`. It creates one pending response for every active team
  and applies a ten-minute expiry.
- `POST save_eta_response.sql` accepts `requestId`, `availability`, and
  `distanceKm`. Distance is required only for `Available`.
- `POST select_eta_response.sql` accepts `requestId` and `responseId`. It locks
  the request, copies the selected team and kilometres onto the request, and
  creates one linked Dispatch Link draft in the same transaction.
- `POST cancel_eta_request.sql` accepts `requestId` and closes an open request.

The draft receives the selected incident type, request creation time,
registration, coordinates, selected team, and distance in
kilometres.
