/*
    Dispatch Link - normalize ground-team allocation codes

    Sets the four standard DispatchTeams codes used by User_info allocations:
      Capital Air             -> CA
      CSG                     -> CSG
      Matrix / legacy Rentrak -> Matrix
      Private & Confidential  -> PanC

    TeamId remains unchanged, so existing ETA request/response relationships
    are preserved.
*/

USE [CC];
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

IF OBJECT_ID(N'dbo.DispatchTeams', N'U') IS NULL
    THROW 51021, 'dbo.DispatchTeams must exist before normalizing team codes.', 1;
GO

IF EXISTS
(
    SELECT 1
    FROM dbo.DispatchTeams
    WHERE TeamCode IN (N'CA', N'PanC', N'Matrix')
      AND TeamName NOT IN (N'Capital Air', N'Private & Confidential', N'Matrix', N'Ren' + N'trak')
)
    THROW 51022, 'A requested allocation code is already used by another dispatch team.', 1;
GO

BEGIN TRANSACTION;

UPDATE dbo.DispatchTeams
SET TeamCode = N'CA',
    UpdatedAt = SYSDATETIME(),
    UpdatedBy = N'allocation-code-migration'
WHERE TeamName = N'Capital Air'
  AND TeamCode <> N'CA';

UPDATE dbo.DispatchTeams
SET TeamCode = N'CSG',
    UpdatedAt = SYSDATETIME(),
    UpdatedBy = N'allocation-code-migration'
WHERE TeamName = N'CSG'
  AND TeamCode <> N'CSG';

UPDATE dbo.DispatchTeams
SET TeamCode = N'PanC',
    UpdatedAt = SYSDATETIME(),
    UpdatedBy = N'allocation-code-migration'
WHERE TeamName = N'Private & Confidential'
  AND TeamCode <> N'PanC';

UPDATE dbo.DispatchTeams
SET TeamCode = N'Matrix',
    TeamName = N'Matrix',
    GroupUsername = N'eta_matrix',
    IsActive = 1,
    DisplayOrder = 40,
    MonthlyDispatchLimit = COALESCE(MonthlyDispatchLimit, 150),
    UpdatedAt = SYSDATETIME(),
    UpdatedBy = N'allocation-code-migration'
WHERE TeamName IN (N'Matrix', N'Ren' + N'trak')
   OR TeamCode IN (N'MATRIX', N'REN' + N'TRAK');

COMMIT TRANSACTION;
GO

PRINT 'Dispatch-team allocation codes normalized to CA, CSG, Matrix, and PanC.';
GO
