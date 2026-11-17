/*
    The deployed, SQLPage 0.25-compatible create query is maintained at:

        api/save_incident.sql

    That endpoint intentionally uses only INSERT ... SELECT, UPDATE, and SELECT.
    Do not replace it with a procedural IF/BEGIN/END batch: SQLPage 0.25's parser
    rejects those statements in page SQL files.
*/
