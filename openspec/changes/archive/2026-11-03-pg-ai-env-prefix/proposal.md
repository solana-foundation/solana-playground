# Proposal

## Why

The assistant's server-side variables are named `AGENT_*`. The name says
neither which product owns them nor that they are about AI, and it reads like
the build agent of a CI system in a Vercel project that holds forty other
variables. HOO-1744 settles on `PG_AI_*` before the default-key work
(HOO-1745) puts a production key behind one of them: renaming a variable that
already carries a production key is a deploy-time outage.

Every Vercel build already carries `AGENT_API_KEY` (`check-agent-env` fails a
build without it), so a hard rename would fail every deploy from the merge
until someone renames the project's variables.

## What Changes

- All thirteen `AGENT_<NAME>` variables read by `agentEnv` get the name
  `PG_AI_<NAME>`, with the same meaning and default.
- The old names stay readable as a deprecated fallback: when `PG_AI_<NAME>` is
  not set at all, `agentEnv` reads `AGENT_<NAME>` and logs one warning per old
  name per process. A `PG_AI_<NAME>` set to an empty string does not fall back.
- `scripts/check-agent-env.mjs` accepts `PG_AI_API_KEY`, or `AGENT_API_KEY`
  with a warning, and names the new variable in its messages.
- `.env.example`, `docs/deploy-client-vercel.md` (with a migration note),
  `docs/firewall.md`, `docs/testing.md`, code comments and tests use the new
  names; so do the design and pending manual tasks of the open change
  `default-backend-cost-gate`, which a person follows to set up the Gateway.
- Telemetry: none added, renamed or removed. No slice under `features/` or
  `widgets/` changes behaviour.

## Capabilities

### New Capabilities

- `assistant-server-env`: the names of the assistant's server-side variables
  and how the deprecated names are still read.

### Modified Capabilities

None.

## Impact

- Code: `client-v2/src/shared/config/server-env.mjs`,
  `client-v2/scripts/check-agent-env.mjs`, their tests, the tests that stub
  the variables, and comments that name them.
- Deploys: none break. A deployment that sets only `AGENT_*` builds and serves
  turns as before, and its function logs show one deprecation warning per old
  name read.
- User-visible: nothing.
- Out of scope: renaming the variables in the Vercel project (a person does it
  after the merge, with HOO-1745); removing the fallback (once no deployment
  sets `AGENT_*`); the constant `AGENT_TIERS` and the `features/agent` slice
  name, which are not environment variables.
