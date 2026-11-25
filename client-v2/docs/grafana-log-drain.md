# Grafana log drain

`api/log-drain.mjs` receives Vercel logs for Playground and forwards full event JSON to Loki. The Grafana folder is `playground`; its dashboards use `{service="playground", env="prd"}`. Keep the alerts paused until the production drain is verified.

## Production configuration

Set these in the production Doppler config, which syncs to Vercel Production:

- `GRAFANA_LOKI_URL`: HTTPS Loki origin or push URL.
- `GRAFANA_LOKI_USER`: numeric Loki tenant.
- `GRAFANA_LOKI_TOKEN`: logs-write credential. Rotation of a shared credential must update every consumer.
- `VERCEL_DRAIN_SECRET`: a random secret used only for this drain.
- `VERCEL_LOG_DRAIN_PROJECT_ID`: the Playground Vercel project ID.
- `VERCEL_LOG_DRAIN_VERIFY`: the team's Vercel verification value.

Never expose these through browser-prefixed variables. Updating the configuration requires a deployment before the function reads it.

## Connect and verify

1. Deploy the receiver. A GET to `https://playground.solana.com/api/log-drain` must return 200 and the configured `x-vercel-verify` header. A POST without the secret must return 403.
2. Create a drain for only the Playground project, production environment, and static/lambda/edge sources. Use NDJSON delivery to the URL above, with `x-vercel-drain-secret` set from the secret store. Exclude `/api/log-drain` from delivery where filtering permits; the receiver also drops those records.
3. Request the homepage and `/api/health`. Confirm actual delivered records appear in Loki with service=playground, env=prd, source and level labels. Confirm proxy.statusCode and path survive JSON parsing. A manually injected verification event does not prove Vercel delivery.
4. Check the Grafana dashboard queries against those records, then enable the three rules. Confirm rule evaluation health is OK. The absence alert assumes regular production traffic and must be revisited if Playground becomes low-traffic.
5. Test Slack delivery with the channel owner's approval. Rules target `playground-slack` directly; the shared notification tree needs no changes.

The receiver drops foreign-project, preview and self-generated records, bounds labels, and rejects malformed or oversized batches. It returns 502 on a Loki push failure to allow Vercel retries. The existing server observability wrapper reports generic configuration and delivery errors to Sentry when enabled and flushes them before returning; log bodies and drain credentials are excluded. It does not exercise the IDE, wallet, compiler or assistant end to end.

## Verification

Run `node --test api/log-drain.test.mjs` from client-v2. The tests stub Loki and prove receiver behavior, not cloud delivery. The steps above are the production verification gate.
