import type { FC } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import styled, { css } from "styled-components";

import Eyebrow from "./Eyebrow";
import StepRail from "../lessons/StepRail";
import { cursorStep, foldRecord, PgLesson } from "../lessons";
import Explorer from "../../sidebar/explorer/Component";
import { useCreateItem } from "../../sidebar/explorer/Component/useCreateItem";
import { BOTTOM_BAR_HEIGHT } from "../tokens";
import { keepColumn, keptColumn, type Tab } from "./kept-column";
import { PgExplorer } from "../../../utils";

interface LeftPanelProps {
  /**
   * Hidden by the stage bar's toggle or ⌘E: the column takes no width
   * (design.md, "Frame chrome (5.25)"), so it draws nothing
   */
  collapsed: boolean;
}

/**
 * Where you are inside the current project. Which project you are in is
 * the navigation's project list's job, and the stage bar's while the
 * assistant, whose head names it, is out of view; this column does not name
 * it too, since two controls for one question would disagree.
 */
const LeftPanel: FC<React.PropsWithChildren<LeftPanelProps>> = ({
  collapsed,
}) => {
  // From the first commit, not from the subscription's first call: a commit
  // without the lesson draws the tree, and the scroll put back below would
  // land on it rather than on the step rail
  const [lesson, setLesson] = useState(() => PgLesson.state);
  useEffect(() => PgLesson.onDidChange(setLesson).dispose, []);

  const [tab, setTab] = useState<Tab>(
    () => keptColumn(PgExplorer.currentWorkspaceId)?.tab ?? "steps"
  );

  // Hidden, the column unmounts (design.md, "Frame chrome (5.25)"), so its
  // tab and scroll are kept for the next mount (`kept-column.ts`). Both are
  // tracked as they change, for a body already out of the document, where
  // its scroll reads 0.
  const kept = useRef({ tab, scrollTop: 0 });
  useLayoutEffect(() => {
    kept.current.tab = tab;
  }, [tab]);
  const bodyRef = useRef<HTMLDivElement>(null);
  // A layout effect: the tree, a child, has reopened its folders by now
  // (`useHandleItemState`), so the scroll lands where it was rather than on
  // a shut tree too short for it
  useLayoutEffect(() => {
    // The one object `onScroll` and the tab effect write to
    const memory = kept.current;
    const body = bodyRef.current;
    const restored = keptColumn(PgExplorer.currentWorkspaceId);
    if (body && restored) {
      body.scrollTop = restored.scrollTop;
      memory.scrollTop = body.scrollTop;
    }
    return () => {
      // Read now, not at mount: a lesson mounts the column before the
      // explorer has opened its project
      const workspace = PgExplorer.currentWorkspaceId;
      if (!workspace) return;
      // Read from the body while it is still in the document: `scroll`
      // arrives a frame late, so ⌘E right after a scroll would otherwise
      // keep the scroll before it
      const scrollTop = body?.isConnected ? body.scrollTop : memory.scrollTop;
      keepColumn({ workspace, tab: memory.tab, scrollTop });
    };
    // Defensive: the frame unmounts a hidden column rather than passing
    // `collapsed`, but a `collapsed` column draws no body either
  }, [collapsed]);
  // The same upstream hook `ExplorerButtons.tsx` calls for its own hidden
  // "New file" icon button (`NewItemButton` -> `useCreateItem`) -- no
  // upstream edit, no programmatic `.click()` of a hidden button.
  const { createItem } = useCreateItem();

  const inLesson = !!lesson.path;
  const showSteps = inLesson && tab === "steps";
  // The pass edge exists only at the frontier, so the valve is only
  // offered there -- a step the learner walked back onto has no edge
  // for the click to travel, and the control is absent rather than inert
  const frontierStep =
    lesson.path && PgLesson.canPass()
      ? cursorStep(lesson.path, foldRecord(lesson.path, lesson.record))
      : null;

  // Hidden, the column takes no width: no landmark either, since an empty,
  // unnamed <aside> is still listed by a screen reader
  if (collapsed) return null;

  return (
    <Wrapper>
      <>
        {inLesson && (
          <Tabs role="tablist">
            {(["steps", "files"] as const).map((t) => (
              <TabButton
                key={t}
                id={`flow-left-tab-${t}`}
                role="tab"
                aria-selected={tab === t}
                aria-controls="flow-left-tabpanel"
                $active={tab === t}
                onClick={() => setTab(t)}
              >
                {t === "steps" ? "Steps" : "Files"}
              </TabButton>
            ))}
          </Tabs>
        )}
        <Body
          ref={bodyRef}
          onScroll={(e) => {
            kept.current.scrollTop = e.currentTarget.scrollTop;
          }}
          id="flow-left-tabpanel"
          role={inLesson ? "tabpanel" : undefined}
          aria-labelledby={inLesson ? `flow-left-tab-${tab}` : undefined}
        >
          {showSteps ? (
            <StepRail state={lesson} />
          ) : (
            <>
              {!inLesson && <Eyebrow>Files</Eyebrow>}
              <ExplorerContainer>
                <Explorer />
              </ExplorerContainer>
            </>
          )}
        </Body>
        {/* Pinned below the rail for the same reason as the files footer:
              a way out that scrolls away is not a way out. */}
        {showSteps && frontierStep && (
          <SkipFooter
            type="button"
            title={`Nothing has proved this step yet — ${frontierStep.verifiedBy}. Moving on now is recorded as a skip, and clears itself if you come back and prove it.`}
            onClick={() => PgLesson.pass()}
          >
            Skip this step
          </SkipFooter>
        )}
        {!showSteps && (
          <Footer type="button" onClick={createItem}>
            + New file
          </Footer>
        )}
      </>
    </Wrapper>
  );
};

