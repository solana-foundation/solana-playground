# Spec Delta

## Purpose

The widget that turns the logger, Sentry, and telemetry on for the app, so
their configuration is one typed contract instead of calls scattered through
start-up.

## ADDED Requirements

### Requirement: One widget initialises logging and telemetry

`widgets/observability` SHALL export `Observability` with the props `sentry`
(`dsn`, `release`, `environment`), `googleAnalytics` (`measurementId`),
`logLevel`, `fallback`, and `children`, and SHALL initialise the logger,
the global error handlers, and telemetry once per page load, before its
children first render.

#### Scenario: StrictMode renders twice

- **WHEN** `Observability` renders under `React.StrictMode` with a DSN
- **THEN** Sentry is initialised once

#### Scenario: A child's first render

- **WHEN** a child of `Observability` renders for the first time
- **THEN** Sentry is already initialised

#### Scenario: A child throws while rendering

- **WHEN** a child of `Observability` throws during render
- **THEN** `fallback` is shown in its place and the error is reported

#### Scenario: No ids

- **WHEN** `Observability` renders without a DSN and without a measurement id
- **THEN** no request goes to Sentry or Google, and the children render

### Requirement: A missing id is announced where the deployment is read

A warning SHALL name each unset `REACT_APP_SENTRY_DSN` or
`REACT_APP_GA_MEASUREMENT_ID` and what is lost without it, in the browser
console at start-up, in the build log, and in the log of each `api/`
function once per instance.

#### Scenario: A deployment without ids

- **WHEN** the app is built and served without either variable
- **THEN** the build log, the browser console, and the first request to each
  `api/` function each print one warning per missing variable

### Requirement: Initialisation is tracked

`widgets/observability` SHALL track `obs_initialised`, with no parameters,
once per page load when initialisation completes.

#### Scenario: The app starts

- **WHEN** `Observability` first renders
- **THEN** `obs_initialised` is tracked once
