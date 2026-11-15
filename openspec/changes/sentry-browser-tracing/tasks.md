# Tasks

Each task depends on the one before it; nothing runs in parallel.

## 1. Browser tracing

- [x] 1.1 Trace page loads at `REACT_APP_SENTRY_TRACES_SAMPLE_RATE` as design.md, Decisions 1 to 4, describes:
  `observabilityEnv()` reads the variable, `widgets/observability` parses it and warns on an invalid value,
  `Observability`'s `sentry` prop and `ReporterConfig` carry `tracesSampleRate`, and `sentryOptions` adds
  `browserTracingIntegration()`, `traceLifecycle: 'static'` and `beforeSendTransaction: scrubTransaction`. The rate
  defaults to 1. Document the variable in `.env.example`, `docs/production-runbook.md` and
  `docs/deploy-client-vercel.md`. Verify: the parser's in-source rows give 1 without a warning for unset, `""` and
  `" "`, 0 for `"0"`, and 1 with one warning naming the variable for `"1.5"`; the `SAMPLE_RATE` table in
  `src/shared/lib/sample-rate.test.mjs` holds the pattern's accepted and rejected values; `scrub.ts` tests show `null`
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
  `beforeSendTransaction` on the client `reporter.init` builds; the two traces sample rate rows of
  `public-env.test.mjs` pass `0.25` and fail `1.5` with the problem naming the variable; `yarn run check` passes. Depends on 1.1. HOO-2905.
- [x] 1.3 Apply the review of `6f7fdb84e` as design.md, Decisions 2, 3 and 5, describe: `beforeSendSpan` scrubs
  standalone spans (INP); `redact` masks a whole-URL string, IPv6 hosts and parentheses in paths; the browser parser
  and `public-env.mjs` share one decimal pattern; the logger provider test asserts the exact integration list.
  Verify: a standalone INP-shaped span with a token in `sentry.transaction` arrives redacted through the real client;
  `redact` masks `https://[2001:db8::1]/v2/abc123def456ghi789` and `https://rpc.example.com/rpc(v1)/abc123def456ghi789`,
  and keeps the `)` of `(see https://x.test/a)` outside the URL; the `SAMPLE_RATE` table in `sample-rate.test.mjs`
  rejects `0x1` and `1e-1`; `yarn run check` passes. Depends on 1.2. HOO-2905.
- [x] 1.4 Apply the review of `9d4ce3a40` as design.md, Decisions 2 and 5, describe: the URL masker keeps the file
  name of the app's content-hashed assets (`static/js/main.3f2a1b4c.js`); `redact` masks the `url.query` and
  `url.fragment` span attributes; `isTokenLike` ignores characters outside its alphabet at the end of a part; a span
  `scrubSpan` cannot walk keeps its numeric `measurements` and carries `scrub.withheld` (task 1.5 replaced the drop of
  a transaction whose root span carries it: such a transaction is sent, marked); one table in `sample-rate.test.mjs` tests `SAMPLE_RATE`; the
  `observabilityEnv` and `scrubSpan` comments and design.md's Limit and Risks match the code. Verify: a `scrubEvent`
  test keeps `https://<host>/static/js/main.3f2a1b4c.js` in a frame and a debug image and masks a token in its place;
  through the real client, a fetch span arrives with a bare token query term and a token fragment redacted, and a
  transaction whose child span cannot be scrubbed is sent with that span marked (task 1.5 replaced the check that a
  transaction whose root span cannot be scrubbed is not sent: it arrives marked); `redact` masks the last segment before `,`, `;`, `:`, `!`, `]` and `*`; `SAMPLE_RATE` accepts
  `0`, `1`, `.5` and `1.0` and rejects `1.5`, `-1`, `0x1` and `1e-1`; `yarn run check` passes. Depends on 1.3.
  HOO-2905.
