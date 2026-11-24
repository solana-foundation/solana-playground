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

`reporter/scrub.ts` gains `scrubTransactionWith(onWithheld)`, which re-checks the transaction's breadcrumbs as
`scrubEvent` does, runs the same `redact` walk over the whole event, its `spans` array included, and, when the walk
throws, passes the failure's name to `onWithheld` and returns `null`. `sentryOptions` passes the result as
`beforeSendTransaction`.

- **Why not `scrubEvent`:** its withheld replacement keeps an error visible; a transaction has nothing worth keeping
  without its values (Context).
- **Standalone spans:** in static mode the SDK sends INP as a standalone span
  (`standalone = !hasSpanStreamingEnabled(client)` in `@sentry/browser-utils`), which `beforeSendTransaction` never
  sees. `sentryOptions` therefore also passes `beforeSendSpan: Sentry.withStaticSpan(scrubSpan)`, which runs the same
  `redact` walk over the span; only a `withStaticSpan` callback runs in static mode
  (`captureStandaloneSpanWithStaticCallback` in `@sentry/core`). It cannot drop a span, so a span whose walk throws is
  replaced by one that keeps only its ids, op, status, timing, and numeric `measurements` (an INP span keeps its
  value), with the description "Span withheld: scrubbing it failed" and `data` of `{ "scrub.withheld": true }`, so a
  reader of the span sees that the scrub withheld it.
- **Envelope header:** every envelope header built from a dynamic sampling context, a transaction's and a standalone
  span's alike, carries the root span's name as `trace.transaction`, which no `beforeSend*` hook sees; an INP span
  that is its own root is named after the clicked element's selector. A `ScrubSamplingContext` integration redacts
  that name on the client's `createDsc` hook. The SDK emits `createDsc` without a guard, so when redacting throws, the
  hook deletes the name rather than lose the event.
- **Processing metadata:** a transaction's `sdkProcessingMetadata` holds the live scopes the span was captured in, the
  client among them, and the envelope drops it, sending only its `dynamicSamplingContext` in the header. The
  transaction scrub, and `scrubEvent`, which shares its walk, redact that sampling context and pass the rest through
  unwalked: walking it would cost each page load the client and every breadcrumb, and a value that throws only on a
  scope would withhold an event that never carries it.
- **A child span that cannot be scrubbed:** the static `beforeSendSpan` also runs on every span of a transaction,
  before `beforeSendTransaction`, so such a child span is reduced and marked, and the transaction is still sent. The
  SDK runs it on the root span too and merges the result back into the transaction's `contexts.trace`, so a root span
  that cannot be scrubbed arrives at the transaction scrub with `contexts.trace` replaced by the reduced span, named
  "Span withheld: scrubbing it failed", and with the transaction's numeric measurements kept. The transaction scrub
  scrubs and sends such a transaction like any other: its Web Vitals still reach the dashboard, and `scrub.withheld`
  in `contexts.trace.data` tells a reader why its name is gone. Only a transaction whose own walk throws is dropped.
  Sentry normalises a transaction's span data before either hook (`normalizeDepth`), so the reduce and drop paths
  guard values its normalising lets through.
