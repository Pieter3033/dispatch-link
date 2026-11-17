USE [CC];
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

CREATE OR ALTER PROCEDURE dbo.DispatchLink_UpdateOperationalDetails
    @dispatch_id int,
    @trailer_registration_1 nvarchar(50) = NULL,
    @trailer_registration_2 nvarchar(50) = NULL,
    @assigned_control_room_agent nvarchar(128) = NULL,
    @client_contact_name nvarchar(150) = NULL,
    @client_contact_number nvarchar(50) = NULL,
    @client_po nvarchar(100) = NULL,
    @stock_number nvarchar(100) = NULL,
    @summary_of_incident nvarchar(max) = NULL,
    @positive_hijacking nvarchar(30) = NULL,
    @vehicle_recovered nvarchar(30) = NULL,
    @load_recovered nvarchar(30) = NULL,
    @trailers_recovered nvarchar(30) = NULL,
    @vehicle_key_available nvarchar(30) = NULL,
    @driver_on_scene nvarchar(30) = NULL,
    @tracking_unit_status nvarchar(100) = NULL,
    @username nvarchar(128)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NULLIF(LTRIM(RTRIM(@username)), '') IS NULL
        THROW 51030, 'Username is required.', 1;
    IF NOT EXISTS (
        SELECT 1 FROM dbo.DispatchIncidents
        WHERE id = @dispatch_id AND ISNULL(isdeleted, 0) = 0
          AND DispatchStatus NOT IN (N'Closed', N'Cancelled')
          AND ClosureApprovalStatus <> N'Pending'
    )
        THROW 51031, 'Dispatch cannot be edited in its current state.', 1;

    BEGIN TRY
        BEGIN TRANSACTION;

        UPDATE dbo.DispatchIncidents
        SET TrailerRegistration1 = NULLIF(LTRIM(RTRIM(@trailer_registration_1)), ''),
            TrailerRegistration2 = NULLIF(LTRIM(RTRIM(@trailer_registration_2)), ''),
            AssignedControlRoomAgent = COALESCE(NULLIF(LTRIM(RTRIM(@assigned_control_room_agent)), ''), @username),
            ClientContactName = NULLIF(LTRIM(RTRIM(@client_contact_name)), ''),
            ClientContactNumber = NULLIF(LTRIM(RTRIM(@client_contact_number)), ''),
            ClientPO = NULLIF(LTRIM(RTRIM(@client_po)), ''),
            StockNumber = NULLIF(LTRIM(RTRIM(@stock_number)), ''),
            SummaryOfIncident = NULLIF(LTRIM(RTRIM(@summary_of_incident)), ''),
            PositiveHijacking = NULLIF(LTRIM(RTRIM(@positive_hijacking)), ''),
            VehicleRecovered = NULLIF(LTRIM(RTRIM(@vehicle_recovered)), ''),
            LoadRecovered = NULLIF(LTRIM(RTRIM(@load_recovered)), ''),
            TrailersRecovered = NULLIF(LTRIM(RTRIM(@trailers_recovered)), ''),
            VehicleKeyAvailable = NULLIF(LTRIM(RTRIM(@vehicle_key_available)), ''),
            DriverOnScene = NULLIF(LTRIM(RTRIM(@driver_on_scene)), ''),
            TrackingUnitStatus = NULLIF(LTRIM(RTRIM(@tracking_unit_status)), ''),
            UpdatedBy = @username,
            UpdatedAt = SYSDATETIME()
        WHERE id = @dispatch_id;

        INSERT INTO dbo.DispatchAuditLog
            (dispatch_id, AuditAction, AuditMessage, AuditUsername, CreatedAt)
        VALUES
            (@dispatch_id, N'Operational details updated', N'Dispatch operational and recovery fields updated.', @username, SYSDATETIME());

        EXEC dbo.DispatchLink_RecalculateDispatchStatus @dispatch_id, @username;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

    SELECT * FROM dbo.DispatchIncidents WHERE id = @dispatch_id;
END;
GO