- [x] 1.5 Apply the review of `52897a80f` as design.md, Decisions 2 and 5, describe: `redact` masks a token-like
  label of the host in the `server.address` and `url.domain` span attributes by the URL masker's host rule; a
  transaction whose root span `scrubSpan` withheld is sent, scrubbed, with its numeric measurements and the
  `scrub.withheld` marker, and `scrubTransaction` returns `null` only when its own walk throws; the URL masker keeps a
  content-hashed file name under `static/` only when its name part is not token-like; the `client-v2-custom-rpcs`
  masking requirement states the rule the screen follows; the runbook's Page loads check marks the dashboard clause
  pending the preview check, now task 1.7 (task 1.6 replaced the mark with the condition). Verify: through the real client, a fetch span to `acme-mainnet-4f2a9c1b7d3e.rpc.example.test` arrives
  with both host attributes redacted, a `sig=abc` query term arrives as `sig=[redacted]` in `url.query`, and a
  transaction whose root span cannot be scrubbed arrives marked, with its `lcp` measurement and no secret; a
  `scrubEvent` test keeps `main.3f2a1b4c.js` and `812.a1b2c3d4.chunk.js` frames and masks
  `abc123def456ghi789.3f2a1b4c.js`; `redact` keeps a `static/media/logo.<hash>.svg` URL and masks a token segment
  above `static/js/main.<hash>.js`; `yarn run check` passes. Depends on 1.4. HOO-2905.
- [x] 1.6 Apply the review of `2aef2969e` as design.md, Decisions 2 and 5, describe: the URL masker judges each run
  of key characters in a host label, path segment, query value, bare query term or fragment on its own, masks each
  run that reads as a token and keeps the text around it, and masks endpoint URLs joined by commas each as a URL of
  its own; `url-secret.mjs` exports `maskQueryWith` and `maskFragmentWith`, which `maskUrlWith` and `URL_PART_RULES`
  both use; `scrubTransaction` becomes `scrubTransactionWith(onWithheld)`, and `sentryOptions` sends one
  "Transaction withheld: scrubbing it failed" message per session, tagged `scrub_error`, on fresh scopes;
  `scrubSamplingContext` redacts only a string; task 1.4 says what 1.5 replaced; the runbook's Page loads check
  states its condition, replacing the clause 1.5 marked pending; the `observabilityEnv` JSDoc names no default.
  Verify: `redact` masks the token in `<key>*`, `<key>,then` and `<key>;v=1` segments and keeps the rest, masks both
  keys and the credentials of `https://a.test/v2/<key>,https://u:pw@b.test/v2/<key>`, keeps the port of a
  `server.address` of `<key>:8899`, and keeps `cluster=devnet&sig=[redacted]` and `section` in `url.query` and
  `url.fragment`; `scrubSamplingContext` redacts a transaction name and leaves a context without one; in-source,
  `scrubTransactionWith` passes `TypeError` to its callback on a walk that throws and does not call it on success;
  through the real client, two transactions whose walk throws send no transaction and one withheld message;
  `yarn run check` passes. Depends on 1.5. HOO-2905.
- [ ] 1.7 Check the change on a preview before the merge: label the PR `preview`, set `SENTRY_PREVIEW_ENABLED=true`
  for it with the rate unset, and walk the manual scenarios of both delta specs. Rewrite the Page loads check of
  `client-v2/docs/production-runbook.md` with the result. Verify: the `pageload` transaction shows in Sentry with LCP
  and CLS, the Web Vitals dashboard of project `solana-playground` shows the preview's environment, the PR lists each
  scenario with its result, the runbook's Page loads check states what the dashboard showed, and the PR states the
  preview's transaction count after one day in Sentry's usage stats, with production's projected monthly volume
  against the quota. If the dashboard stays empty while the transaction is in Discover, stop and update this change
  for stream mode (design.md, Risks). Depends on 1.6. HOO-2905.

## Workflow follow-up

- After the merge, watch Sentry's usage stats for a week; if production's volume runs past the quota, set
  `REACT_APP_SENTRY_TRACES_SAMPLE_RATE` lower in Vercel and redeploy.
- Archive the change in this PR once 1.7 is ticked (agreed 2026-11-14).
