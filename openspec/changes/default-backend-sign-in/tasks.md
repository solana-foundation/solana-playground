# Tasks

## 1. The sign-in gate

- [x] 1.1 Gate `/api/agent` behind a GitHub session on our origin (401 with
  `SIGNED_OUT_REASON`, 503 when sign-in is not configured, 403 from another
  origin); in the assistant picker, offer **Sign in with GitHub** for the
  default backend to a signed-out user and reconnect a remembered default only
  for a signed-in one; return the panel to the picker when the session ends on
  the default backend; keep the open project on a sign-in started from the
  panel. No telemetry events are added, renamed, or removed. Verify with
  `e2e/assistant-sign-in.e2e.spec.ts` (the `assistant-own-key:` scenarios),
  the unit tests in `store.test.ts` and `effects/session/session.test.ts`, and
  `src/features/agent/agent.integration.spec.ts`. HOO-2101.
