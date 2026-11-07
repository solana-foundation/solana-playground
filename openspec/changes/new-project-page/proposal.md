# Proposal

## Why

New project is the only one of the navigation's three ways in that opens a
dialog. Tutorials and Programs open as pages in the content area, and the
team agreed on the 7 Nov call that "What do you want to build?" belongs
there too. Home's New project tile adds a second, cut-down copy: it unfolds
Start from scratch under the tiles without the lists. HOO-2709.

## What Changes

- New project becomes a third catalog page beside Tutorials and Programs
  (`widgets/catalog`'s `catalogPage`), drawn under a column bar named "New
  project". Its content is the dialog's body, unchanged: the intro line,
  Start from scratch, Tutorials and Programs with counts and a search, the
  cards.
- The navigation's New project, Home's New project tile, the lesson band's
  Browse gallery and the empty editor's Start a project open the page. The navigation marks New project
  current while it shows.
- `/new` opens the page, as `/tutorials` and `/programs` open theirs: the
  page shows and the URL is replaced with `/`.
- Removed: the `NewWorkspaceModal` dialog, and Home's unfolding Start from
  scratch.
- Telemetry: `catalog_shown` takes `page` `new-project`, and `via`
  `lesson` and `editor`.
  `home_tile_opened` with `tile` `new-project` now fires when the tile opens
  the page. `new_project_started`, `new_project_start_failed` and
  `catalog_tab_switched` are kept as they are. No event is added or removed.
  The funnel's project-start step keeps `new_project_started`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `client-v2-layout`: "New project asks what to build" becomes a page.
  "The navigation opens the gallery and the pages", "Tutorials and Programs
  are pages", "The pages are measured" and "A start with no project opens on
  Home" follow it.

## Impact

- Code: `widgets/catalog` (page, slot, telemetry types), `widgets/app-nav`
  (`AppNav`), `widgets/home` (`BaseHome`, `Home`), `widgets/layout-shell` (`NoFileOpen`), `components/Editor`,
  `views/flow/Flow.tsx`,
  `routes/` (a `new` route, `catalog-paths.ts`). `views/flow/gallery/` is
  deleted.
- e2e: `new-project`, `home`, `lesson-path`, `workspace-migration` and the
  fixtures go through the page.
- Out of scope: browser Back and reload as history entries for the three
  pages (sent to Lead as its own intake). Import from URL (HOO-2608). The
  designers' Anchor version and Template controls. The intro copy's wording.
  The phone's "New Anchor project" quick start.
