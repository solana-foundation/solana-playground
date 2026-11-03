# Proposal

## Why

Home treats every visitor the same: "Where should we begin?" and three tiles, and nothing runs until a choice is made. Spec 06 (designers, first run) wants a first visitor one press from a running example and a returning one one press from their last work, and a slow first build that does not read as broken. The Design alignment audit of 28 Oct (item A3) found none of it shipped; Linear: HOO-2391, stage 1, before Breakpoint.

## What Changes

- Desktop Home on a first visit (no project in the browser) shows "Try an example" above the tiles, with the example's one line and "Run it".
- "Run it" creates the example project from the Anchor starter, opens it and starts its build once. Pressed while the example exists, it opens that project and builds nothing.
- Desktop Home on a return visit (any project in the browser) shows "Pick up where you left off" above the tiles, up to three projects and started tutorials, the open one first, then the latest added.
- Phone Home on a first visit puts the example first among its quick starts; a return visit keeps "Continue {project}" first.
- The Build stage, while a first build runs, shows the seconds so far, and after 60 s the line "First builds take longer. This one is running."
- Telemetry, `home` slice: adds `home_example_run` (`outcome`: created, opened, current) and `home_recent_opened`; `home_quickstart_opened` gains the id `example`. No event is renamed or removed.

## Capabilities

### New Capabilities

- `client-v2-first-run`: what Home offers a first and a returning visitor, the example's one automatic build, and the slow first-build line.

### Modified Capabilities

None.

## Impact

- Code: `client-v2/src/widgets/home` (Home, PhoneHome, their Base parts, telemetry, a model module for the example and the recent list), `client-v2/src/views/flow/stages` (Build, BaseBuild).
- The build server is called once more per example created, never on a load.
- Out of scope: the landing button's route (Decision 4, open), the status indicators and the setup list (HOO-2323), the Home composer sending its text, a stored "first run done" flag, timestamps for recency.
