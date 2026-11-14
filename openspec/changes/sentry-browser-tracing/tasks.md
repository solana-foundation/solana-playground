# Tasks

Task 1.2 depends on 1.1; nothing runs in parallel.

## 1. Browser tracing

- [ ] 1.1 Trace page loads at `REACT_APP_SENTRY_TRACES_SAMPLE_RATE` as design.md, Decisions 1 to 4, describes:
  `observabilityEnv()` reads the variable, `widgets/observability` parses it and warns on an invalid value,
  `Observability`'s `sentry` prop and `ReporterConfig` carry `tracesSampleRate`, and `sentryOptions` adds
  `browserTracingIntegration()`, `traceLifecycle: 'static'` and `beforeSendTransaction: scrubTransaction`;
  `scripts/public-env.mjs` gives the variable a signed-number shape. The rate defaults to 1 (design.md, Decision 3).
  Document the variable as optional, its default and the build failure on a non-number, in `.env.example`,
  `docs/production-runbook.md` and `docs/deploy-client-vercel.md`. Verify: in-source tests of the parser give 1 for
  unset, `""`, `"abc"`, `"1.5"` and `"-1"` (a warning for the last three), and the value itself for `0`, `0.25` and
  `1`; `scripts/public-env.test.mjs` accepts `0.25` and `-1` and
  rejects `abc`; `scrub.ts` tests show a secret key
  in a transaction's name and in a span's description redacted, and `null` when the walk throws;
  `reporter/sentry.integration.test.ts` sends a transaction through a recording transport and finds it scrubbed;
  `Observability.test.tsx` passes the rate to `Sentry.init`; `yarn run check` passes. The PR states the `main` size
  from a build with `VERCEL_ENV=production` against one from `master`. HOO-2905.
- [ ] 1.2 Check the change on a preview before the merge: label the PR `preview`, set `SENTRY_PREVIEW_ENABLED=true`
  for it with the rate unset, and walk the manual scenarios of both delta specs. Verify: the `pageload` transaction
  shows in Sentry with LCP and CLS, the [Web Vitals
  dashboard](https://solana-fndn.sentry.io/dashboard/1261677/?project=4512187224096768) shows the preview's
  environment, the PR lists each scenario with its result, and the PR states the preview's transaction count after
  one day in Sentry's usage stats, with production's projected monthly volume against the quota. If the dashboard stays empty while the transaction is
  in Discover, stop and update this change for stream mode (design.md, Risks). Depends on 1.1. HOO-2905.

## Workflow follow-up

- After the merge, watch Sentry's usage stats for a week; if production's volume runs past the quota, set
  `REACT_APP_SENTRY_TRACES_SAMPLE_RATE` lower in Vercel and redeploy.
- Archive the change in the PR that ticks the last task, on a human's yes.
