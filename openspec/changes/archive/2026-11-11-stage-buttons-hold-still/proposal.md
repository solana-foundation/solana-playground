## Why

The Build and Interact stages' buttons, and the Deploy stage's content,
shift sideways while their action runs, which reads as a layout glitch
([HOO-2795](https://linear.app/solana-fndn/issue/HOO-2795)). Measured on
10 Nov: "Building…" is wider than "Build again", so the centred Build row
recentres by 5.6 px; Interact's left-aligned card row slides 54 px while Send
reads "Sending…"; and a scrollbar that appears mid-deploy moves the Deploy
stage 7.5 px left. #492 held the Build row still vertically; nothing keeps the
rule written down.

## What Changes

- The design system's AsyncButton, given a `loadingText`, keeps its idle
  label and its busy label (spinner and `loadingText`) in one grid cell, the
  one not shown `invisible` and `aria-hidden`. The button is as wide as the
  wider label at all times, so an idle button with a wider busy label is wider
  than before. It is reinstalled into `client-v2/src/shared/ui`.
- The Build stage's brand pill ("Build again" after the code changed, "Try
  again") keeps its label and "Building…" the same way.
- A stage's scroll frame reserves its scrollbar gutter on both edges
  (`scrollbar-gutter: stable both-edges`), so a scrollbar that appears does
  not move the centred stage.
- No telemetry events are added, renamed or removed; no funnel step's code
  changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `client-v2-stages`: a new requirement that the stages' buttons do not
  move sideways while their action runs.

## Impact

- `design-system/src/components/ui/async-button.tsx` and its installed copy
  `client-v2/src/shared/ui/async-button.tsx`; every AsyncButton with a
  `loadingText` is as wide idle as busy.
- `client-v2/src/views/flow/stages/BaseBuild.tsx` (the brand pill's label) and
  `stage-layout.ts` (`STAGE_FRAME`).
- Out of scope: the Deploy stage's vertical jump while it deploys
  (HOO-2796); the Deploy pill's own width, which changes between "Deploy to
  devnet" and "Deploying..." while it stays centred; an AsyncButton without a
  `loadingText`, which still adds its spinner beside its label.
