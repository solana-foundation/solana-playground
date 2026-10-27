# Tasks

## 1. Band and page (PR 1; plan: [plans/1-band-and-page.md](plans/1-band-and-page.md))

- [x] 1.1 `objective-band` in `design-system/`: `px-3.5`, `font-medium`
      objective, round nav, `ObjectiveCheck` and `ObjectiveCondition`,
      `ObjectiveActions` without `max-md:hidden`; `yarn ds-add
      objective-band` (HOO-2262)
- [x] 1.2 The wide band: one row, sentence-case count, the check toggle,
      quiet "Read the page", "Continue" on a read step; drop the proving
      action, the readiness callout, `readiness.ts` and
      `readiness-remedy.ts` (HOO-2262; after 1.1)
- [x] 1.3 The page: no opening on entry, "Read the page" only, the
      objective as head, round close, no footer, headings at 500 (HOO-2262)
- [x] 1.4 The phone: the fold, `BaseLessonBar`/`LessonBar` at the foot,
      no "Show the steps", the files row opens the sheet on Files, the
      shell's Sheets in the product font (HOO-2262; after 1.2)
- [x] 1.5 Specs: edit ui-migration's "The band folds to one row on a
      phone" and the "Lessons (5.19)" paragraph in place; update the e2e
      specs this PR breaks (HOO-2262; with 1.2–1.4)

## 2. Rail, Skip and the navigation (PR 2, stacked on PR 1)

- [ ] 2.1 `step-rail` in `design-system/`: wrapping titles, muted status,
      16 px grid, the arrow mark; `yarn ds-add step-rail` (HOO-2262)
- [ ] 2.2 The full-width Skip footer, underlined wide and plain on a
      phone; the status copy ("aiming at", "locked") landed with 1.2, which
      removed the label it was built from (HOO-2262; after 2.1)
- [ ] 2.3 A started lesson is a Projects row with the folder glyph and no
      count; edit ui-migration's "The navigation lists the projects" in
      place; update the e2e specs this breaks (HOO-2262)

## 3. The assistant (PR 3, stacked on PR 2)

- [ ] 3.1 The lesson's three suggestions in a wrapped row; chips ordered
      step, file, files (HOO-2262)
