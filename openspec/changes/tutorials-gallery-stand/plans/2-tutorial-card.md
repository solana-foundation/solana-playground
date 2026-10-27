# The tutorial card — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** One tutorial card as the stand draws it (brand cover, caption,
corner ↗ or tick, "N of M", a chevron on a phone, a failure on the card),
fed by each tutorial's saved progress, and New project's Tutorials list
drawing it.

**Architecture:** `entities/tutorial` gains the progress union, a pure
`progressOf` and a hook `useTutorialProgress` over `PgTutorial`.
`widgets/catalog` gains the cover art, `BaseTutorialCard` and
`BaseTutorialGrid`; `useTutorialList` hands out tutorial items instead of
catalog cards, and `BaseNewProject` draws the tutorial grid on its
Tutorials tab while Programs keeps `BaseCatalogGrid`. The Tutorials page
moves to the new card in task 3, with its groups.

**Tech Stack:** React 19, Tailwind 4, vitest + Testing Library, Playwright.

**Spec:** `openspec/changes/tutorials-gallery-stand/specs/client-v2-tutorials/spec.md`,
requirement "A tutorial card opens its tutorial"; `design.md`, decisions "A
tutorials list of its own", "Progress from `PgTutorial`", "The art is ours".
Stand: `client-v2/src/views/flow/gallery/TutorialsTab.tsx` (card),
`TutorialCover.tsx` (cover), `views/deck/Atmosphere.tsx` (`BEDS`, `FIELDS`),
`components/PlaygroundMarkNext.tsx` (`MARK_PATH`).

## Global Constraints

- Button labels exactly `Open <name>`, `Continue <name>`,
  `<name> completed. Open it`; one button per card, stretched over it.
- Progress text exactly `<n> of <m>` (page of pages), started only.
- Captions: `<framework> · by <first author>` (grouped),
  `<level> · <framework>` (flat; New project). Missing parts drop with
  their separator.
- Cover: ground by framework (Anchor `deep`, Native `explore`, Seahorse
  `violet`, else `haze`), mark placement by a hash of the name, white mark,
  `aria-hidden`, no `<img>`. Colours are the stand's art constants, kept in
  the art file; no new DS token, no edit in `src/shared/ui`.
- The card composes `ActionCard` (`data-slot="action-card"`,
  `action-card-content` kept: e2e reads them). Phone is `< 768 px` (`md:`).
- Programs' card and `BaseCatalogGrid` unchanged.

## Review Focus

- Explorer not initialised when New project opens on a cold load:
  `PgTutorial.isStarted` throws; the hook reads every tutorial as `new` and
  reads again on `PgExplorer.onDidInit`, never crashes the dialog.
- A started tutorial whose metadata file is missing or unreadable: it shows
  as started on page 1 and the failure is logged once (`createLogger`
  `warn`), not thrown into render.
- A started tutorial's card is labelled `Continue <name>`: e2e specs that
  press `Open Hello Anchor` run on fresh storage; any that run after a start
  (lesson-path, thread-restore) must be checked and moved to the new label.
- Phone: the one button stays in the accessibility tree and keeps its name;
  only its drawing changes (corner square hidden, chevron shown). The
  new-project phone spec that expected the Open button hidden moves to that.
- A failed Open: the message shows on that card only (`role="alert"`),
  the other cards stay enabled once it settles.

---

### Task 1: Progress and the card (2.1)

**Files:**
- Create: `client-v2/src/entities/tutorial/model/progress.ts` (+ export from `entities/tutorial/index.ts`), its tests in the module's in-source block (AGENTS.md)
- Create: `client-v2/src/entities/tutorial/model/use-tutorial-progress.ts`, `use-tutorial-progress.test.tsx` (mock `utils/tutorial/tutorial` and `utils/explorer/explorer`, never the barrel)
- Create: `client-v2/src/widgets/catalog/ui/art/TutorialCover.tsx`, `TutorialCover.test.tsx`
- Create: `client-v2/src/widgets/catalog/ui/BaseTutorialCard.tsx`, `BaseTutorialCard.test.tsx`
- Create: `client-v2/src/widgets/catalog/lib/tutorial-caption.ts`, its tests in-source

