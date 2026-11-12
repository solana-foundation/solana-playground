-- `agent_turn` gets its row when the turn is reserved, not when it settles,
-- and names the model that served it (HOO-2396 follow-up). A function killed
-- at `maxDuration` never reaches `settle`, and those are the longest turns;
-- with the row written at reserve they stay visible as `started`. The model
-- changes between deploys (`PG_AI_MODEL`), and tokens and charges are not
-- comparable across models. See `features/agent/server/ledger.mjs` for the
-- statements that write the table.

-- migrate:up

-- What each column means from here on:
--
-- - `at`: when the turn was reserved. Rows written before this migration
--   hold their settle time here, as `settled_at` does.
-- - `settled_at`: when `settle` ended the turn; null while it is `started`.
--   `settled_at - at` is how long a turn written after this migration took.
-- - `outcome`: `started` from reserve until `settle` writes the ledger's
--   `TurnEnd` kind. A row still `started` well after the function's
--   `maxDuration` is a turn that never settled.
-- - `charged`: micro-USD. A `started` row holds the reservation, which
--   `agent_spend` keeps in `reserved`, against the cap, for a turn that never
--   settles; `settle` replaces it with the turn's charge.
-- - `prompt_tokens`, `completion_tokens`: as before, null unless `completed`,
--   so null on a `started` row too (`agent_turn_tokens_check`).
-- - `model`: the model the route asked the upstream for (`PG_AI_MODEL`, or
--   its default), written at reserve. Null on rows written before this
--   migration.
alter table agent_turn
  add column model text,
  add column settled_at timestamptz;

update agent_turn set settled_at = at;

-- The default is for the code still deployed while this migration is
-- applied ("migrate first, then merge"): its `settle` inserts a settled row
-- without `settled_at`, which would otherwise fail `agent_turn_settled_check`
-- and leave the turn's reservation spent. `reserve` writes null explicitly.
-- TODO(HOO-2396): drop the default in a later migration once no deployment
-- runs the settle-time insert; until then a writer that omits `settled_at`
-- gets a settled row instead of a check failure.
alter table agent_turn alter column settled_at set default now();

alter table agent_turn
  drop constraint agent_turn_outcome_check,
  add constraint agent_turn_outcome_check check (
    outcome in ('started', 'completed', 'unfinished', 'refused', 'abandoned')
  ),
  add constraint agent_turn_settled_check check (
    ((outcome = 'started') = (settled_at is null)) and settled_at >= at
  );

-- migrate:down

-- The old table records settled turns only, with `at` as the settle time. A
-- turn that never settled is kept as `unfinished` at its reservation, which is
-- what the old `settle` would have written for a turn that reported no usage.
-- Its `at` stays the reserve time, the nearest to a settle time it has.
alter table agent_turn
  drop constraint agent_turn_settled_check,
  drop constraint agent_turn_outcome_check;

update agent_turn set outcome = 'unfinished' where outcome = 'started';
update agent_turn set at = settled_at where settled_at is not null;

alter table agent_turn
  add constraint agent_turn_outcome_check check (
    outcome in ('completed', 'unfinished', 'refused', 'abandoned')
  ),
  drop column if exists settled_at,
  drop column if exists model;
