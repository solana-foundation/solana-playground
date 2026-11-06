# Design

## Context

`InteractBody` renders one column capped at 42rem (39rem inside its padding):
chips, form, result, Call history, Accounts, Events. `BaseCallHistory` renders
nothing when there are no records. The stage scrolls inside `STAGE_FRAME`; its
width depends on the chat and Files panels beside it.

No design source gives a two-column Interact (the DS prototype's ready state is
unreachable without a real build, Almaz's stand has no Call history, Spec 03
puts it under the form). The values below are decided here and sent to the
designers' batch.

## Decisions

- **Container query, not a viewport breakpoint.** The body is an `@container`;
  two columns from `@min-[40rem]` of the stage's width. The viewport does not
  change when the panels open or close, so a viewport breakpoint would give two
  columns in a stage too narrow for them, or one column in a stage that has room.
- **Grid `minmax(0,42rem) 18rem`, gap 1.5rem.** The wrapper's max width is
  64.5rem, the two tracks, the gap and its 3rem of side padding, so the form can
  reach 42rem. The history row (dot, name, outcome, time, signature) fits 18rem
  by wrapping.
- **Sticky history, capped.** `self-start sticky top-6` keeps the column beside
  the form while the form scrolls; it scrolls away with the grid once Accounts
  pass under it. Its height is capped at the viewport less the app header and
  stage toolbar (`100dvh - 16rem`) and its list scrolls inside, so the last
  rows stay reachable while it is pinned.
- **The empty line only in the wide layout.** A `showEmpty` prop on
  `BaseCallHistory` keeps the heading and "Calls you send show up here." before
  the first call, so the reserved history track does not read as a blank hole.
  Below the breakpoint the whole section is hidden while there are no records,
  as one column showed nothing there before.
- **History rows break after the name in a narrow column.** Under 24rem of
  column width (always, in the 18rem column) the dot and the name keep the first
  line and the outcome, time and signature wrap below, so every row breaks at
  the same place. The name's basis is the row less the dot and its gap
  (1.125rem, rounded up to 1.25rem).
- **Fill and Reset wrap as one group** in the instruction form's button row
  (`Instruction.tsx`, shared with the legacy Test panel), so a narrow form puts
  them together on a second line under Call rather than leaving Reset alone.
- **Accounts and Events** move out of the column into a full-width block under
  the grid.

## Measured

At 1512 x 900 with the chat and Files open the stage is 670 px (41.9rem). A
26rem form floor would need a 48.5rem stage (26 + 1.5 + 18 + 3 padding), so the
floor is knowingly not met: the threshold stays 40rem, where the form is 280 px
(17.5rem), and 310 px at the measured stage. There an instruction with long
account names and three arguments wraps no label; with Fill and Reset grouped,
its button row wraps as Call, then the pair. At a 1200 px window the stage is
358 px and keeps one column.
