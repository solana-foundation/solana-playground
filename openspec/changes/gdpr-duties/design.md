# Design

## Context

See [proposal.md](proposal.md), "Why". The facts the approach rests on, read at
`foundation/master@12416edb7`:

- Every table keyed by a user cascades from `"user"` (`db/schema.sql`):
  `account`, `session`, `projects` (and through it `project_files` and
  `conversations`, then `messages`), `agent_spend` and `agent_turn`.
  `build_audit` has no foreign key on purpose
  (`db/migrations/20261106120000_build_audit.sql`) and copies `login` and
  `github_id` in.
- `deleteProject` (`features/persistence/model/projects.mjs`) tombstones the
  project and its conversations, deletes the files and messages and clears the
  titles. The tombstones refuse a stale device's push (`ensureThread`,
  `TOMBSTONED`). Every read of `projects.name` filters `deleted_at is null`.
- Sign-out is two halves (`relinquish` in `effects/session/session.tsx`): an
  upload while the cookie is valid (`PgChatSync.pushAll`,
  `PgProjectSync.pushCurrent`), then, once the server ended the session, a
  teardown that forgets the handed-over threads and removes clean projects
  (`releaseLocalProjects`).
- GA4: `ga4Provider` installs `window.gtag` and `window.dataLayer` when it is
  created in `initObservability`, and `GoogleAnalytics` injects `gtag.js`
  whenever a measurement id is set. Nothing asks.
- Better Auth stores the GitHub token in `account.accessToken`. HOO-2881 may
  encrypt it.

## Goals / Non-Goals

**Goals:**

- Ship with no migration: the release is close and the user ruled one out.
- No new way to lose work. Deletion removes from the browser only what the
  server held identically at the moment of deletion.

**Non-Goals:**

- A consent framework or a consent-management platform. One tri-state choice
  for one vendor.
- Server-side consent records. The choice lives in the browser that made it.

## Decisions

### Account deletion is our route, not Better Auth's `deleteUser`

`DELETE /api/account` (`api/account.mjs`) calls a `deleteAccount(userId)` in
`features/auth/server.mjs` that runs, in one `transaction`:
`update build_audit set login = null, github_id = null where user_id = $1`, then
`delete from "user" where id = $1`. The cascades do the rest.

Better Auth's `deleteUser` was the alternative. It needs enabling in
`getAuth`, runs its own deletes outside our pool's transaction, and offers
hooks rather than one transaction with the `build_audit` update. Ours is two
statements and covers the acceptance criterion in one place.

