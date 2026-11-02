# Design

## Context

`api/agent.mjs` reserves a turn's worst case in `agent_spend` before the
upstream call and settles it after the response ends (HOO-1751). The route's
integration spec counts its queries: one `reserve`, one `settle`.

## Decisions

1. **A row per turn, not more columns on `agent_spend`.** A daily row cannot
   answer an hourly window or a request count per window; one row per turn
   answers any. Volume is a handful of rows per active user per day.
2. **Written by `settle`'s statement.** `settle` becomes a CTE: the
   `update agent_spend` and an `insert into agent_turn` in one statement, so
   the round-trip count the spec checks is unchanged and the two never
   disagree. The row carries the reserve's `day`, so a turn that settles after
   midnight still sums with the day it was charged on. Token counts come from
   the upstream and are bound only when they fit an `integer`; anything else
   is recorded as null, so bad upstream data can never fail the settle.
3. **A capped turn is counted, not logged.** It reserved nothing, and a
   capped user retrying in a loop would otherwise add a row per request to a
   table with no retention. `recordCapped` adds one to `agent_spend.capped`
   after the 429 is sent, in the route's `finally`, so it delays nothing. It is
   caught and logged like `settle`.
4. **Outcome is the ledger's `TurnEnd.kind`.** No new vocabulary; `charged`
   is `chargeFor`'s result, so a day's rows sum to that day's `spent`, short
   of any turn whose settle failed or whose function died before it.
5. **Redaction by runs, not by exact match.** Upstreams that echo a key
   usually mask part of it (`sk-...abcd`), so removing only the exact key
   would miss a long fragment. `redactSecrets` replaces every run of 8 or more
   characters of each key with `[redacted]`. Shorter runs are left: 8
   characters of a random key are not guessable, and shorter would start to
   hit ordinary words. The text is cut to the 300 characters the route relays
   before it is redacted, which bounds the work on an error body of any size;
   the route classifies a refusal from the text as received. The upstream's
   own 200 stream is forwarded byte for byte: redacting it would mean parsing
   every chunk and joining keys split across chunks, for an upstream that has
   never been seen to echo the key inside a successful stream.
6. **No retention yet.** The follow-up that sets the quota's shape decides how
   long rows are kept; until then the table grows, which at this volume is
   harmless for months.

## Risks

- Migration order: the new `settle` fails on a database without `agent_turn`,
  and a failing settle leaves the reservation spent (overcharge, never
  undercharge). The deploy page already says "migrate first, then merge".
