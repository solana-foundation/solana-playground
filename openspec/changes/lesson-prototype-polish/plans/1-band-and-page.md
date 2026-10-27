# Band and page (tasks 1.1–1.5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The lesson's band, page and phone bar look and behave as the original prototype's `ObjectiveBand`, `LessonBar` and `Reader`.

**Architecture:** DS parts first (`design-system/src/components/ui/objective-band.tsx`, installed by `yarn ds-add objective-band`), then `BaseObjectiveBand` (props only) and a new `BaseLessonBar`, wired in `ObjectiveBand.tsx` / `Flow.tsx`. The page loses its footer and its opening on entry.

**Tech Stack:** React, Tailwind 4, the design system's registry, vitest + Testing Library, Playwright.

**Spec:** `openspec/changes/lesson-prototype-polish/{proposal,design}.md`, `specs/client-v2-lessons/spec.md`; values from `.claude/lead/hoo-2237-e2-lesson-2026-10-23.md` (main checkout).

## Global Constraints

- Never edit `client-v2/src/shared/ui` by hand; `yarn ds-add <name>` only.
- Ids, aria-labels and test ids survive: "Previous step", "Next step", "Read the page", "Close the page", `data-slot="objective-band"`, `role="progressbar"`.
- No nested ternaries; no empty `catch`; tests use no spread for new shapes.
- Copy: "Step 1 of 4" (sentence case), "Read the page", "Continue", "How this step is checked".
- Every value from the re-measure: band row min-h 40, padding 5 14; nav 24 round; quiet pill 26 / 13 / 400 / muted / full radius; phone fold 52; bar 60; targets 48; phone type 13/380 label, 15/440 control, 15/320 secondary.

## Review Focus

- A read step behind the frontier (walked back to): the primary must not offer "Continue" there (nothing to attest) — it shows the assistant label. Test in Task 2.
- The finished path: the band still renders "Browse gallery" in one row and on the phone bar. Test in Task 2 and Task 4.
- Re-entry of a lesson whose page was never opened: the page stays closed. Test in Task 3.
- A step with no page: no "Read the page" in the band or the bar. Test in Task 2.
- Focus after Esc on the page returns to "Read the page". Covered by `lessons.e2e.spec.ts` (existing).

---

### Task 1: `objective-band` in the design system (1.1)

**Files:**
- Modify: `design-system/src/components/ui/objective-band.tsx`
- Reinstall: `client-v2/src/shared/ui/objective-band.tsx` via `yarn ds-add objective-band`

**Interfaces:**
- Produces: `ObjectiveBand` (`px-3.5`), `ObjectiveText` (`font-medium`), `ObjectiveNav` (round buttons), `ObjectiveCheck({ open: boolean, onToggle(): void, label?: string })` — a 22 px round button, `aria-expanded={open}`, `aria-label="How this step is checked"`, check-circle 14 px at stroke 1.4, `text-muted-foreground`, `text-success` while open; `ObjectiveCondition` — a `<p>` at `text-xs leading-normal text-muted-foreground px-3.5 pb-2 -mt-0.5`; `ObjectiveActions` with `gap-1` and no `max-md:hidden`.

- [ ] Step 1: Edit the DS file; mirror the existing part style (`data-slot` on each).
- [ ] Step 2: `cd design-system && npm run build` (or the registry build the script uses) — passes.
- [ ] Step 3: `cd client-v2 && yarn ds-add objective-band` — the installed file diff equals the DS diff.
- [ ] Step 4: Commit `feat(client-v2): the objective band's parts as the prototype draws them (HOO-2262)`.

### Task 2: the wide band (1.2)

**Files:**
- Modify: `client-v2/src/views/flow/lessons/BaseObjectiveBand.tsx`, `ObjectiveBand.tsx`, `band-copy.ts`
- Delete: `readiness.ts`, `readiness-remedy.ts` (+ `readiness-remedy.test.ts`)
- Test: `BaseObjectiveBand.test.tsx`, `ObjectiveBand.test.tsx`, `band-copy.test.ts`

