# Proposal

## Why

The lesson inside a tutorial still looks like the first cut of ui-migration
5.19, not like Nikita's original design-system prototype, which polish stage
two takes as the target (HOO-2237). The re-measure of audit rows R56–R62
(HOO-2236 v3) found all seven still open on `new-face-polish-2` at 8ef138dae.
Almaz's tutorial flow is not approved, so the lesson is polished only: no new
flow (Slava, 2026-10-23).

## What Changes

- **Landing (R56).** Entering a lesson shows the code with the page closed;
  the once-on-entry opening of the page is dropped. The band's label is always
  "Read the page" (no "Read step n first" and no unread dot).
- **The page (R56).** Its head is the objective alone, its close is a round
  28 px button, and it has no footer. A read step continues from the band's
  primary "Continue".
- **Objective band, wide (R57).** One row, 40 px: "Step 1 of 4" in sentence
  case, the meter, the objective at weight 500, a check toggle that shows how
  the step is checked on a line under the row, then ‹ ›, "Read the page" and
  "I'm stuck" at the row's end. The actions wrap under the objective as one
  group only when they do not fit, at 834 as at 1440 (Slava, 2026-10-26).
- **BREAKING (look).** "Build to prove this" / "Deploy to prove this" and the
  readiness callout under the band are removed (Slava, 2026-10-26). The
  stepper's target dot already points at the stage that proves the step.
- **Step rail and Skip (R58, R62).** Titles wrap; statuses read "aiming at
  build", "locked" and "skipped — not verified" in the secondary text colour;
  the skipped mark is an arrow; "Skip this step" is a full-width footer,
  underlined on a wide screen and plain on a phone.
- **Assistant in a lesson (R59).** The empty thread offers "Explain this
  step", "Give me a hint" and "Why did my build fail?", laid out as a
  wrapped row; outside a lesson it keeps the project's three. The context
  chips read Step · file · files.
- **Navigation (R60).** A started lesson is a row under Projects with a
  folder glyph; the separate Lessons group and its "n of m" count go.
- **Phone (R61).** The band folds to one 52 px row that opens in place to show
  the whole objective and how it is checked; the actions move to a 60 px bar
  at the foot of the code with 48 px targets; the Files sheet opens on Files
  from the files row and on Steps from nowhere else; the sheet's text is in
  the product font, not JetBrains Mono.
- Telemetry: no event is added, renamed or removed. `assistant_suggestion_picked`
  fires for the lesson suggestions as it does for the project's.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `client-v2-lessons` (added by ui-migration, not yet archived): the band is
  one row, its page is never opened on entry and has no footer, the proving
  action and the readiness callout are gone, and on a phone the actions sit
  in a bar at the foot.
- `client-v2-layout` (added by ui-migration): lessons are listed under
  Projects instead of a Lessons group.
- `client-v2-assistant` (added by ui-migration): the empty thread's
  suggestions depend on whether a lesson is open.

Both capabilities live only in ui-migration's deltas, so this change adds its
requirements to `client-v2-lessons` and edits the three ui-migration
requirements it contradicts in place (see design.md, "Specs").

## Impact

- Code: `client-v2/src/views/flow/lessons/` (band, reader, rail, copy),
  `views/flow/Flow.tsx` (entry), `views/flow/left/LeftPanel.tsx` (Skip),
  the phone's files sheet, `widgets/assistant/ui/` (suggestions, chips),
  `widgets/app-nav/ui/BaseProjectList.tsx` (lesson rows).
- Design system: `objective-band` (one row, round nav, `px-3.5`,
  `font-medium`, check toggle), `step-rail` (wrapping titles, status colour,
  skipped mark, row grid), `brand-button` sm text, and `font-sans` on
  `body`. Each lands in `design-system/` and reaches client-v2 by
  `yarn ds-add`.
- Tests: unit tests of the band, rail, reader and thread; the e2e specs that
  read the band's two rows, "Build to prove this", the readiness callout,
  the page opening on entry or the Lessons group.
- Out of scope: the tutorials gallery and the tutorial page (stream E1,
  HOO-2254); the lesson logic (ledger, verify, hints) stays as it is; the
  lesson row's tutorial glyph (Spec 11 l.81) and the other designer
  conflicts recorded in the re-measure are left to the designers; the
  assistant head's brand icon and the phone header (batch 1, phone shell)
  are not lesson rows.
- Removed with the callout: `readiness.ts` and `readiness-remedy.ts`, whose
  only reader is the band.
