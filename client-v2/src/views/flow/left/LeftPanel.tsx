import type { FC } from "react";
import { useLayoutEffect, useRef } from "react";

import { cn } from "@/shared/lib/utils";

import { PgExplorer } from "../../../utils";
import Explorer from "../../sidebar/explorer/Component";
import { useCreateItem } from "../../sidebar/explorer/Component/useCreateItem";
import { BOTTOM_BAR_HEIGHT } from "../tokens";
import { keepColumn, keptColumn } from "./kept-column";

interface LeftPanelProps {
  /**
   * Defensive: the layout draws the tree only where it shows (the docked
   * column, or the dropdown under the editor head), so this is false there;
   * a collapsed panel draws nothing
   */
  collapsed: boolean;
  /** The phone's Files sheet, which keeps no scroll for the wide column */
  sheet?: boolean;
}

/**
 * Where you are inside the current project. Which project you are in is
 * the navigation's project list's job, and the stage bar's while the
 * assistant, whose head names it, is out of view; this column does not name
 * it too, since two controls for one question would disagree.
 */
const LeftPanel: FC<React.PropsWithChildren<LeftPanelProps>> = ({
  collapsed,
  sheet = false,
}) => {
  // Hidden, the column unmounts (design.md, "Frame chrome (5.25)"), so its
  // scroll is kept for the next mount (`kept-column.ts`). It is tracked as it
  // changes, for a body already out of the document, where it reads 0.
  const kept = useRef({ scrollTop: 0 });
  // The phone's sheet keeps nothing: it is mounted fresh each time, and its
  // scroll must not become the wide column's
  const told = useRef(sheet);
  const bodyRef = useRef<HTMLDivElement>(null);
  // A layout effect: the tree, a child, has reopened its folders by now
  // (`useHandleItemState`), so the scroll lands where it was rather than on
  // a shut tree too short for it
  useLayoutEffect(() => {
    // The one object `onScroll` writes to
    const memory = kept.current;
    const keeps = !told.current;
    const body = bodyRef.current;
    const restored = keptColumn(PgExplorer.currentWorkspaceId);
    if (body && restored) {
      body.scrollTop = restored.scrollTop;
      memory.scrollTop = body.scrollTop;
    }
    return () => {
      // Read now, not at mount: the column can mount before the explorer
      // has opened its project
      const workspace = PgExplorer.currentWorkspaceId;
      if (!workspace || !keeps) return;
      // Read from the body while it is still in the document: `scroll`
      // arrives a frame late, so ⌘E right after a scroll would otherwise
      // keep the scroll before it
      const scrollTop = body?.isConnected ? body.scrollTop : memory.scrollTop;
      keepColumn({ workspace, scrollTop });
    };
    // Defensive: the frame unmounts a hidden column rather than passing
    // `collapsed`, but a `collapsed` column draws no body either
  }, [collapsed]);
  // The same upstream hook `ExplorerButtons.tsx` calls for its own hidden
  // "New file" icon button (`NewItemButton` -> `useCreateItem`) -- no
  // upstream edit, no programmatic `.click()` of a hidden button.
  const { createItem } = useCreateItem();

  // Hidden, the column takes no width: no landmark either, since an empty,
  // unnamed <aside> is still listed by a screen reader
  if (collapsed) return null;

  return (
    // A column of the flush frame like Center and Right (design.md, "Frame
    // chrome (5.25)"): no card edges, the page's background. Width comes from
    // the layout shell (`PANEL_SIZES.files`, or the phone's Files Sheet), so
    // the panel fills whatever it is given. `h-full` is explicit: the resize
    // wrapper it sits inside is a plain block, so without it the panel ends at
    // its content and stops short of the editor beside it
    <aside className="flex h-full w-full flex-col overflow-hidden bg-surface-base">
      {/* The tree starts at the column's top: the editor head over it names
          the column with its Files toggle (DES-205) */}
      <div
        ref={bodyRef}
        // File names are never shortened, so a name wider than the panel
        // scrolls here rather than being clipped
        className="min-h-0 flex-1 overflow-auto"
        onScroll={(e) => {
          kept.current.scrollTop = e.currentTarget.scrollTop;
        }}
        id="flow-left-tabpanel"
      >
        <div className={EXPLORER_CONTAINER}>
          <Explorer />
        </div>
      </div>
      {/* Quiet, full-width footer button pinned below the scrollable tree (a
          sibling of the body, not inside it, so it never scrolls away).
          Reuses `createItem` from `useCreateItem` -- the exact upstream
          create-item flow, not a re-implementation. */}
      <button
        type="button"
        className="flex w-full shrink-0 cursor-pointer items-center border-t border-border bg-transparent px-3 text-left font-[inherit] text-[var(--text-secondary)] hover:bg-surface-base hover:text-[var(--text-primary)] focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-primary"
        style={{ height: BOTTOM_BAR_HEIGHT }}
        onClick={createItem}
      >
        + New file
      </button>
    </aside>
  );
};

export default LeftPanel;

