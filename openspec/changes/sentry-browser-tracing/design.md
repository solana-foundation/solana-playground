# Design

## Context

See [proposal.md](proposal.md), "Why". The browser reporter is `reporter/sentry.ts` in `shared/lib/reporter`, the
only browser module that imports `@sentry/react` (`app/slice-structure.test.ts` enforces this). `sentryOptions`
builds the options for `Sentry.init`. The logger's `sentryProvider` calls `reporter.init` with the `ReporterConfig`
that `widgets/observability` passes from `src/index.tsx`, which reads `observabilityEnv()` in
`shared/config/client-env.ts`.

Constraints found in the code at `master@8c8d5460b`:

- `@sentry/react` and `@sentry/core` are 11.4.0. Their `traceLifecycle` option defaults to `'stream'`. In stream mode
  no transaction is built, so `beforeSendTransaction` never runs, and `beforeSendSpan` can change a span but cannot
  drop one.
- `scrubEvent` (`reporter/scrub.ts`) redacts every value of an event and, when redacting throws, returns a
  replacement event that says the report was withheld. That fallback suits an error, whose existence the team must
  see. For a transaction, a withheld stand-in carries no measurement and only costs quota.
- `craco.config.js` swaps the Sentry reporter for a stub when `sentryEnabled` is false (`trackerSwaps`). CI and local
  builds have no `VERCEL_ENV`, so they never bundle `@sentry/react`.
- The server parses its own rate with `tracesSampleRate` in `features/api/server/with-observability.mjs`, where unset
  means 1. Browser code cannot import a `server.mjs`.

## Goals / Non-Goals

**Goals:**

- A sampled page load reaches Sentry as a `pageload` transaction with Web Vitals measurements.
- A transaction that fails scrubbing is dropped, never sent unscrubbed.

**Non-Goals:**

- Custom spans around builds, deploys or test runs.

## Decisions

### 1. `traceLifecycle: 'static'`

`sentryOptions` sets `traceLifecycle: 'static'`, so the SDK builds a transaction when the page-load span tree ends,
and `beforeSendTransaction` runs on it.

- **Why:** `beforeSendTransaction` can return `null`, which drops the transaction. The spec "Transactions carry no
  secret key" requires that a transaction that cannot be scrubbed is not sent. In stream mode the only drop control,
  `ignoreSpans`, matches span names when a span starts, before any value is known.
- **Alternative:** stream mode with a `beforeSendSpan` that redacts in place. Rejected: a span whose scrub throws would
  still be sent, as is.

### 2. A transaction scrub that drops instead of withholding

`reporter/scrub.ts` gains `scrubTransaction`, which runs the same `redact` walk as `scrubEvent` over the whole
transaction event, its `spans` array included, and returns `null` when the walk throws. `sentryOptions` passes it as
`beforeSendTransaction`.

- **Why not `scrubEvent`:** its withheld replacement keeps an error visible; a transaction has nothing worth keeping
  without its values (Context).
- The breadcrumb filter in `scrubEvent` does not apply: a transaction event carries no breadcrumbs.

### 3. The rate is parsed in the browser, once, with 1 as the default

`observabilityEnv()` adds `SENTRY_TRACES_SAMPLE_RATE: process.env.REACT_APP_SENTRY_TRACES_SAMPLE_RATE`, a literal
member expression so CRA inlines it. A parser in `widgets/observability/model` turns the string into a number:
unset or `""` gives 1 silently, a number from 0 to 1 gives itself, and anything else gives 1 with one `log.warn`
through the widget's existing `observability:init` logger. The default and the fallback match the server's
`tracesSampleRate` and Sentry's advice to send every trace the quota allows; the variable exists to lower the rate. `initObservability` passes the number through
`sentryProvider` into `ReporterConfig.tracesSampleRate`.

- **Build shape:** `scripts/public-env.mjs` fails a production build on a `REACT_APP_*` value the client reads
  without a `VALUE_SHAPES` entry, since CRA inlines every such value into the bundle. The entry for this variable is a
  signed decimal number: a typo such as `0,1`, or a token pasted into the variable, fails before deploy, while `-1`
  and `1.5` build and reach the browser warning.
- **Warning before the logger:** `sentryProvider` needs the number when it is built, so the rate is parsed before
  `initLogger`. An invalid-rate warning therefore prints through the logger's default console provider and ignores
  `logLevel`.
- **Why in the widget:** the widget already owns the start-up warnings for missing ids (`warnAboutMissingIds`), and the
  reporter stays free of configuration parsing.
- **Alternative:** move the server's `tracesSampleRate` to `shared/lib` and give it a default argument. Rejected:
  the server parser logs through the server logger, which browser code cannot import.

### 4. `browserTracingIntegration` with default options

`sentryOptions` adds `Sentry.browserTracingIntegration()` to the filtered defaults and sets `tracesSampleRate` from
the config. `tracePropagationTargets` is not set, so the SDK adds trace headers to same-origin requests only (spec
"Trace headers stay on the page's own origin").

## Risks / Trade-offs

- [The Web Vitals dashboard reads streamed spans, not static transactions] → Unverified. Task 1.2 checks the dashboard
  on a preview, before the merge. If it stays empty while the transaction is in Discover, the change returns to the
  spec and design for stream mode before it merges.
- [A sampled page load sends a transaction with dozens of resource spans, each scrubbed] → `redact` already walks
  error events of similar size; the scrub runs once per transaction after the page settles, outside any user action.
- [Quota: production traces every page load from the merge on, and an exhausted quota can drop events] → Task 1.2
  reads the preview's usage in Sentry's usage stats after one day and projects production from it. Setting
  `REACT_APP_SENTRY_TRACES_SAMPLE_RATE` lower, or to `0`, and redeploying cuts the volume.
- [Bundle] → Production `main` grows by the tracing integration. `bench/BUNDLE.md` cannot show it (Context); the PR
  states the size measured from a build with `VERCEL_ENV=production`.

## Migration Plan

Before the merge, deploy the PR as a preview with `SENTRY_PREVIEW_ENABLED=true` and the variable unset, and check
the manual scenarios and the usage (task 1.2). If the projected production volume exceeds the quota, set a lower
`REACT_APP_SENTRY_TRACES_SAMPLE_RATE` in Vercel's production environment before the merge, since CRA inlines the
value at build time. Rollback is setting the variable to `0` and redeploying.
