USE [CC];
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;

IF OBJECT_ID('dbo.DispatchIncidents', 'U') IS NULL
    THROW 51000, 'dbo.DispatchIncidents does not exist.', 1;

IF OBJECT_ID('dbo.DispatchClosureReviews', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.DispatchClosureReviews (
        id int IDENTITY(1,1) NOT NULL,
        dispatch_id int NOT NULL,
        RequestSequence int NOT NULL,
        ReviewStatus nvarchar(20) NOT NULL,
        ClosingComments nvarchar(max) NOT NULL,
        RequestedBy nvarchar(128) NOT NULL,
        RequestedAt datetime2(3) NOT NULL CONSTRAINT DF_DispatchClosureReviews_RequestedAt DEFAULT (SYSDATETIME()),
        ReviewedBy nvarchar(128) NULL,
        ReviewedAt datetime2(3) NULL,
        ManagerComments nvarchar(max) NULL,
        RejectionReason nvarchar(max) NULL,
        CONSTRAINT PK_DispatchClosureReviews PRIMARY KEY CLUSTERED (id),
        CONSTRAINT FK_DispatchClosureReviews_DispatchIncidents FOREIGN KEY (dispatch_id)
            REFERENCES dbo.DispatchIncidents(id),
        CONSTRAINT UQ_DispatchClosureReviews_Dispatch_Sequence UNIQUE (dispatch_id, RequestSequence),
        CONSTRAINT UQ_DispatchClosureReviews_Id_Dispatch UNIQUE (id, dispatch_id),
        CONSTRAINT CK_DispatchClosureReviews_Sequence CHECK (RequestSequence >= 1),
        CONSTRAINT CK_DispatchClosureReviews_Status CHECK (ReviewStatus IN ('Pending','Approved','Rejected')),
        CONSTRAINT CK_DispatchClosureReviews_ReviewDetails CHECK (
            (ReviewStatus = 'Pending' AND ReviewedBy IS NULL AND ReviewedAt IS NULL AND RejectionReason IS NULL)
            OR
            (ReviewStatus = 'Approved' AND NULLIF(LTRIM(RTRIM(ReviewedBy)), '') IS NOT NULL AND ReviewedAt IS NOT NULL AND RejectionReason IS NULL)
            OR
            (ReviewStatus = 'Rejected' AND NULLIF(LTRIM(RTRIM(ReviewedBy)), '') IS NOT NULL AND ReviewedAt IS NOT NULL AND NULLIF(LTRIM(RTRIM(RejectionReason)), '') IS NOT NULL)
        )
    );
END;
GO

IF OBJECT_ID('dbo.DispatchManagerComments', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.DispatchManagerComments (
        id int IDENTITY(1,1) NOT NULL,
        dispatch_id int NOT NULL,
        closure_review_id int NULL,
        CommentText nvarchar(max) NOT NULL,
        CommentBy nvarchar(128) NOT NULL,
        CommentedAt datetime2(3) NOT NULL CONSTRAINT DF_DispatchManagerComments_CommentedAt DEFAULT (SYSDATETIME()),
        CONSTRAINT PK_DispatchManagerComments PRIMARY KEY CLUSTERED (id),
        CONSTRAINT FK_DispatchManagerComments_DispatchIncidents FOREIGN KEY (dispatch_id)
            REFERENCES dbo.DispatchIncidents(id),
        CONSTRAINT FK_DispatchManagerComments_ClosureReview FOREIGN KEY (closure_review_id, dispatch_id)
            REFERENCES dbo.DispatchClosureReviews(id, dispatch_id),
        CONSTRAINT CK_DispatchManagerComments_Text CHECK (NULLIF(LTRIM(RTRIM(CommentText)), '') IS NOT NULL)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.DispatchClosureReviews') AND name = 'IX_DispatchClosureReviews_Status_RequestedAt')
    CREATE INDEX IX_DispatchClosureReviews_Status_RequestedAt
        ON dbo.DispatchClosureReviews(ReviewStatus, RequestedAt)
        INCLUDE (dispatch_id, RequestedBy);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.DispatchClosureReviews') AND name = 'UX_DispatchClosureReviews_OnePending')
    CREATE UNIQUE INDEX UX_DispatchClosureReviews_OnePending
        ON dbo.DispatchClosureReviews(dispatch_id)
        WHERE ReviewStatus = 'Pending';
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.DispatchManagerComments') AND name = 'IX_DispatchManagerComments_Dispatch_Time')
    CREATE INDEX IX_DispatchManagerComments_Dispatch_Time
        ON dbo.DispatchManagerComments(dispatch_id, CommentedAt)
        INCLUDE (closure_review_id, CommentBy);
GO
