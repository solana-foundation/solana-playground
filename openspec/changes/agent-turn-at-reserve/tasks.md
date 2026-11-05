# Tasks

## 1. Record the turn at reserve

- [x] 1.1 Add the migration (`model`, `settled_at`, the `started` outcome,
      `agent_turn_settled_check`), write the row in `reserve` and update it
      by id in `settle`, thread the id and the model through `api/agent.mjs`,
      regenerate `db/schema.sql` and update the runbook's `agent_turn`
      paragraph (HOO-2396). Verify: `yarn test-api` with `DATABASE_URL` set
      passes the ledger cases for a started row, an in-place settle, a double
      settle and a refused reserve; `yarn test-unit` passes the route's
      recorded-turn cases; the migration rolls back and re-applies with
      `yarn db-rollback` and `yarn db-migrate`.
