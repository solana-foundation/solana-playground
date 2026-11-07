# Design

## Context

The target is `Card` in `design-system/src/prototype/tutorial-v2/desktop/TutorialList.tsx`
at `f7d42bf2e`. The phone draws the same card through `TutorialsBody`.

## Decisions

- **Stay on the design system's `ActionCard`.** The look is the prototype's and
  the code stays the design system's. The card lays its parts on a grid through
  `className`: cover over two rows, text beside it, corner square, then the
  description under the text and the square. `ActionCard` itself does not change,
  because the Programs tab and the sample cards share it.
- **`caption` becomes `eyebrow`,** in `ActionCardEyebrow`. `tutorialCaption`
  becomes `groupedEyebrow` (the framework, in a level) and `flatEyebrow`
  ("<level> · <framework>", elsewhere).
- **Progress stays page of pages.** The prototype counts passed steps because
  its data has them; ours has pages, and the spec already says "its page of its
  pages".
- **Open's running and failed lines** sit under the description in the same
  column. The prototype has none.

## Gaps, decided

- Almaz's prototype has no New project dialog; the opening prototype does.
  `prototype/redesign/src/views/flow/gallery/TutorialsTab.tsx:50-51` writes
  "<level> · <framework>", now over the name.
- The folding search keeps the prototype's states and 44 px squares, without
  its 160 ms grow and fold of the field.
- The ticket said "step count beside the section heading". At `f7d42bf2e` that
  number is the count of tutorials in the level; `BaseTutorialLevels` already
  draws it.
