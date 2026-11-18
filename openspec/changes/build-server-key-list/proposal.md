# Proposal

## Why

The build server accepts one API key, `PG_API_KEY`, and the Playground's
`/api/build-server` route holds it. Giving a second client access means
sharing that key, so no client can be rotated or revoked without the others
(HOO-2890, part of finding B1 of HOO-2872, asked on HOO-2422 on 2026-11-13).

## What Changes

- The build server reads a list of keys, `PG_API_KEYS`, comma-separated, one
  per client, and admits a request on `/build`, `/deploy/<uuid>` and every
  `/unstable` route whose `x-api-key` matches any entry. A key outside the
  list, or no key, gets `401`, as today.
- `PG_API_KEY`, the single key deployments already set, counts as one more
  entry, so a server configured before this change keeps working unchanged.
- Each comparison stays constant-time, and every entry is compared whichever
  matches. The server logs how many keys it accepts, never a key.
- `/api/build-server` keeps sending one key, `PG_BUILD_SERVER_API_KEY`, now
  described as that deployment's entry of the list. No client-v2 behaviour
  changes; the runbook, `.env.example`, `server/app.yaml` and the manual
  test steps in `docs/testing.md` describe the list.
- No telemetry event is added, renamed or removed; no slice under
  `features/` or `widgets/` and no funnel step's code is touched.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `build-server-access`: "The build server can require an API key" accepts
  any key of a list instead of one key, and gains scenarios for a second
  client's key and a removed key.

## Impact

- Code: `server/src/middlewares/api_key.rs`, `server/src/config.rs`,
  `server/src/main.rs`. This is a fork-owned change to `server/`, like the
  API key check itself (HOO-2422): an upstream sync keeps it.
- Operations: production moves its key into `PG_API_KEYS`, held in a GCP
  secret, when a second client needs access; until then `PG_API_KEY` alone
  works. Revoking a client is removing its entry and restarting the server.
- Out of scope: storing SHA-256 digests of the keys instead of the keys;
  naming each key's client in logs or the audit trail; a client that runs
  only in a browser, which would publish its key and needs a route of its
  own in front; any change to how `/api/build-server` authenticates users.