export default LeftPanel;

// A column of the flush frame like Center and Right (design.md, "Frame
// chrome (5.25)"): no card edges, the page's background.
// Width comes from the layout shell (`PANEL_SIZES.files`, or the navigation's
// Sheet below `LAYOUT_BREAKPOINTS.left`), so the panel fills whatever it is
// given.
const Wrapper = styled.aside`
  ${({ theme }) => css`
    width: 100%;
    // Explicit rather than inherited: as a grid item this stretched on its
    // own, but the resize wrapper it sits inside is a plain block, so
    // without this the panel ends at its content and stops short of the
    // editor beside it
    height: 100%;
    display: flex;
    flex-direction: column;
    background: ${theme.colors.default.bgPrimary};
    overflow: hidden;
  `}
`;

const Tabs = styled.div`
  ${({ theme }) => css`
    display: flex;
    align-items: stretch;
    border-bottom: 1px solid ${theme.colors.default.border};
  `}
`;

const TabButton = styled.button<{ $active: boolean }>`
  ${({ theme, $active }) => css`
    flex: 1;
    padding: 0.625rem;
    border: none;
    border-bottom: 2px solid
      ${$active ? theme.colors.default.primary : "transparent"};
    background: transparent;
    color: ${$active
      ? theme.colors.default.textPrimary
      : theme.colors.default.textSecondary};
    font: inherit;
    font-size: ${theme.font.other.size.small};
    letter-spacing: 0.04em;
    text-transform: uppercase;
    cursor: pointer;
    &:focus-visible {
      outline: 2px solid ${theme.colors.default.primary};
      outline-offset: -2px;
    }
  `}
`;

const Body = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  // File names are never shortened, so a name wider than the panel scrolls
  // here rather than being clipped
  overflow-x: auto;
`;

// Quiet, full-width footer button pinned below the scrollable tree (a
// sibling of `Body`, not inside it, so it never scrolls away). Reuses
// `createItem` from `useCreateItem` -- the exact upstream create-item flow,
// not a re-implementation.
const Footer = styled.button`
  ${({ theme }) => css`
    flex-shrink: 0;
    width: 100%;
    height: ${BOTTOM_BAR_HEIGHT};
    padding: 0 0.75rem;
    display: flex;
    align-items: center;
    border: none;
    border-top: 1px solid ${theme.colors.default.border};
    background: transparent;
    color: ${theme.colors.default.textSecondary};
    font: inherit;
    text-align: left;
    cursor: pointer;
    &:hover {
      color: ${theme.colors.default.textPrimary};
      background: ${theme.colors.default.bgPrimary};
    }
    &:focus-visible {
      outline: 2px solid ${theme.colors.default.primary};
      outline-offset: -2px;
    }
  `}
