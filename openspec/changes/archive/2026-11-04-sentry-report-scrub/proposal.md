# Proposal

## Why

A Sentry report from the browser can carry what the user did not choose to
send. The user's tests print through mocha to the window's `console.log`,
which Sentry's `Console` integration records as breadcrumbs, so their program
output rides along with every later report. Errors and contexts can hold a
secret key as base58, hex, or bytes. And every command typed in the terminal
that fails as expected (an unknown command, a declined wallet question) arrives
as an unhandled `panic`, which buries real failures (HOO-1800).

## What Changes

- Sentry's `Console` integration is off, and every `console` breadcrumb is
  dropped; the logger's own entries at `warn` or above reach Sentry as
  breadcrumbs the reporter adds.
- `reporter/scrub.ts` walks every error event and breadcrumb and replaces
  secret-shaped values with `[redacted]`; an event it cannot walk is replaced
  by a "withheld" one. Public keys and feedback text are kept.
- `PgTerm.process` marks a failure it printed as expected (`markExpected`),
  never a fault such as a `TypeError`, and the global handler logs a marked
  rejection at `warn` under its name only, a breadcrumb.

## Capabilities

### Modified Capabilities

- `client-v2-logging`: what an error event and its breadcrumbs may carry, and
  how a failure the terminal printed is logged.

## Impact

`client-v2/src/shared/lib/reporter/`, `shared/lib/logger/` (Sentry provider,
global handlers), `utils/terminal/terminal.ts`. No server change, no new
dependency.
