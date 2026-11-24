# Tasks

Groups 1, 2 and 3 may run at the same time. Inside group 2, task 2.2 depends
on 2.1, and the two ship in the same release: 2.1 alone turns GA4 off for every
visitor until the banner asks. Task 3.2 depends on 1.2 and 3.1. Task 4.1 runs
after 1.1 is merged and before the release.

## 1. Server

- [x] 1.1 Retention job and project names (HOO-2955). `deleteProject` sets
  `name = ''` in its transaction. `api/retention.mjs` answers `GET` with
  `Authorization: Bearer $CRON_SECRET`, runs the three steps of the
  `data-retention` spec, each in its own `try`, and answers with their counts.
  `CRON_SECRET` is read through `shared/config/server-env.mjs` and listed in
  `.env.example`. `client-v2/vercel.json` gains `crons` with `/api/retention`
  daily. The deploy doc and the production runbook already name the variable
  and the job (proposal PR). Verified by `api/retention.test.mjs` covering every
  `data-retention` scenario, a `projects.test.mjs` case that a deleted
  project's row holds an empty name and a restarted tutorial its new name,
  and `yarn test-api` passing.
- [x] 1.2 `DELETE /api/account` (HOO-2955). `features/build-server` exports
  `scrubIdentity(query, userId)`; `persistence/server.mjs` exports
  `transaction`; `features/auth/server.mjs` exports the token read and the
  grant revocation. `api/account.mjs` reads the token, runs the `user` delete
  and then the scrub in one transaction, then revokes, as in design.md "Account
  deletion is our route". Verified by `api/account.test.mjs` covering every
  `account-deletion` scenario marked as pinned there, with `fetch` to GitHub
  stubbed, under `yarn test-api`.

## 2. Analytics consent

- [x] 2.1 Consent store and the GA4 gate (HOO-2955).
  `shared/lib/telemetry/consent.ts` per design.md "Consent is a small store";
  `ga4Provider` and `GoogleAnalytics` read it. Verified by in-source tests of
  the store (missing, garbage and throwing storage read as `unanswered`), and
  cases in the in-source block of `providers/ga4.ts` for the `client-v2-telemetry` scenarios, including no
  `window.gtag` while not `allowed` and no pre-consent event after Allow.
- [x] 2.2 Banner, Settings switch and `obs_analytics_consent_set` (HOO-2955,
  depends on 2.1). `BaseConsentBanner` and `ConsentBanner` in
  `widgets/observability/ui`, the event declared in that slice's
  `model/telemetry.ts`, the Analytics row in the Settings page's Advanced
  section. The banner's look follows theme tokens; its design is a ticket of
  its own (ticket to file, outside this task).
  `docs/assistant-context.md` says analytics is asked for, then
  `yarn sync-assistant-context`. Verified by Playwright tests named after every `analytics-consent`
  scenario not marked manual, run with a test measurement id and asserting on
  requests to `googletagmanager.com`, and component tests asserting the event
  through the memory provider.

## 3. Account menu

- [x] 3.1 Privacy policy item (HOO-2955). The `client-v2-account` delta:
  the item in both menu states, `privacy-policy` added to `AccountItem`.
  Verified by a `BaseAccountMenu.test.tsx` case for the link's `href` and
  `target`, and the event through the memory provider.
- [x] 3.2 Delete account (HOO-2955, depends on 1.2 and 3.1, the second for
  the menu file both touch). `PgSession.deleteAccount`, the
  `setOnAccountDeleted` hook with the upload-free teardown,
  `PgChatSync.syncedThreads`, `auth_account_deleted`, and the menu's question
  with `session_delete_account_ended`, as in design.md "Deletion in the
  browser". `docs/assistant-context.md` lists Delete account and what it
  removes, then `yarn sync-assistant-context`. Verified by `session.ts` tests that deletion never calls the
  upload half and runs the teardown only after the server's success,
  `chat-sync` tests that `syncedThreads` leaves out a thread with any
  unacknowledged item, a Playwright test for "Deleting from the menu" with
  `/api/account` stubbed, and the events through the memory provider. Review
  runs on Opus: a mistake here removes a user's only copy.

## 4. Release

- [ ] 4.1 Turn retention on in production (HOO-2955). Set `CRON_SECRET` in
  the Vercel production environment before the release, then read the first
  run's log. Verified by the log line with the three counts, dated, in the
  HOO-2955 thread.

## Workflow follow-up

- The quota carry-over that closes the reset on deletion is HOO-2963 and
  needs a migration after the release.
- Archive the change in the PR that ticks its last task, on a human's yes.
