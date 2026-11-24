# Tasks

## 1. Staging sign-in host for previews

- [x] 1.1 Make the host role explicit (`AUTH_OAUTH_PROXY_HOST`), add the build
      check and the env-overlap script, and rewrite the sign-in docs for the
      staging host. Verify with `yarn test-api`
      (`src/features/auth/model/oauth-proxy.test.mjs`,
      `scripts/check-auth-env.test.mjs`, `scripts/env-overlap.test.mjs`)
      (HOO-2816; no dependencies; plan: [plans/1.1-staging-signin-host.md](plans/1.1-staging-signin-host.md))
- [ ] 1.2 Foundation runbook: create the staging Vercel project, its GitHub
      OAuth app and database, point the Preview environment at it, remove
      every `AUTH_OAUTH_PROXY_*` from production, and run `env-overlap.mjs`
      on Preview against Production. Recorded on HOO-2816 when done
      (HOO-2816; after 1.1)
