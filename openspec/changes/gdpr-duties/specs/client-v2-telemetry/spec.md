# Spec Delta

## MODIFIED Requirements

### Requirement: GA4 loads only with a measurement id

The GA4 provider SHALL send nothing without a measurement id or while the
analytics choice is not `allowed` (`analytics-consent`). With an id and the
choice `allowed`, it SHALL queue events from the moment consent is given, so
events tracked after Allow and before `gtag.js` loads are sent once it does.
`GoogleAnalytics` SHALL inject `gtag.js` once when a measurement id is set and
the choice is `allowed`, and nothing otherwise.

#### Scenario: An event before gtag.js loads
Pinned by the in-source block of `client-v2/src/shared/lib/telemetry/providers/ga4.ts` and `client-v2/src/shared/lib/telemetry/google-analytics.test.tsx`, under `yarn test-unit`.

- **WHEN** an event is tracked after `initTelemetry`, after the visitor
  allowed analytics and before `gtag.js` has loaded, with a measurement id set
- **THEN** the event is in the queue `gtag.js` reads when it loads

#### Scenario: No measurement id
Pinned by the in-source block of `client-v2/src/shared/lib/telemetry/providers/ga4.ts` and `client-v2/src/shared/lib/telemetry/google-analytics.test.tsx`, under `yarn test-unit`.

- **WHEN** a build without `REACT_APP_GA_MEASUREMENT_ID` tracks an event
- **THEN** no request goes to Google and nothing throws

#### Scenario: A measurement id is set
Pinned by the in-source block of `client-v2/src/shared/lib/telemetry/providers/ga4.ts` and `client-v2/src/shared/lib/telemetry/google-analytics.test.tsx`, under `yarn test-unit`.

- **WHEN** a build with `REACT_APP_GA_MEASUREMENT_ID`, in a browser that
  allowed analytics, tracks `dply_started`
- **THEN** `gtag` is called with event `dply_started` and its parameters

#### Scenario: A measurement id is set and analytics is not allowed (manual)
Pinned by the in-source block of `client-v2/src/shared/lib/telemetry/providers/ga4.ts`, under `yarn test-unit`.

- **WHEN** a build with `REACT_APP_GA_MEASUREMENT_ID`, in a browser whose
  choice is `unanswered` or `declined`, tracks `dply_started`
- **THEN** no request goes to Google, `window.gtag` and `window.dataLayer` are
  undefined, and nothing throws

#### Scenario: Rendering on the server or in a test without initialisation
Pinned by the in-source block of `client-v2/src/shared/lib/telemetry/providers/ga4.ts` and `client-v2/src/shared/lib/telemetry/google-analytics.test.tsx`, under `yarn test-unit`.

- **WHEN** `track` runs where `window` is undefined
- **THEN** nothing throws and nothing is sent
