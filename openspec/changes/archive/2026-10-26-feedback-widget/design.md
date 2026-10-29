# Design

## Context

- Sentry is initialised by `widgets/observability` through
  `shared/lib/logger/providers/sentry.ts`, which imports `@sentry/react`
  and sends only log entries. Nothing in `client-v2` sends user feedback.
- `craco.config.js` swaps `providers/sentry.ts` for `providers/sentry-off.ts`
  in every build where `sentryEnabled` (`scripts/sentry-gate.mjs`) is false.
  `REACT_APP_SENTRY_DSN` is still inlined in those builds, so "a DSN is set"
  does not mean "Sentry is initialised".
- The design tokens and `shared/ui` came with #60. `modal`,
  `async-button` and `brand-button` are registry items
  (`design-system/registry.json`); the stock `dropdown-menu`, `textarea`
  and `label` have sources in `design-system/src/components/ui` and no
  registry item, so this change registers them.
- `client-v2` has no Storybook: decision 7 of `ui-migration` rejects one in
  favour of the design system's catalogue. User-level tests of components
  run in vitest with Testing Library. `@testing-library/user-event` is not
  a dependency yet.
- The legacy toast (`PgView.setToast`, `react-toastify`) is the only toast
  mounted in `client-v2`.
- The Explorer's widget (`app/features/feedback` in
  `solana-foundation/explorer`) is the source of the structure: trigger,
  menu, form, star rating, the submit hook, the Sentry call inside
  `withScope`, and the envelope test
  (`feedback-envelope.integration.spec.tsx`).

## Goals / Non-Goals

**Goals:**

- One browser module talks to `@sentry/react`, and a build without Sentry bundles
  none of it.
- Everything above that module is tested against a stand-in, and that
  module itself is tested against the real SDK with a capturing transport.
- Every `Base*` component has interaction tests that drive it as a user
  does: by role, label and keyboard.

**Non-Goals:**

- Any visual from the Explorer. Its `accent` is a brand green; the
  Playground's `accent` is the hover grey. Highlights use `primary`.
- A Storybook, or any change to `ui-migration`'s decision 7.
- A second toast system.

## Decisions

### One reporter in `shared/lib/reporter`

The reporter is what reaches the team: the log entries marked `report`
and user feedback. The directory is named for that role, not for the
vendor, so it is not read as the logger's Sentry provider, and the vendor
shows only in the implementation's file name.

- `reporter/types.ts`: the `Reporter` interface below.
- `reporter/sentry.ts`: the Sentry implementation, the only module that
  imports `@sentry/react`.
- `reporter/sentry-off.ts`: the implementation craco swaps in.
- `reporter/index.ts`: the public API.

`Reporter` has:

- `carried`: whether this build reports at all; `true` in `sentry.ts`.
- `init(config)`: the `Sentry.init` call that the logger's provider makes
  today, moved as is.
- `capture(entry)`: the `withScope` + `captureException` / `captureMessage`
  the logger's provider makes today, moved as is.
- `sendFeedback(feedback)`: `Sentry.sendFeedback` inside `withScope`, with
  the tags from the spec. It resolves when Sentry accepts the feedback and
  rejects when delivery fails. The callback hands the delivery promise back
  boxed: `withScope` keeps a returned promise's scope on the stack until it
  settles, so an error captured mid-send would carry the feedback's tags.

`shared/lib/reporter/sentry-off.ts` has the same shape: `carried` is
`false`, `init` and `capture` do nothing, and `sendFeedback` rejects. The
Sentry entry in `craco.config.js` swaps this pair instead of the logger's
provider, and `logger/providers/sentry-off.ts` is deleted:
`logger/providers/sentry.ts` keeps its name and its tests and delegates to
the reporter.

Alternatives:

- `shared/lib/sentry`: names the vendor, and reads as a generic Sentry
  provider for logs.
- `shared/lib/feedback-provider`: the module also carries the logger's
  `init` and `capture`, so the logger would import from a module named
  for feedback.
- A second SDK importer in `shared/lib/feedback`, swapped beside the
  logger's. Two modules then call `Sentry.init`'s client, each with its own
  swap entry, and a third use of Sentry would add a third.
- A `feedback` method on the logger's `LogProvider`. Feedback is not a log
  entry: it has no level and no namespace, and every other log provider
  would need a no-op for it.
- Gating on `Boolean(REACT_APP_SENTRY_DSN)`, as the Explorer does. In a
  local or preview build the DSN is set and Sentry is not initialised, so
  the form would show and every send would fail.

The off `sendFeedback` rejects rather than resolves: one that resolves would
tell a user their feedback was sent when it went nowhere.

### A feedback provider between the slice and the reporter

`features/feedback/model/provider.ts` declares

```ts
interface FeedbackProvider {
  /** Whether a send can succeed in this build */
  available: boolean;
  send(values: FeedbackValues, cluster: string): Promise<void>;
}
```

with two implementations:

- `reporterFeedbackProvider`: `available` is the reporter's `carried`; `send`
  maps the form's values and the cluster to the reporter's
  `sendFeedback`.
- `memoryFeedbackProvider({ available, fail })`: records every send and
  resolves, or rejects when `fail` is set. Only tests use it, by its module
  path; the slice's `index.ts` does not export it.

`FeedbackHost` reads the provider from a React context whose default is
`reporterFeedbackProvider()`. `useFeedbackForm` receives the provider, the
cluster, and the `onSent` and `onFailedClosed` callbacks in one options
object, so its tests pass them directly and never touch `PgConnection` or
`PgView`; the host reads the cluster and shows the toasts.

### Tests, by layer

- `shared/lib/reporter`: integration, against the real SDK initialised with
  a capturing transport.
