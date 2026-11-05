# Tasks

## 1. Record DES-124 as shipped

- [x] 1.1 Delta specs for `client-v2-interact`, `cli-deploy` and `client-v2-deploy` describe the shipped DES-124 (#327, ticket: none, Slava's decision of 6 Nov inside SF#76). Verify: `yarn spec:validate` passes.

## 2. Count stage opens of the settings as their own

- [x] 2.1 `settings_opened` takes `from: "stage"` for the Deploy stage's Change and the stage notice's network action (`SettingsEntry` in `shared/lib/settings-request.ts`, `views/flow/Flow.tsx`), and `ui-migration`'s `client-v2-layout` delta lists the value. Ticket: none (SF#76). Depends on nothing. Verify: `client-v2-layout: Opening and closing the settings is counted` (e2e) presses the Deploy stage's Change and reads `settings_opened` with `from: stage`; the requirement lives in `ui-migration`'s delta, which this task edits.
