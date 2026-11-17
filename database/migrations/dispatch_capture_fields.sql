-- Requires explicit database-change authorization before execution (AGENTS.md).
-- Target: CC.dbo.DispatchIncidents, through SQLPage's configured connection only.
-- Additive ALTER statements compatible with SQLPage; no existing records are updated or backfilled.
-- Existing rows retain NULL in all three columns and remain exempt.
-- New rows default to DispatchCaptureVersion = 1, including ETA-created drafts.
-- Deliberately omit WITH VALUES so the default applies only to future inserts.
-- Preflight must confirm all three columns are absent; do not run on partial schema.
ALTER TABLE CC.dbo.DispatchIncidents ADD
    ActualDispatchReason nvarchar(1000) NULL;

ALTER TABLE CC.dbo.DispatchIncidents ADD
    PositiveVESA nvarchar(20) NULL
        CONSTRAINT CK_DispatchIncidents_PositiveVESA CHECK (
            PositiveVESA IS NULL OR PositiveVESA COLLATE Latin1_General_100_BIN2 IN (N'Hijacked', N'Stolen', N'No')
        );

ALTER TABLE CC.dbo.DispatchIncidents ADD
    DispatchCaptureVersion tinyint NULL
        CONSTRAINT DF_DispatchIncidents_DispatchCaptureVersion DEFAULT (1)
        CONSTRAINT CK_DispatchIncidents_DispatchCaptureVersion CHECK (
            DispatchCaptureVersion IS NULL OR DispatchCaptureVersion = 1
        );