**Interfaces:**
- Produces (`entities/tutorial`):
  - `type TutorialProgress = { state: "new" } | { state: "started"; page: number; pages: number } | { state: "completed" }`
  - `progressOf(started: boolean, meta: TutorialMetadata | null, pages: number): TutorialProgress`
  - `useTutorialProgress(): (name: string) => TutorialProgress` — reads
    once on mount and on `PgExplorer.onDidInit`; unknown names are `new`.
- Produces (`widgets/catalog`):
  - `tutorialCaption(t: Pick<TutorialData, "level" | "framework" | "authors">, grouped: boolean): string`
  - `TutorialCover({ name, framework?, className? })`
  - `BaseTutorialCard(props: { title: string; description: string; caption: string; framework?: string; progress: TutorialProgress; open?: CardOpen; busy: boolean; onOpen: () => Promise<void> })`

- [ ] **Step 1: Failing tests.**
  `progress.test.ts`: `progressOf(false, null, 5)` → `{state:"new"}`;
  `progressOf(true, {pageNumber: 2, completed: false}, 5)` →
  `{state:"started", page: 2, pages: 5}`; `progressOf(true, {pageNumber: 5,
  completed: true}, 5)` → `{state:"completed"}`; `progressOf(true, null, 5)`
  → `{state:"started", page: 1, pages: 5}`.
  `use-tutorial-progress.test.tsx`: explorer uninitialised → `"new"`, then
  firing `onDidInit` with Hello Anchor started on page 2 → `started 2 of
  <pageCount>`; `getMetadata` rejecting → `started` page 1, warn logged.
  `tutorial-caption.test.ts`: grouped `Anchor · by <author>`, flat
  `Beginner · Anchor`, no framework flat → `Beginner`.
  `TutorialCover.test.tsx`: `aria-hidden`, the Anchor ground's colour on the
  tile, the same placement for one name across two renders.
  `BaseTutorialCard.test.tsx`: new → button `Open Hello Anchor`, no
  `N of M`; started → `Continue Hello Anchor` and text `2 of 5`;
  completed → `Hello Anchor completed. Open it`, tick, no `N of M`;
  `open: {state:"failed", message:"boom"}` → `role="alert"` `boom`;
  `busy` → button disabled; caption text rendered; a click calls `onOpen`
  once; `[data-card-chevron]` present.
- [ ] **Step 2:** `yarn test-unit src/entities/tutorial src/widgets/catalog` → the new files FAIL.
- [ ] **Step 3:** `progress.ts` and the hook (state a `Map`, `read` an async
  over `PgTutorial.all`: no explorer workspaces yet (`allWorkspaceNames`
  unset) → all new, `getMetadata` only for started ones, each in its own
  catch).
- [ ] **Step 4:** `TutorialCover`: the stand's `GROUND_BY_FRAMEWORK`,
  `BEDS`/`FIELDS` for the four grounds, `PLACES`, `PLAY_WIDTH`, `hash` and
  `MARK_PATH` as module constants; Tailwind for the tile
  (`relative block shrink-0 overflow-hidden text-white`), inline style for
  the per-field position, colour, scale and the radial gradient.
