# Proposal

## Why

Sharing a project today makes a public gist and hands back the gist's GitHub
URL. Designers' Spec 05 ("Share through GitHub") asks for a secret gist by
default and one Playground link to send, which opens the project straight in
Playground. Share also hides in every row's actions menu, so the project you
are working on has no Share action in view (HOO-2390).

## What Changes

- The share dialog becomes "Share to GitHub" with Spec 05's copy. A
  Secret / Public choice, Secret by default, carries a help tip: "Secret gists
  don't show on your profile. Anyone with the link can open them." The
  public-only notice and the "Create public gist" button go away. The primary
  button reads "Share to GitHub", and "Sharing to GitHub…" while it runs.
- `POST /api/gists` takes a boolean `public` and creates the gist with it, so
  `create-gist.mjs` no longer hard-codes `public: true`. A body without the
  field makes a secret gist, and a field that is not a boolean answers `400`.
- The shared state leads with the Playground link `<origin>/gist/<id>` in a
  read-only field, with a copy button and a "Link copied" toast. Below it come
  the line "Opens <name> in Solana Playground as a preview. Anyone with the
  link can see the code.", an "Open on GitHub" link and a secondary "Copy
  GitHub link".
- Share opens from a Share button in the frame's header on desktop, and from
  the open project's row in the project list. Other rows no longer offer
  share.
- While sign-in waits on GitHub's popup, the share dialog offers its own
  Cancel, which stops the wait (`PgSession.cancelSignIn`). This closes the
  uncovered spec scenario "gist-sharing: Sign-in cancelled".
- On a phone, a project with no program shows no stepper at all. It used to
  show an empty one, because the phone stepper already leaves out Write.
- Telemetry (`gist` slice): `gist_export_started`, `gist_export_succeeded` and
  `gist_export_failed` gain `visibility` (`secret` | `public`).
  `gist_export_started` gains `source` (`header` | `project_menu`). A new
  event, `gist_link_copied`, carries `copied` (`playground` | `github`). No
  event is renamed or removed.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `gist-sharing`: the dialog's visibility choice, copy and shared state;
  where Share is offered; the server route's `public` field; the share
  telemetry's new parameters and event; a Cancel while sign-in waits.
- `project-without-program`: on a phone, no stepper for a project with no
  program.

## Impact

- Code: `client-v2/src/features/gist/` (dialog, export, telemetry, a
  Playground-link helper), `client-v2/api/gists.mjs`,
  `client-v2/src/features/gist/model/create-gist.mjs`,
  `client-v2/src/app/ShareGistDialog/`, `client-v2/src/widgets/app-nav/ui/`
  (row menu), `client-v2/src/views/flow/` (header Share button, phone
  stepper).
- API: `POST /api/gists` gains an optional `public` boolean. Leaving it out
  makes a gist secret where it used to be public. Only this client calls the
  route.
- Tests: `ShareGist.test.tsx`, `create-gist.test.mjs`, `api/gists.test.mjs`,
  the project-list tests, `Stepper.test.tsx`, and the e2e `gist-sharing` spec
  with the new "Sign-in cancelled" case.
- Out of scope: the Repo target and the Gist | Repo switch; ticking or
  unticking files; "Update share", the "Shared" or "Changed since shared" tag
  and remembering a project's link; the old share-link page; the phone's
  system share sheet; a Share button in the phone header; renaming events to
  Spec 05's `share_*` names (waits on the analytics decision); the
  keypair-warning callout.
