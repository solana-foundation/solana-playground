# Spec Delta

## Purpose

The steps a visitor takes from arriving to using a deployed program, the
product events that mark each step's success and its failure, and the code
that sends them, so a GA4 funnel can be built from the events and a change to
that code keeps them.

Every scenario is marked `(manual)`: it is held by a unit test, the funnel
check in `src/app/slice-structure.test.ts`, not by a Playwright test.

## ADDED Requirements

### Requirement: Each funnel step names its events and the code that sends them

Each step SHALL be marked by the events in its Events column when it goes
through and by the events in its Failure events column when it does not, sent
from the code its Code column names (paths under `client-v2/src`). Parameters
are in each slice's spec. A step that cannot fail, or whose failure is not the
product's, names `none: <why>` as its failure events. A Source of
`pending (<change>)` marks events that change has yet to send; `GA4` marks an
event GA4 sends itself. Every other name SHALL be declared by a tracker
somewhere under `src/`, a legacy root's included, and SHALL appear quoted in
source outside its declaration, where a `track` call names it.

| Step | Events | Failure events | Code | Source |
| --- | --- | --- | --- | --- |
| Arrive | `page_view` | none: GA4 counts a page that loaded | none: GA4 Enhanced Measurement (HOO-2409) | GA4 |
| Arrive on Home | `home_shown` | none: a view | `useStartView` in `widgets/home/model/start-view.ts` | widgets/home |
| Arrive on the catalog | `catalog_shown` | none: a view | `catalogPage` in `widgets/catalog/model/catalog-page.ts` | widgets/catalog |
| Get a project: new | `new_project_started` | `new_project_start_failed` | `StartFromScratch` in `features/new-project/ui/StartFromScratch.tsx` | features/new-project |
| Get a project: from the catalog | `catalog_item_opened` | `catalog_open_failed` | `useCardOpen` in `widgets/catalog/model/use-card-open.ts` | widgets/catalog |
| Get a project: import | `project_imported` | `project_import_failed` | `ImportGithub` and its `Example` in `views/sidebar/explorer/Component/Modals/ImportGithub.tsx`; `ImportFs` in `Modals/ImportFs.tsx`; `ImportTemporary` in `Modals/ImportTemporary.tsx` | features/project-files |
| Get a project: view a GitHub link | `project_viewed` | `project_view_failed` | `trackView` in `features/project-files/model/view.ts`, around `PgGithub.getFiles` in `github` (`/github/<owner>/<repo>…`, `routes/github/github.tsx`) | features/project-files |
| Sign in | `auth_signed_in` | `auth_sign_in_failed` | `PgSession._signIn` in `features/auth/model/session.ts` | features/auth |
| Build | `build_started`, `build_succeeded` | `build_failed` | `build` in `commands/build/build.ts` | features/program-build |
| Fund the wallet | `fund_sent`, `fund_airdropped` | `fund_failed` | `FundDialog` in `features/fund-wallet/ui/FundDialog.tsx`; `airdrop` in `commands/airdrop/airdrop.ts` | features/fund-wallet |
| Deploy | `deploy_started`, `deploy_succeeded` | `deploy_failed` | `deploy` (its `preChecks` and `handle`) in `commands/deploy/deploy.ts`; `PgStageDeploy.start` in `features/deploy/model/stage-deploy.ts` | features/deploy |
| Use: run tests or a client script | `run_finished` | `run_errored` | `processCommon` in `commands/run-and-test/run-and-test.ts`; `PgJsRuntime.execute` in `utils/js-runtime/js-runtime.ts` | features/run |
| Use: send an instruction | `interact_sent`, `interact_succeeded` | `interact_failed`, `interact_cancelled` (the user said no in the wallet) | `runCall` in `views/flow/stages/run-call.ts` | features/program-interact |
| Export the project | `project_exported` | `project_export_failed` | `ExportWorkspace` in `Modals/ExportWorkspace.tsx`; `ExportProject` in `widgets/settings-page/ui/ExportProject.tsx` | features/project-files |
| Follow a tutorial | `tutorial_started`, `tutorial_finished` | `tutorial_definition_rejected`, `tutorial_action_run` (its outcome other than ok) | `open`, `reducer` and `store` in `features/tutorial-conversation/model/`; `load` in `entities/tutorial/model/definition/load.ts`; markdown tutorials opened by `PgTutorial.open` are not counted (HOO-2751, 10 Nov 2026) | entities/tutorial |
| Ask the assistant | `assistant_turn_sent`, `assistant_turn_answered` | `assistant_turn_failed` | `useTurn` in `widgets/assistant/model/use-turn.ts` | widgets/assistant |
| Assistant: apply a change | `assistant_patch_written` | `assistant_patch_write_failed` | the `write_file` tool in `views/sidebar/assistant/model/tools.ts` | widgets/assistant |

#### Scenario: A listed event is renamed (manual)

- **WHEN** a change renames `deploy_succeeded` in `features/deploy` and leaves
  the table as it is
- **THEN** `src/app/slice-structure.test.ts` fails and names
  `deploy_succeeded`

#### Scenario: A failure event is removed (manual)

- **WHEN** a change removes `build_failed` from `features/program-build` and
  leaves the table as it is
- **THEN** `src/app/slice-structure.test.ts` fails and names `build_failed`

#### Scenario: A track call is removed (manual)

- **WHEN** a change deletes the `track("interact_succeeded", ...)` call in
  `runCall` and keeps the declaration
- **THEN** `src/app/slice-structure.test.ts` fails and names
  `interact_succeeded`

#### Scenario: A step lists no failure (manual)

- **WHEN** a row's Failure events cell is empty
- **THEN** `src/app/slice-structure.test.ts` fails and names the step

#### Scenario: A pending mark is removed too early (manual)

- **WHEN** the Export row's Source is changed to `features/project-files`
  while no tracker declares `project_exported`
- **THEN** `src/app/slice-structure.test.ts` fails and names
  `project_exported`

#### Scenario: An event declared in a legacy root counts (manual)

- **WHEN** a row names `explorer_limit_refused`, declared by the tracker in
  `utils/explorer/telemetry.ts`
- **THEN** `src/app/slice-structure.test.ts` finds it declared

#### Scenario: A GA4 event is listed (manual)

- **WHEN** the table lists `page_view` in a row whose Source is `GA4`
- **THEN** `src/app/slice-structure.test.ts` does not look for a tracker
  that declares `page_view`

### Requirement: A change to a funnel step's code keeps its events

A change that adds, moves, or alters code the Code column names SHALL keep
that step's events and failure events firing from it, or update the step's row
in the same change. A change that moves a step's code SHALL update the Code
column. A change that starts sending a pending row's events SHALL replace its
`pending (<change>)` mark with the owning slice. Code in a legacy root
(`commands/`, `views/`, `components/`, `routes/`, `utils/`) that a row names
SHALL send through the owning slice's tracker, without a scope.

#### Scenario: A deploy path is refactored (manual)

- **WHEN** a change moves the deploy run out of `commands/deploy/deploy.ts`
- **THEN** the same change sends `deploy_started`, `deploy_succeeded` and
  `deploy_failed` from the new location and names it in the Deploy row's Code
  column

#### Scenario: A pending step lands (manual)

- **WHEN** the change that declares and sends `run_finished` and
  `run_errored` lands
- **THEN** it replaces the run row's `pending (funnel-events)` with the owning
  slice, and `src/app/slice-structure.test.ts` passes