- [ ] **Step 5:** `BaseTutorialCard` on `ActionCard` (`ActionCardMedia`
  slot with `TutorialCover` at `h-[2.625rem] w-14 rounded-lg`, Content with
  Title + `<n> of <m>` (`text-caption text-muted-foreground tabular-nums`),
  Description, caption line (`text-caption text-subtle`), running text and
  failure as `BaseCatalogGrid` does). The one `AsyncButton`-free
  `<button>` (failure is the card's `open`, as now) carries
  `ActionCardLink`'s stretched `after:` and holds: from `md` a `size-8
  rounded-lg bg-surface-raised` square with ↗ (lucide `ArrowUpRight`) or,
  completed, `bg-success/12 text-success` with `Check`; below `md` a
  `ChevronRight data-card-chevron`. `disabled={busy}`; click →
  `onOpen().catch(reportButtonFailure(\`open ${title}\`))`.
- [ ] **Step 6:** run → PASS.
- [ ] **Step 7:** Commit `feat(client-v2): the tutorial card with its cover and progress (HOO-2254)`.

### Task 2: New project's Tutorials list draws it (2.2)

**Files:**
- Create: `client-v2/src/widgets/catalog/ui/BaseTutorialGrid.tsx`
- Modify: `client-v2/src/widgets/catalog/model/lists.ts` (`CardList<C = CatalogCard>`)
- Modify: `client-v2/src/widgets/catalog/model/use-tutorial-list.ts` (items, not catalog cards)
- Modify: `client-v2/src/widgets/catalog/model/use-new-project.ts`, `ui/BaseNewProject.tsx`
- Modify: `client-v2/src/widgets/catalog/ui/TutorialsPage.tsx` (keeps `BaseCatalogPage` until task 3: maps items to `CatalogCard` with a local adapter)
- Modify: `client-v2/src/widgets/catalog/ui/NewProject.test.tsx`, `model/use-catalog-lists.test.ts`
- Modify: `client-v2/e2e/new-project.e2e.spec.ts` (phone case), any e2e found in Review Focus line 3

**Interfaces:**
- Consumes: Task 1's `BaseTutorialCard`, `tutorialCaption`, `useTutorialProgress`.
- Produces:
  - `interface TutorialItem { id: string; title: string; description: string; framework?: string; level: TutorialLevel; authors: Author[]; progress: TutorialProgress; open?: CardOpen }`
  - `useTutorialList(query, cardOpen): CardList<TutorialItem>` (task 3 adds the framework)
  - `BaseTutorialGrid({ items: CatalogList<TutorialItem>; query; busy; onOpen: (id) => Promise<void> })` (task 3 adds the grouping) — same failed/loading/empty branches as `BaseCatalogGrid`, grid `grid-cols-[repeat(auto-fill,minmax(min(20rem,100%),1fr))] gap-3` (the stand's).
  - `BaseNewProjectProps.tutorials: Omit<BaseTutorialGridProps, "query">`, drawn when `tab === "tutorials"`; `grid` becomes Programs' only.

- [ ] **Step 1: Failing tests.** `NewProject.test.tsx`: the Tutorials tab
  shows `Open Hello Anchor` and the caption `Beginner · Anchor`; with Hello
  Anchor started on page 2 (mocked `useTutorialProgress`) the button is
  `Continue Hello Anchor` and `2 of <m>` shows; Programs' cards still have
  their `Open` text button. Existing open/hold/failure cases keep passing
  with the tutorial labels.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** generic `CardList`, `TutorialItem`, `useTutorialList`
  (adds `progress` from the hook), `BaseTutorialGrid`, `BaseNewProject`
  switch, `useNewProject` hands `tutorials` and `grid`; `TutorialsPage`'s
  adapter keeps today's card (`media: PgTutorial` thumbnail lookup by name).
- [ ] **Step 4:** `yarn test-unit src/widgets/catalog` → PASS.
- [ ] **Step 5:** e2e: `new-project.e2e.spec.ts` phone case expects the
  chevron visible and the corner square hidden, the button still found by
  `/^Open /`; `grep -rn '"Open Hello' e2e` and check each spec's storage for
  a started tutorial. Run `yarn test-e2e e2e/new-project.e2e.spec.ts` and
  each touched spec alone.
- [ ] **Step 6:** Commit `feat(client-v2): New project lists tutorials with the new card (HOO-2254)`.

### Task 3: Verify and PR

- [ ] `yarn run check` green; touched e2e specs alone, green.
- [ ] Screenshots stand vs ours of New project's Tutorials tab at
  1440/834/393 (new, started, completed cards).
- [ ] `/sx:review-pr full`, `/sx:review-pr`; tick 2.1 and 2.2 in `tasks.md`.
- [ ] PR stacked on #171's branch (base `slavakoreshkov/hoo-2254-polish-2-e1-tutorials`).
