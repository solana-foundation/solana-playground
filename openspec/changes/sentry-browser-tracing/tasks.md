# Tasks

Task 1.2 depends on 1.1, and 1.3 on 1.2; nothing runs in parallel.

## 1. Browser tracing

- [x] 1.1 Trace page loads at `REACT_APP_SENTRY_TRACES_SAMPLE_RATE` as design.md, Decisions 1 to 4, describes:
  `observabilityEnv()` reads the variable, `widgets/observability` parses it and warns on an invalid value,
  `Observability`'s `sentry` prop and `ReporterConfig` carry `tracesSampleRate`, and `sentryOptions` adds
  `browserTracingIntegration()`, `traceLifecycle: 'static'` and `beforeSendTransaction: scrubTransaction`. The rate
  defaults to 1. Document the variable in `.env.example`, `docs/production-runbook.md` and
  `docs/deploy-client-vercel.md`. Verify: in-source tests of the parser give 1 for unset, `""`, `"abc"`, `"1.5"` and
  `"-1"` (a warning for the last three), and the value itself for `0`, `0.25` and `1`; `scrub.ts` tests show `null`
  when the walk throws; `reporter/sentry.integration.test.ts` sends a transaction through a recording transport and
  finds it scrubbed; `Observability.test.tsx` passes the rate to `Sentry.init`; `yarn run check` passes. The PR states
  the `main` size from a build with `VERCEL_ENV=production` against one from `master`. HOO-2905.
- [x] 1.2 Apply the review of #172 as design.md, Decisions 2 to 5, describes. `url-secret.mjs` gains the URL masker
  that `maskRpcUrl` and `redact` both use; `scrubTransaction` re-checks breadcrumbs as `scrubEvent` does;
  `tracePropagationTargets: []`; `public-env.mjs` fails a value outside 0 to 1; the parser trims; comments and docs
  match (the `observabilityEnv` JSDoc, the `scrubTransaction` reason, the runbook's Sentry checks). Verify:
  `maskRpcUrl`'s existing table passes unchanged; a `redact` table masks the Alchemy, QuickNode and `?api-key=` URLs
  of the logging spec and keeps `https://api.devnet.solana.com/`; the integration test finds no `sentry-trace` header
  on a same-origin and a cross-origin fetch inside a sampled span, and asserts `traceLifecycle` and
  `beforeSendTransaction` on the client `reporter.init` builds; `public-env.test.mjs` accepts `0`, `0.25` and `1` and
  rejects `1.5`, `-1` and `abc`; `yarn run check` passes. Depends on 1.1. HOO-2905.
- [ ] 1.3 Check the change on a preview before the merge: label the PR `preview`, set `SENTRY_PREVIEW_ENABLED=true`
  for it with the rate unset, and walk the manual scenarios of both delta specs. Verify: the `pageload` transaction
  shows in Sentry with LCP and CLS, the Web Vitals dashboard of project `solana-playground` shows the preview's
  environment, the PR lists each scenario with its result, and the PR states the preview's transaction count after
  one day in Sentry's usage stats, with production's projected monthly volume against the quota. If the dashboard
  stays empty while the transaction is in Discover, stop and update this change for stream mode (design.md, Risks).
  Depends on 1.2. HOO-2905.

## Workflow follow-up

- After the merge, watch Sentry's usage stats for a week; if production's volume runs past the quota, set
  `REACT_APP_SENTRY_TRACES_SAMPLE_RATE` lower in Vercel and redeploy.
- Archive the change in this PR once 1.3 is ticked (agreed 2026-11-14).
