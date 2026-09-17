import type { FC } from "react";
import { useEffect, useState } from "react";
import styled, { css } from "styled-components";

import Eyebrow from "./Eyebrow";
import StepRail from "../lessons/StepRail";
import { currentStep, INITIAL_LESSON_STATE, PgLesson } from "../lessons";
import Explorer from "../../sidebar/explorer/Component";
import { useCreateItem } from "../../sidebar/explorer/Component/useCreateItem";
import Chevron from "../Chevron";
import { BOTTOM_BAR_HEIGHT } from "../tokens";

type Tab = "steps" | "files";

interface LeftPanelProps {
  collapsed: boolean;
  onToggle: () => void;
  /**
   * Whether the rail's "+" is waiting for the tree to appear.
   *
   * Owned by `Flow` rather than held here, because this component does not
   * survive the toggle: the open and collapsed panels sit in different
   * branches of `Flow`'s tree -- one inside `Resizable`, one not -- so React
   * unmounts one and mounts the other. A flag kept here went with it, and the
   * rail's "+" expanded the panel and then did nothing at all.
   */
  pendingCreate?: boolean;
  /** Raise or clear `pendingCreate`. */
  onPendingCreateChange?: (pending: boolean) => void;
}

/**
 * Where you are inside the current project. Which project you are in is
 * the header switcher's job -- the rail used to answer that too, and two
 * controls for one question is what this change removed.
 */
const LeftPanel: FC<LeftPanelProps> = ({
  collapsed,
  onToggle,
  pendingCreate = false,
  onPendingCreateChange,
}) => {
  const [lesson, setLesson] = useState(INITIAL_LESSON_STATE);
  useEffect(() => PgLesson.onDidChange(setLesson).dispose, []);

  const [tab, setTab] = useState<Tab>("steps");
  // The same upstream hook `ExplorerButtons.tsx` calls for its own hidden
  // "New file" icon button (`NewItemButton` -> `useCreateItem`) -- no
  // upstream edit, no programmatic `.click()` of a hidden button.
  const { createItem } = useCreateItem();

  // `createItem` portals its input into the explorer tree, so it cannot run
  // in the rail button's own handler -- the tree is still unmounted at that
  // point. Expanding raises the flag instead and the create happens here, on
  // the commit that mounts the tree.
  useEffect(() => {
    if (collapsed || !pendingCreate) return;

    onPendingCreateChange?.(false);
    createItem();
  }, [collapsed, pendingCreate, createItem, onPendingCreateChange]);

  // Sits in the tab row when open and at the top of the rail when collapsed,
  // so it lines up with the tab labels instead of floating above them.
  const toggle = (
    <Collapse
      type="button"
      $collapsed={collapsed}
      aria-expanded={!collapsed}
      aria-label={collapsed ? "Expand project panel" : "Collapse project panel"}
      onClick={onToggle}
    >
      {/* Collapsed, this hint is the only thing telling you how to get the
          panel back, so the rail stacks it under the chevron rather than
          dropping it. */}
      {collapsed && <Chevron $flip={false} />}
      <Hint>&#8984;B</Hint>
      {!collapsed && <Chevron $flip />}
    </Collapse>
  );

  const inLesson = !!lesson.path;
  const showSteps = inLesson && tab === "steps";
  const activeStep = lesson.path
    ? currentStep(lesson.path, lesson.progress)
    : null;

  return (
    <Wrapper>
      {collapsed && toggle}
      {collapsed && !showSteps && (
        <RailAction
          type="button"
          onClick={() => {
            onPendingCreateChange?.(true);
            onToggle();
          }}
          aria-label="New file"
          title="New file"
        >
          +
        </RailAction>
      )}
      {!collapsed && (
        <>
          {/* Rendered outside a lesson too, where it carries no tabs: the row
              is the toggle's only home when the panel is open. */}
          <Tabs role={inLesson ? "tablist" : undefined}>
            {inLesson &&
              (["steps", "files"] as const).map((t) => (
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
            {toggle}
          </Tabs>
          <Body
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
          {showSteps && activeStep && (
            <SkipFooter
              type="button"
              title={`Nothing has proved this step yet — ${activeStep.verifiedBy}. Moving on now is recorded as a skip, and clears itself if you come back and prove it.`}
              onClick={() => PgLesson.skipStep()}
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
      )}
    </Wrapper>
  );
};

export default LeftPanel;

// A floating panel like Center and Right: full 1px border, rounded corners,
// the raised surface background instead of the black page ground.
// Width comes from `Columns` in `Flow.tsx` (14.5rem open, 1.5rem collapsed)
// so the grid and the panel can never disagree about the column size.
const Wrapper = styled.aside`
  ${({ theme }) => css`
    width: 100%;
    // Explicit rather than inherited: as a grid item this stretched on its
    // own, but the resize wrapper it now sits inside is a plain block, so
    // without this the panel ends at its content and stops short of the
    // editor beside it
    height: 100%;
    display: flex;
    flex-direction: column;
    border: 1px solid ${theme.colors.default.border};
    border-radius: ${theme.default.borderRadius};
    background: ${theme.colors.default.bgSecondary};
    overflow: hidden;
  `}
`;

// A flex child either way -- last in the tab row when open, top of the rail
// when collapsed -- so `align-items: center` lines it up with the tab labels
// rather than the panel's top edge.
const Collapse = styled.button<{ $collapsed: boolean }>`
  ${({ theme, $collapsed }) => css`
    flex-shrink: 0;
    width: ${$collapsed ? "100%" : "auto"};
    padding: ${$collapsed ? "0.375rem 0" : "0 0.5rem"};
    display: flex;
    flex-direction: ${$collapsed ? "column" : "row"};
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    /* The rail has 1.5rem of width to spend, so "⌘B" only fits below the
       chevron and only at a smaller size than the expanded panel uses. */
    font-size: ${$collapsed ? "0.5625rem" : theme.font.code.size.small};
    border: none;
    background: transparent;
    color: ${theme.colors.default.textSecondary};
    cursor: pointer;
    z-index: 1;

    &:focus-visible {
      outline: 2px solid ${theme.colors.default.primary};
      outline-offset: 2px;
    }
  `}
`;

// The console handle's `⌘J` hint (`console/ConsoleDrawer.tsx`), same
// treatment so both shortcuts read as one family.
const Hint = styled.span`
  ${({ theme }) => css`
    font-family: ${theme.font.code.family};
    font-size: inherit;
    line-height: 1;
    opacity: 0.6;
  `}
`;

// The collapsed stand-in for `Footer`: same bottom edge, same divider, so
// the action does not move when the panel opens.
const RailAction = styled.button`
  ${({ theme }) => css`
    margin-top: auto;
    flex-shrink: 0;
    width: 100%;
    height: ${BOTTOM_BAR_HEIGHT};
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-top: 1px solid ${theme.colors.default.border};
    background: transparent;
    color: ${theme.colors.default.textSecondary};
    font: inherit;
    font-size: 1.125rem;
    line-height: 1;
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
 * per-section action buttons or labels): the Flow header's stepper already
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
