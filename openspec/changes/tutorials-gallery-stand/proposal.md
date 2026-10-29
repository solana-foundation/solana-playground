# Proposal

## Why

The Tutorials page and a tutorial's About page do not look like the design
the team settled on. For these two screens the target is Almaz's
tutorial-in-product stand (branch `almaz/tutorial-in-product`, 23388bd07),
not the DS prototype. The HOO-2236 audit lists the gaps as rows R53, R54,
R55, R73 and R74; a re-measure on `new-face-polish-2` (8ef138dae) found all
five still open. HOO-2254, polish stage two, stream E1.

## What Changes

- **Tutorials page (R73).** The page gets a "Tutorials" heading with the
  search field ("Search 16 tutorials") and a framework filter beside it. While
  nothing is searched or filtered, a "Start here" banner for Hello Anchor
  leads the page, with the stand's voxel mark. Below it the tutorials stand in
  groups by level (Beginner, Intermediate, Advanced), each with its count and,
  past four cards, Show all / Show less. A search or a filter shows a results
  line and every match, still grouped.
- **The banner has three states**, read from the tutorial's own metadata
  (`PgTutorial.getMetadata`: `pageNumber`, `completed`): fresh ("Start here",
  Start), started ("Pick up where you left off", page N of M, Continue), and
  finished, which hands the banner to the next tutorial (Counter PDA: "Up
  next", Start; or Continue where it was left). Slava, 2026-10-26.
- **New tutorial cards.** A cover in the brand (one of the brand grounds by
  framework, the white mark on it) replaces upstream's thumbnail; the line
  under the description is "Anchor · by acheron" inside a level group and
  "Beginner · Anchor" elsewhere; the action is a square ↗ in the corner, the
  whole card its target; a started tutorial shows "N of M" beside its name and
  a finished one a green tick in the corner. On a phone the whole card is the
  target and ends in a chevron, as now. **The New project dialog's Tutorials
  list uses the same cards** (Slava, 2026-10-26). Program cards do not change.
- **Tutorial About page.** The assistant names the open tutorial: its head
  reads the tutorial's name and its empty state "Ask about <tutorial>" (R53).
  The files column is empty while the About page shows, with no "Create a new
  project" (R54). The action reads "Start", "Continue" or "Completed" in title
  case, beside the title; on a phone it stays pinned full width at the foot
  (R55). Level is a green tag ("BEGINNER"); Framework and Languages are an icon
  and title-case text with no chip (R74).
- **Telemetry** (widgets/catalog): two events added, none renamed or removed.
  `catalog_filtered` when the framework filter changes, and
  `catalog_banner_opened` when the banner's action opens a tutorial, with the
  banner's state. The existing `catalog_item_opened` and
  `catalog_open_failed` cover the cards as before.

## Capabilities

### New Capabilities

- `client-v2-tutorials`: how the Tutorials page lists tutorials (heading,
  search, framework filter, Start here banner, level groups, the tutorial
  card shared with New project) and how a tutorial's About page presents it
  (action, details, the assistant and files column beside it).

### Modified Capabilities

None in `openspec/specs/`. The Tutorials page is otherwise described only
by the unarchived `ui-migration` delta (`client-v2-layout`, "Tutorials and
Programs are pages": "a grid of cards ... each with an Open action"). For
tutorials this change supersedes that sentence; `ui-migration` is not edited
here (one task line per ticket), and reconciling the two is noted for
whoever archives it.

## Impact

- Code: `client-v2/src/widgets/catalog` (Tutorials page, New project's
  Tutorials list, the card, the banner, the filter, telemetry),
  `client-v2/src/entities/tutorial` (start button, detail tags),
  `client-v2/src/components/Tutorial` (About page, details),
  `client-v2/src/widgets/assistant` (head title and empty state while a
  tutorial's About page shows), `client-v2/src/views/sidebar/explorer`
  (files column on the About page). The brand cover and the voxel mark come
  from the stand; a DS-level piece lands in `design-system/` first and is
  installed with `yarn ds-add`.
- e2e: the specs that find the About page's button as `START` by exact name
  (`catalog`, `home`, `account-sync`, `workspace-migration`, `project-list`,
  `client-v2-layout`, `no-document-scroll`) move to "Start" in the same PR.
- Out of scope: the lesson inside a tutorial (R56–R62, HOO-2262, stream E2,
  which stays on Nikita's prototype); the Programs page and its cards; Home;
  the phone's default Chat/Code view on a tutorial route; lesson-level
  progress (steps proved), which the stand reads from its lesson system and
  which we take from the tutorial's page metadata instead.
