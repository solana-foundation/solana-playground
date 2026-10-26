# client-v2-logging Specification

## Purpose
How code in `client-v2` logs, how each entry names its origin, which providers
receive it, and which entries reach Sentry, so that a failure in a user's
browser reaches the team with enough context to find its source.

## Requirements

### Requirement: Every entry has a namespace

Every log entry SHALL carry a namespace of the form `<slice>:<module>`. An
entry from `Logger` without an `ns` option SHALL carry `app:common`; an entry
with an `ns` option SHALL carry that value; an entry from a logger made by
`createLogger(ns)` SHALL carry `ns` unless the call overrides it.

#### Scenario: The default namespace

- **WHEN** `Logger.warn("clipboard unavailable")` is called
- **THEN** the memory provider records namespace `app:common`

#### Scenario: A per-call namespace

- **WHEN** `Logger.error(error, { ns: "wallet:connect" })` is called
- **THEN** the memory provider records namespace `wallet:connect`

#### Scenario: A bound logger

- **WHEN** `createLogger("persistence:sync").error(error)` is called
- **THEN** the memory provider records namespace `persistence:sync`

#### Scenario: Console output

- **WHEN** the console provider receives an entry with namespace
  `persistence:sync`
- **THEN** the printed line starts with `[persistence:sync]`

### Requirement: Providers configured later receive entries from loggers created earlier

A logger SHALL send each entry to the providers configured at the time of the
call, not at the time the logger was created.

#### Scenario: A module-level logger and a later initLogger

- **WHEN** a logger is created at module import, `initLogger` is then called
  with the memory provider, and the logger logs an error
- **THEN** the memory provider receives the entry

### Requirement: Console is the default provider

Before `initLogger` is called, entries SHALL go to the console provider.
`initLogger` SHALL replace the provider list with the one it is given. The
console provider SHALL map `panic` and `error` to `console.error`, `warn` to
`console.warn`, `info` to `console.info`, and `debug` to `console.debug`, and
SHALL print only entries at or above its threshold: `debug` in development,
`warn` in production, or the level in `REACT_APP_LOG_LEVEL` when set.

#### Scenario: An error during start-up

- **WHEN** an error is logged before `initLogger` runs
- **THEN** it is printed with `console.error`

#### Scenario: Production threshold

- **WHEN** a production build logs at `info` and at `warn` with
  `REACT_APP_LOG_LEVEL` unset
- **THEN** only the `warn` entry is printed

#### Scenario: The app's configuration

- **WHEN** the app starts
- **THEN** `initLogger` is called once, by the `Observability` widget, with
  the console and Sentry providers

### Requirement: The browser logger reaches Sentry through one provider

The browser logger SHALL reach Sentry only through
`shared/lib/logger/providers/sentry.ts`; no other file under
`shared/lib/logger/providers/` SHALL import `@sentry/*` statically. The server
logger reaches Sentry as "Server code logs through the server logger" states.
The Sentry provider SHALL send every `panic` entry, and
every `error` or `warn`
entry logged with `report: true`, and no `info` or `debug` entry. It SHALL set
the tag `ns` to the entry's namespace, and SHALL do nothing when
`REACT_APP_SENTRY_DSN` is unset.

#### Scenario: A Sentry import in another logger provider

- **WHEN** a file under `shared/lib/logger/providers/` other than the Sentry
  provider has a static import of `@sentry/react`
- **THEN** `yarn lint` fails

#### Scenario: An error not marked for reporting

- **WHEN** `Logger.error(error)` is called without `report: true`
- **THEN** the Sentry provider sends nothing

#### Scenario: A reported error

- **WHEN** `createLogger("persistence:sync").error(error, { report: true })`
  is called with a DSN configured
- **THEN** Sentry receives an exception event at level `error` with tag
  `ns: persistence:sync`, the build's release, and its environment

#### Scenario: No DSN

- **WHEN** a build without `REACT_APP_SENTRY_DSN` logs a panic
- **THEN** nothing is sent and nothing throws

### Requirement: Unhandled and render errors go through the logger

The logger SHALL log with `Logger.panic` every uncaught error, unhandled
promise rejection, and error thrown while rendering, and Sentry SHALL NOT
capture them through any other path. The one exception is the browser's
`ResizeObserver loop completed with undelivered notifications.` error event,
which carries no `error` and is dropped before it is logged; an event with
any other message, or with an `error`, is logged (HOO-2125).

#### Scenario: An unhandled rejection

- **WHEN** a promise rejects and nothing handles it
- **THEN** the memory provider records a `panic` entry with namespace
  `logger:global`, and Sentry receives exactly one event for it, marked
  unhandled

#### Scenario: The browser's ResizeObserver loop notice (manual)

- **WHEN** a fresh load of the development server lays out the panels and the
  browser reports `ResizeObserver loop completed with undelivered
  notifications.`
