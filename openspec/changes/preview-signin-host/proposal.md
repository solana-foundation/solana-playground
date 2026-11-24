# Proposal

## Why

Previews sign in through a host's GitHub app by Better Auth's OAuth proxy, and
the host has been the production deployment. Every preview then holds the
host's `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` and the proxy secret, so
whoever gets a branch built as a preview holds secrets of production's sign-in
(HOO-2816, row P5 of the security epic HOO-2872).

## What Changes

- The sign-in host for previews is a staging app: a Vercel project of its own
  with its own GitHub OAuth app, `AUTH_SECRET`, proxy secret and database.
  Creating it is a Foundation runbook, not code.
- The host role becomes explicit: a deployment is the host only with
  `AUTH_OAUTH_PROXY_HOST=true`. A non-preview deployment without it installs
  no proxy at all, so a production that is handed the proxy secret by mistake
  neither completes nor starts a proxied sign-in.
- A build check (`scripts/check-auth-env.mjs`, run by `vercel-build.sh`) fails
  a production build that holds any `AUTH_OAUTH_PROXY_*` variable without the
  host flag, a production build with `AUTH_OAUTH_PROXY_URL`, a preview build
  with the host flag, and any build whose `AUTH_SECRET` equals its proxy
  secret.
- `scripts/env-overlap.mjs` compares two environment files and names every
  variable whose value is the same in both, without printing values. The
  runbook runs it on the Preview environment against production's.
- `deploy-client-vercel.md` "Sign-in on previews", `production-runbook.md`,
  `neon.md` and `.env.example` describe the staging host.

## Capabilities

### New Capabilities

- `client-v2-preview-sign-in`: which deployment signs previews in, and what a
  preview and production may hold for it.

### Modified Capabilities

None.

## Impact

- Code: `client-v2/src/features/auth/model/auth.mjs`,
  `client-v2/src/shared/config/server-env.mjs`, two new scripts under
  `client-v2/scripts/` with `node --test` cases, `scripts/vercel-build.sh`.
- Deployments: the build check fails a deployment set up by the old
  runbook, so the order matters. Before this merges, every production that
  builds it must hold no `AUTH_OAUTH_PROXY_*` variable, and the current host
  (the Hoodies project's production, `solana-playground-teal.vercel.app`) must
  add `AUTH_OAUTH_PROXY_HOST=true`, or its next build fails.
- User-visible: none. A preview's user still has no `login`.
- Out of scope: a low-limit model key for previews (same report, item 13).
