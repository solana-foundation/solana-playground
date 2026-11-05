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
`started`. A settle that finds no `started` row changes nothing, charges
nothing, and is reported as the warning `settle found no started turn`.

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
  still holds as reserved

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