- **THEN** the console shows no `logger:global` entry for it (C-4 in
  `docs/testing.md`)

#### Scenario: A component throws while rendering

- **WHEN** a component under the root `LoggerErrorBoundary` throws during
  render
- **THEN** the memory provider records a `panic` entry with namespace
  `app:render`, and the boundary renders its fallback

### Requirement: A thrown value that is not an Error keeps its value

When an entry is logged with a value that is not an `Error`, the logger SHALL
create an `Error` whose message is the value converted to a string and whose
`cause` is the original value.

#### Scenario: A string is thrown

- **WHEN** `Logger.error("timeout")` is called with a string as the error
- **THEN** the recorded entry's error is an `Error` with message `timeout`
  and `cause` `"timeout"`

### Requirement: Code in the layers logs through the logger

Code under `src/{features,shared,entities,widgets}/` and `api/` SHALL NOT
call `console.*`, except the browser console provider
`shared/lib/logger/providers/console.ts`, the server console provider
`shared/lib/logger/providers/server-console.mjs`, and test files. Browser
code logs through `shared/lib/logger`; `api/` and the slices' `.mjs` server
modules log through `shared/lib/logger/server.mjs`. A `catch` in those
layers and in `api/` SHALL rethrow, log through a logger, or show the
failure to the user.

#### Scenario: A console call in a feature

- **WHEN** a file under `features/` calls `console.error`
- **THEN** `yarn lint` fails

#### Scenario: A console call in a route

- **WHEN** a file under `api/` calls `console.error`
- **THEN** `yarn lint` fails

#### Scenario: Output of the user's code

- **WHEN** a legacy root such as `utils/js-runtime` or a `.raw` template
  calls `console.log` for the user's program
- **THEN** the lint rule does not apply

### Requirement: Server code logs through the server logger

`createServerLogger(ns)` in `shared/lib/logger/server.mjs` SHALL take the
levels `error`, `warn`, `info` and `debug`, the `ns` and `report` options
of the browser logger, and a `context` option, a record of fields that
describe the failure. It SHALL send each entry to the providers configured
at the time of the call. Before `initServerLogger` is called, entries SHALL
go to the server console provider only. The server console provider SHALL
print an error as a plain object of its own properties, `message`, `code`,
`stack`, and `cause`, because the platform's console reduces an `Error` to
its `message` and `stack`, and SHALL print `context` after it. Once
`@sentry/node` has loaded, `withObservability` SHALL call `initServerLogger`
with the console and Sentry providers. The server Sentry provider SHALL
capture every `error` or `warn` entry logged with `report: true`, with the
tag `ns` and `context` as the event's `extra`, and no other entry.
`shared/lib/logger` SHALL NOT import `@sentry/node`: the provider takes the
loaded SDK as an argument. `withObservability` SHALL initialise
`@sentry/node` so that no event carries a request body, a cookie, or a
request header.

#### Scenario: A driver error in a route

- **WHEN** `api/projects.mjs` catches a database error that carries `code`
  and `constraint`, and logs it
- **THEN** the function log shows `[api:projects]` and the error's
  `message`, `code`, `constraint`, `stack`, and `cause`

#### Scenario: A module-level server logger and a later initServerLogger

- **WHEN** a server logger is created at module import, `initServerLogger`
  is then called with another provider, and the logger logs a warning
- **THEN** that provider receives the entry

#### Scenario: A reported server error with Sentry on

- **WHEN** Sentry is on and a handler wrapped by `withObservability` calls
  `createServerLogger("api:projects").error(error, { report: true, context: { code: "23505" } })`
- **THEN** Sentry receives the exception with the tag `ns: api:projects` and
  `extra` `{ code: "23505" }`

#### Scenario: A request's body, cookies and headers

- **WHEN** Sentry is on and an error is captured while a function handles a
  request with a body, a session cookie, and an `authorization` header
- **THEN** the event Sentry receives holds none of them

#### Scenario: A server error not marked for reporting

- **WHEN** a server logger logs `error(error)` without `report: true`
- **THEN** the server Sentry provider sends nothing

#### Scenario: Sentry off on the server

- **WHEN** a function runs where `sentryEnabled` is false and logs an error
  with `report: true`
- **THEN** the error is printed by the console provider and nothing else
  receives it

### Requirement: Stack traces in Sentry are readable and source maps are private

Each production build SHALL upload its source maps to Sentry under a release
named after the commit SHA, and SHALL NOT deploy the `.map` files.

#### Scenario: An error from production

- **WHEN** Sentry receives an error from a production build
- **THEN** its stack trace shows original file names and lines

#### Scenario: Requesting a source map

- **WHEN** a browser requests `/static/js/<bundle>.js.map` from the deployed
  site
- **THEN** the response is not the source map
