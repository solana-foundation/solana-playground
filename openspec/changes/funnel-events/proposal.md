# Proposal

## Why

HOO-2411 asks for one GA4 funnel from arrival to a used program: arrive, get
a project, build, deploy, use it. Several steps send nothing. Import, export,
and running tests or a client script live in the legacy roots (`views/`,
`commands/`, `routes/`), which no slice covers, and a deploy started from
the terminal or the assistant is not counted, because only the Deploy stage
tracks `deploy_*`. Nothing ties a funnel step to its events or its code, so
a refactor or a rename can stop a step's events without failing a check.
Greptile does not review `scope/*` PRs, so the agents that implement and
later change this code are what keeps the events: the specs name each call
site, and the project's rules send agents to them.

## What Changes

- A funnel table in a new capability names, for each step, its events and
  the code that sends them. Steps whose events another change owns, or this
  change has yet to send, are marked `pending (<change>)`. A change to a
  step's code keeps its events or updates the table.
  `src/app/slice-structure.test.ts` fails on a listed name no tracker
  declares that is not pending.
- New slice `features/project-files`, prefix `project`. Events added:
  `project_imported {source}`, `project_import_failed {source, reason}`,
  `project_viewed`, `project_view_failed {reason}`, `project_exported {from,
  converted}`, `project_export_failed {from}`.
- New slice `features/run`, prefix `run`. Events added:
  `run_finished {kind, outcome}` and `run_errored {kind, reason}`.
- `features/deploy` counts every deploy from the `deploy` command that the
  Deploy stage, the terminal, and the assistant share. Events changed:
  - `deploy_started` and `deploy_succeeded` take `{cluster, kind, via}`;
    `kind` (`first`, `upgrade`) replaces the `redeploy` boolean.
  - `deploy_failed` takes `{cluster, kind, via, step}`; `step` gains
    `authority`.
  - `cluster` gains `custom`.

  None of these events has reached `master` or production, so no recorded
  data changes meaning. `deploy_sol_needed_shown` and `deploy_backup_*` do
  not change.
- No event is renamed or removed in any other slice.
- `openspec/config.yaml` and `client-v2/CLAUDE.md` extend the telemetry rule
  to the legacy roots and point agents at the funnel table.

## Capabilities

### New Capabilities

- `client-v2-funnels`: the funnel steps, the events that mark each step,
  and the code that sends them.
- `client-v2-project-files`: the events sent when a project is imported,
  viewed from a GitHub link, or exported.
- `client-v2-run`: the events sent when tests or a client script run.

### Modified Capabilities

- `client-v2-wallet-funding`: "A faucet airdrop is counted" adds `fund_airdropped {via, cluster}` from the `airdrop` command, so the funnel's "Fund the wallet" step counts airdrops as well as transfers (HOO-2751).
- `client-v2-deploy`: "Deploy events" counts every deploy, whatever started
  it, and its parameters follow the merged design.

## Impact

- This change carries the specs and the rules into `scope/users-work-2`;
  the team implements `tasks.md` there.
- Code the tasks touch: `src/features/project-files/` and `src/features/run/`
  (new), `src/features/deploy/model/telemetry.ts` and `stage-deploy.ts`,
  `src/commands/deploy/deploy.ts` and `run.ts`,
  `src/commands/run-and-test/run-and-test.ts`, `src/utils/js-runtime/`,
  `src/utils/github.ts`, `src/utils/framework.ts`, the explorer's import,
  export and temporary-import dialogs, `src/routes/github/github.tsx`,
  `src/widgets/settings-page/ui/SettingsPage.tsx`,
  `src/views/sidebar/assistant/bridge/playground-bridge.ts`,
  `src/shared/lib/telemetry/prefixes.ts`, and
  `src/app/slice-structure.test.ts`.
- Rules:
  - `openspec/config.yaml`: `context` says the legacy roots are measured
    too; `rules.proposal` asks a change to a funnel step's code to list the
    funnel events it keeps, adds, or changes; `operations.apply.guidance`
    asks an agent to read a step's events before changing its code and to
    keep them firing.
  - `client-v2/CLAUDE.md`: a paragraph after the slice telemetry rule points
    at the funnel table and extends the rule to the legacy roots.
- Users see no change. The events reach GA4 only where
  `REACT_APP_GA_MEASUREMENT_ID` is set; the deploy, run and import paths
  behave as before, pause and resume included.
- Page views come from GA4's Enhanced Measurement ("page changes based on
  browser history events"), switched on in GA4 admin (HOO-2409), with no
  code.
- Out of scope:
  - Build, IDL, and Interact events: `wbdi-flow` owns them. Its "Deploy
    telemetry" requirement is aligned with these names in a follow-up (ticket
    to file); this change does not edit `wbdi-flow`.
  - Tutorial events (`tutorial-flow-v2` on `scope/tutorial-flow-2`) and
    assistant turn events (`assistant-usage-events`, #62).
  - Sharing, which is also left out of the funnel table. The share route
    never matches (`routes/share/share.tsx`) and nothing opens the Share
    dialog, so no share event can fire.
  - The catalog's program import, which `catalog_item_opened` and
    `catalog_open_failed` already report.
  - The Build stage's export, which `wbdi-flow` names `build_project_exported`.
  - Import from a zip archive: the product has none; a zip is only an export.
  - `greptile.json`.
