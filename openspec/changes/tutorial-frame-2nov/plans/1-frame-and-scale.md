# Tutorial frame to the 2 Nov prototype: implementation plan

> **For agentic workers:** executed inline (`superpowers:executing-plans`). Steps use checkbox syntax.

**Goal:** a tutorial's frame shows chat and editor only, with the prototype's step head, divider and 31 Oct reading scale.

**Architecture:** frame-only branches in `Flow.tsx` and `BaseLayoutShell`; Base components in `widgets/tutorial-conversation` and `widgets/tutorial-frame` rewritten to `f7d42bf2e`'s `StepBar`, `StepDivider`, `Prose`, `type.ts`, `WroteCard` and `ChatColumn`'s dialog.

**Tech Stack:** React 19, Tailwind 4, design-system `DropdownMenu`, vitest + Testing Library.

**Spec:** `openspec/changes/tutorial-frame-2nov/` (proposal, design, specs). Source of values: `git show f7d42bf2e:design-system/src/prototype/tutorial-v2/<file>`.

## Global Constraints

- Prototype `f7d42bf2e` is the 1:1 target; values come from its files, not memory.
- Outside a tutorial frame nothing changes (stage tabs, stage area, files column).
- Act and result cards (`BaseActCard`, `BaseResultCard`, `BaseReceipt`) are not touched.
- No telemetry added, renamed or removed; `via` stays `"bar"` (segment) and `"menu"` (trigger menu).
- Ids, aria-labels and test ids kept: `nav[aria-label="Tutorial steps"]`, `data-testid="tutorial-frame"`, `tutorial-workspace`.

## Review Focus

- Leaving the tutorial for an ordinary project brings the stage tabs and files column back (shell test).
- The editor stays mounted across the frame switch (`Write` must never unmount: `StageRouter` keeps it, forced to `"write"`).
- Before Start the trigger is disabled and reads "4 steps"; after the finish "Done · 4 of 4" with every segment lit.
- A segment of a step not reached is disabled and fires no jump.
- Ctrl/⌘E in the frame toggles the tree only, never the shell's files column.

---

### Task 1: Frame without stage chrome (tasks.md 1.1)

**Files:** Modify `views/flow/Flow.tsx`, `views/flow/stages/StageRouter.tsx`, `widgets/layout-shell/ui/BaseLayoutShell.tsx`, `widgets/layout-shell/ui/LayoutShell.tsx`; Test `widgets/layout-shell/ui/BaseLayoutShell.test.tsx`.

- [ ] Test: in the frame (`tutorial` slot given, wide), the `files` render prop is never called and `stageTabs` content is absent; without the slot both render.
- [ ] Run, see it fail.
- [ ] `BaseLayoutShell`: in `tutorialLayout`, `filesState` is `{ open: false }`, no files panel; stage tabs not drawn. Drop `pinned` from the `files` slot args. `LayoutShell`: Ctrl+E files toggle returns early when `tutorialNow.current`.
- [ ] `StageRouter` gets `tabs?: boolean` (default true); false drops `role`/`aria-labelledby`. `Flow.tsx`: in the frame (`inFrame`) render `<StageRouter stage="write" tabs={false} />` and no `ObjectiveBand`/`Reader`/`LessonBar`.
- [ ] Run shell tests and `yarn test-types`; commit `feat(client-v2): the tutorial frame drops the stage tabs, stage area and files column (HOO-2548)`.

### Task 2: Step head and divider (2.1, 2.2)

**Files:** Modify `widgets/tutorial-conversation/ui/BaseStepBar.tsx`, `BaseStepDivider.tsx`, `BaseFeed.tsx`, `TutorialConversation.tsx`, `model/step-bar.ts`; Tests `BaseStepBar.test.tsx`, `BaseFeed.test.tsx`.

**Interfaces:** `BaseStepBarProps = { steps; live: number | null; viewing: number | null; onJump(index, via: "bar" | "menu") }` (no `progress`, no `narrow`; finished is derived from `steps`). `BaseStepDividerProps = { objective: string }`.

- [ ] Tests: trigger text "Step 2 of 4 · <short>" on step 2, "4 steps" disabled before Start, "Done · 4 of 4" after finish; four segment buttons with aria-labels "Step n of 4, <title>[, done|, current]", none with visible text; segments lit = `live + 1` (all after finish); menu rows disabled when not reached; divider renders the objective as `h2` and no "Step n of m", no time.
- [ ] Run, see them fail.
- [ ] Implement from prototype `ui/StepBar.tsx` (`Segment`, `useSweep`, gradient `#9945ff → #14f195` via `bg-gradient-product-flat` if it matches, else inline). Drop `barProgress`, `useNarrow`, `NARROW_PX`; `UNDER_BAR` becomes 22; feed top `pt-[22px]`.
- [ ] Run tests; commit `feat(client-v2): one step head over four segments, the step's heading as its divider (HOO-2548)`.

### Task 3: Reading scale (3.1–3.3)

**Files:** Modify `Prose.tsx` (`READ`, `HEADING`, `TITLE`, `LISTING`, `HEADLINE`, `CHIP`, `noStop`, the `chip` size prop), `BaseSay.tsx`, `BaseIntroCard.tsx`, `BaseQuestionCard.tsx`, `BaseWroteCard.tsx`, `BaseWinCard.tsx`, `BaseFinishCard.tsx`, `BaseYouPill.tsx`, `BaseFeed.tsx`.

- [ ] Tests: wrote card for lines 5–13 shows 3 rows and "6 more lines", head has no "lines 5 to 13", aria-label still "Show lines 5 to 13 in src/lib.rs"; `Prose` keeps a following "." in the chip's nowrap span; a fresh turn under reduced motion carries the `pg-fade` animation class.
- [ ] Run, see them fail.
- [ ] Port values from the prototype files named in each Base's doc; add `@keyframes pg-fade` where `animate-rise` is defined if missing.
- [ ] Run tests; commit `feat(client-v2): the 31 Oct reading scale in the tutorial feed (HOO-2548)`.

### Task 4: Shortcuts and copy (4.1, 4.2)

**Files:** Modify `widgets/tutorial-frame/model/shortcuts.ts` (`Shortcut.group: "In the lesson" | "Panels" | "Steps"`), `ui/ShortcutsDialog.tsx`; `src/tutorials/hello-anchor/tutorial.json`.

- [ ] Test (in-source): groups in order, five/three/one rows.
- [ ] Implement the prototype's `ShortcutsDialog` layout (320 wide, `h-8` rows, group caption 12/16 subtle).
- [ ] Drop closing periods from step objectives and win lines; `yarn tutorial:check`.
- [ ] Commit `feat(client-v2): grouped tutorial shortcuts, headlines without periods (HOO-2548)`.

### Task 5: Spec pin (5.1)

- [ ] `tutorial-flow-v2` `proposal.md` and `design.md`: `fb4b8e9ee` → `f7d42bf2e`, plus one line: the 31 Oct type scale and step head supersede `fb4b8e9ee`'s (`tutorial-frame-2nov`). Tick tasks here. `yarn spec:validate`. Commit `docs(openspec): pin tutorial-flow-v2 to the 2 Nov prototype (HOO-2548)`.
