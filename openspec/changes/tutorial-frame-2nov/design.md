# Design

## Context

The design source is Almaz's prototype at `f7d42bf2e`
(`design-system/src/prototype/tutorial-v2`), read against `76f5db690` and
the audit `.claude/lead/design-gaps/2026-11-03-tutorial-prototype-head-audit.md`
(sections A, B, C, E). Reference shots: the artifact "Эталон туториала v2".

On `scope/tutorial-flow` the frame (`tutorial-flow-v2` 2.1, 2.2) already lays
out rail, chat and workspace, and the workspace head already opens the tree as
a popover with a pin to dock it (`BaseWorkspaceHead`, `BaseDockedTree`, as the
prototype's `WorkspaceTabs` and `DockedTree`). What still shows is legacy:

- `Flow.tsx` passes `stageTabs={<StageBar />}` and a `stage` whose content is
  `ObjectiveBand`, `StageRouter`, `Reader` and `LessonBar` for every project,
  tutorial or not;
- `BaseLayoutShell` holds the files column open in the frame ("until the feed
  carries the steps"), which mounts `LeftPanel` with its Steps and Files tabs.

## Goals / Non-Goals

Goals: the frame shows chat and editor only; the step head and divider match
`f7d42bf2e`; the feed's cards other than act and result read on the 31 Oct
scale and rhythm.

Non-goals: the phone (HOO-2359); retiring `ObjectiveBand`, `StepRail`,
`Reader`, `LessonBar` and their code (HOO-2365); act and result cards
(HOO-2355, HOO-2356, HOO-2357); the composer (HOO-2354).

## Decisions

### The frame drops the stage, not the components

In the frame, `Flow.tsx` renders the workspace with the editor alone
(`EditorWithTabs` through the Build stage's editor, which is what
`StageRouter` shows on the Write and Build stages) and passes no stage tabs.
`StageBar` and `StageRouter` stay for ordinary projects. `ObjectiveBand`,
`Reader` and `LessonBar` stay in place for HOO-2365 to delete; in the frame
they are not rendered, since none of them belongs there. HOO-2365 edits the
same lines; whichever lands second rebases.

Alternative: switch the stage to Build while a tutorial is open. Rejected: the
Deploy stage would still be one click on a stage tab away, and the stage store
is shared with the ordinary project.

### The shell stops holding the files column in the frame

`BaseLayoutShell` folds the files column in the frame instead of holding it
open, and the frame's `files` slot is not mounted. The `pinned` flag passed to
`files` becomes unused and goes. Ctrl+E in the frame is already the
workspace's (the tree), so the shell's own Ctrl+E files toggle is skipped
there, as Ctrl+R and the console keys already are.

### The tree keeps its dock

The ticket's text said the popover replaces `BaseDockedTree`; the prototype at
`f7d42bf2e` keeps `DockedTree` behind the popover's pin (on a workspace of
1100 px or more). The prototype wins: the dock stays as built.

### One step head, no compact split

`BaseStepBar` becomes the prototype's `StepBar`: a `DropdownMenu` trigger
(14/18, `px-5 pt-3 pb-1`), and under it a grid of segment buttons. The
`narrow` prop and the `useNarrow` measure in `BaseFeed` go. The design
system's `stepper` (a Tabs switch with one selection) and `step-rail` (the
v1 vertical rail) fit neither the trigger nor the jump segments, so the bar
stays a Base component built from `DropdownMenu` and buttons. The hairline's
`barProgress` (a share of beats) goes with it: segments light whole as a step
is entered (`litCount` in the prototype). The sweep animation of newly lit
segments is kept, behind `motion-reduce`.

### One module for the scale

`widgets/tutorial-conversation/ui/Prose.tsx`, where `READ` already lived and
which the act and result cards already import, holds the prototype's class
strings: `READ`, `HEADING`, `TITLE`, `LISTING`, `HEADLINE` and `CHIP`, plus
`noStop`. `Prose` takes `chip` (`normal`, `large`, `small`) for the chip's
size, as the prototype's `small` and `large` do. The act and result cards may
adopt the constants in their own tickets.

### Headlines without periods

The prototype dropped the closing period from step objectives and win lines.
Hello Anchor's `tutorial.json` loses its trailing periods there; the other
tutorials follow in their own tickets.

### A question leaves an open popover alone

With the files column gone, the tree is a popover, and it closes when the
focus leaves it. A question that arrives while it is open (a slow load, or a
learner opening the tree as step 1 posts) took the focus as it mounted and shut
the tree. The card now takes the focus on arrival unless the focus is in an
open dialog, menu or popover that does not hold the card, as it already left
the composer's field alone. Its keys wait until the learner closes the tree or
moves to the card, the same as after any dialog. This narrows
`tutorial-flow-v2`'s "takes focus on arrival" by one case.

## Risks / Trade-offs

- Parallel PRs edit the same cards (#263 build act, #255 client run, the
  deploy cards) and `Flow.tsx` (HOO-2365): conflicts are expected and are
  resolved by rebasing over whichever lands first.
- The capabilities `tutorial-conversation` and `tutorial-workspace` exist only
  as `tutorial-flow-v2` deltas, so this change's MODIFIED requirements archive
  only after `tutorial-flow-v2` does.
- e2e specs that read the old bar's segment labels or the stage tabs inside a
  tutorial change with it.
