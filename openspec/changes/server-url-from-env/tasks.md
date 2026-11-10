# Tasks

Lands in the `stable-anchor-1-1-2` PR. Every task: ticket to file. 1.1 and 1.2 may run in parallel.

## 1. Client

- [x] 1.1 Remove the App Engine literal from `settings/server/default-endpoint.ts`: the "Solana Foundation" option
  takes `BUILD_SERVER_URL` and is absent when it is empty, the default falls back to `LOCAL_ENDPOINT`, and
  `settings/server/server.ts` logs the warning. Update `buildEndpointOptions` in `settings/stored-endpoint.ts` and
  the in-source tests that pin the old URL. Verify: unit tests for every scenario of "Development defaults to a
  local server" and "The Foundation option follows the variable".
- [x] 1.2 Add `scripts/server-url-gate.mjs` and run it first in `build:bundle`. Verify: a `node --test` case
  (`yarn test-api`) for both scenarios of "A deployment build needs the URL".

## 2. Images and docs

- [ ] 2.1 Replace the `ONBUILD ENV` in `client-v2/Dockerfile` with a build argument, pass it from `compose.yaml`'s
  standalone profile, and update `client-v2/.env.example` and `docs/testing.md`. Verify: `git grep -n appspot --
  ':!client/'` prints nothing, and the standalone compose profile builds with the variable passed.

## 3. Integration

- [ ] 3.1 Run `yarn run check`. Verify: it passes, and the PR description lists the Vercel variables a human must set
  before merge. Depends on 1.1, 1.2, and 2.1.
