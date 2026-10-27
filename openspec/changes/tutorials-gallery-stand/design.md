# Design

## Context

The stand (`almaz/tutorial-in-product`, 23388bd07) is Nikita's styled-components
branch with Almaz's screens on top: `views/flow/zero/ZeroState.tsx` (the
Tutorials page: heading, search, `FrameworkFilter`), `views/flow/gallery/StartHere.tsx`
(banner), `TutorialsTab.tsx` (level groups and cards), `TutorialCover.tsx`
(brand cover), `banner-art/IsoVoxels.tsx` (the voxel mark) and
`components/Tutorial/views/About.tsx`. None of it can be copied as is:
new-face is Tailwind and the design system's components, and the stand's
progress reads a lesson summary (`PgLessonSummary`) that new-face does not
have.

On new-face the Tutorials page is `widgets/catalog/ui/TutorialsPage` over
`BaseCatalogPage` and `BaseCatalogGrid`, which Programs and New project
share. The About page is `components/Tutorial/views/About.tsx` with
`entities/tutorial` (`BaseStartButton`, `BaseDetailTag`/`DetailTag`). The
assistant's head takes `PgExplorer.currentWorkspaceName` (`useProjectName`
in `widgets/assistant/ui/Assistant.tsx`); the files column shows
`NoWorkspace` when there is no project.

## Goals / Non-Goals

**Goals:**

- The Tutorials page and the About page match the stand at 1440, 834 and
  393, with our data.
- New project's Tutorials list uses the same card.
- Every id, aria-label and test id the e2e specs use survives, except the
  About page's `START` label, which the specs follow to `Start`.

**Non-Goals:**

- The lesson view (HOO-2262), Programs, Home.
- A lesson-progress model: progress here is the tutorial's own page
  metadata.

## Decisions

- **A tutorials list of its own, not a mode of `BaseCatalogGrid`.** The
  grouped page, the banner, the filter and the new card go into
  `widgets/catalog` as `BaseTutorialsList` (sections, Show all) and
  `BaseTutorialCard`, each a `Base` + connected pair per the slice's rules.
  `BaseCatalogGrid` stays for Programs. New project's Tutorials tab renders
  the flat `BaseTutorialCard` grid instead of `BaseCatalogGrid`. Alternative:
  a `variant` prop on `BaseCatalogGrid`; rejected, since the two cards share
  nothing past the frame and a variant would carry both shapes through every
  caller.
- **Progress from `PgTutorial`.** A small model hook reads, per tutorial,
  `isStarted(name)` and `getMetadata(name)` (`pageNumber`, `completed`) once
  per page show, plus `pageCount` from the tutorial's data, and hands a
  `progress` union (`new` | `started{page, pages}` | `completed`) to the
  cards and the banner. The banner's states are a function of Hello Anchor's
  and Counter PDA Tutorial's progress, tested as a pure function.
- **The banner starts the tutorial.** As on the stand, the banner's action
  marks the tutorial to start on open, then opens it; the About page takes
  the mark on mount and calls its own `start`. The mark is one module-level
  name, taken once, so a later visit to the About page stops there as usual.
- **The art is ours, in the slice.** The voxel mark (`IsoVoxels`, an SVG of
  cubes from the stand) and the framework cover are product art, not
  design-system parts: they go into `widgets/catalog/ui/art/` rewritten
  without styled-components. Their colours are the brand deck's own grounds,
  the same on every theme, which no design-system token describes: they stay
  constants in the art file, and `scripts/check-colors.mjs` allows that
  folder. If the review wants them in the design system, that is a
  follow-up, not a block.
- **Filter as a `DropdownMenu`** from `shared/ui` with radio items, behind a
  ghost icon button with a dot while a framework is picked, as the stand
  draws it. No new DS component.
- **The About page's details become text.** `DetailTag` keeps the level as
  `Tag` with `levelVariant`; framework and languages render as an icon and
  the title-case name in a soft box (the stand's `Boxed`), not a `Tag`. `BaseStartButton`'s labels move to
  "Start" / "Continue" / "Completed", and the e2e specs move with them.
- **The assistant and the files column follow a tutorial not yet started.**
  `entities/tutorial` gains `useTutorialBeforeStart()`: the name of the
  tutorial whose route is showing while it is not started (its workspace
  does not exist), else `null`, re-read on `PgTutorial.onDidChangeCurrent`
  and the explorer's init, switch and workspace-list events. The files column
  renders nothing while it is set, even when other projects exist, as the
  stand draws it; the assistant's head and empty state take that name only
  while no project is open, since an open project's thread and tools are
  still the ones in play (review, 2026-10-26). Once Start creates the workspace, both follow the project.
- **Telemetry**: `catalog_filtered { page, framework }` and
  `catalog_banner_opened { state }` join `catalogTelemetry`; my call,
  offered to Slava to confirm or trim.

## Risks / Trade-offs

- `getMetadata` reads one storage file per tutorial; sixteen small reads per
  page show. Read once on show, never per render; if it shows in a profile,
  read only the started ones (`isStarted` is synchronous).
- Two cards for one catalog: Programs keeps the old card until its own row
  asks otherwise; the two can drift. Accepted, the stand draws them apart.
- The voxel SVG is large (the stand's is ~780 lines of geometry). It is
  decorative and drawn once per page; it stays out of the New project dialog.
- `ui-migration`'s `client-v2-layout` delta still says every card has an
  Open action; the archive of `ui-migration` must take this change's wording
  for tutorials.
