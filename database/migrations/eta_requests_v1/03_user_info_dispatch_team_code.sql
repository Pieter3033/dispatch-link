/*
    Dispatch Link - explicit ground-team user allocation

    Adds a nullable team code to Jobcard.dbo.User_info. Ground-team users keep
    Usertype 11; DispatchTeamCode identifies the active CC.dbo.DispatchTeams
    row they are allowed to represent.

    This migration is additive and does not assign or update any user.
*/

USE [Jobcard];
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

IF OBJECT_ID(N'dbo.User_info', N'U') IS NULL
    THROW 51020, 'dbo.User_info must exist before adding DispatchTeamCode.', 1;
GO

IF COL_LENGTH(N'dbo.User_info', N'DispatchTeamCode') IS NULL
    ALTER TABLE dbo.User_info ADD DispatchTeamCode nvarchar(50) NULL;
GO

IF OBJECT_ID(N'dbo.CK_User_info_DispatchTeamCode_NotBlank', N'C') IS NULL
    ALTER TABLE dbo.User_info WITH CHECK
        ADD CONSTRAINT CK_User_info_DispatchTeamCode_NotBlank
        CHECK (DispatchTeamCode IS NULL OR LEN(LTRIM(RTRIM(DispatchTeamCode))) > 0);
GO

PRINT 'Jobcard.dbo.User_info.DispatchTeamCode is ready for ground-team allocation.';
GO
