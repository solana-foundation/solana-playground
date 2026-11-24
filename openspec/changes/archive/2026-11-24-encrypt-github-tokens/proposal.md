# Proposal

## Why

The `account` table holds each user's GitHub access token as GitHub issued
it, so anyone who reads the database through a leak, a backup or an operator
can act on GitHub as that user (row D2 of the security register, HOO-2881).
Synced program keypairs sit in the same database, and users are not told.

## What Changes

- The server stores each GitHub access token encrypted with `AUTH_SECRET`, a
  key held in the deployment's environment and never in the database. A row
  read directly holds no usable token.
- Routes read the token only through Better Auth, which decrypts it; no
  route reads the token column with SQL, and only the one-off backfill does,
  to encrypt it. The account-age lookup of the agent route moves off its SQL
  read.
- A token that no longer decrypts, after `AUTH_SECRET` changes, reads as "no
  GitHub grant": Share as gist answers `401 github-unauthorized`, and the
  user's next sign-in stores a fresh token. The failure is reported to
  Sentry, since a changed secret makes every encrypted token unreadable.
- Rows written before encryption are encrypted once, after the deploy, by a
  script that production runs through
  `make -f client-v2/Makefile.vercel encrypt-production-github-tokens`.
- Share as gist works again: the route awaited nothing from the auth factory
  since it became asynchronous (#51), so every request failed before reading
  the token.
- Program keypairs stay unencrypted, by decision: sync stores them so the
  program id is the same on every device, and a keypair can claim its
  address only until the program's first deploy. The Program id block says
  that a signed-in account stores the keypair.
- Telemetry: the change adds, renames and removes no events, and touches no
  funnel step's code.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `gist-sharing`: the stored GitHub token is encrypted at rest, and a token
  that no longer decrypts reads as a missing grant.
- `client-v2-program-keypair`: the Program id block tells the user that their
  account stores the keypair.

## Impact

- Code: `client-v2/src/features/auth` (token options, `readGithubToken`),
  `client-v2/api/gists.mjs`, `client-v2/api/agent.mjs`,
  `client-v2/src/features/agent/server/account-age.mjs`,
  `client-v2/src/features/program-keypair/ui/BaseProgramKeypair.tsx`.
- Operations: a new script `client-v2/scripts/db/encrypt-github-tokens.mjs`
  and Makefile target, run once after the production deploy; the deploy doc
  records it and what rotating `AUTH_SECRET` now costs (one sign-in per user
  before Share as gist works).
- Database: no migration. The column stays `text`; only its contents change.
- Rollback: a deployment older than this one sends a stored ciphertext to
  GitHub as a token, so the account-age lookup fails there until the user
  signs in again; Share as gist already fails on such a deployment.
- Out of scope: encrypting program keypairs or any other synced file;
  encrypting tokens of providers other than GitHub (there are none); key
  rotation tooling for `AUTH_SECRET`; the GDPR duties of HOO-2955.
