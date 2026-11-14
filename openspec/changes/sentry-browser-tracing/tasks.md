# Tasks

Each task depends on the one before it; nothing runs in parallel.

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
- [x] 1.3 Apply the review of `6f7fdb84e` as design.md, Decisions 2, 3 and 5, describe: `beforeSendSpan` scrubs
  standalone spans (INP); `redact` masks a whole-URL string, IPv6 hosts and parentheses in paths; the browser parser
  and `public-env.mjs` share one decimal pattern; the logger provider test asserts the exact integration list.
  Verify: a standalone INP-shaped span with a token in `sentry.transaction` arrives redacted through the real client;
  `redact` masks `https://[2001:db8::1]/v2/abc123def456ghi789` and `https://rpc.example.com/rpc(v1)/abc123def456ghi789`,
  and keeps the `)` of `(see https://x.test/a)` outside the URL; the parser gives 1 with a warning for `"0x1"` and
  `"1e-1"`; `yarn run check` passes. Depends on 1.2. HOO-2905.
- [x] 1.4 Apply the review of `9d4ce3a40` as design.md, Decisions 2 and 5, describe: the URL masker keeps the file
  name of the app's content-hashed assets (`static/js/main.3f2a1b4c.js`); `redact` masks the `url.query` and
  `url.fragment` span attributes; `isTokenLike` ignores characters outside its alphabet at the end of a part; a span
  `scrubSpan` cannot walk keeps its numeric `measurements` and carries `scrub.withheld`, and `scrubTransaction` drops
  a transaction whose root span carries it; one table in `sample-rate.test.mjs` tests `SAMPLE_RATE`; the
  `observabilityEnv` and `scrubSpan` comments and design.md's Limit and Risks match the code. Verify: a `scrubEvent`
  test keeps `https://<host>/static/js/main.3f2a1b4c.js` in a frame and a debug image and masks a token in its place;
  through the real client, a fetch span arrives with a bare token query term and a token fragment redacted, a
  transaction whose root span cannot be scrubbed is not sent, and one whose child span cannot be scrubbed is sent with
  that span marked; `redact` masks the last segment before `,`, `;`, `:`, `!`, `]` and `*`; `SAMPLE_RATE` accepts
  `0`, `1`, `.5` and `1.0` and rejects `1.5`, `-1`, `0x1` and `1e-1`; `yarn run check` passes. Depends on 1.3.
  HOO-2905.
- [ ] 1.5 Check the change on a preview before the merge: label the PR `preview`, set `SENTRY_PREVIEW_ENABLED=true`
  for it with the rate unset, and walk the manual scenarios of both delta specs. Verify: the `pageload` transaction
  shows in Sentry with LCP and CLS, the Web Vitals dashboard of project `solana-playground` shows the preview's
  environment, the PR lists each scenario with its result, and the PR states the preview's transaction count after
  one day in Sentry's usage stats, with production's projected monthly volume against the quota. If the dashboard
  stays empty while the transaction is in Discover, stop and update this change for stream mode (design.md, Risks).
  Depends on 1.4. HOO-2905.

## Workflow follow-up

- After the merge, watch Sentry's usage stats for a week; if production's volume runs past the quota, set
  `REACT_APP_SENTRY_TRACES_SAMPLE_RATE` lower in Vercel and redeploy.
- Archive the change in this PR once 1.5 is ticked (agreed 2026-11-14).
