# Proposal

## Why

Playground's Grafana dashboards and alerts have no production logs to query. Vercel needs an authenticated receiver that converts log batches to Loki streams before monitoring can detect failures.

## What Changes

- Add a bounded, authenticated Vercel log receiver that preserves event JSON and labels logs for Playground.
- Exclude preview, foreign-project and receiver traffic to prevent contamination and ingestion loops.
- Document production configuration and activation checks. No product telemetry events change.

## Capabilities

### New Capabilities

- `client-v2-log-drain`: authenticated production log delivery to Loki.

### Modified Capabilities

None.

## Impact

Adds one API route and tests, with no browser changes or new dependencies. Operators can identify Playground errors in Grafana and receive Slack alerts once the drain is activated. Credentials and drain creation stay outside Git. Rust build-server logs, browser telemetry, and changes to other services are out of scope.
