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
- `scrubEvent` (`reporter/scrub.ts`) redacts every secret-shaped value of an event and, when redacting throws, returns
  a replacement event that says the report was withheld. That fallback suits an error, whose existence the team must
  see. For a transaction, a withheld stand-in carries no measurement and only costs quota.
- The SDK merges the scope's breadcrumbs into every event it sends, transactions included (`applyBreadcrumbsToEvent`).
- Sentry strips sensitive query parameters from a request span's URL, never its path. `SECRET_PATTERNS` catches keys
  of 64 characters or more, so a provider key in a path (`/v2/<key>`) passes it.
- `shared/lib/url-secret.mjs` (`isTokenLike`, `isSecretQueryTerm`) already decides which parts of a URL are secret,
  for `maskRpcUrl` on screen and for `scripts/public-env.mjs` in the build.
- The server's `tracesSampler` uses `inheritOrSampleWith`, so an incoming `sentry-trace` header would override
  `SENTRY_TRACES_SAMPLE_RATE` for that request.
- `craco.config.js` swaps the Sentry reporter for a stub when `sentryEnabled` is false (`trackerSwaps`). CI and local
  builds have no `VERCEL_ENV`, so they never bundle `@sentry/react`.

## Goals / Non-Goals

**Goals:**

- A sampled page load reaches Sentry as a `pageload` transaction with Web Vitals measurements.
- A transaction that fails scrubbing is dropped, never sent unscrubbed.
- The browser rate and the server rate are set independently.

**Non-Goals:**

- Distributed traces linking a page load to its API calls.
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
- `beforeSendTransaction` is deprecated in 11.x and removed in v12; a v12 upgrade fails to compile on
  `Sentry.BrowserOptions`, so the scrub cannot disappear silently.

### 2. A transaction scrub that drops instead of withholding

`reporter/scrub.ts` gains `scrubTransaction`, which re-checks the transaction's breadcrumbs as `scrubEvent` does,
runs the same `redact` walk over the whole event, its `spans` array included, and returns `null` when the walk
throws. `sentryOptions` passes it as `beforeSendTransaction`.

- **Why not `scrubEvent`:** its withheld replacement keeps an error visible; a transaction has nothing worth keeping
  without its values (Context).
- **Standalone spans:** in static mode the SDK sends INP as a standalone span (`standalone = !hasSpanStreamingEnabled(client)` in `@sentry/browser-utils`), which `beforeSendTransaction` never sees. `sentryOptions` therefore also passes `beforeSendSpan: Sentry.withStaticSpan(scrubSpan)`, which runs the same `redact` walk over the span; only a `withStaticSpan` callback runs in static mode (`captureStandaloneSpanWithStaticCallback` in `@sentry/core`). It cannot drop a span, so a span whose walk throws is replaced by one that keeps only its ids, op, status, and timing.
- **Envelope header:** a standalone span's envelope header carries the root span's name as `trace.transaction` from the dynamic sampling context, which `beforeSendSpan` never sees; an INP span that is its own root is named after the clicked element's selector. A `ScrubSamplingContext` integration redacts that name on the client's `createDsc` hook.
- **A child span that cannot be scrubbed:** the static `beforeSendSpan` also runs on every span of a transaction, before `beforeSendTransaction`, so such a child span is reduced and the transaction is still sent. A root span that cannot be scrubbed still drops its transaction through `scrubTransaction`.
- **Not logged:** the scrub module cannot import the logger, since the logger reports through the reporter that
  imports the scrub. A drop shows in Sentry's client reports as `before_send` for category `transaction`.

### 3. The rate is parsed in the browser, once, with 1 as the default