**Interfaces:**
- `StepBandProps` loses `prove` and `readiness`; gains `primary: BandAction & { kind: "continue" | "stuck" }`; `read: BandAction | null` (no `unread`). `compact` becomes `phone?: boolean` (Task 4).
- `band-copy.ts`: `primaryLabel` and `readLabel` are deleted; `describeStep` drops `opened` and `position`.

- [ ] Step 1: Failing tests in `BaseObjectiveBand.test.tsx`: renders "Step 1 of 4" (not uppercase class), one `objective-band` child row and no `objective-actions-row`; no "Build to prove this"; no "Before you can deploy"; pressing "How this step is checked" sets `aria-expanded="true"` and shows the criterion; `primary.kind === "continue"` renders "Continue" as a `BrandButton`; `read: null` renders no "Read the page"; `kind: "finished"` renders "Browse gallery".
- [ ] Step 2: `yarn test-unit src/views/flow/lessons/BaseObjectiveBand.test.tsx` — FAIL.
- [ ] Step 3: Rewrite `BaseObjectiveBand` wide branch: `ObjectiveBand` with `flex-wrap gap-x-4 gap-y-1`; a `Main` div `flex-[1_1_18rem] min-w-0 flex items-center gap-2.5` with count, meter, text, `ObjectiveCheck`; `ObjectiveActions` with nav, quiet read, primary; `ObjectiveCondition` under it while open (state local to the band, kept across steps).
- [ ] Step 4: `ObjectiveBand.tsx`: primary is `{kind:"continue", label:"Continue", onClick: PgLesson.attest}` when `graderClass(step.verify) === "attestation" && shown.offersPrimary`, else `{kind:"stuck", label: assistantLabel(...), onClick: askForHelp}`; drop the wallet/balance/cluster/session hooks and the readiness imports; delete the two readiness modules and fix `band-copy` (+ its tests).
- [ ] Step 5: Quiet "Read the page": check whether `button` in the DS has a variant/size matching 26 / 13 / 400 / muted / rounded-full; if not, add `variant: "quiet"` to `design-system/src/components/ui/button.tsx` and `yarn ds-add button`. Check the prototype's stage brand buttons (`origin/prototype/redesign:prototype/redesign/src/views/flow/stages/`): if they are 13/500 too, set BrandButton `sm` to `text-[0.8125rem] font-medium` in the DS; otherwise add size `band`. Tell Dispatcher before pushing either.
- [ ] Step 6: `yarn test-unit src/views/flow/lessons` — PASS; `yarn test-types` — PASS.
- [ ] Step 7: Commit `feat(client-v2): the lesson's band is one row, as the prototype draws it (HOO-2262)`.

### Task 3: the page (1.3)

**Files:**
- Modify: `client-v2/src/views/flow/Flow.tsx` (drop `entryReading` effect), `lessons/reading.ts` (delete `entryReading` and its export in `index.ts`; delete the file if empty, with `reading.test.ts`), `lessons/BaseReader.tsx`, `lessons/Reader.tsx`, `components/Markdown/Markdown.tsx` (h1, h2 `font-weight: 500`)
- Test: `BaseReader.test.tsx`, `Reader.test.tsx`

**Interfaces:** `BaseReaderProps` loses `position`, `criterion`, `footer`.

- [ ] Step 1: Failing tests: BaseReader renders the title, a "Close the page" button, and no "Mark as read" / "Back to the code"; no "STEP" eyebrow.
- [ ] Step 2: Run — FAIL.
- [ ] Step 3: Head: `DialogTitle` in `font-sans text-sm font-medium`, `px-4 py-3 border-b`; close: `Button` ghost `icon-sm` with `rounded-full` only if the DS has no round icon size — else the DS size; footer removed. `Reader.tsx` and `Flow.tsx` stop passing the removed props.
- [ ] Step 4: Run — PASS; commit `feat(client-v2): a lesson opens on its code; the page has no footer (HOO-2262)`.

