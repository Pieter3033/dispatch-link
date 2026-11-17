# Dispatch Link

Dispatch management module with a SQLPage API and browser interface. An alternative Express backend is included under src.

## Source layout

- public: browser interface and static assets
- api and root SQL files: SQLPage endpoints
- database: schema definitions, migrations and integration procedure source
- src: alternative Node.js backend
- tools: report generation and connector source
- tests: regression checks and SQLPage integration test source

## Configuration

This repository is a sanitized source snapshot. Personal approver names, alert recipients, production URLs, server identifiers and machine-specific upload paths were replaced with examples. Review these placeholders before using the code in an environment.

For SQLPage, mount this module under dispatch_link in an existing application and configure the host application's database connection locally. Host configuration and authentication files are intentionally excluded.

For the alternative Node backend, install dependencies with npm ci, copy .env.example to .env, and provide the required local settings. Never commit the populated .env.

SQL migration and procedure files are source only. They are not executed automatically. Database changes and any helper that connects to a database require a separately reviewed deployment procedure. SQLPage integration tests create temporary application endpoints; review them before execution.

## Data protection

Real credentials, database files, uploads, incident data, generated reports, screenshots, manuals, backups, logs, dependencies, executable binaries and machine-specific operational instructions are excluded. The initial commit was checked with Gitleaks and against local credential values before upload.

Preserve the exclusion rules in .gitignore. Review staged files and run a secret scan before future pushes.

## Snapshot validation

All 44 JavaScript files passed syntax checks. The selected offline regression tests passed 50 of 55 checks. Five checks require follow-up: ETA event-handler extraction uses an outdated boundary; PDF generation requires local backend configuration; return-to-approvals and VESA harnesses omit helpers now used by the frontend; VESA navigation also expects a sibling host-application directory. No database integration tests or migration scripts were run.

Gitleaks found no secrets in the exported source. A separate exact-value check found no matches for the populated local database credential values.
