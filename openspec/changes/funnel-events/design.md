# Design

## Context

See [proposal.md](proposal.md), "Why". Facts this design rests on, read on
`scope/users-work-2` at `49d486e74`:

- Import, export and temporary import are dialogs in
  `views/sidebar/explorer/Component/Modals/` (`ImportGithub.tsx`,
  `ImportFs.tsx`, `ImportTemporary.tsx`, `ExportWorkspace.tsx`). The settings
  page opens the import dialogs and exports with `PgFramework.exportWorkspace()`
  directly. `/<GitHub URL>` (`githubDefault` in `routes/github/github.tsx`)
  opens a repository as a temporary project through `PgGithub.getFiles`.
- `PgGithub` throws plain `Error`s whose only difference is the message
  (404, rate limit, truncated tree, no source files), and
  `PgFramework.convertToPlaygroundLayout` throws for an unknown framework
  (`PgFramework.isUnknownFramework`) or a conversion that yields nothing.
- No code imports a zip. The Share dialog is exported but never opened, and
  the share route's `validate` returns `false`.
- `run` and `test` (`commands/run-and-test`) call `PgJsRuntime.execute`
  per file. A test file ends with `mocha.run`, whose failure count is
  dropped; a client script's uncaught error is caught inside the iframe and
  printed. `execute` resolves either way, so the command cannot tell passed
  from failed without a change to `execute`. Runs cannot be stopped
  (`client-v2-command-stop`).
- The terminal, the explorer's menu and folder buttons all reach the `run`
  and `test` handlers through `PgCommandManager.execute` with the same
  tokens, so the handler cannot tell which one started it.
- The Deploy stage (`PgStageDeploy.start`), the terminal and the assistant
  (`realBridge.deploy`) all run `PgCommand.deploy.execute()`. The command's
  `preChecks` (`checkWallet`, `checkProgram`) run before its `handle`, and a
  second `deploy` while one runs runs the checks and then reaches `handle`
  only to pause or resume. Only the stage sends `deploy_*` today.
- With an extension wallet, the deploy sends `setBufferAuthority` between
  the write and the deploy, handing the buffer to that wallet, which signs
  the deploy and becomes the program's upgrade authority. With a Playground
  wallet the deploy instruction sets the upgrade authority itself, with no
  transaction of its own.

## Goals / Non-Goals

**Goals:**

- Each event's requirement names the symbol and file that sends it, so an
  agent changing that code finds the requirement.
- The funnel table names each step's code, and the project's rules
  (`openspec/config.yaml`, `client-v2/CLAUDE.md`) send agents to it.
- Reasons read from typed errors, never from a message.
- No user-visible change.

**Non-Goals:**

- Implementing the events: the team does it on `scope/users-work-2` from
  [tasks.md](tasks.md).
- Moving legacy code into the slices. The legacy roots import the slices'
  trackers and call `tracker.track` without a scope, which the telemetry
  spec allows for code outside React.
- IDL, share and the Build and Interact screens' control events
  (`wbdi-flow`). The outcome events of Build, an instruction call and an
  applied assistant patch are goals (HOO-2598): they live in legacy roots
  the slice rule never reached, so no audit found them missing until
  HOO-2411's.
- Page views: GA4's Enhanced Measurement sends `page_view` on every history
  change once "page changes based on browser history events" is on in GA4
  admin (HOO-2409). No code and no redaction.

## Decisions

### The agent is the enforcement

Greptile reviews only PRs into `master`, so a `scope/*` PR has no automated
reviewer for these events. Three things make an implementing agent emit
them and a later agent keep them: each requirement names its call site; the
funnel table names each step's code; and `openspec/config.yaml` (read by
every `/opsx:*` command) and `client-v2/CLAUDE.md` (loaded for any work in
`client-v2/`) tell the agent to read a step's events before changing its
code. `slice-structure.test.ts` catches a renamed or removed name.

### The funnel table is the step-to-name map, checked by the slice test

`slice-structure.test.ts` already parses every `createTracker<...>()` map
with the TypeScript AST. It gains a collector of every declared name in any
non-test source file under `src/`: the slices, and the legacy roots, which
hold trackers of their own (`utils/explorer/telemetry.ts`) and whose steps
the slice rule never checked. One test reads the table from
`openspec/specs/client-v2-funnels/spec.md`, or from this change's delta
while the main spec does not exist. It takes the backticked names of the
Events and Failure events columns and fails on each one no tracker
declares, unless the row's Source is `GA4` or starts with `pending (`. The
same names must also appear double-quoted in some non-test source file: a
map declares its keys bare, so a quoted name is where a `track` call sends
it, and a declared event nothing sends fails. A row whose cells are not five
fails loudly, since a stray pipe would shift Source and hide the row. A
second test fails on a step whose Failure events cell has no backticked
name and does not start with `none:`, so each step says how it fails or why
it cannot. The Code column is for agents and reviewers; the test does not
read it.

### Build and instruction-call events are sent from the shared code

