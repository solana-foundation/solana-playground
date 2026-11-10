# Tasks

The team implements these on `scope/users-work-2`. Every task is HOO-2411
unless it says "ticket to file", and each is one PR. Task 1.1 goes first;
the others depend on it and may run at the same time, except 4.2, which
depends on 4.1. Each task declares, describes and emits its events, with
memory-provider tests (one per branch, `it.each` for a table), and replaces
its rows' `pending (funnel-events)` mark in the funnel table with the slice.

## 1. The funnel check

- [x] 1.1 Extend `src/app/slice-structure.test.ts` with the funnel check of
      [design.md](design.md): collect every name declared through
      `createTracker<...>()` under `features/`, `widgets/` and `entities/`,
      read the Events column of the table in
      `openspec/specs/client-v2-funnels/spec.md` (or this change's delta
      while that file does not exist), and fail with the missing names when
      a row's Source is neither `GA4` nor `pending (...)`. Satisfies
      `client-v2-funnels`, "Each funnel step names its events and the code
      that sends them". Verify by renaming a declared event and by removing
      a `pending` mark, each failing with the name, both reverted; and that
      `yarn run check` passes

## 2. Project files

- [ ] 2.1 Add `features/project-files` with prefix `project` and the
      error-to-reason mapping, `GithubImportError` in `utils/github.ts` and
      a named empty-conversion error in `utils/framework.ts`. Satisfies
      `client-v2-project-files`, "The slice declares the project events" and
      "Import failures carry an enumerated reason": declare, describe and
      emit, with memory-provider tests, one per reason (depends on 1.1)
- [ ] 2.2 Send the import events from `ImportGithub` and `Example`
      (`ImportGithub.tsx`), `ImportFs` (`ImportFs.tsx`) and `ImportTemporary`
      (`ImportTemporary.tsx`). Satisfies "A GitHub import is counted", "A
      file import is counted" and "A temporary project's import is
      counted": declare, describe and emit, with memory-provider tests,
      including nothing sent for a closed program choice; clear the import
      row's mark (depends on 2.1)
- [ ] 2.3 Send `project_viewed` and `project_view_failed` from the
      `github` route (`routes/github/github.tsx`). Satisfies "A project
      opened from a GitHub link is counted": declare, describe and emit,
      with memory-provider tests; clear the GitHub link row's mark (depends
      on 2.1)
- [ ] 2.4 Send the export events from `convertAndExport` and
      `exportWithoutChanges` (`ExportWorkspace.tsx`) and from `Project`
      (`widgets/settings-page/ui/SettingsPage.tsx`). Satisfies "An export is
      counted with where it started" and "The settings page's export is
      counted": declare, describe and emit, with memory-provider tests,
      including the conversion fallback; clear the export row's mark
      (depends on 2.1)

## 3. Run

- [ ] 3.1 Add `features/run` with prefix `run`; make `PgJsRuntime.execute`
      (`utils/js-runtime/js-runtime.ts`) report whether a file failed and
      throw a named error when another run is in progress; send the events
      from `processCommon` (`commands/run-and-test/run-and-test.ts`).
      Satisfies every requirement of `client-v2-run`: declare, describe and
      emit, with memory-provider tests for passed and failed of each kind,
      `busy`, and `other`; clear the run row's mark (depends on 1.1)

## 4. Deploy

- [ ] 4.1 Change `features/deploy/model/telemetry.ts` to `kind`, `via`,
      `custom` and `authority`; let `PgDeployRun` (`commands/deploy/run.ts`)
      carry `via`; send the three run events from the `deploy` command's
      `preChecks` and `handle` (`commands/deploy/deploy.ts`) without moving
      the checks; record the `authority` step around `setBufferAuthority`;
      wrap `realBridge.deploy` (`playground-bridge.ts`) in
      `via: "assistant"`. Satisfies `client-v2-deploy`, "Deploy events",
      "Every deploy is counted once, from the command they share", "The
      deploy names its caller" and "The authority step is telemetry only":
      declare, describe and emit, with memory-provider tests for each `via`,
      `first` and `upgrade`, a failure at `checks` and at `write`, `custom`,
      and nothing for a pause press; `deploy.test.ts` and `yarn run check`
      pass (depends on 1.1)
- [ ] 4.2 Drop the run events from `PgStageDeploy.start`
      (`features/deploy/model/stage-deploy.ts`) except the wallet-connect
      failure. Satisfies "A stage deploy whose wallet does not connect is
      counted": declare, describe and emit, with memory-provider tests
      that a stage deploy sends each event once (depends on 4.1)

## 5. Fund

- [x] 5.1 Send `fund_airdropped {via, cluster}` from the `airdrop` command
      (`commands/airdrop/airdrop.ts`) once the balance rises, with `via` set
      by each caller through `withAirdropVia` (`commands/airdrop/via.ts`).
      Satisfies `client-v2-wallet-funding`, "A faucet airdrop is counted"
      (HOO-2751; depends on 1.1)

## Workflow follow-up

- Align `wbdi-flow`'s "Deploy telemetry" requirement with the names and
  parameters of 4.1 (ticket to file).
- Share events, once hoodieshq#276 lands on `scope/typescript` (ticket to
  file).
- Archive the change once a human says so, in the PR that ticks the last
  task (`client-v2/CLAUDE.md`, "Specs and changes" 5).
