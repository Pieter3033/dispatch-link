# Dispatch workflow database migration

These scripts target SQL Server database `CC`. They were generated after a read-only inspection of the live dispatch schema.

Run in this order:

1. `01_preflight.sql` — read-only; confirm every required object exists.
2. `02_incident_columns.sql` — add incident-level fields and controlled-value constraints.
3. `03_dispatch_assignments.sql` — create the maximum-three ground-team assignment model.
4. `04_closure_history.sql` — create repeatable closure reviews and manager comments.
5. `05_indexes.sql` — add Active-view and approval-queue indexes.
6. `06_status_and_assignment_procedures.sql` — add authoritative status and assignment procedures.
7. `07_operational_and_closure_procedures.sql` — add operational save, closure review and cancellation procedures.
8. `08_existing_data_review.sql` — read-only; verify legacy records were not treated as closed.
9. `09_verification.sql` — read-only post-migration verification.
10. `10_communication_whatsapp_direction.sql` — allow separate sent and received WhatsApp communication types while retaining historical values.

Important findings:

- The existing `Status` column is the legacy Draft/PendingApproval/Approved/Rejected workflow. These scripts do not change or remove it.
- The new `DispatchStatus` and `ClosureApprovalStatus` columns are separate operational fields.
- The existing `DispatchApprovals` rows are not converted into closure approvals.
- At inspection time, all 17 existing `DispatchIncidents` rows had `isdeleted = 1`. These scripts do not restore or otherwise modify that flag.
- The existing `dbo.dispatch_teams` table is a company/team-availability mapping, not an incident assignment table. It is left untouched.
- Existing Approved records are not assumed to be Closed.

No destructive rollback script is included. Before production execution, take the normal database backup and run the scripts in a test database first. Any rollback that removes populated columns or tables requires explicit data-loss approval.
