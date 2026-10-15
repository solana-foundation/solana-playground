# Tasks

Tasks 1.1 and 2.1 may run at the same time.

## 1. Design-system parts

- [x] 1.1 Register the stock `dropdown-menu`, `textarea` and `label` in
  `design-system/registry.json`; install `modal`, `dropdown-menu`,
  `textarea`, `label`, `async-button` and `brand-button` into
  `client-v2/src/shared/ui` with `yarn ds-add`, and add
  `@testing-library/user-event` as a development dependency. Verify
  `yarn test-types` and `src/app/shared-ui.test.tsx` pass. Ticket to
  file.

## 2. The reporter

- [x] 2.1 Add `shared/lib/reporter`: the `Reporter` interface (`carried`,
  `init`, `capture`, `sendFeedback`), its Sentry implementation
  `sentry.ts` and `sentry-off.ts`; move the logger provider's SDK calls
  into `sentry.ts`, delete `logger/providers/sentry-off.ts`,
  and point the Sentry tracker in `craco.config.js` at the new pair.
  Verify with the existing `logger/providers/sentry.test.ts` and
  `widgets/observability` tests passing unchanged; with an integration
  test that initialises the real SDK with a capturing transport and
  asserts the feedback envelope (message, name, source, URL, tags), that a
  message captured afterwards carries none of the feedback tags, and that
  a `500` from the transport makes `sendFeedback` reject; and by grepping a
  `yarn build:bundle` without `VERCEL_ENV` for no Sentry SDK code. Ticket to file.

## 3. The feedback slice

- [x] 3.1 Add `features/feedback/model`: `provider.ts` with
  `FeedbackProvider`, `reporterFeedbackProvider` and
  `memoryFeedbackProvider`; `telemetry.ts` with the four events and their
  doc comments; the `feedback` prefix in
  `shared/lib/telemetry/prefixes.ts`; and `useFeedbackForm` holding
  whether the form shows, the send status and the draft, taking the
  provider as an argument. Verify with unit tests: the values and tags
  `reporterFeedbackProvider` hands a mocked reporter; and for
  `useFeedbackForm` against `memoryFeedbackProvider`, a send that resolves
  closes the form and clears the draft, one that rejects keeps the draft
  and calls `onFailedClosed` only behind a closed form, and each tracks its
  event through the memory telemetry provider with no message or handle in
  it. Depends on 2.1.
  Ticket to file.
- [x] 3.2 Add `BaseStarRating`, `BaseFeedbackForm` and
  `BaseFeedbackWidget`, styled only with design-system tokens (`primary`,
  `surface-panel`, `gradient-stroke`). Verify with interaction tests that
  drive each by role, label and key with `user-event`: the form scenarios
  of `client-v2-feedback` a component can show alone (an empty or
  spaces-only message refused, arrow keys move the rating, the draft it is
  given shown, report a bug from the form), the menu with and without
  "Share feedback", the trigger's spinner and pulse, Submit disabled and the
  fields read-only while sending, focus back on the trigger after Escape,
  and the ids and `aria-label`s the spec names. A closed form keeping its
  draft is tested in 3.1's hook tests, and closing mid-send in 3.1's and
  3.3's. Depends on 1.1.
  May run beside 3.1. Ticket to file.
- [x] 3.3 Add the connected `FeedbackWidget` with the provider context.
  Verify with an integration test that renders it over the real
  `shared/lib/reporter` and the capturing transport, sends one rated
  feedback through the UI and asserts the envelope, the success toast and
  `feedback_opened` then `feedback_sent`; and with
  `src/app/slice-structure.test.ts` passing. Depends on 3.1 and 3.2.
  Ticket to file.
- [x] 3.4 Render `<FeedbackWidget />` in `views/flow/Flow.tsx` and add
  Playwright tests titled `client-v2-feedback: <scenario>` for every
  scenario not marked `(manual)`. Verify with `yarn test-e2e` and
  `spec:coverage` reporting no uncovered `client-v2-feedback` scenario.
  Depends on 3.3. Ticket to file.

## 4. Walk-through

- [ ] 4.1 On a Vercel preview with `SENTRY_PREVIEW_ENABLED=true`, check every
  `(manual)` scenario of `client-v2-feedback`, including the trigger with
  the project panel open, folded to its rail and as a phone Sheet, and with
  a toast showing, and record the result and the
  Sentry feedback ids in the PR. Depends on 3.4. Ticket to file.
