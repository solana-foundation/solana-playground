# Design

## Context

Sign-in runs on Better Auth 1.7 in database mode (`src/features/auth/model/auth.mjs`).
It writes the GitHub token to `account."accessToken"` (`text`). Two readers
exist: `api/gists.mjs`, through Better Auth's `getAccessToken`, and the agent
route's account-age lookup (`src/features/agent/server/account-age.mjs`),
through raw SQL. `getAuth()` has been asynchronous since #51, and
`api/gists.mjs` never awaited it, so Share as gist fails on `master`.

## Goals / Non-Goals

**Goals:**

- No usable GitHub token in a database row, backup or dump.
- Existing users keep working without signing in again.

**Non-Goals:**

- Encrypting program keypairs (see proposal, decided against).
- Rotating `AUTH_SECRET` without a sign-in per user.

## Decisions

- **Better Auth's `account.encryptOAuthTokens`, keyed by `AUTH_SECRET`.**
  Better Auth encrypts on every token write and decrypts on
  `getAccessToken`. Alternatives: Postgres `pgcrypto` (the key would travel
  to the database with each query and sit in its logs), or a separate
  `TOKEN_ENCRYPTION_KEY` (one more secret to provision in every environment
  for no gain: `AUTH_SECRET` already lives only in the deployment's
  environment, and rotating it already signs everyone out).
- **One reader.** `readGithubToken` moves from `api/gists.mjs` to
  `src/features/auth/model/github-token.mjs` and is exported from the auth
  slice's server entry, with `readGithubTokenWith(getAuth)`, the reader both
  routes build, so no route glues `getAuth` to it by hand again (the missing
  `await` was such glue). `learnAccountAge` takes a `readToken` dependency
  instead of reading SQL. A SQL reader would hand GitHub the ciphertext.
- **Legacy rows read through.** Better Auth decrypts only a value that looks
  like its ciphertext (`$ba$…` or even-length hex); a GitHub token (`gho_…`)
  is neither, so an old row is returned as stored. That makes the deploy
  safe before the backfill.
- **Backfill by script, not migration.** Migrations are SQL run by dbmate and
  never hold `AUTH_SECRET`. `scripts/db/encrypt-github-tokens.mjs` uses Better
  Auth's own `symmetricEncrypt`, checks each ciphertext decrypts back, and
  updates a row only while it still holds the value it read, so a sign-in in
  between wins. It counts by default and encrypts only with `--apply` and a
  `yes` typed in a terminal. Before asking, it decrypts one token a sign-in
  has already encrypted, so a wrong `AUTH_SECRET` stops the run. It refuses
  `BETTER_AUTH_SECRETS`, so it writes the one format a single secret
  produces.
- **A token that fails to decrypt is a missing grant, and reported.** Better
  Auth reports it as `FAILED_TO_GET_ACCESS_TOKEN`, its catch-all for any
  failure to produce the token. `NoGithubGrant` carries a closed reason
  (`no-account`, `unreadable`, `empty`): the route answers
  `401 github-unauthorized` for each, so the dialog asks for a sign-in, and
  reports `unreadable` to Sentry. The account-age lookup skips an
  `unreadable` token as `token-unreadable`, reported, not as `no-token`.

## Risks / Trade-offs

- [Rollback to a deployment before this change sends ciphertext to GitHub]
  → Share as gist was already broken there; the account-age lookup skips and
  retries. Users who signed in after this deploy sign in again after a
  rollback.
- [Backfill run with the wrong `AUTH_SECRET`] → The script decrypts a token
  a sign-in already encrypted and stops on failure; before any sign-in it
  cannot check and warns. The Makefile target pulls the secret from the
  Production environment.
- [Shared preview database] → Previews share one Vercel environment and so
  one `AUTH_SECRET`; a preview built from a branch without this change reads
  a token another preview encrypted as ciphertext. Previews only.

## Migration Plan

1. Merge; production deploys with encryption on. New sign-ins store
   ciphertext; old rows keep working as plaintext.
2. Run `make -f client-v2/Makefile.vercel encrypt-production-github-tokens`,
   which reports the count, asks for `yes`, encrypts, and reports zero rows
   left.
3. Rollback: revert the deploy; affected users sign in again.
