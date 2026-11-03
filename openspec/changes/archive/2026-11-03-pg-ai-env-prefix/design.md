# Design

## Context

`agentEnv` (`src/shared/config/server-env.mjs`) is the only reader of the
assistant's variables; every other file names them only in tests, comments and
docs. `check-agent-env` runs in `vercel.json`'s build command and fails any
Vercel build without `AGENT_API_KEY`, so every deployment carries that name
today.

## Decisions

1. **Prefix `PG_AI_`**, as the ticket names it. `NAME` keeps its suffix, so
   `agentEnv()` keeps its field names and no caller changes.
2. **Fallback, not a hard rename.** A hard rename fails every Vercel build from
   the merge until a person renames the project's variables, and turns the
   default backend off on any deployment that is redeployed first. With the
   fallback the merge and the Vercel rename are independent steps.
3. **Fallback only when the new name is absent.** `read()` treats an empty
   value as unset, but an empty `PG_AI_API_KEY` is how `docs/testing.md` turns
   the backend off on a command line over a `client-v2/.env` that sets the key.
   If emptiness fell through to `AGENT_API_KEY`, a developer whose `.env` still
   holds the old name would get the backend back.
4. **One warning per old name per process.** `agentEnv` runs on every request;
   a warning per call would flood the function logs. A module-level `Set` of
   names already warned about is enough: a serverless instance is one process.

## Removal

The fallback goes once no deployment sets `AGENT_*`: after the Vercel project
is renamed (with HOO-1745) and each developer's `client-v2/.env` follows.
Removing it is a one-line change to `resolveAgent` plus its tests; ticket to file
when the rename is done.

## Risks

- A developer's `.env` keeps working, with warnings in the dev server's log,
  which is the intended nudge.
