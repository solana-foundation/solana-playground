# Spec Delta

## Purpose

**Area:** `GET /api/retention` and its daily Vercel Cron (client-v2 API)

Which stored rows Playground removes or clears once they are no longer needed,
how often, and who may start the job, so no personal data is kept longer than
its use.

## ADDED Requirements

### Requirement: Only the scheduler starts the retention job

`GET /api/retention` SHALL run the job only for a request whose
`Authorization` header is `Bearer <CRON_SECRET>`, compared in constant time.
It SHALL answer `401` for any other header, `405` for any other method, and
`503`, running nothing, when `CRON_SECRET` is unset.

#### Scenario: A request without the secret (manual)
The route against Postgres: pinned by `client-v2/api/retention.test.mjs` under `yarn test-api`.
- **WHEN** `GET /api/retention` arrives with no `Authorization` header
- **THEN** the route answers `401` and no row changes

#### Scenario: A deployment without the secret (manual)
The route against Postgres: pinned by `client-v2/api/retention.test.mjs` under `yarn test-api`.
- **WHEN** `CRON_SECRET` is unset and any request arrives
- **THEN** the route answers `503` and no row changes

### Requirement: The job runs daily on production

`client-v2/vercel.json` SHALL schedule `GET /api/retention` once a day.

#### Scenario: The schedule is declared (manual)
Read in review; Vercel runs the schedule on production only.
- **WHEN** a reviewer reads `client-v2/vercel.json`
- **THEN** its `crons` list holds `/api/retention` with a daily schedule

### Requirement: Expired sessions are deleted

The job SHALL delete every `session` row whose `expiresAt` is in the past.

#### Scenario: An expired and a live session (manual)
The route against Postgres: pinned by `client-v2/api/retention.test.mjs` under `yarn test-api`.
- **WHEN** the job runs over one session that expired yesterday and one that expires tomorrow
- **THEN** the expired row is gone and the live row stays

### Requirement: Build audit rows are kept for 90 days

The job SHALL delete every `build_audit` row whose `at` is more than 90 days
before the run.

#### Scenario: Rows either side of the limit (manual)
The route against Postgres: pinned by `client-v2/api/retention.test.mjs` under `yarn test-api`.
- **WHEN** the job runs over a row from 91 days ago and a row from 89 days ago
- **THEN** the 91-day-old row is gone and the 89-day-old row stays

### Requirement: Deleted projects keep no name

The job SHALL set `name` to the empty string on every `projects` row whose
`deleted_at` is set and whose `name` is not already empty. The row itself
stays.

#### Scenario: A project deleted before this change (manual)
The route against Postgres: pinned by `client-v2/api/retention.test.mjs` under `yarn test-api`.
- **WHEN** the job runs over a deleted project still named "alice-defi"
- **THEN** the row stays deleted, with an empty `name`

### Requirement: The job reports what it did

The job SHALL answer `200` with the number of rows each step changed, as
`{ "sessions": n, "buildAudit": n, "projectNames": n }`, and log the same
counts. A step that fails SHALL be logged with `report: true`, SHALL NOT stop
the other steps, and SHALL make the route answer `500` with the counts of the
steps that ran.

#### Scenario: One step fails (manual)
The route against Postgres: pinned by `client-v2/api/retention.test.mjs` under `yarn test-api`.
- **WHEN** the `build_audit` delete fails and the other two steps succeed
- **THEN** the route answers `500`, the expired sessions are gone, deleted projects' names are cleared, and the failure is reported
