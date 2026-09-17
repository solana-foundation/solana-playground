import { useEffect, useRef, useState } from "react";
import styled, { css } from "styled-components";

import Chevron from "./Chevron";
import ConsoleDrawer from "./console/ConsoleDrawer";
import NewWorkspaceModal from "./gallery/NewWorkspaceModal";
import Header from "./header/Header";
import LeftPanel from "./left/LeftPanel";
import {
  clampLeftWidth,
  DEFAULT_LEFT_WIDTH,
  MIN_LEFT_WIDTH,
} from "./left/width";
import Resizable from "../../components/Resizable";
import ObjectiveBand from "./lessons/ObjectiveBand";
import Reader from "./lessons/Reader";
import { currentStep } from "./lessons/progress";
// The barrel registers every lesson path as a side effect, so importing
// it here is also what populates the registry for the whole app.
import { INITIAL_LESSON_STATE, PgLesson } from "./lessons";
import type { LessonState } from "./lessons";
import GearSidebar from "./settings/GearSidebar";
import type { SettingsFocus } from "./settings/GearSidebar";
import StageRouter from "./stages/StageRouter";
import { PgDeployHistory } from "./state/deploy-history";
import { INITIAL_FLOW_STATE, PgFlow } from "./state/stage";
import type { FlowState } from "./state/stage";
import { GAP } from "./tokens";
import Assistant from "../sidebar/assistant/Component";
import { PgAssistant } from "../sidebar/assistant/store";
import ModalBackdrop from "../../components/ModalBackdrop";
import Toast from "../../components/Toast";
import Wallet from "../../components/Wallet";
import { useKeybind } from "../../hooks";
import { PgExplorer, PgView } from "../../utils";
import type { Disposable } from "../../utils/types";

/**
 * The Flow layout: header, left project/file tabs, the stage router in the
 * center with a collapsible console beneath it, and the assistant on the
 * right. Replaces the classic `Panels` layout unless `?classic` is present.
 */
const Flow = () => {
  const [state, setState] = useState<FlowState>(INITIAL_FLOW_STATE);
  const [leftOpen, setLeftOpen] = useState(true);
  const [lesson, setLesson] = useState<LessonState>(INITIAL_LESSON_STATE);
  const [reading, setReading] = useState(false);
  // Session-only, like `leftOpen` and `assistantOpen` above.
  // TODO: persist to `localStorage` so a width dragged to read a long path
  // survives a reload.
  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT_WIDTH);
  const [assistantOpen, setAssistantOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Lives here, not in `LeftPanel`: the open and collapsed panels are separate
  // branches of the tree below, so toggling unmounts one and mounts the other
  // and anything `LeftPanel` held goes with it.
  const [pendingCreate, setPendingCreate] = useState(false);
  const [settingsFocus, setSettingsFocus] = useState<SettingsFocus>("panel");

  useKeybind("Ctrl+B", () => setLeftOpen((o) => !o));

  useEffect(() => {
    const subs = [
      PgFlow.init(),
      PgLesson.init(),
      PgDeployHistory.init(),
      PgFlow.onDidChange(setState),
      PgLesson.onDidChange(setLesson),
      // So a "Fix with assistant" click while collapsed reopens the panel
      // and the user sees where the click went.
      PgAssistant.onDidRequestPrompt(() => setAssistantOpen(true)),
    ];
    return () => subs.forEach((s) => s.dispose());
  }, []);

  // Takes over the browser's reload shortcut, same as Ctrl+J does for the
  // console drawer
  useKeybind("Ctrl+R", () => setAssistantOpen((o) => !o));

  const openGallery = () => PgView.setModal(NewWorkspaceModal);
  // Toggles rather than opens: the header controls are the only way in, so a
  // second click on one has to be the way out.
  const toggleSettings = (focus: SettingsFocus = "panel") => {
    setSettingsFocus(focus);
    setSettingsOpen((open) => !open);
  };

  // Whether the empty-workspace gallery has already been opened once for
  // this mount of `Flow`.
  const openedGalleryOnInit = useRef(false);
  /** Watches for the account's projects to land under an auto-opened gallery */
  const imported = useRef<Disposable | null>(null);

  useEffect(() => {
    // `PgExplorer` initializes asynchronously (`routes/common.tsx`), so
    // `allWorkspaceNames` may still be `undefined` on the first render --
    // only decide once it has actually settled, otherwise every cold start
    // would flash the gallery before we know whether there are projects.
    //
    // `PgExplorer.init()` reruns on every route navigation, so `onDidInit`
    // fires more than once for the lifetime of `Flow`. Open the gallery at
    // most once: dispose the subscription right after it fires so later
    // navigations (e.g. into and out of a tutorial) never stack a second
    // modal on top of one the user already interacted with.
    const openIfEmpty = () => {
      if (openedGalleryOnInit.current) return;
      if (PgExplorer.allWorkspaceNames?.length === 0) {
        openedGalleryOnInit.current = true;
        sub.dispose();
        openGallery();
        // "You have no projects" is a guess until the account has answered.
        // A browser signed in to an account with work on it is empty only for
        // as long as the sync takes, and the gallery was landing on top of
        // projects that arrived a moment later. Waiting for the sync instead
        // would delay the gallery for everyone who genuinely is new, so it
        // opens on time and stands down if it turns out to be wrong.
        imported.current = PgExplorer.onDidCreateWorkspace(() => {
          if (PgExplorer.allWorkspaceNames?.length) {
            imported.current?.dispose();
            PgView.closeModal();
          }
        });
      }
    };
    const sub = PgExplorer.onDidInit(openIfEmpty);
    if (PgExplorer.allWorkspaceNames) openIfEmpty();
    return () => {
      sub.dispose();
      imported.current?.dispose();
    };
  }, []);

  const readingStep = lesson.path
    ? currentStep(lesson.path, lesson.progress)
    : null;

  // A learner who fixes the code while the page is open should come back
  // to the editor, not to the next step's prose.
  useEffect(() => {
    setReading(false);
  }, [readingStep?.id]);

  return (
    <Wrapper>
      <Header
        onOpenGallery={openGallery}
        onToggleSettings={toggleSettings}
        settingsOpen={settingsOpen}
      />
      <Columns $assistant={assistantOpen} $left={leftOpen}>
        {leftOpen ? (
          <Resizable
            enable="right"
            size={{ width: leftWidth, height: "100%" }}
            minWidth={MIN_LEFT_WIDTH}
            maxWidth={clampLeftWidth(Infinity, window.innerWidth)}
            onResizeStop={(_ev, _dir, ref) => {
              setLeftWidth(
                clampLeftWidth(
                  ref.getBoundingClientRect().width,
                  window.innerWidth
                )
              );
            }}
          >
            <LeftPanel
              collapsed={false}
              onToggle={() => setLeftOpen((o) => !o)}
              pendingCreate={pendingCreate}
              onPendingCreateChange={setPendingCreate}
            />
          </Resizable>
        ) : (
          <LeftPanel
            collapsed
            onToggle={() => setLeftOpen((o) => !o)}
            pendingCreate={pendingCreate}
            onPendingCreateChange={setPendingCreate}
          />
        )}
        <Center>
          <ObjectiveBand state={lesson} onRead={() => setReading(true)} />
          <Stage>
            <StageRouter stage={state.stage} />
            {reading && readingStep && (
              <Reader
                key={readingStep.id}
                step={readingStep}
                onClose={() => setReading(false)}
              />
            )}
          </Stage>
          <ConsoleDrawer />
        </Center>
        <Right $open={assistantOpen}>
          <Collapse
            type="button"
            aria-label={
              assistantOpen ? "Collapse assistant" : "Expand assistant"
            }
            onClick={() => setAssistantOpen((o) => !o)}
          >
            <Chevron $flip={!assistantOpen} />
          </Collapse>
          {assistantOpen && <Assistant />}
        </Right>
      </Columns>

      <GearSidebar
        open={settingsOpen}
        focus={settingsFocus}
        onClose={() => setSettingsOpen(false)}
      />

      <Wallet />
      <PortalAbove id={PgView.ids.PORTAL_ABOVE} />
      <StyledModalBackdrop />
      <PortalBelow id={PgView.ids.PORTAL_BELOW}>
        <Toast />
      </PortalBelow>
    </Wrapper>
  );
};