- **Reported by the reporter, not logged:** the scrub module cannot import the logger, since the logger reports
  through the reporter that imports the scrub. `reporter/sentry.ts` binds an `onWithheld` that sends one message,
  "Transaction withheld: scrubbing it failed", tagged `scrub_error`, at most once per session, so a regression that
  throws on every page load reaches the team as an issue, not only as a `before_send` count on the Stats page. The
  message goes through `beforeSend` like any event. It is captured on fresh scopes: the value the walk threw on usually
  sits in the app's scopes, and would make `scrubEvent` withhold the message too.

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
password, each token in a host label, path segment, query value, bare query term or fragment, and the whole value of
a query term with a key-like name are replaced. The rest of the URL stays. Inside one part, each run of the
characters a key is written in is judged on its own, and the text between runs stays as written, so a key followed by
`,then`, `;v=1` or `:8899` is masked and the rest is kept. `maskRpcUrl` calls the masker with `••••`. `redact` in
`scrub.ts` passes a string that is a whole URL (a span's `url.full`) through the masker with `[redacted]`, and in any
other string finds each `http(s)://` URL, an IPv6 host in brackets and parentheses in the path included, before
`SECRET_PATTERNS` run. A closing parenthesis that only wraps the URL in prose stays outside it, and a comma followed by
`http(s)://` starts a URL of its own, so endpoints joined by commas are each masked with their credentials. Sentry's
fetch instrumentation also copies a URL's query and fragment into the span attributes `url.query` and `url.fragment`,
without the `?` or `#`, and its host into `server.address` and `url.domain`, without the scheme, so `redact` masks
them with the masker's own part rules, `maskQueryWith`, `maskFragmentWith` and `maskHostWith`. The masker judges the
URL as the parser reads it, so `redact` sends a URL as written only when nothing in it was masked and the parser
leaves it as written, a bare origin's added `/` aside; any other URL is sent as the masker rebuilt it, so a key the
parser removes, as in `/<key>/../v2`, is not sent.

- **The app's own assets:** CRA names its build output `static/(js|css|media)/<name>.<hash>(.chunk)?.<ext>`, and a
  file name such as `main.3f2a1b4c.js` reads as a token. The masker keeps the last segment of a path of that shape,
  on any host, when its `<name>` part is not itself token-like (`main`, `812`, `logo`), so a stack frame's `filename`
  and `abs_path` and a debug image's `code_file` still pair with the uploaded source maps. The `:line:col` a stack
  trace writes after the file name is allowed, so a stack trace quoted in breadcrumb data or extras keeps it too. A
  token-like `<name>`, and every other segment of the path, is masked as usual.
- **Why one rule:** the screen, the build check and the reports then agree on what in a URL is a key, and a change to
  `isTokenLike` reaches all three.
- **Why mask, not strip the path:** `/v2/[redacted]` still names the provider's route, which a span needs to be read.
- **Limit:** `isTokenLike` reads a part as holding a token when one run of its alphabet in it is 16 or more characters
  with a digit, or 24 or more in mixed case. A key shorter than 16 characters, a key with no digit unless it is 24 or
  more characters in mixed case, and a key split by a character outside the alphabet into shorter runs are kept, as on
  screen and in the build.

## Risks / Trade-offs

- [The Web Vitals dashboard reads streamed spans, not static transactions] → Unverified: the preview check planned
  before the merge was dropped (decided 2026-11-24). The Page loads check of `client-v2/docs/production-runbook.md`
  reads the dashboard after the first production deploy. If it stays empty while the transaction is in Discover,
  stream mode needs a change of its own, since `beforeSendTransaction` never runs there (Decision 1).
- [A sampled page load sends a transaction with dozens of resource spans, each scrubbed] → `redact` already walks
  error events of similar size; the scrub runs on each span through `beforeSendSpan` and once more over the whole
  transaction through `beforeSendTransaction`, after the page settles, outside any user action.
- [Quota: production traces every page load from the merge on, and an exhausted quota can drop events] → Not
  projected before the merge. Sentry's usage stats show production's volume after the first deploy. Setting
  `REACT_APP_SENTRY_TRACES_SAMPLE_RATE` lower, or to `0`, and redeploying cuts the volume.
- [The URL masker hides a word that only looks like a token] → Accepted, as on screen: a hidden slug costs a reader a
  guess, a shown key costs the user the key.
- [Bundle] → Production `main` grows by the tracing integration. `bench/BUNDLE.md` cannot show it (Context); the PR
  states the size measured from a build with `VERCEL_ENV=production`.

## Migration Plan

The change merges with the variable unset, so production traces every page load and navigation from its first
deploy. After that deploy, run the Page loads check of `client-v2/docs/production-runbook.md` and read the volume in
Sentry's usage stats. If the volume runs past the quota, set a lower `REACT_APP_SENTRY_TRACES_SAMPLE_RATE` in
Vercel's production environment and redeploy, since CRA inlines the value at build time. Rollback is setting the
variable to `0` and redeploying.
