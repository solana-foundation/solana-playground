# Tasks

All tasks land in #214 (HOO-2996) and run in order.

## 1. Settle on a warm connection

- [x] 1.1 HOO-2996: set the Cloud SQL pool's `idleTimeoutMillis` to the agent
      route's `maxDuration` (`IDLE_TIMEOUT_MS` in `cloud-sql.mjs`); verify with
      the `cloud-sql.test.mjs` case "keeps a connection open unused for as long
      as a turn may run", which fails against `cloud-sql.mjs` at b3f1d9385
- [x] 1.2 HOO-2996, after 1.1: put a `ConnectContext` on a failed `connect`
      in both forms and add it to the settle failure report in `api/agent.mjs`
      (scenario "A settle that cannot connect"); verify with the two
      `cloud-sql.test.mjs` cases "puts ... on a failed connect"

## 2. End turns that never settled

- [x] 2.1 HOO-2996: add `settleStaleTurns` and `STALE_TURN_AGE` to the ledger
      (requirement "Turns that never settled are ended"); verify with the three
      `ledger.test.mjs` cases on stale turns, run by `yarn test-api` against a
      database
- [x] 2.2 HOO-2996, after 2.1: move the `CRON_SECRET` gate into
      `refuseCronFor`, add `api/stale-turns.mjs` and its `crons` entry every 6
      hours, and document it in `client-v2/docs/production-runbook.md`
      (requirement "The sweep runs on a schedule of its own"); verify with
      `api/stale-turns.test.mjs` and the unchanged `api/retention.test.mjs`

## 3. Before the PR merges

- [ ] 3.1 HOO-2996, after 1 and 2: `yarn run check` green in CI on #214, and
      `/sx:review-pr` with 0 critical open