export default Flow;

const Wrapper = styled.div`
  ${({ theme }) => css`
    width: 100vw;
    height: 100vh;
    display: flex;
    flex-direction: column;
    position: relative;
    overflow: hidden;
    background: ${theme.colors.default.bgPrimary};
  `}
`;

// Open, the left track is `auto` so the `Resizable` around `LeftPanel` sets
// its own width; collapsed, the track is fixed and there is no `Resizable`
const Columns = styled.div<{ $assistant: boolean; $left: boolean }>`
  flex: 1;
  display: grid;
  grid-template-columns:
    ${({ $left }) => ($left ? "auto" : "1.5rem")} 1fr
    ${({ $assistant }) => ($assistant ? "21.75rem" : "1.5rem")};
  gap: ${GAP};
  padding: 0 ${GAP} ${GAP};
  overflow: hidden;
`;

// The floating center panel: a single bordered/rounded surface holding both
// the stage and the console drawer, so the drawer's status line reads as
// the bottom edge of one panel rather than a separate box (see the board).
const Center = styled.div`
  ${({ theme }) => css`
    display: flex;
    flex-direction: column;
    min-width: 0;
    background: ${theme.colors.default.bgSecondary};
    border: 1px solid ${theme.colors.default.border};
    border-radius: ${theme.default.borderRadius};
    overflow: hidden;
  `}
`;

// display: flex here matters: Primary's own wrapper sizes itself with
// flex: 1; min-height: 0 (from theme.views.main.primary.default), which
// only takes effect inside a flex container. Without this, the editor's
// height collapses to its content size and Monaco never gets a real box
// to paint into.
const Stage = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /* The lesson reader covers the stage, not the whole layout */
  position: relative;
`;

const Right = styled.aside<{ $open: boolean }>`
  ${({ theme, $open }) => css`
    position: relative;
    --flow-handle-inset: ${$open ? "1rem" : "0px"};
    width: 100%;
    border: 1px solid ${theme.colors.default.border};
    border-radius: ${theme.default.borderRadius};
    background: ${theme.colors.default.bgSecondary};
    display: flex;
    flex-direction: column;
    overflow: hidden;
  `}
`;

const Collapse = styled.button`
  ${({ theme }) => css`
    /* The handle owns the panel's left gutter; the assistant header reads
       --flow-handle-inset (set on Right) and starts after it. */
    position: absolute;
    /* Centre on the assistant header row (its eyebrow and chips sit
       ~20px below the panel top): 4px offset + 32px tall = 20px centre. */
    top: 0.25rem;
    left: 0;
    width: 1.5rem;
    height: 2rem;
    display: flex;
    align-items: center;
    justify-content: center;
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

const PortalAbove = styled.div`
  z-index: 4;
`;
const StyledModalBackdrop = styled(ModalBackdrop)`
  z-index: 3;
`;
const PortalBelow = styled.div`
  z-index: 2;
`;
