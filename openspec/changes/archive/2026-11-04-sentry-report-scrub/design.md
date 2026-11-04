# Design

## Context

The `telemetry-and-logging` change (archived 2026-10-26) sends `panic`
entries and entries logged with `report: true` to Sentry. Two things reach a
report that should not: the user's own program output, and secret keys. A
command failure the terminal has already printed is also reported as a
`panic`, though the user saw it and it is no bug.

## Decisions

1. **Reports are scrubbed in the reporter.** The user's tests print through
    mocha's `spec` reporter to the main window's `console.log`, which Sentry's
    `Console` integration records as breadcrumbs, and no console call tells
    their output from the logger's. So the integration is off, and the Sentry
    provider leaves each entry at `warn` or above as a breadcrumb through
    `reporter.trail`. `reporter/sentry.ts` passes `beforeBreadcrumb` and
    `beforeSend` the pure rules in `reporter/scrub.ts`, which walk the whole
    event and redact secret-shaped values: hex or base58 runs of 64+
    characters, and 32+ bytes in any shape, including the index-keyed object
    Sentry's normalising makes of a typed array. An event the rules cannot walk
    is replaced by a "withheld" event, since Sentry drops a throwing
    `beforeSend` without a word. Feedback is not an error event, so its text
    is sent as written. _Rejected:_ keeping console breadcrumbs whose first
    argument is the logger's tag (user output can start with one too);
    scrubbing at each call site (the user's output never passes through our
    code); a list of event fields to scrub (every field left off is a leak).
    A command typed in the terminal that fails is no bug: `PgTerm.process`
    prints it and rethrows, and the Enter key leaves that rejection unhandled.
    So `process` marks the error with `markShown`, and the global handler logs
    a marked rejection at `warn`, a breadcrumb. _Rejected:_ catching at the
    Enter key (a caller of `execute` still needs the rejection, and any other
    unawaited caller would still panic); reusing `markFailureShown` (it marks
    only while the console is open, for the button toast, and lives above the
    logger).
