# Proposal

## Why

The default assistant backend (`/api/agent`) spends the deployment's paid key,
so only a signed-in user on our origin may use it. This change amends
[`assistant-own-key-storage`](../archive/2026-10-15-assistant-own-key-storage/)
(`openspec/changes/archive/2026-10-15-assistant-own-key-storage/`, HOO-1748),
whose proposal says the default backend's remembered choice "keeps working as
before". That no longer holds: a remembered default reconnects only for a
signed-in user, and `openspec/specs/assistant-own-key/spec.md` says nothing
about sign-in. HOO-2101 is the ticket for the gate.

## What Changes

- `/api/agent` answers a POST without a session with 401 and
  `{ "reason": "signed-out" }` (`SIGNED_OUT_REASON`), with 503 when sign-in is
  not configured on the deployment, and with 403 to a request from another
  origin.
- The assistant picker (`Component/Connect.tsx`) tags the default backend
  "sign-in needed" for a signed-out user, and its button reads
  **Sign in with GitHub** in place of **Start**.
- A remembered default backend reconnects on load only when the `/api/agent`
  probe reports it configured and the user is signed in.
- When the session ends while the panel is connected to the default backend,
  the panel returns to the picker, which offers sign-in. A key-based backend
  stays connected.
- A sign-in started from the panel (`PgSession.signIn({ from: "assistant" })`)
  keeps the open project, where a sign-in from the header opens the account's
  newest project.
- Telemetry: the assistant panel lives in the legacy `views/` root. The change
  to `features/auth` (`SignInOrigin`, `PgSession.signingInFrom`) adds, renames,
  and removes no events.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `assistant-own-key`: adds two requirements. The keyless default backend is
  offered and reconnected only for a signed-in user, and a sign-in from the
  assistant panel keeps the open project.

## Impact

- Code: `client-v2/api/agent.mjs`, `client-v2/src/features/auth/` (`auth.mjs`,
  `config.mjs`, `model/session.ts`), `client-v2/src/effects/session/session.tsx`,
  `client-v2/src/views/sidebar/assistant/` (`Component/Connect.tsx`,
  `store.ts`, `model/openai.ts`, `model/remembered-backend.ts`).
- Docs: `docs/assistant-context.md`, `docs/testing.md`,
  `client-v2/docs/deploy-client-vercel.md`.
- Tests: `client-v2/e2e/assistant-sign-in.e2e.spec.ts`, unit tests beside
  `store.ts` and `effects/session/session.tsx`, and the `/api/agent`
  integration tests in `src/features/agent/agent.integration.spec.ts`.
- User-visible: a signed-out user sees the default backend but has to sign in
  with GitHub to use it; a key-based backend works without an account.
- Out of scope: the archived change
  `openspec/changes/archive/2026-10-15-assistant-own-key-storage/` stays as it
  was archived; per-user quotas or rate limits on `/api/agent`; any change to
  how a key-based backend stores or sends its key.
