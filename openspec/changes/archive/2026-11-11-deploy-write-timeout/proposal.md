# Proposal

## Why

A buffer write the cluster never answers hangs the deploy without a word: web3.js's `fetch` has no time limit, so a
validator paused with `SIGSTOP` mid-deploy leaves only "This is taking longer than usual." in the terminal, and the
deploy waits forever (HOO-2819, found while testing HOO-2797). The refused-write line and the stalled-round limit from
HOO-2797 never see such a write, because it neither fails nor lands.

## What Changes

- A buffer write with no answer within 20 seconds counts as a refused write: when it is the round's first refusal, of
  whatever kind, it prints the existing refusal line with "No answer in 20 s" as its message, and the write is sent
  again in the next round.
- A write with no answer ends its round: the other workers send no further chunks, the round reads the buffer, and the
  stalled-round limit counts it as it counts any round, so a cluster that answers reads but not writes ends the deploy
  with "The RPC kept refusing buffer writes: ... (last refusal: No answer in 20 s)".
- A write the cluster answers within the limit, however slowly, is unaffected by it.
- A stop while a write waits for its answer ends the deploy at once; before, it waited for the answer.
- Telemetry: no event is added, renamed or removed. The Deploy funnel step's `deploy_started` and `deploy_succeeded`
  keep firing from `commands/deploy/deploy.ts` as before.

## Capabilities

### New Capabilities

### Modified Capabilities

- `client-v2-deploy`: a new requirement, a buffer write with no answer within the time limit counts as refused and
  ends its round.

## Impact

- Code: `client-v2/src/commands/deploy/bpf-loader-upgradeable.ts` (`loadBuffer` puts a time limit on each buffer
  write, and a stop ends the wait for its answer). A write that answers after its limit is found by the next buffer
  read; it may also have been sent again, a second fee. The Deploy stage, the terminal and a tutorial's deploy print the line through the `onRefusal` they already
  pass; none of them changes.
- Out of scope: `PgTx.send` and its other callers, which keep no time limit; the write pace, the backoff, the
  stalled-round limit and the rate-limit path, which stay as they are; reads of the buffer account and the round's
  confirmation, which a cluster that answers nothing still holds up (a paused local validator prints the refusal line
  and then waits on the read or the confirmation); aborting the request itself, which the browser keeps open until it answers or fails.