The `build_audit` update lives in `features/build-server`
(`scrubIdentity(query, userId)`, taking the transaction's `query`) so the table
keeps one owner; `features/auth` calls it through `server.mjs`. A feature
importing a feature breaks the layer rule, so the route composes them:
`api/account.mjs` opens the transaction and calls both, as
`api/build-server.mjs` already composes slices. `persistence/server.mjs`
exports `query` but not `transaction`, so the task exports `transaction` there
too.

### The token is read before the delete, through Better Auth

The route reads the GitHub token with Better Auth's `getAccessToken` before the
transaction, since the cascade removes it. Going through Better Auth rather than
`select "accessToken"` keeps working if HOO-2881 turns on token encryption.
Revocation is `DELETE https://api.github.com/applications/{GITHUB_CLIENT_ID}/grant`
with Basic auth from `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` and body
`{ "access_token": token }`, after the commit, bounded by a timeout. A missing
token, a timeout or a non-`204` answer gives `githubRevoked: false` and a
reported log. Revoking before the delete was the alternative: a revoke that
succeeds followed by a failed transaction leaves an account that can no longer
reach GitHub.

### Deletion in the browser runs the teardown and skips the upload

`PgSession.deleteAccount()` mirrors `_signOut`: it shares the
`_signingOut` latch, calls `DELETE /api/account`, and on success clears the
user and runs the teardown. It does not call the sign-out hook's upload half.
On deletion, an upload turns work the account never held into "saved", and the
teardown then removes it from the browser seconds before the server deletes it.

So the session effect registers a second hook, `setOnAccountDeleted`, whose
teardown is the sign-out teardown minus the upload:

- projects: `releaseLocalProjects` as is. It removes only projects whose files
  match this account's sync mark, so an unpushed edit or a project never synced
  stays.
- chats: `PgChatSync.forget` takes the threads that are fully on the server
  without pushing them. `chat-sync` gains a read, `syncedThreads()`, answering
  the same `HandOver` shape `pushAll` returns, for threads whose every local
  item the server has acknowledged. A thread with anything unacknowledged stays.

The alternative, keeping every local copy and detaching it from the account,
needs new transitions in the sync mark and the thread fence, which are where
this codebase has lost data before (`.claude/rules/project-sync.md`). The user
chose the sign-out cleanup.

A second tab still holds the session in memory. Its next request answers `401`
and it shows "Your session ended", keeping its marks, as for any ended session.
Its projects then count as another account's leftovers and never upload, which
is the existing rule for leftovers.

### Consent is a small store in `shared/lib/telemetry`

`shared/lib/telemetry/consent.ts` holds `readConsent()`, `writeConsent(choice)`
and `subscribe`, over one `localStorage` key, every access in `try`/`catch`.
`ga4Provider` reads the store at each `send`: it installs the gtag queue on the
first send while `allowed`, and drops the event otherwise. `GoogleAnalytics`
subscribes and injects `gtag.js` once the choice becomes `allowed`. On a change
to `declined` after `allowed`, the store sets
`window["ga-disable-<measurementId>"] = true`, Google's documented switch that
stops `gtag.js` from sending, and expires the `_ga` and `_ga_*` cookies on the
app's domain.

A Settings entry through `createSetting` was the alternative. A setting is
two-valued with a default, and the banner needs a third state, "not asked yet".
The Analytics switch is a custom row in the Advanced section bound to the
store, like the assistant key's row.

### The banner and its event belong to `widgets/observability`

`BaseConsentBanner` and `ConsentBanner` live in `widgets/observability/ui`,
rendered by `Observability` beside `GoogleAnalytics`, since that widget already
owns the GA4 configuration. `obs_analytics_consent_set` joins its tracker.
The banner is built from `shared/ui` parts, following the UI move rule. No
design exists for it yet: the task files a design ticket and ships the text
and buttons the spec names.

### Retention is a Vercel Cron on a guarded route

`api/retention.mjs` answers `GET` with `Authorization: Bearer $CRON_SECRET`,
which Vercel Cron sends when the variable is set. The three statements run
one by one, each in its own `try`, so one failure does not block the rest. A
GitHub Actions schedule was the alternative. It needs database credentials and
network access from Actions to production, which exist only for previews.

Deleted conversations are not purged: their content is erased at deletion, and
their rows refuse a re-upload from a device that signs in again months later.
IndexedDB keeps those threads with no expiry on Chrome and Firefox. Deleted
projects get `name = ''` in `deleteProject`, and the job clears rows deleted
before this change, so no migration is needed. `NOT NULL` holds, and the unique
index covers live rows only.

## Risks / Trade-offs

- [Deletion resets the day's AI cap and the hour's build limit for a GitHub
  account that signs in again] → Accepted until the follow-up ticket adds a
  carry-over table (HOO-2963). The AI tier is unaffected, since it comes from the GitHub
  account's age.
- [GA4 data drops to consenting visitors, breaking funnel comparisons across
  the deploy] → Named in the proposal. Mark the deploy date in GA4.
- [GA4 loads before consent if an import path calls `ga4Provider` some other
  way] → The provider itself checks the store at each send. The e2e scenario
  "A visitor who declines" fails on any request to Google.
- [`syncedThreads` misjudges a thread as acknowledged, and the teardown removes
  its only copy] → The read is the inverse of the `pushAll` bookkeeping and is
  tested against it. The task is reviewed on the data-loss path.
- [`CRON_SECRET` unset in production] → The route answers `503`, so retention
  silently does not run. The deploy task sets it and checks the first run's log.
- [A revocation that fails leaves the GitHub grant] → The menu tells the user
  to remove the app at `https://github.com/settings/applications`.

## Migration Plan

No schema migration. Deploy order:

1. Set `CRON_SECRET` in the Vercel production environment.
2. Merge. The cron takes effect with the production deployment.
3. Check the first run's log for the three counts.

Rollback is a revert. Rows already deleted or cleared stay that way.

## Open Questions

- The banner's look. It does not change the spec's text, buttons or ids; the
  design ticket settles placement and style.