`;

// The files footer's shape, dimmed further: skipping is the way out of a
// step, never the way through it
const SkipFooter = styled(Footer)`
  ${({ theme }) => css`
    justify-content: center;
    font-size: ${theme.font.other.size.small};
    text-decoration: underline;
  `}
`;

/**
 * Quiets the upstream explorer down to the bare tree the board shows
 * (`src`, `client`, `tests` -- no workspace picker, no icon toolbar, no
 * per-section action buttons or labels): the stage bar's stepper already
 * owns Build/Deploy/Run/Test, and the footer `Footer` button above already
 * owns "new file".
 *
 * Every rule here is structural (`nth-child`), anchored either on
 * `#root-dir` (`PgView.ids.ROOT_DIR`, a stable id upstream itself relies
 * on) or on this wrapper's own DOM position, because none of the elements
 * being hidden carry a stable `id`/`class` of their own -- their generated
 * styled-components class names are build-dependent, and
 * `SectionHeader`/`SectionButton` carry no `title`/`aria-label` that would
 * differ between "Build" and "Deploy" etc. Verified against the live DOM
 * (not just the source) via the running dev server.
 */
const ExplorerContainer = styled.div`
  /* Workspaces row (project select + "Projects" label) and the icon
   * toolbar (new file/folder, collapse, share, ...) are the 1st and 2nd
   * children of Explorer's own root <div> -- true whether Explorer renders
   * its normal tree or the "temporary project" warning in Workspaces's
   * place (both are a single root <div>, so the position holds either
   * way). Anchor: positional, scoped under this wrapper's single child
   * (Explorer's own root). Failure mode: if the current project has *no*
   * workspaces at all, Explorer renders a single-branch "create a
   * project" empty state instead (a different component, not Workspaces +
   * Folders) -- its own first two children (an intro line and a "Create a
   * new project" button) would be hidden by the same rule. Flow only
   * mounts once a project is open, so this state should not occur in
   * practice, but it is a real gap if it ever does.
   */
  & > div > div:nth-child(1),
  & > div > div:nth-child(2) {
    display: none;
  }

  /* Program section (#root-dir's own first child): hides the "Program"
   * label and the Build/Deploy buttons, keeps a lone "+" (add-program,
   * shown only when the project has no \`src\` yet -- \`addProgram\`
   * scaffolds a real \`lib.rs\`, which the footer's plain \`createItem\`
   * does not, so it stays reachable). \`nth-child(2):nth-last-child(2)\`
   * only matches the first of *two* button siblings (Build);
   * \`nth-child(3)\` only exists when there is a second (Deploy); the lone
   * "+" is \`nth-child(2)\` with no \`nth-child(3)\`, so neither matches it.
   * Anchor: \`#root-dir\` (stable). Safe guard: \`:has(> button)\` ensures
   * the selector only matches a section header row (which contains direct
   * \`<button>\` children), never a folder/file row (no direct \`<button>\`
   * children). Failure mode: none -- always safe.
   */
  #root-dir > div:has(> button):first-child > div:first-child,
  #root-dir
    > div:has(> button):first-child
    > button:nth-child(2):nth-last-child(2),
  #root-dir > div:has(> button):first-child > button:nth-child(3) {
    display: none;
  }

  /* Client section ("Client" label + Run/Test, or their "Add client"/"Add
   * tests" fallbacks): always exactly 2 buttons, so no lone-button case to
   * preserve. Safe guard: \`:has(> button)\` ensures the selector only
   * matches a section header row (which contains direct \`<button>\`
   * children), never a folder/file row (no direct \`<button>\` children).
   * Position: normally \`#root-dir > div:nth-child(3)\` when the Program
   * row's own FolderGroup (the \`src\` tree) renders; shifts to
   * \`nth-child(2)\` when no \`src\` exists. When \`src\` is absent, the
   * Run/Test buttons (the "Add client"/"Add tests" fallbacks) simply stay
   * VISIBLE, which is acceptable degradation -- the empty-state fallbacks
   * are worth reaching. Folder rows are never matched because they contain
   * no direct \`<button>\` children.
   */
  #root-dir > div:has(> button):nth-child(3) > div:first-child,
  #root-dir > div:has(> button):nth-child(3) > button:nth-child(2),
  #root-dir > div:has(> button):nth-child(3) > button:nth-child(3) {
    display: none;
  }
`;