/**
 * Quiets the upstream explorer down to the bare tree the board shows
 * (`src`, `client`, `tests` -- no workspace picker, no icon toolbar, no
 * per-section action buttons or labels): the stage bar's stepper already
 * owns Build/Deploy/Run/Test, and the footer button above already
 * owns "new file". A temporary project keeps one more row above the tree:
 * Workspaces's warning, whose Import is the only way to keep the project.
 *
 * Every rule here is structural (`nth-child`), anchored either on
 * `#root-dir` (`PgView.ids.ROOT_DIR`, a stable id upstream itself relies
 * on) or on this wrapper's own DOM position. Two attribute selectors are
 * the exceptions: `[data-temporary-warning]` exempts that warning from the
 * hiding, and `[data-section]` reaches each section to zero its margins.
 * None of the elements being hidden carry a stable `id`/`class`
 * of their own -- their generated class names are build-dependent, and
 * `SectionHeader`/`SectionButton` carry no `title`/`aria-label` that would
 * differ between "Build" and "Deploy" etc. Verified against the live DOM
 * (not just the source) via the running dev server.
 *
 * Each rule is an arbitrary variant with `!`: the explorer's own elements
 * set their `display` with utilities of the same layer, and which of two
 * utilities wins then depends on their order in the built sheet.
 */
const EXPLORER_CONTAINER = cn(
  // Workspaces row (project select + "Projects" label) and the icon
  // toolbar (new file/folder, collapse, share, ...) are the 1st and 2nd
  // children of Explorer's own root <div>. Anchor: positional, scoped
  // under this wrapper's single child (Explorer's own root). Failure
  // mode: if the current project has *no* workspaces at all, Explorer
  // renders a single-branch "create a project" empty state instead (a
  // different component, not Workspaces + Folders) -- its own first two
  // children (an intro line and a "Create a new project" button) would be
  // hidden by the same rule. Flow only mounts once a project is open, so
  // this state should not occur in practice, but it is a real gap if it
  // ever does.
  //
  // In a temporary project Workspaces renders its warning in the 1st place
  // instead, and that stays: its Import is the only way to keep the
  // project, so the rule skips `[data-temporary-warning]`, which the
  // warning's root carries.
  "[&>div>div:nth-child(1):not([data-temporary-warning])]:hidden!",
  "[&>div>div:nth-child(2)]:hidden!",
  // Program section (#root-dir's own first child): hides the "Program"
  // label and the Build/Deploy buttons, keeps a lone "+" (add-program,
  // shown only when the project has no `src` yet -- `addProgram`
  // scaffolds a real `lib.rs`, which the footer's plain `createItem`
  // does not, so it stays reachable). `nth-child(2):nth-last-child(2)`
  // only matches the first of *two* button siblings (Build);
  // `nth-child(3)` only exists when there is a second (Deploy); the lone
  // "+" is `nth-child(2)` with no `nth-child(3)`, so neither matches it.
  // Anchor: `#root-dir` (stable). Safe guard: `:has(> button)` ensures
  // the selector only matches a section header row (which contains direct
  // `<button>` children), never a folder/file row (no direct `<button>`
  // children). Failure mode: none -- always safe.
  "[&_#root-dir>div:has(>button):first-child>div:first-child]:hidden!",
  "[&_#root-dir>div:has(>button):first-child>button:nth-child(2):nth-last-child(2)]:hidden!",
  "[&_#root-dir>div:has(>button):first-child>button:nth-child(3)]:hidden!",
  // Client section ("Client" label + Run/Test, or their "Add client"/"Add
  // tests" fallbacks): always exactly 2 buttons, so no lone-button case to
  // preserve. Safe guard: `:has(> button)` ensures the selector only
  // matches a section header row (which contains direct `<button>`
  // children), never a folder/file row (no direct `<button>` children).
  // Position: normally `#root-dir > div:nth-child(3)` when the Program
  // row's own FolderGroup (the `src` tree) renders; shifts to
  // `nth-child(2)` when no `src` exists. When `src` is absent, the
  // Run/Test buttons (the "Add client"/"Add tests" fallbacks) simply stay
  // VISIBLE, which is acceptable degradation -- the empty-state fallbacks
  // are worth reaching. Folder rows are never matched because they contain
  // no direct `<button>` children.
  "[&_#root-dir>div:has(>button):nth-child(3)>div:first-child]:hidden!",
  "[&_#root-dir>div:has(>button):nth-child(3)>button:nth-child(2)]:hidden!",
  "[&_#root-dir>div:has(>button):nth-child(3)>button:nth-child(3)]:hidden!",
  // With their labels and buttons hidden, the section tops above are only
  // their margins: 16 over Client and 4 under each, a blank 20 px between
  // `src` and `client` and none between `client` and `tests`. The tree reads
  // as one list, so they take none. The rule reaches every section, so a
  // label that stays visible ("Other", or Client before `src` exists) sits
  // right under the row above it.
  "[&_#root-dir>div[data-section]]:my-0!"
);
