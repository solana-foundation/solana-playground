# Tasks

Tasks 1.1, 1.2 and 1.3 touch different files and may run at the same time.

## 1. Name a null error by its source (HOO-3021)

- [x] 1.1 The logger names a `null` or `undefined` error by the namespace that logged it, or says nothing caught an unhandled one (`shared/lib/logger/logger.ts`); verify with the in-source tests under "an error that is null or undefined", failing first against 84f51ff5. HOO-3021
- [x] 1.2 Persistence diagnostics report a failure with no error object as an `Error` named by what failed (`features/persistence/model/diagnostics.ts`); verify with its in-source test for `null` and `undefined`, failing first against 84f51ff5. HOO-3021
- [x] 1.3 The key page's transaction helper rejects a failed request with the request's error, not `null` (`utils/wallet/key-origin/frame/store.ts`); verify with its in-source `ConstraintError` test, failing first against 84f51ff5. HOO-3021

## Workflow follow-up

- Ask a human whether to close the change before the PR is opened.
