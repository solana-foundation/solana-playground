# Design

## Context

See [proposal.md](proposal.md), section "Why". At `foundation/master` b43d3a1e1:

- `settings/server/default-endpoint.ts` exports `FOUNDATION_ENDPOINT` (the App Engine URL), `LOCAL_ENDPOINT`,
  `SERVER_ENDPOINT_OPTIONS`, and `defaultServerEndpoint`, which returns `REACT_APP_SERVER_URL` or
  `FOUNDATION_ENDPOINT`. `api.solpg.io` is not an option.
- `settings/stored-endpoint.ts` (`buildEndpointOptions`) stores a provided address as an option key: `configured`
  (the variable's URL, when set), `foundation`, `local`. A key whose option is gone, `solpg` among them, falls back
  to the default.
- `scripts/sentry-gate.mjs` already decides build behaviour from `VERCEL_ENV`.
- `client-v2/Dockerfile` sets `REACT_APP_SERVER_URL` to the App Engine URL with `ONBUILD ENV` for images built
  without the server.

## Goals / Non-Goals

**Goals:** the host lives only in deployment configuration; a misconfigured deployment fails at build, not in a
user's first build.

**Non-Goals:** hiding the URL from the bundle, which `REACT_APP_*` inlining makes impossible.

## Decisions

**`FOUNDATION_ENDPOINT` becomes the variable.** `default-endpoint.ts` reads `SERVER_URL` from
`shared/config/client-env`; the "Solana Foundation" option exists only when it is non-empty;
`defaultServerEndpoint` returns it or `LOCAL_ENDPOINT`. The `foundation` key in `stored-endpoint.ts` maps to the same
value, so a stored `foundation` choice follows the variable, and falls back to the default through the existing
"option is gone" path when the variable is empty.

**The build gate is a script beside `sentry-gate.mjs`.** `scripts/server-url-gate.mjs` exports a predicate over
`env` and a CLI entry that `build:bundle` runs first. It fails only when `VERCEL_ENV` is set, so CI's
`client-v2.yml` build and local builds pass without the variable. Alternative: fail every build. Rejected by the
user: CI and local builds would need a value.

**The warning is logged once from `settings/server/server.ts`** through `shared/lib/logger`, when the default is
computed without the variable.

**Docker takes the URL as a build argument.** `client-v2/Dockerfile` drops the `ONBUILD ENV` line and declares
`ARG REACT_APP_SERVER_URL` exported as `ENV`; `compose.yaml` passes `${REACT_APP_SERVER_URL:-}` to the standalone
profile. The profiles with a server keep `http://localhost:${PG_PORT}`.

## Risks / Trade-offs

- [A Vercel project lacks the variable when this merges] → the build fails with the variable's name, and the
  previous deployment stays live. The PR description lists both Vercel projects and both environments.
- [A developer relying on the old default gets a local server] → the start-up warning names the variable;
  `client-v2/.env.example` documents it.

## Migration Plan

1. Set `REACT_APP_SERVER_URL` for production and preview in both Vercel projects (a human does this).
2. Merge. Rollback: revert the PR.
