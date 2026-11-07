# Plan: the tutorial card to f7d42bf2e

Inline. Design in [../design.md](../design.md).

1. Screenshots before: `scope/tutorial-flow` at 1440 and 393, Tutorials page.
   Reference: the prototype's `f7d42bf2e`, same sizes.
2. Tests first, then red:
   - `lib/tutorial-caption.ts` → `lib/tutorial-eyebrow.ts`: the framework alone in
     a level, "<level> · <framework>" elsewhere, a missing framework drops.
   - `BaseTutorialCard.test.tsx`: the word sits in `action-card-eyebrow`, above
     the title; no `data-card-chevron`; the corner square on every state.
   - `NewProject.test.tsx` keeps "Beginner · Anchor".
3. `BaseTutorialCard`: `eyebrow` prop, grid layout through `className`, the
   prototype's type and colours, no chevron. Levels and grid pass the new word.
4. `yarn run check`; screenshots after; compare with the reference.
5. `/sx:review-pr full`, `/sx:review-pr`, lint delta, Testing block, PR.
