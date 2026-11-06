# Proposal

## Why

Almaz's DES-124 (#327) shipped the Deploy stage's facts card and the users-work empty states into `scope/users-work`, and they land with SF#76. Four places now draw something the main specs describe differently, and two new states have no requirement at all. Slava decided (6 Nov) to keep Almaz's version as shipped and record it in the specs, so the specs describe the code again.

## What Changes

- Call history's empty column on a wide Interact stage: the title "No calls yet" and the line "Calls you make here show with their result.", in place of "Calls you send show up here.".
- "Deploy with the CLI" on the Deploy stage: an outline in the row of outlines with Upload IDL, following the deploy pill on a desk; on a phone the row stays in the page above the pinned foot, so it is not beside the deploy action there.
- History links on a phone read "Explorer"; the row already names its network, and the link's accessible name still says "Explorer (Devnet)". On a desk the text stays "Explorer (Devnet)".
- New requirement: before the first deploy on the network picked, the stage shows the deploy's facts in one card (Spec 08's EMPTY-03): Network with Change, the IDL in use, who pays, and the program id last.
- New requirement: when the network picked has no deploy but another network does (EMPTY-14), the title reads "Nothing on {network}" and the line offers "Show {network}", off while a deploy runs.
- Telemetry: `settings_opened` gains `from: "stage"`. The Deploy stage's Change and the stage notice's network action open the settings and were counted as `cluster`, the status row's indicator, so stage opens read as footer opens. The values are listed in `ui-migration`'s `client-v2-layout` delta ("The settings page is measured"), which this PR updates; no event is added or removed. No funnel step's events change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `client-v2-interact`: the wide stage's empty Call history column.
- `cli-deploy`: where the Deploy stage puts "Deploy with the CLI".
- `client-v2-deploy`: the phone's history link text; the facts card before a first deploy; the deployed-elsewhere state.

## Impact

- Code: `views/flow/stages/BaseDeploy.tsx`, `BaseCallHistory.tsx` already draw this; the only code change is the `settings_opened` value (`shared/lib/settings-request.ts`, `views/flow/Flow.tsx`) and its test.
- Out of scope: any visual change to DES-124; the Interact card requirements in `client-v2-stages` that disagree with the branch's chips (queued separately, Intake `2026-11-06-session-sf76-sx-review-not-fixed-in-landing`); the deploy-history write failures the review found.
