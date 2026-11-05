# Plan: tasks 3.1 and 3.2, the Tutorials page (HOO-2360)

Ticket: [HOO-2360](https://linear.app/solana-fndn/issue/HOO-2360) Tutorials
page by level, with Start here and conversation progress. Also closes
`tutorial-flow-v2` task 6.1. Base `scope/tutorial-flow`.

## Success metric

Most first visits to the page start Hello Anchor. Check:
`catalog_banner_opened` against page views, first week after Breakpoint.

## Design sources

Prototype `origin/almaz/mobile-tutorial-prototype`,
`design-system/src/prototype/tutorial-v2`: `desktop/Gallery.tsx`
(`TutorialsBody`), `desktop/TutorialList.tsx` (`TutorialLevels`,
`FilterButton`, `LEVEL_FIRST`), `ui/catalog.ts` (`byLevel`, `resultsLine`,
`searchHint`), `ui/StartHereBanner.tsx`, `ui/IsoVoxels.tsx`, `host.tsx`
(`LADDER`, `useFeatured`). Design alignment check confirmed by Slava 3 Nov
14:32.

## Design gaps (decided; Design alignment accepted 3 Nov)

1. Banner line per lesson lives in the start ladder constant, copied from
   the prototype's lessons.
2. Completed shows only when all three are done, on Zero Copy, with Open
   again only.
3. Lumberjack and Zero Copy are markdown until 6.3/6.4: "Continue · Page n
   of m", "<n> pages" meta, About page on open.
4. The banner opens like its card; a failed open is said on the banner.

## Steps (TDD, inline)

1. `entities/tutorial/model/start-ladder.ts`: `START_LADDER` (name, line)
   for Hello Anchor, Lumberjack, Zero Copy; `startTutorials(all)` returns
   the registered ones in ladder order. Unit test.
2. `widgets/catalog/lib/levels.ts`: `byLevel`, `frameworksOf`,
   `resultsLine`, `searchHint`, `LEVEL_FIRST = 4`. Unit tests.
3. `widgets/catalog/model/banner.ts`: `featuredOf(items)` (first not
   completed, else last) and `bannerOf(item)` -> `{state, label, line, meta,
   meter, action}`. Unit tests incl. "Hello Anchor half done" (2 of 4 ->
   "Continue · Step 3 of 4"), moved on to Lumberjack, all completed.
4. `useTutorialList` takes the pool; the Tutorials page passes
   `startTutorials(PgTutorial.all)`, New project keeps all. Items carry
   `minutes`, `steps` (objective per step) and `finish` from the definition.
5. Telemetry: `catalog_filtered {page, framework}`, `catalog_banner_opened
   {state}`.
6. UI: `ui/art/IsoVoxels.tsx` (ported), `ui/BaseStartHereBanner.tsx`,
   `ui/BaseTutorialLevels.tsx`, `ui/FrameworkFilter.tsx`, `TutorialsPage`
   rewritten on them. Component tests: banner hidden on search, results
   line, no filter with one framework, Show all only past four.
7. Home: `tutorials={startTutorials(PgTutorial.all)}`, so "All 3" and
   "3 guided paths"; PhoneHome the same. Update their tests.
8. Verify: `yarn run check`; screenshots via Playwright of banner fresh,
   continue, moved on to Lumberjack, all completed, a search, Home.
