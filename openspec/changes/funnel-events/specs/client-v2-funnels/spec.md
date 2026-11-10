# Spec Delta

## Purpose

The steps a visitor takes from arriving to using a deployed program, the
product events that mark each step, and the code that sends them, so a GA4
funnel can be built from the events and a change to that code keeps them.

Every scenario is marked `(manual)`: it is held by a unit test, the funnel
check in `src/app/slice-structure.test.ts`, not by a Playwright test.

## ADDED Requirements

### Requirement: Each funnel step names its events and the code that sends them

Each step SHALL be marked by the events in its Events column, sent from the
code its Code column names (paths under `client-v2/src`). Parameters are in
each slice's spec. A Source of `pending (<change>)` marks events that change
has yet to send; `GA4` marks an event GA4 sends itself. Every other name
SHALL be declared by a tracker under `features/`, `widgets/` or `entities/`.

| Step | Events | Code | Source |
| --- | --- | --- | --- |
| Arrive | `page_view` | none: GA4 Enhanced Measurement (HOO-2409) | GA4 |
| Arrive on Home | `home_shown` | `useStartView` in `widgets/home/model/start-view.ts` | widgets/home |
| Arrive on the catalog | `catalog_shown` | `catalogPage` in `widgets/catalog/model/catalog-page.ts` | widgets/catalog |
| Get a project: new | `new_project_started` | `StartFromScratch` in `features/new-project/ui/StartFromScratch.tsx` | features/new-project |
| Get a project: from the catalog | `catalog_item_opened` | `useCardOpen` in `widgets/catalog/model/use-card-open.ts` | widgets/catalog |
| Get a project: import | `project_imported` | `ImportGithub` and its `Example` in `views/sidebar/explorer/Component/Modals/ImportGithub.tsx`; `ImportFs` in `Modals/ImportFs.tsx`; `ImportTemporary` in `Modals/ImportTemporary.tsx` | features/project-files |
| Get a project: view a GitHub link | `project_viewed` | `github` (`/github/<owner>/<repo>…`) in `routes/github/github.tsx` | pending (funnel-events) |
| Sign in | `auth_signed_in` | `PgSession._signIn` in `features/auth/model/session.ts` | features/auth |
| Build | `build_started`, `build_succeeded` | `build` in `commands/build/build.ts` | pending (wbdi-flow) |
| Fund the wallet | `fund_sent`, `fund_airdropped` | `FundDialog` in `features/fund-wallet/ui/FundDialog.tsx`; `airdrop` in `commands/airdrop/airdrop.ts` | features/fund-wallet |
| Deploy | `deploy_started`, `deploy_succeeded` | `deploy` (its `preChecks` and `handle`) in `commands/deploy/deploy.ts`; `PgStageDeploy.start` in `features/deploy/model/stage-deploy.ts` | features/deploy |
| Use: run tests or a client script | `run_finished` | `processCommon` in `commands/run-and-test/run-and-test.ts`; `PgJsRuntime.execute` in `utils/js-runtime/js-runtime.ts` | features/run |
| Use: send an instruction | `interact_sent` | `runCall` in `views/flow/stages/run-call.ts` | pending (wbdi-flow) |
| Export the project | `project_exported` | `ExportWorkspace` in `Modals/ExportWorkspace.tsx`; `Project` in `widgets/settings-page/ui/SettingsPage.tsx` | pending (funnel-events) |
| Follow a tutorial | `tutorial_started`, `tutorial_finished` | `PgTutorial` in `utils/tutorial/tutorial.ts`; markdown tutorials opened by `PgTutorial.open` are not counted (HOO-2751, 10 Nov 2026) | pending (tutorial-flow-v2) |
| Ask the assistant | `assistant_turn_sent`, `assistant_turn_answered` | `useTurn` in `widgets/assistant/model/use-turn.ts` | pending (assistant-usage-events) |

#### Scenario: A listed event is renamed (manual)

- **WHEN** a change renames `deploy_succeeded` in `features/deploy` and leaves
  the table as it is
- **THEN** `src/app/slice-structure.test.ts` fails and names
  `deploy_succeeded`

#### Scenario: A pending mark is removed too early (manual)

- **WHEN** the Build row's Source is changed to `features/build` while no
  tracker declares `build_started`
- **THEN** `src/app/slice-structure.test.ts` fails and names `build_started`

#### Scenario: A GA4 event is listed (manual)

- **WHEN** the table lists `page_view` in a row whose Source is `GA4`
- **THEN** `src/app/slice-structure.test.ts` does not look for a tracker
  that declares `page_view`

### Requirement: A change to a funnel step's code keeps its events

A change that adds, moves, or alters code the Code column names SHALL keep
that step's events firing from it, or update the step's row in the same
change. A change that moves a step's code SHALL update the Code column. A
change that starts sending a pending row's events SHALL replace its
`pending (<change>)` mark with the owning slice. Code in a legacy root
(`commands/`, `views/`, `components/`, `routes/`, `utils/`) that a row names
SHALL send through the owning slice's tracker, without a scope.

#### Scenario: A deploy path is refactored (manual)

- **WHEN** a change moves the deploy run out of `commands/deploy/deploy.ts`
- **THEN** the same change sends `deploy_started` and `deploy_succeeded`
  from the new location and names it in the Deploy row's Code column

#### Scenario: A pending step lands (manual)

- **WHEN** the change that declares and sends `build_started` and
  `build_succeeded` lands
- **THEN** it replaces the Build row's `pending (wbdi-flow)` with the owning
  slice, and `src/app/slice-structure.test.ts` passes
