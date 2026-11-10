# Proposal

## Why

`client-v2` hard-codes the production build server's App Engine host in `settings/server/default-endpoint.ts`
(`FOUNDATION_ENDPOINT`) and in `client-v2/Dockerfile`. The host belongs in deployment configuration, so it can change
without a commit and is not published in the repository. The value still ships in the built JavaScript, since
`REACT_APP_*` variables are inlined at build time: this change removes it from the sources, not from the bundle.

## What Changes

- **BREAKING** The build server's production URL comes only from `REACT_APP_SERVER_URL`. No source file names the
  App Engine host.
- **BREAKING** A Vercel build (`VERCEL_ENV` set) fails before bundling when `REACT_APP_SERVER_URL` is empty, with a
  message naming the variable.
- `yarn dev` without the variable defaults to `http://localhost:8080` and logs a warning naming the variable.
- The "Solana Foundation" option of the "Build server" setting uses the URL from `REACT_APP_SERVER_URL` and is not
  listed when the variable is empty. A profile that stored that option follows the variable; with the variable
  empty, it falls back to the default.
- `client-v2/Dockerfile` drops its baked-in URL and takes `REACT_APP_SERVER_URL` as a build argument; the compose
  profiles pass it through.
- Telemetry: no slice under `features/` or `widgets/` changes; no events are added, renamed, or removed.

## Capabilities

### New Capabilities

- `client-v2-build-server-endpoint`: where `client-v2`'s build server URL comes from, what the "Build server"
  setting offers, and what a build or a development server does when the URL is not configured.

### Modified Capabilities

None.

## Impact

- Deployment: both Vercel projects (the Foundation's and hoodies') need `REACT_APP_SERVER_URL` for production and
  preview before this merges; without it the next deployment fails at the new check. An agent never reads or sets
  the value.
- Development: a fresh checkout without the variable builds against a local server. A developer who wants the
  production server sets the variable in `client-v2/.env`.
- Code: `client-v2/src/settings/server/default-endpoint.ts`, `client-v2/src/settings/stored-endpoint.ts`, a build
  gate script beside `scripts/sentry-gate.mjs`, `client-v2/Dockerfile`, `compose.yaml`, `client-v2/.env.example`,
  `docs/testing.md`.
- Out of scope: removing the host from git history; `client/` and `server/`; the local option of the setting; the
  RPC endpoints.
