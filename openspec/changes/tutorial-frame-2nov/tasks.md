# Tasks

Ticket: HOO-2548. One PR lands all tasks; base `scope/tutorial-flow`.
Plan: [plans/1-frame-and-scale.md](plans/1-frame-and-scale.md).

## 1. Frame

- [x] 1.1 In the frame, the workspace shows the editor alone: no stage tabs,
      no stage area, no Steps/Files column; the shell stops holding the
      files column open there. Verify: the shell's frame tests; "Deploy step
      in the frame" and "An ordinary project keeps its stages" by hand at
      1440

## 2. Step head and divider

- [x] 2.1 `BaseStepBar` as one trigger over four segments; `BaseFeed` drops
      the narrow split; segments light whole per step. Verify:
      `BaseStepBar.test.tsx` and the "Jumping back from step 3" component
      test
- [x] 2.2 `BaseStepDivider` as the step's heading alone, 24/28; the jump
      lands 22 px under the feed's top. Verify: component test for the
      divider's text

## 3. Reading scale

- [x] 3.1 the scale (`READ`, `HEADING`, `TITLE`, `LISTING`, `HEADLINE`) and the ringed chip in `Prose.tsx`; the scale in Say,
      intro, question, wrote, win, finish and you cards; the feed's rhythm
      and the waiting cards' 8 px. Verify: screenshots against the reference
      at 1440
- [x] 3.2 Wrote card ends on "⋯ N more lines", heads with the path alone.
      Verify: component test for the thirteen-line write
- [x] 3.3 Reduced motion fades new turns in. Verify: component test for the
      class under reduced motion

## 4. Shortcuts and copy

- [x] 4.1 Grouped shortcuts dialog. Verify: component test for the three
      groups in order
- [x] 4.2 Hello Anchor's headlines without closing periods. Verify:
      `yarn tutorial:check`

## 5. Spec pin

- [x] 5.1 Re-pin `tutorial-flow-v2` proposal and design to `f7d42bf2e`, with
      the line that the 31 Oct type scale and step head supersede
      `fb4b8e9ee`. Verify: `yarn spec:validate`

## 6. Added by Lead, 3 Nov 22:04

- [x] 6.1 DES-160: from 1024 px the desktop frame; under a finger the step
      head and the workspace head's small controls take a 44 px hit area
      and look the same. Verify: unit tests unchanged; by hand with touch
      emulation at 1024
- [x] 6.2 The act card's main button colour: f7d42bf2e draws it off-white
      (its warm palette); DES-160's 3 Nov palette is purple with white text.
      Lead, 3 Nov: Almaz's DES-160 comment settles the cool palette, so the
      button stays purple (Button default) and `BaseActCard` is unchanged
