# Spec Delta

## Purpose

Which deployment signs a preview build in, so that a preview holds no secret
of production's sign-in.

## ADDED Requirements

Its scenarios are checked by Node tests, not in the browser, so they carry the
`(manual)` mark: `src/features/auth/model/oauth-proxy.test.mjs`,
`scripts/check-auth-env.test.mjs` and `scripts/env-overlap.test.mjs`
(`yarn test-api`, under `client-v2/`).

### Requirement: Only a flagged deployment hosts preview sign-in

A deployment SHALL act as the OAuth proxy's host only when
`AUTH_OAUTH_PROXY_HOST` is exactly `true`, `AUTH_OAUTH_PROXY_SECRET` is set
and `VERCEL_ENV` is not `preview`. The host SHALL NOT serve the proxy's
completion endpoints. A deployment outside a preview without the host flag
SHALL install no proxy. A preview whose proxy URL names one of its own
hostnames SHALL keep the proxy without its completion endpoints.

#### Scenario: The staging app is the host (manual)

- **WHEN** a production deployment has `AUTH_OAUTH_PROXY_HOST=true` and the proxy secret
- **THEN** it installs the proxy without its completion endpoints

#### Scenario: Production handed the secret by mistake (manual)

- **WHEN** a production deployment has the proxy secret and no host flag
- **THEN** it installs no proxy

### Requirement: Builds refuse a sign-in environment that mixes roles

A Vercel build SHALL fail when its environment would let production take part
in preview sign-in or would reuse one secret for two purposes: a production
build with any `AUTH_OAUTH_PROXY_*` variable but no host flag, a production
build with `AUTH_OAUTH_PROXY_URL`, a preview build with the host flag, or a
build whose `AUTH_SECRET` equals its `AUTH_OAUTH_PROXY_SECRET`. The failure
SHALL name the variables and never print a value.

#### Scenario: Production with a proxy variable (manual)

- **WHEN** a production build has `AUTH_OAUTH_PROXY_SECRET` and no `AUTH_OAUTH_PROXY_HOST`
- **THEN** the build fails naming `AUTH_OAUTH_PROXY_SECRET`

#### Scenario: Production without proxy variables (manual)

- **WHEN** a production build has none of the `AUTH_OAUTH_PROXY_*` variables
- **THEN** the check passes

### Requirement: Preview and production share no value

The repository SHALL provide a script that, given two environment files,
names every variable whose non-empty value appears in both, ignoring public
`REACT_APP_*` and `VERCEL_*` names and boolean flags, exits non-zero when it
names any, and never prints a value.

#### Scenario: A shared secret (manual)

- **WHEN** the preview file and the production file hold the same `GITHUB_CLIENT_SECRET`
- **THEN** the script names `GITHUB_CLIENT_SECRET` and exits 1