- `reporterFeedbackProvider`: unit, the values and tags it hands a mocked
  reporter.
- `useFeedbackForm`: unit, its states, outcomes and events (through the
  memory telemetry provider), against `memoryFeedbackProvider`.
- `Base*` components: interaction, driven with `user-event` by role,
  label and key, through props only.
- `FeedbackHost` with `FeedbackTrigger`: integration, the whole slice and
  one send end to end, over the real reporter and the capturing transport,
  and a draft and a send that outlive the trigger unmounting.
- The page: Playwright, the scenarios not marked `(manual)`, against the
  dev server.

The integration tests copy the Explorer's approach: `Sentry.init` with a
transport whose `send` records the envelope and answers `200`, then assert
the feedback item's message, name, source, URL and tags, and that a
message captured afterwards, or while the feedback is still in flight,
carries none of the tags. A second case answers `500` and asserts that
`sendFeedback` rejects, which the SDK's documentation does not state.

### Components

All four live in `features/feedback/ui`:

- `BaseFeedbackWidget`: `dropdown-menu`, an icon `button` (ghost) that
  shows `spinner` while a send is in flight, a `primary` halo behind it
  that pulses (`motion-safe:animate-ping`) meanwhile, and `gradient-stroke`
  with `--stroke-fill: var(--surface-panel)`.
- `BaseFeedbackForm`: `modal`, `label`, `textarea`, `input`, and
  `async-button` with the `accent` look of `brand-button`.
- `BaseStarRating`, private to the form: native radios, the `lucide-react`
  `Star`, `fill-primary` for a chosen star and `fill-surface-raised` for
  the rest.
- `FeedbackHost`: `BaseFeedbackForm`, `useFeedbackForm`, the provider
  context and the telemetry; `FeedbackTrigger`, below it wherever the page
  puts it, renders `BaseFeedbackWidget` from what the host hands it through a
  context of the slice's own.

`modal` replaces the Explorer's split between `Dialog` and `Drawer` on
`isSm`: it is already a dialog on a wide screen and a page on a phone.

### State

`useFeedbackForm` holds `{ open, send, draft }`: whether the form shows, a
send status of `idle`, `sending` or `failed`, and what the user typed. The
two are independent on purpose: the user may close a sending form, and a
send that refused to close would trap the user until the SDK's 30 s timeout
whenever Sentry never answers. Every combination is valid:

- `sending` behind a closed form: the trigger shows a spinner in a pulsing
  halo.
- `failed` behind a closed form: a toast says so, and the alert shows when
  the form opens again.
- A success closes the form, whichever state it was in, and clears the
  draft.

The draft lives in the hook, not in the form, because the modal unmounts its
content on close; it is kept until a send succeeds, unlike the Explorer,
which resets the rating on close. The fields are read-only while sending, so
a success cannot clear text typed after Submit. One send runs at a time:
Submit is disabled while sending, and the menu reopens the same form.

The modal opens from a menu item and has no trigger of its own, so
`BaseFeedbackForm` takes `returnFocusTo` and sends focus back to the
"Feedback" button on close.

### Where it mounts

`views/flow/Flow.tsx` wraps the whole frame in `<FeedbackHost>` and puts
`<FeedbackTrigger />` in the navigation's footer. The state sits in the host,
above the shell, because the footer does not stay mounted: below 768 px it is
on the phone's menu page, and crossing that width swaps the page for the
rail. A legacy root may import a feature;
the slice adds no UI to the legacy root itself.

The trigger moved into the account menu in `ui-migration` 5.15
(2026-10-16): the menu carries the three entries, and a send in flight shows
on the account row.

### What the browser suite can reach

The e2e dev server has no `VERCEL_ENV`, so it carries no Sentry and the form
is unreachable there. The scenarios that need the form are marked
`(manual)` in the spec; each is covered by an interaction or integration
test from the table above. Task 4.1, a walk-through by hand on a preview,
did not run: it closed on the owner's confirmation of the production
configuration (2026-10-26, HOO-2280). Running
the suite with Sentry carried and the ingest URL stubbed by `page.route`
would turn them into browser tests, but it changes the environment of every
spec (no ticket filed).

### Toast

A sent form, which has closed, is thanked with `PgView.setToast`. Installing
`sonner` would mount a second toast container with its own position and
stacking. A failed send behind an open form is shown in the form as an
alert instead: a toast opens in the bottom-left corner, away from the form the
user is reading, and closes on a timer, so the walk-through found the form
saying nothing while the outcome showed elsewhere. Behind a closed form there
is nothing to read but the toast, so the failure is a toast there.

## Risks / Trade-offs

- [Moving the logger's SDK calls into the reporter can change what the
  logger sends] → the move keeps `logger/providers/sentry.test.ts` and
  `widgets/observability` tests unchanged and passing.
- [The trigger covers what is under it] → it does not float. Fixed at the
  bottom left it would sit over the project panel's "+ New file" and, with the
  four-column frame (`ui-migration` 5.2), over the cluster chip and the avatar
  in the navigation's footer. It sits in that footer instead, under the
  status chips, where the prototype keeps "Report a bug".
  The rail swaps the footer for its own (the cluster's dot and the account)
  and the phone's Sheet unmounts it on close, so the form and its state stay
  in `FeedbackHost`, above the navigation, and only the trigger moves with
  the footer. `ui-migration` 5.15 later moved the trigger into the account
  menu ("Where it mounts").
- [The feedback text reaches Sentry, which the team reads] → the message is
  never put in telemetry; the spec forbids it.

## Migration Plan

No data and no migration. Rollback is reverting the PR; the trigger
disappears and nothing else depends on it.
