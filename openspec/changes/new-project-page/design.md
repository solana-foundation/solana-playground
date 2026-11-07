# Design

## Context

`catalogPage` (`widgets/catalog/model/catalog-page.ts`) holds which page
covers the work, or Home, through `LayoutShell`'s `cover`. `catalogSlot`
maps a page to its bar title and content. New project's state lives in
`useNewProject`, built for a dialog: it takes `close` and closes the dialog
by id when a card's Open or Start finishes.

## Goals / Non-Goals

**Goals:** one way to show New project, the same as the other pages, from
every entry.

**Non-Goals:** any change to New project's content. History entries for
the pages came later as task 2.1, and are now foundation master's page-path
model (`views/flow/use-view-path.ts`) with `/new` added.

## Decisions

- **A third `catalogPage` value, not a new mechanism.** The shown page's
  type widens to `CatalogPage | "new-project"` (`ShownPage`). `CatalogPage`
  stays the two lists, because New project's tabs, counts and the card
  events are keyed by it.
- **`NewProjectPage` holds `useNewProject(() => catalogPage.closePage("new-project"))`, which closes the page only while it still shows.** The page is
  not under a `ModalFrame`, so the program picker's dialog stacking over it
  remounts nothing, and the hook's state can sit in the page component.
- **Home's tile opens the page through `onOpenPage`.** `PageTile` gains
  `new-project`. `BaseHome` loses `scratch` and its unfold state.
- **`/new` is an entry link like `/programs`** (`openPageFromLink`), and
  it is listed in `catalog-paths.ts`, both ways (`catalogPageOfPath`,
  `pathOfCatalogPage`), so `/new` counts as a start path and stays in the
  address while the page shows.

## Risks / Trade-offs

- e2e that scoped to the dialog by its name are rewritten to scope to the
  page's region, so they keep checking the same controls.
- The requirements this delta modifies are still in `ui-migration`'s
  delta, not in `openspec/specs/`. This change is archived after
  `ui-migration`, never before it.
