# Tasks

Both tasks are HOO-2078, one PR each, in this order.

## 1. The typed turn failure

- [x] 1.1 `TurnFailure` in `views/sidebar/assistant/model/types.ts` with
      `reason` (`provider`, `refusal`, `paused`, `capped`), `status` and the
      SDK's error as `cause`; `model/provider.ts` rejects with a `TurnFailure`
      wherever it rethrows an `AiTurnError` (the pass-through keeps `kind`
      and `status`; the refusal and the signed-out refusal keep their text; a
      `backendRefusal` of kind `limit` gives reason `capped` with its status,
      after HOO-1751's `agent_refused` is tracked), and the thread's text for
      each case is unchanged (HOO-2078); verify
      `provider.test.ts` has a row per reason, a network failure with no
      status and both limit refusals included, asserting the class, the
      reason, the status and the message, each failing against the provider
      HOO-1751 merged (`56be278f`), and `yarn run check` passes

## 2. The events

- [ ] 2.1 Declare `assistant_turn_sent`, `assistant_turn_answered`,
      `assistant_turn_failed` and `assistant_turn_capped` in
      `widgets/assistant/model/telemetry.ts` with a TSDoc comment each, and
      send them from `use-turn.ts` around the provider's send as
      [design.md](design.md) decides, classifying a `TurnFailure` by its
      reason and any other error as `other` (HOO-2078; depends on 1.1);
      verify `use-turn.test.tsx` asserts through the memory provider every
      scenario of
      [specs/client-v2-assistant-usage/spec.md](specs/client-v2-assistant-usage/spec.md):
      sent then answered, nothing for a send with no backend or one refused
      while a turn runs, sent and stopped only for a Stop, failed with reason and status for a provider
      error, a refusal and a step-limit error, capped and not failed for
      reason `capped`, failed `provider` `429` for a plain 429, and no event
      carrying the prompt when the failure message quotes it; and that
      `src/app/slice-structure.test.ts`, `yarn test-types` and
      `yarn run check` pass

## Workflow follow-up

- Archive the change once a human says so, in the PR that ticks 2.1
  (`client-v2/CLAUDE.md`, "Specs and changes" 5).
