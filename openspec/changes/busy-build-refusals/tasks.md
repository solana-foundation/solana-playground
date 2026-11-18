# Tasks

Every task lands in #182. Tasks 1.1 and 2.1 are independent. Task 3.1 depends
on both, since it reads the answers they send. Task 3.2 depends on 3.1, which
adds the busy refusal it counts. Task 4.1 needs no code and may run at any time.

## 1. Route

- [x] 1.1 Limit builds per GitHub user in `/api/build-server`
  (`client-v2/src/features/build-server/server/limits.mjs`, `checkBuildLimitWith`
  before `startAuditWith`), answering `429` with `Retry-After` and
  `reason: "build-limit"`, writing no audit row, and answering `503` when the
  count fails; relay `Retry-After` on a `429` or `503` only, and leave a `503`
  with `Retry-After` unreported (HOO-2907). Verified by `limits.test.mjs` and
  `api/build-server.test.mjs` under `yarn test-api`, covering each scenario of
  "A user's builds are limited", "A build refused by a limit", "The build
  server's queue is full" and "A Retry-After on another status", and a test
  that fails if `BUILD_MAX_DURATION_SECONDS` differs from the route's
  `maxDuration` in `client-v2/vercel.json`.

## 2. Build server

- [x] 2.1 Bound the wait for a build slot in `server/src/routes/build.rs`
  (`QueueLimits`, the `Waiting` guard in `Permit::acquire`), answering
  `Error::Busy` (`503` with `Retry-After`), with `PG_BUILD_QUEUE_LIMIT` and
  `PG_BUILD_QUEUE_WAIT_SECS` read in `config.rs` and set in `server/app.yaml`,
  and `Retry-After` exposed by the CORS middleware (HOO-2908). Verified by
  `cargo test` covering a free slot, a full queue refused at once, a wait that
  runs out taking no slot, and a caller that leaves freeing its place; and by
  `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings`.

## 3. Client

- [x] 3.1 Show a busy refusal as a wait (HOO-2907, HOO-2908):
  `getBusyRetryAfter` in `client-v2/src/utils/busy-refusal.ts`, `retryAfterSeconds`
  and `BUSY_SERVER_MESSAGE` on `PgServerError`, the `busy` kind of
  `BuildFailure`, the `Busy` surface of `BaseBuild` with its countdown, the
  console status line, and `markBuildRefused` in `commands/build/build.ts` for a
  busy refusal. Verified by `yarn test-unit` on `busy-refusal.ts`,
  `server.test.ts`, `stage.test.ts`, `status.test.ts` and `BaseBuild.test.tsx`,
  covering each scenario of "The Build stage shows a busy refusal as a wait";
  depends on 1.1 and 2.1.
- [x] 3.2 Send `build_failed { framework, reason: "busy" }` for a busy refusal:
  add `"busy"` to `BuildFailedReason` in
  `client-v2/src/features/program-build/model/telemetry.ts`, with its doc
  comment, and return it from `reasonOf` in `commands/build/build.ts` when
  `isBusyRefusalError` holds (HOO-2907). Verified by `build.test.ts` asserting
  through the memory provider both scenarios of "A build turned away as busy
  is counted as busy"; depends on 3.1.

## 4. Records

- [x] 4.1 Replace "server/ is not modified" in `openspec/config.yaml`'s
  `context`, and "Never edit client/ or server/" in its `apply` guidance, with
  text that keeps `client/` untouched and points at the root `CLAUDE.md`
  "Gotchas" entry for the fork-owned `server/` changes (ticket to file).
  Verified by `yarn spec:validate` passing and by the entry naming
  `QueueLimits` and #182.

## Workflow follow-up

- Ask whether to close the change before #182 leaves draft. On a yes, delete
  `tasks.md` and run `/opsx:archive` in #182.
