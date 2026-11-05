# Proposal

## Why

Slava, 3 Nov 20:00: every tutorial task targets Almaz's prototype at its head,
`almaz/mobile-tutorial-prototype` at `f7d42bf2e` (2 Nov), not `fb4b8e9ee`
(28 Oct), which `tutorial-flow-v2` pins. Three prototype commits (31 Oct
"Practicum-style type and rhythm", 31 Oct "last QA details", 2 Nov) reached
no branch. Meanwhile a tutorial on `scope/tutorial-flow` still renders the new
feed inside the old frame: the stage tabs, the Build/Deploy stage area on the
right and the Steps/Files column all still show. HOO-2548 brings the frame and
the feed's type to the head.

## What Changes

- **The frame loses the old stage chrome.** In a tutorial's frame the
  workspace shows the editor only: no Write/Build/Deploy stage tabs
  (`StageBar`), no stage area (`StageRouter`'s Deploy stage, "Nothing
  deployed"). Build, deploy, run and call stay cards in the chat.
- **No Steps/Files column in the frame.** The column the frame held open
  until the feed carried the steps goes. The file tree opens only from the
  workspace head (the open tab's arrow, the Files tool, ⌘E), and its pin still
  docks it beside the editor, as the prototype's `DockedTree` does.
- **The step head is one trigger over four segments.** "Step n of N · <short
  label> ⌄" (14/18) opens the step menu; under it one 4 px rounded segment per
  step on a 12% track, lit with the brand gradient as the step is entered. The
  per-segment labels, the full/compact split at 24rem and the 2 px hairline
  go. Segments stay buttons that jump to a reached step.
- **The step divider is the step's heading.** 24/28 at 500, the step's
  objective alone; no "Step n of m" kicker, no check, no time.
- **The 31 Oct type scale in the feed.** Text 16/24 at 320 (was 15/1.6), card
  heads 20/24 at 500, the quiz question 18/26, quiz options in the 14/24
  listing face, inline code on the ringed chip in whole pixels, win and finish
  headlines 28/32 at 500, the feed's top at 22 px and 15 px between paragraphs
  of one reply. The act and result cards are left to the tickets building
  them (HOO-2355, HOO-2356, HOO-2357), which already follow the head.
- **Small things from the same commits.** The shortcuts dialog groups its
  keys under "In the lesson", "Panels" and "Steps"; with reduced motion a new
  turn fades in instead of appearing whole; a wrote card ends on "⋯ N more
  lines" and heads with the file name alone, no line range; headlines carry
  no closing period.
- **`tutorial-flow-v2` re-pinned.** Its proposal and design name `f7d42bf2e`
  as the design source, with a line that the 31 Oct type scale and step head
  supersede `fb4b8e9ee`'s.
- **Telemetry: none added, renamed or removed.** `tutorial_step_jumped` keeps
  `via: "bar"` for a segment and `"menu"` for the trigger's menu.

## Capabilities

### New Capabilities

- `tutorial-reading-scale`: the type scale and rhythm of a tutorial's chat
  feed (text, headings, code chips, listings, gaps, the reduced-motion fade).

### Modified Capabilities

- `tutorial-conversation`: the step bar becomes one trigger over unlabelled
  segments, and the divider becomes the step's heading alone.
- `tutorial-workspace`: the frame shows no stage tabs, stage area or
  Steps/Files column; the shortcuts list is grouped.

## Impact

- Code: `views/flow/Flow.tsx` (the frame's stage and its `files` slot),
  `widgets/layout-shell` (no files column held open in the frame),
  `widgets/tutorial-conversation` (`BaseStepBar`, `BaseStepDivider`,
  `BaseFeed`, `Prose`, `BaseSay`, `BaseWroteCard`, `BaseQuestionCard`,
  `BaseIntroCard`, `BaseWinCard`, `BaseFinishCard`, `BaseYouPill`, the
  scale's constants in `ui/Prose.tsx`), `widgets/tutorial-frame` (`ShortcutsDialog`), the Hello
  Anchor definition's headlines.
- Tests: the step bar's and divider's component tests, the shell's tests for
  the frame, the tutorial e2e specs that read the old bar.
- Out of scope: the phone (HOO-2359: the frame shows on a wide window only);
  `ObjectiveBand`, `StepRail`, `Reader` and the phone `LessonBar`, which
  HOO-2365 retires; the act and result cards' type (HOO-2355, HOO-2356,
  HOO-2357); the chat field's 44 px (HOO-2354); the tutorials list cards
  (HOO-2549); lesson copy in Lumberjack and Zero Copy (HOO-2362, HOO-2363).
- Outside a tutorial nothing changes: the stage tabs, stage area and files
  column stay for an ordinary project.