CREATE OR ALTER PROCEDURE dbo.DispatchLink_RequestClosure
    @dispatch_id int,
    @closing_comments nvarchar(max),
    @username nvarchar(128)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NULLIF(LTRIM(RTRIM(@username)), '') IS NULL
        THROW 51040, 'Username is required.', 1;
    IF NULLIF(LTRIM(RTRIM(@closing_comments)), '') IS NULL
        THROW 51041, 'Closing comments are required.', 1;

    BEGIN TRY
        BEGIN TRANSACTION;

        IF NOT EXISTS (
            SELECT 1 FROM dbo.DispatchIncidents WITH (UPDLOCK, HOLDLOCK)
            WHERE id = @dispatch_id AND ISNULL(isdeleted, 0) = 0
              AND DispatchStatus NOT IN (N'Closed', N'Cancelled')
        )
            THROW 51042, 'Dispatch incident is unavailable for closure.', 1;

        EXEC dbo.DispatchLink_RecalculateDispatchStatus @dispatch_id, @username;

        IF EXISTS (SELECT 1 FROM dbo.DispatchClosureReviews WHERE dispatch_id = @dispatch_id AND ReviewStatus = N'Pending')
            THROW 51043, 'A closure request is already pending.', 1;

        IF NOT EXISTS (SELECT 1 FROM dbo.DispatchAssignments WHERE dispatch_id = @dispatch_id AND DispatchedAt IS NOT NULL)
            THROW 51044, 'At least one dispatched ground-team assignment is required.', 1;

        IF EXISTS (
            SELECT 1 FROM dbo.DispatchAssignments
            WHERE dispatch_id = @dispatch_id AND DispatchedAt IS NOT NULL AND StoodDownAt IS NULL
        )
            THROW 51045, 'Every dispatched ground team must be stood down before closure.', 1;

        IF EXISTS (
            SELECT 1 FROM dbo.DispatchIncidents
            WHERE id = @dispatch_id AND (
                DispatchStatus <> N'Stood Down'
                OR NULLIF(LTRIM(RTRIM(SummaryOfIncident)), '') IS NULL
                OR VehicleRecovered IS NULL
                OR LoadRecovered IS NULL
                OR TrailersRecovered IS NULL
                OR DriverOnScene IS NULL
                OR TrackingUnitStatus IS NULL
            )
        )
            THROW 51046, 'Summary, recovery outcomes, driver-on-scene outcome, tracking status and stood-down status are required.', 1;

        DECLARE @request_sequence int;
        DECLARE @review_id int;
        DECLARE @old_approval_status nvarchar(30);

        SELECT @old_approval_status = ClosureApprovalStatus
        FROM dbo.DispatchIncidents
        WHERE id = @dispatch_id;

        SELECT @request_sequence = ISNULL(MAX(RequestSequence), 0) + 1
        FROM dbo.DispatchClosureReviews WITH (UPDLOCK, HOLDLOCK)
        WHERE dispatch_id = @dispatch_id;

        INSERT INTO dbo.DispatchClosureReviews
            (dispatch_id, RequestSequence, ReviewStatus, ClosingComments, RequestedBy, RequestedAt)
        VALUES
            (@dispatch_id, @request_sequence, N'Pending', LTRIM(RTRIM(@closing_comments)), @username, SYSDATETIME());

        SET @review_id = SCOPE_IDENTITY();

        UPDATE dbo.DispatchIncidents
        SET ClosureApprovalStatus = N'Pending',
            UpdatedBy = @username,
            UpdatedAt = SYSDATETIME()
        WHERE id = @dispatch_id;

        INSERT INTO dbo.DispatchAuditLog
            (dispatch_id, AuditAction, OldStatus, NewStatus, AuditMessage, AuditUsername, CreatedAt)
        VALUES
            (@dispatch_id, N'Closure requested', @old_approval_status, N'Pending',
             N'Dispatch submitted for manager closure approval.', @username, SYSDATETIME());

        COMMIT TRANSACTION;

        SELECT @review_id AS ClosureReviewId, @request_sequence AS RequestSequence,
               N'Pending' AS ClosureApprovalStatus, N'Stood Down' AS DispatchStatus;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.DispatchLink_ReviewClosure
    @closure_review_id int,
    @decision nvarchar(20),
    @manager_comments nvarchar(max) = NULL,
    @rejection_reason nvarchar(max) = NULL,
    @username nvarchar(128)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @decision NOT IN (N'Approved', N'Rejected')
        THROW 51050, 'Decision must be Approved or Rejected.', 1;
    IF NULLIF(LTRIM(RTRIM(@username)), '') IS NULL
        THROW 51051, 'Username is required.', 1;
    IF @decision = N'Rejected' AND NULLIF(LTRIM(RTRIM(@rejection_reason)), '') IS NULL
        THROW 51052, 'A rejection reason is required.', 1;

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @dispatch_id int;
        SELECT @dispatch_id = dispatch_id
        FROM dbo.DispatchClosureReviews WITH (UPDLOCK, HOLDLOCK)
        WHERE id = @closure_review_id AND ReviewStatus = N'Pending';

        IF @dispatch_id IS NULL
            THROW 51053, 'Pending closure review was not found.', 1;

        UPDATE dbo.DispatchClosureReviews
        SET ReviewStatus = @decision,
            ReviewedBy = @username,
            ReviewedAt = SYSDATETIME(),
            ManagerComments = NULLIF(LTRIM(RTRIM(@manager_comments)), ''),
            RejectionReason = CASE WHEN @decision = N'Rejected' THEN LTRIM(RTRIM(@rejection_reason)) ELSE NULL END
        WHERE id = @closure_review_id;

        IF NULLIF(LTRIM(RTRIM(@manager_comments)), '') IS NOT NULL
        BEGIN
            INSERT INTO dbo.DispatchManagerComments
                (dispatch_id, closure_review_id, CommentText, CommentBy, CommentedAt)
            VALUES
                (@dispatch_id, @closure_review_id, LTRIM(RTRIM(@manager_comments)), @username, SYSDATETIME());
        END;

        IF @decision = N'Approved'
        BEGIN
            UPDATE dbo.DispatchIncidents
            SET ClosureApprovalStatus = N'Approved',
                ClosedBy = @username,
                ClosedAt = SYSDATETIME(),
                UpdatedBy = @username,
                UpdatedAt = SYSDATETIME()
            WHERE id = @dispatch_id AND ISNULL(isdeleted, 0) = 0 AND DispatchStatus <> N'Cancelled';
        END
        ELSE
        BEGIN
            UPDATE dbo.DispatchIncidents
            SET ClosureApprovalStatus = N'Rejected',
                ClosedBy = NULL,
                ClosedAt = NULL,
                UpdatedBy = @username,
                UpdatedAt = SYSDATETIME()
            WHERE id = @dispatch_id AND ISNULL(isdeleted, 0) = 0 AND DispatchStatus <> N'Cancelled';
        END;

        IF @@ROWCOUNT = 0
            THROW 51054, 'Dispatch incident could not be reviewed in its current state.', 1;

        INSERT INTO dbo.DispatchAuditLog
            (dispatch_id, AuditAction, OldStatus, NewStatus, AuditMessage, AuditUsername, CreatedAt)
        VALUES
            (@dispatch_id, N'Closure reviewed', N'Pending', @decision,
             CASE WHEN @decision = N'Approved' THEN N'Manager approved dispatch closure.' ELSE N'Manager rejected dispatch closure.' END,
             @username, SYSDATETIME());

        EXEC dbo.DispatchLink_RecalculateDispatchStatus @dispatch_id, @username;

        COMMIT TRANSACTION;

        SELECT incident.id, incident.DispatchStatus, incident.ClosureApprovalStatus,
               review.id AS ClosureReviewId, review.ReviewStatus
        FROM dbo.DispatchIncidents incident
        JOIN dbo.DispatchClosureReviews review ON review.dispatch_id = incident.id
        WHERE incident.id = @dispatch_id AND review.id = @closure_review_id;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.DispatchLink_AddManagerComment
    @dispatch_id int,
    @closure_review_id int = NULL,
    @comment_text nvarchar(max),
    @username nvarchar(128)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NULLIF(LTRIM(RTRIM(@comment_text)), '') IS NULL
        THROW 51060, 'Comment is required.', 1;
    IF NULLIF(LTRIM(RTRIM(@username)), '') IS NULL
        THROW 51061, 'Username is required.', 1;
    IF NOT EXISTS (SELECT 1 FROM dbo.DispatchIncidents WHERE id = @dispatch_id AND ISNULL(isdeleted, 0) = 0)
        THROW 51062, 'Dispatch incident was not found.', 1;
    IF @closure_review_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM dbo.DispatchClosureReviews WHERE id = @closure_review_id AND dispatch_id = @dispatch_id
    )
        THROW 51063, 'Closure review does not belong to this dispatch.', 1;

    INSERT INTO dbo.DispatchManagerComments
        (dispatch_id, closure_review_id, CommentText, CommentBy, CommentedAt)
    VALUES
        (@dispatch_id, @closure_review_id, LTRIM(RTRIM(@comment_text)), @username, SYSDATETIME());

    SELECT CAST(SCOPE_IDENTITY() AS int) AS ManagerCommentId;
