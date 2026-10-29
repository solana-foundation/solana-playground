# Design

## Context

The measured gaps, row by row, are in the re-measure
`.claude/lead/hoo-2237-e2-lesson-2026-10-23.md` (main checkout, not
committed); each value below is quoted from it. The prototype's sources are on
`origin/prototype/redesign` under `prototype/redesign/src/views/flow/lessons/`
(`ObjectiveBand.tsx` with its `LessonBar`, `StepRail.tsx`, `Reader.tsx`),
`flow/left/LeftPanel.tsx` and `sidebar/assistant/Component/Chat.tsx`. Where
the designers' specs disagree with the prototype, the prototype wins (Slava,
2026-10-23); the four disagreements are listed in the re-measure and left to
the designers.

ui-migration's "Lessons (5.19)" stays the record of the lesson's structure
(`Base*` pairs, the ledger, the reader as a non-modal `Dialog` inside the
stage). This change overrides only its look and the parts named in the
proposal.

## Goals / Non-Goals

**Goals:**

- Every open row of R56–R62 matches the prototype side by side at 1440, 834
  and 393.
- The design system's parts carry the look; the app passes no class that
  restyles them.

**Non-Goals:**

- No change to the lesson's logic: the ledger, legal moves, hints, verify.
- No new flow from Almaz's stand.
- The gallery and the tutorial page (HOO-2254).

## Decisions

### Band

- `objective-band` in `design-system/` gets the prototype's row: `px-3.5`,
  `ObjectiveText` at `font-medium`, `ObjectiveNav` buttons `rounded-full`,
  and a new `ObjectiveCheck` part (22 px round toggle, 14 px check-circle at
  stroke 1.4, muted, success green while open) with `ObjectiveCondition`, the
  12/1.5 line under the row. `ObjectiveActions` keeps `ml-auto` and gap 4 px
  (`gap-1`) and loses `max-md:hidden`, since the phone no longer renders it.
- `BaseObjectiveBand` lays the row out as the prototype's `Row`/`Main`:
  `flex-wrap`, `Main` at `flex: 1 1 14rem` (the prototype has 18rem, which wraps at 834), actions at the end. This gives one
  row at 834 as at 1440 (Slava, 2026-10-26) and wraps the actions as one group
  only in a column too narrow for both.
- The count reads `Step 1 of 4` in sentence case (`tabular-nums`, no
  `uppercase`).
- "Read the page" is a quiet pill: the DS `Button` ghost, size `sm`, with the
  prototype's 26 px / 13 px / 400 / muted / full radius. If the DS button has
  no such size, a `quiet` variant is added to `button` in `design-system/`
  rather than a class in the app. "I'm stuck" stays `BrandButton` `sm`; its
  text goes from 12/400 to 13/500 in the DS only if the prototype's other
  small brand actions (the stages' Build, Deploy, Run) are 13/500 too,
  otherwise as a `BrandButton` size of its own, so stream C's stages do not
  move.
- The proving action, the readiness `Callout`, `readiness.ts` and
  `readiness-remedy.ts` go. On a read step the primary action is "Continue"
  (`PgLesson.attest()`), as the prototype's `continueRead`; elsewhere it is
  the assistant's rung label. The stage bar's stepper keeps its target dot.

### Page

- `Flow.tsx` stops calling `entryReading`; `reading.ts` drops it and its
  tests. `readLabel` returns "Read the page" only; the unread dot goes.
- `BaseReader`'s head is the objective alone (Stack Sans Text 14/500, padding
  12 16, a hairline under it), the close is 28 px round with lucide X, and the
  footer goes. Esc and "Close the page" return focus to "Read the page" as
  before.
- `Markdown`'s h1 and h2 use weight 500, as the prototype's copy of the
  component does everywhere it renders.

### Rail and Skip

- `step-rail` in `design-system/`: `StepRailTitle` wraps (no `truncate`),
  `StepRailMeta` is `text-muted-foreground`, the row grid is 16 px + gap 10
  with padding 6 8 and no row gap, and the skipped mark is the prototype's
  arrow (`M2.5 6h7…`, 12 px, stroke 1.6), drawn inline since lucide has none.
