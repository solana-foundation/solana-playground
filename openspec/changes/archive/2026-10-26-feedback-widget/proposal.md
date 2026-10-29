# Proposal

## Why

A person using `client-v2` has no way to tell the team what is missing or
broken without leaving the product and opening a GitHub issue, which needs an
account and a decision to write one. The Solana Explorer ships a feedback
widget that sends a short message and a rating to Sentry, and Sentry is
already initialised in `client-v2` by `widgets/observability`. Porting the
widget gives the team a channel that costs the user one form.

## What Changes

`ui-migration` 5.15 (2026-10-16) replaced the footer trigger described here
with entries in the account menu; `openspec/specs/client-v2-feedback/spec.md`
states the placement that shipped.

- A `features/feedback` slice: a trigger in the navigation's footer, under
  the status chips (the prototype keeps "Report a bug" in that footer's
  account menu), a menu with "Share
  feedback" and "Report a bug" ("Suggest an idea" left the menu on
  2026-10-23, Slava: the prototype has no such row; the form keeps it), and a form with a
  five-star rating, a message and an optional X handle.
- The form sends its values to Sentry as user feedback, tagged as the spec's
  "A sent form reaches Sentry as user feedback" lists. A sent form closes and
  a toast thanks the user. The user may close the form while it sends; the
  trigger then shows the send in progress, and what they typed is kept until
  a send succeeds. A failed send shows an alert in the open form, or a toast
  when the form is closed, and both point the user back at the form.
- "Share feedback" shows only in a build that carries Sentry. Everywhere else
  (local, CI, a preview without `SENTRY_PREVIEW_ENABLED`) the menu offers
  "Report a bug" only.
- "Suggest an idea" and "Report a bug" open the issue list of
  `solana-foundation/solana-playground`; telemetry records which one was
  picked.
- Sentry is reached through one module in `shared/lib/reporter`, which the
  logger and the feedback slice share. The slice sends through a feedback
  provider, so every layer above Sentry is tested against a stand-in, and
  the Sentry module is tested against the real SDK.
- The structure and the Sentry integration come from the Explorer's widget.
  Every colour, size and component comes from the Playground design system;
  no Explorer token or class is carried over.
- Events added (`features/feedback`): `feedback_opened`, `feedback_sent`,
  `feedback_failed`, `feedback_github_clicked`.

## Capabilities

### New Capabilities

- `client-v2-feedback`: the feedback trigger, its menu and form, what is sent
  to Sentry, when the form is offered, and the events the slice sends.

### Modified Capabilities

None here. `client-v2-logging` is a delta in `telemetry-and-logging`, which
is not archived, so this change amends that delta in place: its "Sentry
receives reported entries through one provider" said the logger's Sentry
provider is the only `@sentry/*` importer, and now says only that no other
logger provider imports it.

## Impact

- `client-v2/src/features/feedback/`: new.
- `client-v2/src/shared/lib/reporter/`: new, the one browser module that
  imports `@sentry/react`, and its `-off` twin. The logger's Sentry
  provider delegates to it; what the logger sends to Sentry does not change.
- `client-v2/craco.config.js`: the Sentry tracker swaps the new pair instead
  of the logger's provider, so a build without Sentry still bundles no SDK
  code; production builds, and opted-in previews, emit hidden source maps
  (`scripts/sourcemap-gate.mjs`).
- `client-v2/package.json`: `@testing-library/user-event` and `@sentry/cli`
  as development dependencies. `yarn build` becomes the whole production
  build (`wasm/build.sh`, a reinstall, `build:bundle`); `build:bundle` is the
  former `build` plus `scripts/upload-sourcemaps.mjs`, which uploads the maps
  to Sentry and deletes them before deploy. This lands `telemetry-and-logging`
  task 2.3.
- `client-v2/vercel.json` and `compose.yaml`'s `client-v2-prod`: run
  `build:bundle`, since both already have the wasm packages built.
- `client-v2/src/shared/lib/telemetry/prefixes.ts`: the `feedback` prefix.
- `client-v2/src/shared/ui/`: `modal`, `dropdown-menu`, `textarea`, `label`,
  `async-button` and `brand-button` installed with `yarn ds-add`.
- `client-v2/src/views/flow/Flow.tsx`: renders the widget in the navigation's footer.
- Users: a round button sits in the navigation's footer, under the status
  chips.
  What they type and the handle they give reach Sentry, which the team can
  read. In a build without Sentry they
  see the button with the two GitHub links.
- Builds on #60, merged into `master-2.0`, for the design tokens and
  `shared/ui`.
- Out of scope:
  - Issue templates or labels on `solana-foundation/solana-playground`; a
    label in a new-issue link applies only for people with triage rights, so
    the links open the issue list.
  - Screenshots or attachments with the feedback.
  - A second feedback entry point, such as a menu link beside the trigger.
  - Feedback from `client-v2/api/*.mjs` or any server route.
  - Moving the legacy toast (`PgView.setToast`) to the design system's
    `sonner`.
  - A Storybook for `client-v2`; `ui-migration` rejects one, and the
    components are tested by interaction tests in vitest instead.
