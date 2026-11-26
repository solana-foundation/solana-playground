# Design

## Context

Grafana uses the Explorer log schema: full Vercel event JSON with service, environment, source and severity labels. Playground has plain Node API handlers under client-v2/api.

## Goals / Non-Goals

**Goals:** Deliver production logs without exposing credentials, accepting foreign-project events, or recursively logging the receiver.

**Non-Goals:** Browser telemetry, build-server logs, changes to shared ingestion services, or changing application authentication.

## Decisions

Use a native Node route and the existing server logger. Authenticate the fixed Vercel drain header with a timing-safe comparison. Preserve the JSON record so proxy status and path queries remain compatible with Explorer. Bound request size and label cardinality. Return 502 on upstream failure so Vercel can retry.

A direct drain to Loki cannot translate NDJSON into Loki's push format. Reusing the Tokens receiver would lose Vercel fields when a message exists and does not attach the severity label, so it cannot support these dashboards unchanged.

## Risks / Trade-offs

The shared Loki token couples rotation across consumers; copy it only to production secret stores. A receiver in the same deployment cannot report an outage that prevents its own invocation; the missing-logs alert detects that condition. A failed push can be retried and duplicate logs, so counts are operational signals rather than billing records. Batches above the request bound require a Vercel delivery-size change. Activation waits for production deployment and observed Loki events.
