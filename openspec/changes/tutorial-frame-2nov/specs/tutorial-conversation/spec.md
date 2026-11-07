## MODIFIED Requirements

### Requirement: Each step opens with a divider and the step bar jumps to it

Each step SHALL open with a divider in the feed: the step's objective as its
heading, and nothing beside it, before or after the step passes (no "Step n
of m" kicker, no check, no time). A step bar SHALL sit under the chat head:
`nav` with `aria-label="Tutorial steps"`, holding one trigger over one
segment per step.

The trigger reads "Step n of m · <short label>" with a chevron, "m steps"
before Start (disabled then), and "Done · m of m" after the finish. It SHALL
open a menu of the steps, each row with its number or a check and its title,
marked "Done" or "Now"; a step not reached is disabled. The live step's row is
`aria-current="step"`, and the one the feed is scrolled into, when it is
another, `aria-current="location"`.

Each segment is a button on a 4 px rounded bar, 4 px apart, 12 px tall to the
pointer, with no label of its own on screen. Its `aria-label` reads "Step n
of m, <title>", with ", done" or ", current" once reached. A segment SHALL
light, in the brand gradient, when its step is entered, and all of them after
the finish; a step not reached is disabled. The live segment is
`aria-current="step"` and the one the feed is scrolled into, when it is
another, `aria-current="location"`.

A segment or a menu row of a done or current step SHALL scroll its divider to
22 px under the feed's top and flash it once. It SHALL open that step's main
file in the workspace, scrolled to the top, and reset nothing. ⌥↑ and ⌥↓
SHALL move to the previous and next divider, up to the live step.

While the live card is off screen, a pill SHALL float above the composer. It
reads "Back to step n", or "Back to the start" before Start, with an arrow
toward the card. A click SHALL scroll to the live card and focus its first
control. After the finish there SHALL be no pill.

#### Scenario: Jumping back from step 3

- **WHEN** the learner is on step 3 and clicks the step bar's first segment
- **THEN** the feed lands on step 1's heading, `lib.rs` opens at the top,
  segment 1 has `aria-current="location"` and segment 3
  `aria-current="step"`
- **AND** a "Back to step 3" pill shows, and nothing in step 1 can be run
  again

#### Scenario: The step head on step 2 (manual)

- **WHEN** the learner is on step 2 of Hello Anchor
- **THEN** the step bar reads "Step 2 of 4 · <step 2's short label>" over four
  segments, the first two lit and the last two disabled
- **AND** no segment shows a label on screen
