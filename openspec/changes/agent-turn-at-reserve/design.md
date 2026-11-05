# Design

## Context

`reserve` is one `INSERT ... ON CONFLICT ... WHERE` on `agent_spend`, whose
row lock keeps two parallel turns from passing the cap together. `settle` is
one statement that settles `agent_spend` and inserts the `agent_turn` row.
See proposal.md for why the row moves.

## Goals / Non-Goals

**Goals:**

- The cap stays enforced by one atomic statement, and each end of a turn
  stays one round trip.
- A turn never charged twice, and never charged less than before.

**Non-Goals:**

- Sweeping `started` rows into another outcome. A row's age past the
  function's `maxDuration` already says it never settled.

## Decisions

- **The row is inserted by a CTE of the reserve statement**, from the
  `admitted` CTE's result, and the statement returns its id. Admission and
  the row cannot disagree, and a refused turn has no row. A second statement
  after the reserve was rejected: a function killed between the two would
  leave a reservation with no row, the case this change exists for.
- **`settle` updates by id, only while the row is `started`, and moves
  `agent_spend` only through that update** (a CTE joined on the row's
  `user_id` and `day`). A second settle, or one whose row is gone, matches
  nothing and changes nothing. The reservation then stays held, which
  overcharges, as the ledger may. `settle` returns whether it ended a turn,
  and the route reports a warning when it did not.
- **`settle` releases the reservation the row holds**, read from the row as
  the statement found it, not one the caller passes again. `agent_spend`
  then gives back exactly what `reserve` took.
- **`at` becomes the reserve time and `settled_at` is added**, rather than
  adding `started_at` and keeping `at` as the settle time. `at` stays
  `not null` and indexed with `user_id`, so a window query over `at` sees
  unsettled turns too. Rows from before the migration get `settled_at = at`;
  their `at` is a settle time, off from the reserve by at most a turn's
  length.
- **A `started` row is charged its reservation**, not 0: it is what
  `agent_spend` holds for that turn until it settles, so summing `charged`
  over a day still matches `spent + reserved`.
- **`agent_turn_settled_check`: `(outcome = 'started') = (settled_at is
  null)`, and `settled_at >= at`.** The token check already keeps tokens null
  on a `started` row.
- **`settled_at` defaults to `now()`, and `reserve` writes null explicitly.**
  Production migrates first, then merges, so the code deployed before this
  change still settles against the new schema: its insert names no
  `settled_at`, and without the default it would fail the check and leave
  every turn in that window unsettled.
- **The model is written at reserve**, from the configured `PG_AI_MODEL`,
  which the route knows before it calls the upstream.

## Risks / Trade-offs

- [The code reaches production before the migration] → every reserve fails
  on the missing column and the route answers 503 rather than serving
  unrecorded turns. The runbook's "migrate first, then merge" covers it.
- [The migration reaches production before the code, as the runbook
  orders] → the old `settle` keeps working through the `settled_at`
  default; its rows have no `model`, and their `at` is a settle time.
- [Rolling the migration back] → `started` rows become `unfinished` at their
  reservation, which is what the old `settle` wrote for a turn with no usage;
  settled rows get their settle time back in `at`.