END;
GO

CREATE OR ALTER PROCEDURE dbo.DispatchLink_CancelDispatch
    @dispatch_id int,
    @cancellation_reason nvarchar(max),
    @username nvarchar(128)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NULLIF(LTRIM(RTRIM(@cancellation_reason)), '') IS NULL
        THROW 51070, 'Cancellation reason is required.', 1;
    IF NULLIF(LTRIM(RTRIM(@username)), '') IS NULL
        THROW 51071, 'Username is required.', 1;

    BEGIN TRY
        BEGIN TRANSACTION;

        IF NOT EXISTS (
            SELECT 1 FROM dbo.DispatchIncidents WITH (UPDLOCK, HOLDLOCK)
            WHERE id = @dispatch_id AND ISNULL(isdeleted, 0) = 0
              AND DispatchStatus NOT IN (N'Closed', N'Cancelled')
        )
            THROW 51072, 'Dispatch cannot be cancelled in its current state.', 1;

        UPDATE dbo.DispatchClosureReviews
        SET ReviewStatus = N'Rejected',
            ReviewedBy = @username,
            ReviewedAt = SYSDATETIME(),
            RejectionReason = N'Closure request superseded by dispatch cancellation.'
        WHERE dispatch_id = @dispatch_id AND ReviewStatus = N'Pending';

        UPDATE dbo.DispatchIncidents
        SET CancellationReason = LTRIM(RTRIM(@cancellation_reason)),
            CancelledBy = @username,
            CancelledAt = SYSDATETIME(),
            ClosureApprovalStatus = CASE WHEN ClosureApprovalStatus = N'Pending' THEN N'Rejected' ELSE ClosureApprovalStatus END,
            UpdatedBy = @username,
            UpdatedAt = SYSDATETIME()
        WHERE id = @dispatch_id;

        INSERT INTO dbo.DispatchAuditLog
            (dispatch_id, AuditAction, OldStatus, NewStatus, AuditMessage, AuditUsername, CreatedAt)
        SELECT @dispatch_id, N'Dispatch cancelled', DispatchStatus, N'Cancelled',
               LTRIM(RTRIM(@cancellation_reason)), @username, SYSDATETIME()
        FROM dbo.DispatchIncidents
        WHERE id = @dispatch_id;

        EXEC dbo.DispatchLink_RecalculateDispatchStatus @dispatch_id, @username;

        COMMIT TRANSACTION;

        SELECT id, DispatchStatus, ClosureApprovalStatus, CancelledAt, CancelledBy
        FROM dbo.DispatchIncidents WHERE id = @dispatch_id;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO
