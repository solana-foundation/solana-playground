# Proposal

## Why

client-v2 stores personal data from GitHub sign-in and from use of the app,
and sends events to GA4 without asking, yet it links no privacy notice, offers
no way to delete an account and keeps some rows forever (HOO-2955). EU and UK
visitors are owed a notice, erasure on request, consent before analytics and
bounded retention.

## What Changes

- **Privacy notice link.** The account menu, signed in and signed out, and the
  consent banner link the Solana Foundation's privacy policy at
  `https://solana.com/privacy-policy`. Playground has no notice page of its
  own: the user confirmed the Foundation's policy covers it.
- **Delete account.** The account menu gains "Delete account", which asks in
  place, like sign-out, and offers Export first. `DELETE /api/account`
  deletes the `user` row in one transaction, which cascades to `account`,
  `session`, `projects`, `project_files`, `conversations`, `messages`,
  `agent_spend` and `agent_turn`, and clears `login` and `github_id` on the
  user's `build_audit` rows. It then revokes the GitHub OAuth grant. The
  browser runs the sign-out cleanup: projects and chats saved to the account
  leave this browser, and unsaved ones stay.
- **Analytics consent.** GA4 loads, and its queue exists, only after the
  visitor allows it. A banner asks every visitor once (Allow / Decline). An
  "Analytics" switch in Settings changes the answer later. The choice is kept
  in this browser. A visitor who declines, or has not answered, sends no
  request to `googletagmanager.com`, and an event tracked before consent is
  never sent to GA4 later.
- **Retention.** A daily Vercel Cron calls `GET /api/retention`, guarded by
  `CRON_SECRET`. The route deletes `session` rows past `expiresAt`, deletes
  `build_audit` rows older than 90 days, and clears the name of every
  deleted project.
- **A deleted project keeps no name.** `deleteProject` sets the row's `name`
  to the empty string. The row stays, holding ids, owner, kind and
  timestamps, because the row is what refuses a stale device's upload. The
  same holds for deleted conversations, which already keep no title and no
  messages, so this change adds no purge for them.
- **No migration.** Every change above uses the existing schema: the
  cascades exist, `build_audit` has no foreign key, and `projects.name`
  accepts an empty string.
- **Telemetry.**
  - `session_account_item_picked` gains the items `delete-account` and
    `privacy-policy`.
  - `session-footer` adds `session_delete_account_ended`, with `outcome`
    `ok` or `cancelled`, mirroring `session_sign_out_ended`.
  - `features/auth` adds `auth_account_deleted`, sent when the server accepts
    the deletion.
  - `widgets/observability` adds `obs_analytics_consent_set`, with `choice`
    (`allowed`, `declined`) and `via` (`banner`, `settings`). A `declined`
    event never reaches GA4. It goes to the log provider only.
  - The `Sign in` funnel step's events (`auth_signed_in`,
    `auth_sign_in_failed` in `PgSession._signIn`) are kept unchanged.
  - Consequence for analytics: GA4 counts only visitors who allow it, so every
    funnel in GA4 shows fewer visitors from the deploy of this change on.

## Capabilities

### New Capabilities

- `account-deletion`: what deleting an account removes on the server, in the
  build audit, at GitHub and in the browser, and how the account menu asks.
- `analytics-consent`: when GA4 may load and receive events, how the
  visitor is asked, and how the answer is changed and kept.
- `data-retention`: which rows the daily retention job removes or clears, and
  who may call it.

### Modified Capabilities

- `client-v2-telemetry`: "GA4 loads only with a measurement id" also requires
  consent, and the queue is not installed before consent.
- `client-v2-auth`: "Sign-in and sign-out are tracked" adds
  `auth_account_deleted`.
- `client-v2-account`: the account menu adds the privacy policy link and the
  Delete account question, and their events.
- `project-deletion`: deleting a project clears its name on the server.

## Impact

- **Code:** `client-v2/api/account.mjs` and `client-v2/api/retention.mjs`
  (new); `features/auth` (`PgSession.deleteAccount`, server-side deletion and
  grant revocation); `features/persistence` (`deleteProject`);
  `features/build-server` (the `build_audit` scrub);
  `shared/lib/telemetry` (GA4 consent gate); `widgets/observability`
  (banner, consent state); `widgets/session-footer` (menu items and
  question); `widgets/settings-page` (Analytics row);
  `client-v2/vercel.json` (`crons`).
- **Configuration:** `CRON_SECRET` in the Vercel production environment. A
  deployment without it answers 503 on `/api/retention`, so retention does
  not run there until it is set. Vercel runs crons on production deployments
  only, so previews never purge.
- **GitHub:** deletion calls `DELETE /applications/{client_id}/grant` with
  the app's client id and secret. A failed revocation does not stop the
  deletion. The user is told to revoke the app in their GitHub settings.
- **Out of scope:**
  - Writing or hosting a privacy notice. The Foundation's policy is linked.
  - Encrypting the stored GitHub token (HOO-2881).
  - Keeping a deleted account's daily AI spend and hourly build count when
    the same GitHub account signs in again. Deletion resets both until
    HOO-2963 adds a carry-over table, which needs a migration.
  - Geo-targeting the consent banner. Every visitor is asked.
  - Sentry consent. Sentry receives scrubbed error reports, which this
    change treats as necessary for operating the service.
  - Purging deleted conversation and project rows. Their content is already
    erased, and the rows refuse stale uploads.
