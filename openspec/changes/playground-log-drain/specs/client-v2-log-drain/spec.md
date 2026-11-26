# Spec Delta

## Purpose

**Area:** Production Vercel log ingestion (client-v2 API). Deliver authenticated Playground events to Loki for dashboards and alert evaluation.

## ADDED Requirements

### Requirement: Authenticate delivery and bound input

The receiver SHALL reject unauthenticated POST requests before reading the body, return 503 when required configuration is missing, and reject bodies larger than 4 MiB.

#### Scenario: Invalid authentication (manual)
- **WHEN** a POST has no valid drain-secret header
- **THEN** the receiver returns 403 without contacting Loki

#### Scenario: Oversized batch (manual)
- **WHEN** an authenticated body exceeds 4 MiB
- **THEN** the receiver returns 413 without contacting Loki

### Requirement: Preserve production logs with bounded labels

The receiver SHALL preserve event JSON, use service=playground and env=prd, bound source and level values, and exclude other projects, previews and its own requests.

#### Scenario: Production error event (manual)
- **WHEN** an authenticated batch contains a production Playground error
- **THEN** Loki receives its timestamp, original JSON and service, env, source and level labels

#### Scenario: Ingestion loop prevention (manual)
- **WHEN** a batch contains receiver traffic, preview traffic or another project's records
- **THEN** those records are omitted

### Requirement: Retry failed delivery without logging secrets

The receiver SHALL return 502 when Loki rejects a push or the bounded network request fails, without logging credentials or event bodies.

#### Scenario: Loki failure (manual)
- **WHEN** Loki returns an error or fails to answer within the timeout
- **THEN** Vercel receives 502 and the server log contains a generic error

### Requirement: Support Vercel endpoint verification

The receiver SHALL return the configured verification header on GET without requiring ingestion credentials.

#### Scenario: Endpoint verification (manual)
- **WHEN** Vercel requests the receiver with GET
- **THEN** the response contains the configured x-vercel-verify header and no log is forwarded