`observabilityEnv()` adds `SENTRY_TRACES_SAMPLE_RATE: process.env.REACT_APP_SENTRY_TRACES_SAMPLE_RATE`, a literal
member expression so CRA inlines it. A parser in `widgets/observability/model` turns the trimmed string into a number:
unset or empty gives 1 silently, a decimal from 0 to 1 (the build check's pattern, shared) gives itself, and anything
else (`0x1`, `1e-1` included) gives 1 with one `log.warn`
through the widget's `observability:init` logger. The variable exists to lower the rate. `initObservability` passes
the number through `sentryProvider` into `ReporterConfig.tracesSampleRate`.

- **Build check:** `scripts/public-env.mjs` fails a production build on a `REACT_APP_*` value the client reads without
  a `VALUE_SHAPES` entry, since CRA inlines every such value into the bundle. The entry for this variable accepts a
  decimal from 0 to 1 and nothing else, so a mistyped `10` meant as 10 % fails before deploy instead of tracing every
  page load. The runtime fallback serves builds that skip the check, such as `yarn dev`.
- **Warning before the logger:** `sentryProvider` needs the number when it is built, so the rate is parsed before
  `initLogger`. The warning prints through the logger's default console provider, ignores `logLevel`, and does not
  become a breadcrumb.
- **Why in the widget:** the widget already owns the start-up warnings for missing ids (`warnAboutMissingIds`), and the
  reporter stays free of configuration parsing.
- **Alternative:** move the server's `tracesSampleRate` to `shared/lib`. Rejected: it logs through the server logger,
  which browser code cannot import.

### 4. `browserTracingIntegration` with no trace propagation

`sentryOptions` adds `Sentry.browserTracingIntegration()` to the filtered defaults, sets `tracesSampleRate` from the
config, and sets `tracePropagationTargets: []`, so no request carries `sentry-trace` or `baggage`.

- **Why:** with the SDK's default, same-origin `/api/*` requests carry the browser's decision, and the server's
  `inheritOrSampleWith` follows it (Context). The browser rate would then govern those requests, and lowering
  `SENTRY_TRACES_SAMPLE_RATE` would not cut them. The two sides need different rates.
- **Cost:** a page load and the API calls it makes are separate traces in Sentry.

### 5. One URL rule for the screen and for reports

`url-secret.mjs` gains a URL masker, curried on the mask text, built from `maskRpcUrl`'s rule: a user name or
password, a token-like host label, path segment or fragment, and the value of a secret query term are replaced. The
rest of the URL stays. `maskRpcUrl` calls it with `••••`. `redact` in `scrub.ts` passes a string that is a whole URL
(a span's `url.full`) through the masker with `[redacted]`, and in any other string finds each `http(s)://` URL,
an IPv6 host in brackets and parentheses in the path included, before `SECRET_PATTERNS` run. A closing parenthesis
that only wraps the URL in prose stays outside it.

- **Why one rule:** the screen, the build check and the reports then agree on what in a URL is a key, and a change to
  `isTokenLike` reaches all three.
- **Why mask, not strip the path:** `/v2/[redacted]` still names the provider's route, which a span needs to be read.
- **Limit:** a key shorter than `isTokenLike`'s floor, with no digit, is kept, as it is on screen and in the build.

## Risks / Trade-offs

- [The Web Vitals dashboard reads streamed spans, not static transactions] → Unverified. Task 1.4 checks the dashboard
  on a preview, before the merge. If it stays empty while the transaction is in Discover, the change returns to the
  spec and design for stream mode before it merges.
- [A sampled page load sends a transaction with dozens of resource spans, each scrubbed] → `redact` already walks
  error events of similar size; the scrub runs once per transaction after the page settles, outside any user action.
- [Quota: production traces every page load from the merge on, and an exhausted quota can drop events] → Task 1.4
  reads the preview's usage in Sentry's usage stats after one day and projects production from it. Setting
  `REACT_APP_SENTRY_TRACES_SAMPLE_RATE` lower, or to `0`, and redeploying cuts the volume.
- [The URL masker hides a word that only looks like a token] → Accepted, as on screen: a hidden slug costs a reader a
  guess, a shown key costs the user the key.
- [Bundle] → Production `main` grows by the tracing integration. `bench/BUNDLE.md` cannot show it (Context); the PR
  states the size measured from a build with `VERCEL_ENV=production`.

## Migration Plan

Before the merge, deploy the PR as a preview with `SENTRY_PREVIEW_ENABLED=true` and the variable unset, and check
the manual scenarios and the usage (task 1.4). If the projected production volume exceeds the quota, set a lower
`REACT_APP_SENTRY_TRACES_SAMPLE_RATE` in Vercel's production environment before the merge, since CRA inlines the
value at build time. Rollback is setting the variable to `0` and redeploying.