The `build` command is what the Build stage, the terminal, the assistant and
a tutorial's build act all run, and `runCall` is the Interact stage's only
send, so the events go there, through trackers of two new slices,
`features/program-build` (`build`) and `features/program-interact`
(`interact`), the slices `wbdi-flow` names for these screens. Each holds only
its `model/telemetry.ts` for now; `wbdi-flow` grows them. The names and
parameters are `wbdi-flow`'s "Build telemetry" and "Interact telemetry", plus
`interact_succeeded`: a funnel needs the success as its own event, and
`interact_sent` minus the confirm failures is not one GA4 can chart.
`interact_failed`'s `validation` and `simulation` phases wait for the
Simulate task that adds them.

### The patch is counted after the write

`assistant_approval_answered` is the user's answer; whether the file was
written is the `write_file` tool's, after `bridge.applyPatch` resolves or
throws. Both new events join the `assistant` tracker, the slice that owns the
assistant's other events.

The rows this change adds start as `pending (funnel-events)`; each
implementing task replaces its row's mark with the slice.

### Typed failures carry the reason

`utils/github.ts` gains `GithubImportError` with a `reason`
(`not-found`, `rate-limited`, `too-large`, `no-source`), thrown where the
messages are built today with the same messages. A `TypeError` from `fetch`
is `network`; `PgFramework.isUnknownFramework` and the empty conversion are
`unsupported` (the latter through a named error in `utils/framework.ts`);
anything else is `other`. `features/project-files` exports one mapping from
an error to a reason, used by every call site.

### Import and export are tracked at the dialogs, not inside `PgGithub`

`PgGithub.import` is also the catalog's program import, which
`catalog_item_opened` already counts. Tracking at the dialogs, the route and
the settings page keeps one event per user action. There is no
`project_import_started`: every attempt ends in `project_imported` or
`project_import_failed` except a closed program choice, which is the user's
choice, and the file dialog has no single start (a drop reads the files,
Import creates the project).

### `run` outcomes come from the runtime

`PgJsRuntime.execute` resolves with whether the file failed: for a test, the
failure count `mocha.run`'s callback reports; for a client script, whether
the wrapper's `catch` or the iframe's `error` listener fired. A refusal
because another run is in progress throws a named error. There is no
`run_started` and no `via`: the handler cannot tell the terminal from the
explorer, and `run_finished` plus `run_errored` count every run.

### Every deploy is tracked in the `deploy` command, checks unmoved

`checkWallet` and `checkProgram` stay in `preChecks`, joined under one
pre-check that runs them in the same order. While `PgGlobal.deployState` is
`ready` (a new deploy, not a pause or resume press), that pre-check sends
`deploy_started` first and `deploy_failed {step: "checks"}` when a check
throws, then rethrows; a stale-build cancel inside `checkProgram` sends no
failure. A pause or resume press runs the checks as before and sends
nothing. `handle` sends `deploy_succeeded`, or `deploy_failed` with the step
reached (`funding` for a `DeployFundingError`).

`PgDeployRun` carries the run's caller beside its answers: `withAnswers`
records `stage`, `realBridge.deploy` wraps its call in `withVia("assistant")`,
and a run with no caller is `terminal`. The run's last step is cleared when
`deploy_started` is sent, so a terminal run does not report an earlier run's
step. `PgStageDeploy.start` drops its `deploy_*` run events, except for a
Playground wallet that does not connect: the command never runs then, so the
stage sends `deploy_started` and `deploy_failed {step: "checks"}` itself.

`step: "authority"` is recorded around the `setBufferAuthority`
transaction, apart from `PgDeployRun`'s step, so the stage's progress list
keeps its four rows.

`kind` is `upgrade` when `PgProgramInfo.onChain.deployed`, else `first`.
`cluster` is `PgConnection.cluster` when the endpoint is an `Endpoint` value
or a `NETWORKS` value, and `custom` otherwise or when the cluster is `null`.
Nothing is derived from a custom URL, its genesis cluster included, since
the URL may carry an API key. `deploy_sol_needed_shown` keeps its five
cluster values: the stage funds only on networks it knows.

Alternatives considered: `PgCommand.deploy.onDidStart` and `onDidFinish`
listeners, which fire for pause presses too and need an app effect to
register them; and moving the checks into `handle` (see "Open Questions").

### The deploy delta's scenarios are manual

`client-v2-deploy` is an existing capability, so its delta carries no
Purpose. Like the new specs, each of its scenarios here is held by a unit
test through the memory provider, which the tasks name.

## Risks / Trade-offs

- [`custom` hides the network of a typed RPC] → A custom mainnet RPC and a
  custom devnet RPC read the same. Accepted.
- [The stage sends two events itself for a wallet that does not connect] →
  The command never runs then, so nothing is counted twice.
- [The funnel test reads a change folder before archive] → It falls back to
  the delta only while the main spec is missing.
- [`wbdi-flow` specifies `deploy_* {cluster, kind}` with `phase`] → A
  follow-up aligns its "Deploy telemetry" requirement with these names
  (ticket to file). This change does not edit `wbdi-flow`.

## Open Questions

- Move `checkWallet` and `checkProgram` from `preChecks` into the `deploy`
  command's `handle`? Owned by the user, undecided. A pause or resume press
  would then skip the checks, which can start a build today. The events do
  not need the move.
- Share events: hoodieshq#276 brings a share dialog back on
  `scope/typescript`, so share events need their own change when that lands.
