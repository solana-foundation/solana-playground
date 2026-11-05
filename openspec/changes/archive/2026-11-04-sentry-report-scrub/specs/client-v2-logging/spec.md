## MODIFIED Requirements

### Requirement: Reported entries reach Sentry through one provider per logger

The browser logger SHALL reach Sentry only through
`shared/lib/logger/providers/sentry.ts`, and the server logger only through
`sentryServerProvider` in `shared/lib/logger/server.mjs`, which takes the
loaded SDK as an argument so that `shared/lib/logger` never imports
`@sentry/node`. No other file under `shared/lib/logger/providers/` SHALL
import `@sentry/*` statically. Each provider SHALL send every `error` or
`warn` entry logged with `report: true`, the browser's every `panic` entry
too, and no `info` or `debug` entry, as an event, with the tag `ns` set to the
entry's namespace and, on the server, `context` as the event's `extra`. The browser
provider SHALL do nothing when `REACT_APP_SENTRY_DSN` is unset; in the
browser, an entry at `warn` or above that is not reported reaches Sentry only
as a breadcrumb, which no report is sent for.
`withObservability` SHALL register the server provider only once
`@sentry/node` has loaded, and SHALL initialise `@sentry/node` so that no
event carries a request body, a cookie, or a request header.

#### Scenario: A Sentry import in another logger provider

- **WHEN** a file under `shared/lib/logger/providers/` other than the Sentry
  provider has a static import of `@sentry/react`
- **THEN** `yarn lint` fails

#### Scenario: An error not marked for reporting

- **WHEN** `Logger.error(error)` is called without `report: true`
- **THEN** the Sentry provider sends no event, and keeps the entry as a
  breadcrumb for the next report

#### Scenario: A reported error

- **WHEN** `createLogger("persistence:sync").error(error, { report: true })`
  is called with a DSN configured
- **THEN** Sentry receives an exception event at level `error` with tag
  `ns: persistence:sync`, the build's release, and its environment

#### Scenario: No DSN

- **WHEN** a build without `REACT_APP_SENTRY_DSN` logs a panic
- **THEN** nothing is sent and nothing throws

#### Scenario: A reported server error with Sentry on

- **WHEN** Sentry is on and a handler wrapped by `withObservability` calls
  `createServerLogger("api:projects").error(error, { report: true, context: { code: "23505" } })`
- **THEN** Sentry receives the exception with the tag `ns: api:projects` and
  `extra` `{ code: "23505" }`

#### Scenario: A request's body, cookies and headers

- **WHEN** Sentry is on and an error is captured while a function handles a
  request with a body, a session cookie, and an `authorization` header
- **THEN** the event Sentry receives holds none of them

### Requirement: Unhandled and render errors go through the logger

The logger SHALL log with `Logger.panic` every uncaught error, unhandled
promise rejection, and error thrown while rendering, and Sentry SHALL NOT
capture them through any other path. There are two exceptions. The
browser's `ResizeObserver loop completed with undelivered notifications.`
error event, which carries no `error`, is dropped before it is logged; an
event with any other message, or with an `error`, is logged (HOO-2125). A
rejection the terminal has printed as an expected outcome (its "Process
error" line for an unknown command, a bad option or a declined wallet
question, or the line a stop prints) is marked as expected and logged at
`warn` under its error's name only, a breadcrumb (HOO-1800); an unmarked
rejection is a `panic`. A fault is never marked, so a `TypeError`,
`ReferenceError`, `RangeError`, `SyntaxError`, `EvalError`, `URIError` or
WebAssembly error in a command stays a `panic` though the terminal printed
it; a plain `Error` a bug throws is the price of this rule, and is logged at
`warn`. Only an object can be marked: a thrown string or other primitive
stays a `panic` even when the terminal printed it.

#### Scenario: An unhandled rejection

- **WHEN** a promise rejects, nothing handles it, and it is not marked as
  expected
- **THEN** the memory provider records a `panic` entry with namespace
  `logger:global`, and Sentry receives exactly one event for it, marked
  unhandled

#### Scenario: The browser's ResizeObserver loop notice (manual)

- **WHEN** a fresh load of the development server lays out the panels and the
  browser reports `ResizeObserver loop completed with undelivered
  notifications.`
- **THEN** the console shows no `logger:global` entry for it (C-4 in
  `docs/testing.md`)

#### Scenario: A terminal command fails as expected (manual)

- **WHEN** a terminal command fails as expected (an unknown command, a bad
  option, a declined wallet question, a stop) and the rejection reaches the
  global handler, on a preview with a DSN
- **THEN** the browser console shows a `warn` line under `logger:global` that
  names only the error, such as `Expected failure: Error`, and Sentry receives
  no event for it

#### Scenario: A component throws while rendering

- **WHEN** a component under the root `LoggerErrorBoundary` throws during
  render
- **THEN** the memory provider records a `panic` entry with namespace
  `app:render`, and the boundary renders its fallback

## ADDED Requirements

### Requirement: Reports carry no user code or secret key

An error event the browser sends to Sentry SHALL NOT carry the user's program
output or a secret key. Sentry's `Console` integration SHALL be off and every
`console` breadcrumb dropped; the logger's own trail SHALL reach Sentry as
breadcrumbs the reporter adds, one per entry at `warn` or above. In every
value of an error event and of a breadcrumb, a hex or base58 run of 64 or more
characters, a base64 run of 86 or more, a list of 32 or more numbers from 0
to 255 (bracketed, bare, as an index-keyed object, or as the text
`JSON.stringify` makes of one), and a typed array of 32 or more bytes, SHALL
be replaced with `[redacted]`, in keys as in values. An object with `toJSON`
SHALL be scrubbed as what `toJSON` returns, and an `Error` as its name,
message and stack. An event that cannot be scrubbed SHALL be replaced by one
that says it was withheld, keeps its release, environment and exception type,
and groups by namespace. Base58 text of 32 to 44 characters SHALL be kept, so
a public key in base58 stays, and so does a 32-byte seed written in base58 or
base64, which cannot be told from one; any 32-byte value in hex or as bytes,
a public key included, is redacted. A feedback SHALL be sent as the user
wrote it: it is text they chose to send. Unit and integration tests
(`reporter/scrub.ts`, `reporter/sentry.integration.test.ts`) support these
rules; the scenarios are checked by hand on a preview with a DSN.

#### Scenario: The user's test prints to the console (manual)

- **WHEN** a test the user runs prints a value with `console.log`, even one
  that starts with a `[slice:module]` tag, and an error is reported afterwards
- **THEN** the report's breadcrumbs do not include that output

#### Scenario: A secret key in an error message (manual)

- **WHEN** a reported error's message quotes a 64-byte secret key, as base58
  or as a JSON byte array
- **THEN** the report shows `[redacted]` in its place

#### Scenario: A secret key in a reported context (manual)

- **WHEN** a reported entry's context holds a secret key as a `Uint8Array`
- **THEN** the report shows `[redacted]` in its place

#### Scenario: A wallet address in a reported context (manual)

- **WHEN** a reported entry's context holds a wallet's public key
- **THEN** the report shows the public key as it was
