# Dispatch Link Phase 2 SQLPage API

All endpoints require a valid `Current_session` row matching the SQLPage `session` cookie. Request bodies use `application/x-www-form-urlencoded`, matching the existing frontend helper.

## Read endpoints

### `GET api/dispatch_metadata.sql`

Returns staff, Zoho account metadata, dispatch teams, operational statuses, outcome options, and tracking-unit statuses.

### `GET api/dispatch_incidents.sql`

Existing filters remain supported: `status`, `search`, and `scope`.

New filters:

- `dispatchStatus`
- `closureApprovalStatus`
- `view`: `active`, `closure-pending`, `closed`, or `cancelled`

Every row now includes `DispatchStatus`, `ClosureApprovalStatus`, `AssignedControlRoomAgent`, `AssignedTeams`, `LatestETA`, and `LatestOperationalUpdate`.

### `GET api/dispatch_incident_detail.sql?dispatchId={id}`

The response now includes:

- New incident-level operational fields
- `assignments`
- `closureReviews`
- `managerComments`
- `closureValidation`
- Existing photos, files, communications, audit, and validation data

### `GET api/dispatch_closures_pending.sql`

Manager-only queue of pending closure requests.

## Write endpoints

All write endpoints return a JSON object with `status`. A successful response uses `status: "ok"`.

### `POST api/save_operational_details.sql`

Full operational payload:

- `incidentId`
- `trailerRegistration1`
- `trailerRegistration2`
- `assignedControlRoomAgent`
- `clientContactName`
- `clientContactNumber`
- `clientPO`
- `stockNumber`
- `summaryOfIncident`
- `positiveHijacking`
- `vehicleRecovered`
- `loadRecovered`
- `trailersRecovered`
- `vehicleKeyAvailable`
- `driverOnScene`
- `trackingUnitStatus`

This endpoint recalculates Dispatch Status transactionally.

### `POST api/save_dispatch_assignment.sql`

- `incidentId`
- `sequenceNo`: 1–3
- `assignedTeam`
- `eta`
- `dispatchedAt`
- `obNumber`
- `teamOnSceneAt`
- `stoodDownAt`

This endpoint creates or updates one assignment and recalculates Dispatch Status.

### `POST api/delete_dispatch_assignment.sql`

- `incidentId`
- `sequenceNo`

### `POST api/request_dispatch_closure.sql`

- `incidentId`
- `closingComments`

The dispatch must be Stood Down and satisfy `closureValidation`.

### `POST api/review_dispatch_closure.sql`

Manager only:

- `closureReviewId`
- `decision`: `Approved` or `Rejected`
- `managerComments`
- `rejectionReason`: mandatory for rejection

### `POST api/add_dispatch_manager_comment.sql`

Manager only:

- `incidentId`
- `closureReviewId`: optional
- `commentText`

### `POST api/cancel_dispatch.sql`

- `incidentId`
- `cancellationReason`

Cancellation does not require manager approval.

## Compatibility

The legacy `submit_incident.sql`, `approve_incident.sql`, `reject_incident.sql`, and `dispatch_approvals_pending.sql` endpoints remain in place until the frontend is switched to closure approval. New frontend code must use the Phase 2 closure endpoints instead.

The backend remains SQLPage-only. The Express routes are not part of the Phase 2 integration contract.