### Task 4: the phone (1.4)

**Files:**
- Modify: `BaseObjectiveBand.tsx` (phone branch), `ObjectiveBand.tsx`, `Flow.tsx` (render `LessonBar` under `<Stage>` on a phone; drop `keepTab` call), `left/LeftPanel.tsx` (`startOn?: Tab` prop overriding the kept tab), `left/kept-column.ts` (drop `keepTab` if unused), `widgets/layout-shell/ui/LayoutShell.tsx` (`sheetFont` in the text face)
- Create: `lessons/BaseLessonBar.tsx`, `lessons/LessonBar.tsx`
- Test: `BaseObjectiveBand.test.tsx`, `BaseLessonBar.test.tsx`

**Interfaces:**
- `BaseLessonBar({ back, next, read, primary })` — the same shapes as `StepBandProps`; `<div role="toolbar" aria-label="This step">`, `min-h-15 border-t frosted`, nav 48×48 icons 20, read and primary `h-12 px-4 text-[0.9375rem] font-[440]` (primary `px-5`).
- `ObjectiveBand.tsx` exports a hook `useBandProps(state, flow, onRead, onOpenGallery)` returning `BaseObjectiveBandProps | null`, shared by `ObjectiveBand` and `LessonBar`.

- [ ] Step 1: Failing tests: phone band is one button `aria-expanded="false"` with "1/4" and the objective, and no "Read the page"; pressing it → `aria-expanded="true"` and the criterion shows; `BaseLessonBar` renders "Previous step", "Next step", "Read the page", "I'm stuck"; finished → "Browse gallery".
- [ ] Step 2: Run — FAIL.
- [ ] Step 3: Implement the fold and the bar with the prototype's values; `LeftPanel` gets `startOn="files"` from `Flow` when `phone`.
- [ ] Step 4: Font leak: in Playwright at 393, open the files sheet and read `getComputedStyle` of "Skip this step" to find the rule giving JetBrains Mono; fix with `body { font-family: var(--font-text) }` in `index.css`'s base layer if it is inheritance, else the narrowest rule that wins. Re-read: the product font.
- [ ] Step 5: Run unit tests — PASS; commit `feat(client-v2): the phone's lesson bar at the foot of the code (HOO-2262)`.

### Task 5: specs and e2e (1.5)

**Files:**
- Modify: `openspec/changes/ui-migration/specs/client-v2-lessons/spec.md` ("The band folds to one row on a phone": actions in the bar at the foot, the band opens in place; scenario updated), `openspec/changes/ui-migration/design.md` "Lessons (5.19)" (one row, no proving action/readiness, no opening on entry, no reader footer, phone bar)
- Modify: `client-v2/e2e/lessons.e2e.spec.ts`, `lesson-path.e2e.spec.ts`, `client-v2-layout.e2e.spec.ts`, `stepper.e2e.spec.ts`, `lesson-deep-link.e2e.spec.ts` where they read the removed copy or controls
- Modify: `openspec/changes/lesson-prototype-polish/tasks.md` (tick 1.1–1.5, link this plan)

- [ ] Step 1: `grep` the e2e specs for "to prove this", "Before you can deploy", "Read step", "Show the steps", "Back to the code", "Mark as read", "objective-actions-row"; rewrite each to the new control ("Continue" for read steps; Build via the stepper).
- [ ] Step 2: `yarn spec:validate` — PASS.
- [ ] Step 3: `yarn test-e2e e2e/<each touched spec>` — PASS.
- [ ] Step 4: `yarn run check` — PASS.
- [ ] Step 5: Commit `docs(openspec): lesson-prototype-polish; ui-migration's lesson look follows it (HOO-2262)`.