- Status copy in `StepRail.tsx`: "aiming at build" / "aiming at deploy",
  "locked", "skipped — not verified".
- "Skip this step" in `LeftPanel.tsx` becomes the prototype's `SkipFooter`: a
  full-width 28 px row with a top hairline, 13/400 muted, underlined from the
  phone width up, plain in the phone's sheet (52 px, 16/320).
- The Steps | Files switch's pill shape belongs to the segmented control
  (batch 1 §5, stream A) and is not changed here.

### Assistant

- `Thread.tsx` picks the suggestions by whether a lesson is open; `BaseThread`
  lays them out as a wrapped row (`flex-wrap`, gap 6) everywhere, as the
  prototype does.
- `AssistantComposer`'s chips are ordered step, active file, file count, and
  read "Step 1 of 4", "lib.rs", "1 file" (no lower-case "step", no
  "active").
- `assistant_suggestion_picked` fires as before; it carries no parameter, so
  the new labels change nothing in it.

### Navigation

- `BaseProjectList` drops the Lessons group: a started lesson is a row in
  Projects, with the folder glyph and no "n of m". Its menu keeps the lesson
  rules (no Rename, no Duplicate).

### Phone

- Below `LAYOUT_BREAKPOINTS.phone`, `BaseObjectiveBand` renders the
  prototype's `Fold`: one button, 52 px (`aria-expanded`), "n/m" 13/380 over
  a 28 px meter, the objective 15/440 on one line, a 20 px caret; open, the
  objective wraps and the condition follows at 15/320.
- A new `BaseLessonBar` (with its connected `LessonBar`) renders the
  prototype's foot bar under the editor: 60 px, a top hairline, frosted; ‹ ›
  at 48×48 with 20 px icons, then "Read the page" and the primary action at
  48 px high, 15/440. "Show the steps" goes from the band.
- The files row opens the Files sheet on Files (Spec 11 l.161 agrees); the
  sheet's tab memory (`kept-column.ts`) is still honoured inside the sheet.
- The sheet's mono text: `LayoutShell` set every Sheet's content in the
  code face (`sheetFont`), and the design system's buttons inherit their
  font, so "Skip this step" and the close rendered in JetBrains Mono. The
  shell's Sheets now take the text face (`theme.font.other.family`), as the
  wide column has it; the size stays the one the legacy file tree is laid
  out at. `body` keeps its font: nothing else portals outside a `data-slot`
  in the lesson.

### Specs

`client-v2-lessons`, `client-v2-layout` and `client-v2-assistant` exist only
as ui-migration's deltas (nothing in `openspec/specs/`), so no MODIFIED delta
can target them. This change adds its requirements to `client-v2-lessons`,
and edits in place the three ui-migration requirements it contradicts: "The
band folds to one row on a phone" (the actions move to the foot bar), "The
navigation lists the projects" (no Lessons group) and the "Lessons (5.19)"
paragraph of ui-migration's design.md (one row, no proving action, no
readiness line, no opening on entry, no reader footer). Nothing else in
ui-migration is touched.

### PRs

Stacked, each reviewable alone, all with HOO-2262 in the title:

1. Band and page, wide and phone: the band, the check toggle, the page, the
   landing, the phone's fold and foot bar, the font leak.
2. Rail, Skip and the navigation row.
3. The assistant's suggestions and chips.

## Risks / Trade-offs

- Dropping the readiness line removes a working hint about the wallet and
  the build. The stepper's dot remains, and the deploy command still says
  what is missing when pressed. Slava chose this on 2026-10-26.
- No page on entry means a learner may start without reading. The prototype
  and Spec 01 l.72 both land on the code.
- e2e specs that read the second row, the proving action, the readiness
  callout, the page on entry or the Lessons group fail until updated; each
  PR updates the specs its change breaks.
- A DS change to `objective-band` or `step-rail` reaches every user of them;
  today the lesson is the only one (checked with grep on 8ef138dae).
