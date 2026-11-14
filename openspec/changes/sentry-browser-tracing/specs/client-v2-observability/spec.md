# Spec Delta

## MODIFIED Requirements

### Requirement: One widget initialises logging and telemetry

`widgets/observability` SHALL export `Observability` with the props `sentry`
(`dsn`, `release`, `environment`, `tracesSampleRate`), `googleAnalytics`
(`measurementId`), `logLevel`, `fallback`, and `children`, and SHALL
initialise the logger, the global error handlers, and telemetry once per page
load, before its children first render.

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

## ADDED Requirements

### Requirement: Page loads are traced at the configured rate

With a DSN, the browser SHALL trace each page load and navigation with the
probability `REACT_APP_SENTRY_TRACES_SAMPLE_RATE` gives, and a traced page load
SHALL reach Sentry as a transaction carrying the Web Vitals the browser
measured. An unset or empty variable SHALL mean 1. A production build SHALL
fail when the variable holds a value that is not a decimal number, and a number
outside 0 to 1 SHALL mean 1 and print one console warning that names the
variable and the value.

#### Scenario: The rate is unset (manual)

- **WHEN** a preview built with a DSN and without the variable loads in the
  browser
- **THEN** one `pageload` transaction reaches Sentry, with LCP and CLS among its
  measurements

#### Scenario: The rate is 0 (manual)

- **WHEN** a preview built with a DSN and `REACT_APP_SENTRY_TRACES_SAMPLE_RATE=0`
  loads and the user works in it for a minute
- **THEN** no transaction reaches Sentry, and an error reported meanwhile still
  does

#### Scenario: The rate is invalid

- **WHEN** the variable is `"1.5"` or `"-1"`
- **THEN** Sentry is initialised with a sample rate of 1, and the console shows
  one warning naming `REACT_APP_SENTRY_TRACES_SAMPLE_RATE` and the value

#### Scenario: The rate is not a number

- **WHEN** a production build runs with the variable set to `"abc"`
- **THEN** the build fails and names `REACT_APP_SENTRY_TRACES_SAMPLE_RATE`

### Requirement: Trace headers stay on the page's own origin

The browser SHALL add the `sentry-trace` and `baggage` headers only to requests
to the page's own origin. A request to the build server, an RPC endpoint or any
other origin SHALL carry neither header.

#### Scenario: A build request on a traced page load (manual)

- **WHEN** a traced page load sends a build request to the build server
- **THEN** the request carries neither `sentry-trace` nor `baggage`, and its
  CORS preflight, if any, asks for no header it did not ask for before
