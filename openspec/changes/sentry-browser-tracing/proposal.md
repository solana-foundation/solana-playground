# Proposal

## Why

The [Web Vitals dashboard](https://solana-fndn.sentry.io/dashboard/1261677/?project=4512187224096768) of Sentry
project `solana-playground` is empty, because the browser SDK sends errors and feedback only. `sentryOptions` in
`client-v2/src/shared/lib/reporter/sentry.ts` sets no `browserTracingIntegration` and no sample rate, and Sentry
records LCP, INP and CLS only on a sampled page-load span. The team has no measure of how fast Playground loads for
real users. HOO-2905.

## What Changes

- The browser reporter adds `browserTracingIntegration`, so a sampled page load or navigation sends a transaction
  with its Web Vitals.
- An optional build-time variable, `REACT_APP_SENTRY_TRACES_SAMPLE_RATE`, lowers the share of page loads traced.
  Unset or empty, every page load is traced, as Sentry advises and as the server's `SENTRY_TRACES_SAMPLE_RATE` does;
  a value from 0 to 1 overrides that, and `0` turns tracing off. A value that is not a number fails the production
  build; a number outside 0 to 1 means 1 and prints a warning in the browser console.
- `Observability`'s `sentry` prop gains `tracesSampleRate`, passed from `src/index.tsx` as the DSN is.
- Every transaction and span the browser sends passes the same scrub as an error event, so a secret key in a page
  URL, a request URL or a span attribute arrives as `[redacted]`.
- Trace headers (`sentry-trace`, `baggage`) go to same-origin requests only, the SDK's default. Requests to the build
  server and to RPC endpoints carry no new header, so no CORS preflight changes.
- Telemetry: `widgets/observability` gains a prop and no event; no event is added, renamed or removed. No funnel
  step's code changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `client-v2-observability`: `Observability`'s `sentry` prop gains `tracesSampleRate`, and page loads are traced at
  that rate.
- `client-v2-logging`: the rule that reports carry no secret key extends from error events and breadcrumbs to
  transactions and spans.

## Impact

- **Code:** `client-v2/src/shared/lib/reporter/` (`sentry.ts`, `types.ts`, `scrub.ts`),
  `client-v2/src/shared/lib/logger/providers/sentry.ts`, `client-v2/src/widgets/observability/`,
  `client-v2/src/shared/config/client-env.ts`, `client-v2/src/index.tsx`, `client-v2/scripts/public-env.mjs`,
  `client-v2/.env.example`.
- **Docs:** the variable tables in `client-v2/docs/production-runbook.md` and
  `client-v2/docs/deploy-client-vercel.md`.
- **Bundle:** a deployment that carries Sentry grows by the tracing code. The CI build swaps Sentry out
  (`trackerSwaps` in `craco.config.js`, gated by `sentryEnabled`), so `bench/BUNDLE.md` measures no change.
- **Cost, user-visible to the team:** from the merge on, each production page load is one Sentry transaction against
  the organisation's quota, until the variable lowers the rate. A user sees no change: no UI, no new request to a third party beyond the Sentry ingest the page already
  uses.
- **Out of scope:** tracing of `api/*.mjs`, which `SENTRY_TRACES_SAMPLE_RATE` already controls; Session Replay;
  profiling; trace propagation to the build server or RPC endpoints; custom spans for build, deploy or test runs.
