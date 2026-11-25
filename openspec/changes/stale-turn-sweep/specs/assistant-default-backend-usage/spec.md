# Spec Delta

## MODIFIED Requirements

### Requirement: Every admitted turn is recorded

`/api/agent` SHALL write one `agent_turn` row for every turn the spend ledger
admitted, in the statement that reserves it: `user_id`, `day` (the UTC day it
was reserved on), `at` (when it was reserved), `tier`, `model` (the model the
upstream was asked for), outcome `started` and `charged` equal to the
reservation, in micro-USD. The statement that settles the turn's charge SHALL
update that row, not add one: `outcome` (the turn's end: `completed`,
`unfinished`, `refused`, `abandoned`), `prompt_tokens`, `completion_tokens`,
`charged` and `settled_at`. Tokens are those the upstream reported for a
`completed` turn, and null otherwise or when the reported count is not a
non-negative integer that fits a Postgres `integer`. A `completed` turn whose
usage holds such a count is charged its whole reservation, as one that
reported no usage. A turn refused before the ledger (signed out,
cross-origin, malformed, too large, ledger down) writes nothing. A settle that
fails is reported as an error carrying the turn's id and leaves the row
`started`; when the failure was a database connection that did not open, the
report also carries the pool's idle, open and waiting clients as the connect
began, and the time spent before the driver's connect and inside it. A settle
that finds no `started` row changes nothing, charges nothing, and is reported
as the warning `settle found no started turn`.

#### Scenario: A completed turn (manual)

- **WHEN** a signed-in user's turn streams to its end and the upstream reports
  100 prompt and 20 completion tokens
- **THEN** one `agent_turn` row holds outcome `completed`, those token counts,
  the user's tier, the configured model, the reserve's day, a `settled_at`
  and a `charged` equal to what `agent_spend.spent` grew by

#### Scenario: A turn that never settles (manual)

- **WHEN** a turn is admitted and its function ends before the settle runs,
  or the settle fails
- **THEN** its `agent_turn` row stays with outcome `started`, null tokens, no
  `settled_at` and `charged` equal to its reservation, which `agent_spend`
  still holds as reserved, until the stale-turn sweep ends it

#### Scenario: A settle that cannot connect (manual)

- **WHEN** the settle fails because a new database connection did not open
  within the pool's connection timeout
- **THEN** the reported error carries the turn's id and the pool's idle, open
  and waiting clients as the connect began, with the time spent before the
  driver's connect and inside it

#### Scenario: A turn settled twice (manual)

- **WHEN** the settle for a turn runs a second time
- **THEN** `agent_spend` and the turn's row are unchanged by it

#### Scenario: A token count the table cannot hold (manual)

- **WHEN** the upstream reports `prompt_tokens` as `2.5`, `"12"`, `-1` or
  `2^31`
- **THEN** the turn is still settled and recorded, with `prompt_tokens` null,
  and charged its reservation

#### Scenario: No extra round trip for an admitted turn (manual)

- **WHEN** an admitted turn ends
- **THEN** the route has issued one query to reserve it and one to settle it,
  as before this change

## ADDED Requirements

### Requirement: Turns that never settled are ended

A sweep SHALL end every `agent_turn` row still `started` an hour after its
`at`: outcome `unfinished`, `settled_at` set, `charged` kept at the
reservation, and that reservation moved from `agent_spend.reserved` into
`spent` on the row's day, so the day's `spent + reserved` does not change. A
turn the sweep ended is never charged again, by the sweep or by a later
settle. A row `started` for less than an hour is left to its route.

#### Scenario: A turn started over an hour ago (manual)

- **WHEN** the sweep runs and two of a user's turns on one day have been
  `started` for over an hour, reserving 300 and 200
- **THEN** both rows hold outcome `unfinished`, a `settled_at` and their
  reservations as `charged`, and the day's `reserved` fell by 500 while its
  `spent` grew by 500

#### Scenario: A turn started within the hour (manual)

- **WHEN** the sweep runs and a turn has been `started` for 59 minutes
- **THEN** its row and its day's `agent_spend` are unchanged

#### Scenario: A settle after the sweep (manual)

- **WHEN** the sweep has ended a turn and its route's settle then runs
- **THEN** the settle finds no `started` row and the day's `agent_spend` is
  unchanged by it

### Requirement: The sweep runs on a schedule of its own

Vercel Cron SHALL call `GET /api/stale-turns` every 6 hours with
`Authorization: Bearer $CRON_SECRET`. The route answers `200` with
`{ "staleTurns": n }`, the number of turns the sweep ended; `500`, reported,
when the sweep fails; `503`, reported, without running anything while
`CRON_SECRET` is unset; `405` with `Allow: GET` for another method; and
`401` without the secret. The sweep is not a step of the retention job.

#### Scenario: A run by the cron (manual)

- **WHEN** the route is called with `GET` and the cron secret, and the sweep
  ends 2 turns
- **THEN** it answers `200` with `{ "staleTurns": 2 }`

#### Scenario: A sweep that fails (manual)

- **WHEN** the sweep's statement fails
- **THEN** the route answers `500` without a `staleTurns` count and reports
  the error `stale-turns sweep failed`

#### Scenario: No secret on the deployment (manual)

- **WHEN** `CRON_SECRET` is unset and any request reaches the route
- **THEN** it answers `503`, runs no sweep, and reports
  `CRON_SECRET is unset; stale-turns did not run`

#### Scenario: A caller without the secret (manual)

- **WHEN** a `GET` carries no `Authorization` header or another secret
- **THEN** the route answers `401` and runs no sweep
