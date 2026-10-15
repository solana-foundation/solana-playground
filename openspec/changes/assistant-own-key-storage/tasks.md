# Tasks

All tasks are HOO-1748 and land in one PR, in this order; none can run in
parallel with another, since each builds on the one before.

## 1. Keep and forget the connection

- [x] 1.1 ([plan](plans/1.1-own-key-storage.md)) Extend `model/remembered-backend.ts`: `rememberBackend(connection)`,
      `forgetBackend()` clearing both stores, `rememberedConnection()` with shape
      checks, logged (never valued) storage failures; verify with unit tests in
      `remembered-backend.test.ts` covering store, read, clear, switch to the
      default, a malformed value, an unknown provider and storage that throws
- [x] 1.2 ([plan](plans/1.1-own-key-storage.md)) Call it from `PgAssistant.connect` and `disconnect` in `store.ts`
      (depends on 1.1); verify with `store.test.ts` that after connecting with a
      key, `localStorage` and the persisted thread hold no key string, and that
      disconnecting empties `sessionStorage`

## 2. Reconnect on load

- [x] 2.1 ([plan](plans/1.1-own-key-storage.md)) Reconnect a stored key-based connection on mount in
      `Component/Connect.tsx`, under the existing guards (depends on 1.2);
      verify with the spec's Playwright scenarios in
      `e2e/assistant-reconnect.e2e.spec.ts`, titled
      `assistant-own-key: <scenario name>`, one test per scenario of the
      `assistant-own-key` spec, none of which needs a live provider (storage
      that refuses access is simulated with an init script that makes
      `sessionStorage` throw)

## 3. Record the decision

- [x] 3.1 ([plan](plans/1.1-own-key-storage.md)) Rewrite the comments that said the key is never persisted:
      `store.ts` and `remembered-backend.ts` describe the `sessionStorage`
      entry and point at this change, `model/anthropic.ts` points at
      `remembered-backend`, and `model/openai.ts` drops its pointer to the
      old decision. Record the redaction of the key from provider errors
      (`model/redact-key.ts`) as a decision in `design.md`. Update the key
      handling in `docs/assistant-context.md`, then `yarn sync-assistant-context`;
      verify `grep -rn "in memory only" client-v2/src/views/sidebar/assistant`
      finds nothing about the key and `yarn spec:validate` passes
