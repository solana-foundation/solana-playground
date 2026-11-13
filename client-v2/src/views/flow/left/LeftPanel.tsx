import type { FC } from "react";
import { useLayoutEffect, useRef } from "react";

import { cn } from "@/shared/lib/utils";

import { PgExplorer } from "../../../utils";
import Explorer from "../../sidebar/explorer/Component";
import { keepColumn, keptColumn } from "./kept-column";

interface LeftPanelProps {
  /**
   * Hidden by the editor head's Files or ⌘E: the column takes no width
   * (design.md, "Frame chrome (5.25)"), so it draws nothing
   */
  collapsed: boolean;
  /** The phone's Files sheet, which keeps no scroll for the wide column */
  sheet?: boolean;
  /**
   * Whether the project has a program (`FlowState.hasProgram`): without one,
   * the sheet keeps the tree's own actions (`SHEET_SECTIONS`)
   */
  hasProgram: boolean;
}

/**
 * Where you are inside the current project. Which project you are in is
 * the navigation's project list's job, and the editor head's while the
 * assistant, whose head names it, is out of view; this column does not name
 * it too, since two controls for one question would disagree.
 */
const LeftPanel: FC<React.PropsWithChildren<LeftPanelProps>> = ({
  collapsed,
  sheet = false,
  hasProgram,
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
        <div
          className={cn(
            EXPLORER_CONTAINER,
            sheet && !hasProgram ? SHEET_SECTIONS : WIDE_SECTIONS
          )}
        >
          <Explorer />
        </div>
      </div>
    </aside>
  );
};

export default LeftPanel;

/**
 * Quiets the upstream explorer down to the bare tree the board shows
 * (`src`, `client`, `tests` -- no workspace picker, no icon toolbar, no
 * per-section action buttons or labels): the stage bar already owns
 * Build/Deploy/Run/Test and adding a program, and the editor head's +
 * already owns "new file".
 *
 * Every rule here is structural (`nth-child`), anchored either on
 * `#root-dir` (`PgView.ids.ROOT_DIR`, a stable id upstream itself relies
 * on) or on this wrapper's own DOM position, because none of the elements
 * being hidden carry a stable `id`/`class` of their own -- their generated
 * class names are build-dependent, and
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
  // children of Explorer's own root <div> -- true whether Explorer renders
  // its normal tree or the "temporary project" warning in Workspaces's
  // place (both are a single root <div>, so the position holds either
  // way). Anchor: positional, scoped under this wrapper's single child
  // (Explorer's own root). Failure mode: if the current project has *no*
  // workspaces at all, Explorer renders a single-branch "create a
  // project" empty state instead (a different component, not Workspaces +
  // Folders) -- its own first two children (an intro line and a "Create a
  // new project" button) would be hidden by the same rule. Flow only
  // mounts once a project is open, so this state should not occur in
  // practice, but it is a real gap if it ever does.
  "[&>div>div:nth-child(1)]:hidden!",
  "[&>div>div:nth-child(2)]:hidden!",
  // A section top that stays takes no margin: the tree reads as one list,
  // so its label sits right under the row above it.
  "[&_#root-dir>div[data-section]]:my-0!"
);

/**
 * The wide column drops the Program and Client section rows whole ("Program"
 * + Build/Deploy or the add-program "+", "Client" + Run/Test or their "Add
 * client"/"Add tests" fallbacks): the stage bar owns those actions, in a
 * project with no program too (`StageBar`'s Add program, Test and Run).
 * `:has(> button)` matches only a section row with actions, so "Other",
 * which has none, keeps its label; folder and file rows carry no
 * `data-section`.
 */
const WIDE_SECTIONS = "[&_#root-dir>div[data-section]:has(>button)]:hidden!";

/**
 * The phone's bar carries only a project with no program's Run, so its sheet
 * keeps the tree's Client row (Run, Test) and the add-program "+". Only the
 * Program row's Build and Deploy go, which an empty `src` folder still draws:
 * a third child the add-program row never has.
 */
const SHEET_SECTIONS =
  "[&_#root-dir>div[data-section]:first-child:has(>button:nth-child(3))]:hidden!";
