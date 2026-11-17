USE [CC];
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

CREATE OR ALTER PROCEDURE dbo.DispatchLink_RecalculateDispatchStatus
    @dispatch_id int,
    @audit_username nvarchar(128) = N'System'
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NOT EXISTS (SELECT 1 FROM dbo.DispatchIncidents WHERE id = @dispatch_id AND ISNULL(isdeleted, 0) = 0)
        THROW 51001, 'Dispatch incident was not found.', 1;

    DECLARE @old_status nvarchar(30);
    DECLARE @new_status nvarchar(30);

    SELECT @old_status = DispatchStatus
    FROM dbo.DispatchIncidents WITH (UPDLOCK)
    WHERE id = @dispatch_id;

    SELECT @new_status =
        CASE
            WHEN incident.CancelledAt IS NOT NULL THEN N'Cancelled'
            WHEN incident.ClosureApprovalStatus = N'Approved' AND incident.ClosedAt IS NOT NULL THEN N'Closed'
            WHEN EXISTS (
                    SELECT 1 FROM dbo.DispatchAssignments assignment
                    WHERE assignment.dispatch_id = incident.id AND assignment.DispatchedAt IS NOT NULL
                 )
                 AND NOT EXISTS (
                    SELECT 1 FROM dbo.DispatchAssignments assignment
                    WHERE assignment.dispatch_id = incident.id
                      AND assignment.DispatchedAt IS NOT NULL
                      AND assignment.StoodDownAt IS NULL
                 ) THEN N'Stood Down'
            WHEN incident.VehicleRecovered = N'Yes'
              OR incident.LoadRecovered = N'Yes'
              OR incident.TrailersRecovered = N'Yes' THEN N'Recovered'
            WHEN EXISTS (
                    SELECT 1 FROM dbo.DispatchAssignments assignment
                    WHERE assignment.dispatch_id = incident.id AND assignment.TeamOnSceneAt IS NOT NULL
                 ) THEN N'On Scene'
            WHEN EXISTS (
                    SELECT 1 FROM dbo.DispatchAssignments assignment
                    WHERE assignment.dispatch_id = incident.id AND assignment.DispatchedAt IS NOT NULL
                 ) THEN N'Dispatched'
            ELSE N'Dispatch Requested'
        END
    FROM dbo.DispatchIncidents incident
    WHERE incident.id = @dispatch_id;

    IF @new_status <> @old_status
    BEGIN
        UPDATE dbo.DispatchIncidents
        SET DispatchStatus = @new_status,
            UpdatedAt = SYSDATETIME(),
            UpdatedBy = COALESCE(NULLIF(LTRIM(RTRIM(@audit_username)), ''), N'System')
        WHERE id = @dispatch_id;

        INSERT INTO dbo.DispatchAuditLog
            (dispatch_id, AuditAction, OldStatus, NewStatus, AuditMessage, AuditUsername, CreatedAt)
        VALUES
            (@dispatch_id, N'Dispatch status changed', @old_status, @new_status,
             N'Operational dispatch status recalculated from dispatch fields.',
             COALESCE(NULLIF(LTRIM(RTRIM(@audit_username)), ''), N'System'), SYSDATETIME());
    END;

END;
GO

CREATE OR ALTER PROCEDURE dbo.DispatchLink_UpsertAssignment
    @dispatch_id int,
    @sequence_no tinyint,
    @assigned_team nvarchar(80),
    @eta datetime2(0) = NULL,
    @dispatched_at datetime2(0) = NULL,
    @ob_number nvarchar(100) = NULL,
    @team_on_scene_at datetime2(0) = NULL,
    @stood_down_at datetime2(0) = NULL,
    @username nvarchar(128)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF @sequence_no NOT BETWEEN 1 AND 3
        THROW 51010, 'Assignment sequence must be between 1 and 3.', 1;
    IF @assigned_team NOT IN (N'Capital Air', N'Private & Confidential', N'CSG', N'Matrix')
        THROW 51011, 'Assigned team is not valid.', 1;
    IF NULLIF(LTRIM(RTRIM(@username)), '') IS NULL
        THROW 51012, 'Username is required.', 1;
    IF @team_on_scene_at IS NOT NULL AND (@dispatched_at IS NULL OR @team_on_scene_at < @dispatched_at)
        THROW 51013, 'Team-on-scene time cannot precede dispatch time.', 1;
    IF @stood_down_at IS NOT NULL AND (
        @dispatched_at IS NULL OR @stood_down_at < @dispatched_at
        OR (@team_on_scene_at IS NOT NULL AND @stood_down_at < @team_on_scene_at)
    )
        THROW 51014, 'Stand-down time is not valid.', 1;

    IF NOT EXISTS (
        SELECT 1 FROM dbo.DispatchIncidents
        WHERE id = @dispatch_id AND ISNULL(isdeleted, 0) = 0
          AND DispatchStatus NOT IN (N'Closed', N'Cancelled')
          AND ClosureApprovalStatus <> N'Pending'
    )
        THROW 51015, 'Dispatch cannot be edited in its current state.', 1;

    BEGIN TRY
        BEGIN TRANSACTION;

        IF EXISTS (SELECT 1 FROM dbo.DispatchAssignments WITH (UPDLOCK, HOLDLOCK) WHERE dispatch_id = @dispatch_id AND SequenceNo = @sequence_no)
        BEGIN
            UPDATE dbo.DispatchAssignments
            SET AssignedTeam = @assigned_team,
                ETA = @eta,
                DispatchedAt = @dispatched_at,
                OBNumber = NULLIF(LTRIM(RTRIM(@ob_number)), ''),
                TeamOnSceneAt = @team_on_scene_at,
                StoodDownAt = @stood_down_at,
                UpdatedBy = @username,
                UpdatedAt = SYSDATETIME()
            WHERE dispatch_id = @dispatch_id AND SequenceNo = @sequence_no;
        END
        ELSE
        BEGIN
            INSERT INTO dbo.DispatchAssignments
                (dispatch_id, SequenceNo, AssignedTeam, ETA, DispatchedAt, OBNumber, TeamOnSceneAt, StoodDownAt, CreatedBy)
            VALUES
                (@dispatch_id, @sequence_no, @assigned_team, @eta, @dispatched_at,
                 NULLIF(LTRIM(RTRIM(@ob_number)), ''), @team_on_scene_at, @stood_down_at, @username);
        END;

        EXEC dbo.DispatchLink_RecalculateDispatchStatus @dispatch_id, @username;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;

    SELECT * FROM dbo.DispatchAssignments
    WHERE dispatch_id = @dispatch_id
    ORDER BY SequenceNo;
END;
GO

CREATE OR ALTER PROCEDURE dbo.DispatchLink_DeleteAssignment
    @dispatch_id int,
    @sequence_no tinyint,
    @username nvarchar(128)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF NULLIF(LTRIM(RTRIM(@username)), '') IS NULL
        THROW 51020, 'Username is required.', 1;
    IF NOT EXISTS (
        SELECT 1 FROM dbo.DispatchIncidents
        WHERE id = @dispatch_id AND ISNULL(isdeleted, 0) = 0
          AND DispatchStatus NOT IN (N'Closed', N'Cancelled')
          AND ClosureApprovalStatus <> N'Pending'
    )
        THROW 51021, 'Dispatch cannot be edited in its current state.', 1;

    BEGIN TRY
        BEGIN TRANSACTION;
        DELETE FROM dbo.DispatchAssignments
        WHERE dispatch_id = @dispatch_id AND SequenceNo = @sequence_no;

        EXEC dbo.DispatchLink_RecalculateDispatchStatus @dispatch_id, @username;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO
