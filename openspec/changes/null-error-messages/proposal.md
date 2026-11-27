# Proposal

## Why

About 100 Sentry events on release 84f51ff5 read "Error: null", with nothing
naming the code that produced them (HOO-3021: SOLANA-PLAYGROUND-15, -16, -19,
-1D, -1F, -1G). The logger turned a `null` or `undefined` value into an
`Error` whose message is the string "null", and persistence diagnostics passed
`null` on purpose for a failure that has no error object, such as an HTTP 404.
A report that says neither what failed nor who logged it cannot be triaged.

## What Changes

- The logger gives a `null` or `undefined` value logged as an error a message
  naming the namespace that logged it (`editor:editor logged null instead of
  an Error`), or, from the global handler, saying that nothing caught it (`a
  promise rejected with null and nothing caught it`). `cause` stays the
  original value; the stack is taken at the log call. Other non-Error values
  keep today's message, the value as a string (HOO-3012 covers a plain
  object).
- Persistence diagnostics report a failure that came with no error object as
  an `Error` whose message is what failed (`fetch project <id>: HTTP 404`).
  The recorded failure still holds the original value.
- The wallet key page's IndexedDB transaction helper rejects a failed request
  with the request's error instead of `tx.error`, which is still `null` when
  `onerror` runs.
- No telemetry event is added, renamed or removed; no funnel step's code
  changes.

User-visible consequence: none in the UI. Sentry groups these failures under
messages that name their source, so they can be assigned and fixed.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `client-v2-logging`: "A thrown value that is not an Error keeps its value"
  gains the message for `null` and `undefined`; a new requirement says how
  persistence diagnostics report a failure with no error object.

## Impact

- Code: `client-v2/src/shared/lib/logger/logger.ts`,
  `client-v2/src/features/persistence/model/diagnostics.ts`,
  `client-v2/src/utils/wallet/key-origin/frame/store.ts`, with their in-source
  tests.
- Sentry: the existing "Error: null" issues stop receiving events; new issues
  open under the new messages.
- Out of scope: the lightning-fs / idb-keyval layer, whose aborted requests
  reject with `null` and whose debounced tree save and deactivation leave
  rejections unhandled (HOO-3023); a plain object logged as an error,
  "[object Object]" (HOO-3012); the `PgExplorer.saveMeta` interval that
  retries every 5 s against a closed database (HOO-3023).
