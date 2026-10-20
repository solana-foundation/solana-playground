# Design

## Context

See `proposal.md`, section "Why". The gate spans three places: the
`/api/agent` handler (`client-v2/api/agent.mjs`), the session model
(`PgSession` in `client-v2/src/features/auth/model/session.ts`), and the
assistant panel (`Component/Connect.tsx` and `store.ts` under
`client-v2/src/views/sidebar/assistant/`).

## Goals / Non-Goals

**Goals:**

- `/api/agent` refuses a turn before it reads the body or calls the upstream,
  so a refused turn spends nothing.
- The panel never offers the default backend as ready to a user the server
  would refuse.

**Non-Goals:**

- Limiting how much a signed-in user may spend.

## Decisions

- **The server decides; the panel only follows.** `/api/agent` checks the
  origin, then that sign-in is configured, then the session, and answers 403,
  503, or 401 (`SIGNED_OUT_REASON`). The picker reads `PgSession` to choose
  between **Start** and **Sign in with GitHub**. The alternative, a gate in
  the panel alone, leaves the paid key open to any caller of `/api/agent`.
- **Unconfigured sign-in fails closed.** Without sign-in the server cannot
  tell a user from anyone else, so the default backend is off (503) rather
  than open.
- **The remembered choice survives the end of a session.** On a session end,
  the store's `PgSession.onDidChange` listener calls
  `PgAssistant.pickBackend` and leaves the remembered default in place, so the
  next sign-in reconnects it. Forgetting it would send the user back through
  the picker after every expiry.
- **A panel sign-in names its origin.** `PgSession.signIn({ from:
  "assistant" })` sets `PgSession.signingInFrom`, and the session effect skips
  opening the newest project for that sign-in: the user started it mid-task,
  with a prompt written for the open project.

## Risks / Trade-offs

- [The probe and the session load independently, so the picker can render
  before either is known] → reconnect waits for both: the probe must report
  configured and `PgSession.get()` must return a user.
- [A session that ends in another tab is noticed only on the next request] →
  the 401 with `SIGNED_OUT_REASON` refreshes the session, and the
  `onDidChange` listener returns the panel to the picker.
