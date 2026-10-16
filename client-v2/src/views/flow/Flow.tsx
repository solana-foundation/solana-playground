import { useEffect, useRef, useState } from "react";
import styled, { css } from "styled-components";

import ConsoleDrawer from "./console/ConsoleDrawer";
import NewWorkspaceModal from "./gallery/NewWorkspaceModal";
import Logomark from "./header/Logomark";
import StageBar from "./header/StageBar";
import LeftPanel from "./left/LeftPanel";
import ObjectiveBand from "./lessons/ObjectiveBand";
import Reader from "./lessons/Reader";
// The barrel registers every lesson path as a side effect, so importing
// it here is also what populates the registry for the whole app.
import {
  describeStep,
  entryReading,
  graderClass,
  INITIAL_LESSON_STATE,
  PgLesson,
} from "./lessons";
import type { LessonState } from "./lessons";
import GearSidebar from "./settings/GearSidebar";
import type { SettingsFocus } from "./settings/GearSidebar";
import StageRouter from "./stages/StageRouter";
import { PgDeployHistory } from "./state/deploy-history";
import { INITIAL_FLOW_STATE, PgFlow } from "./state/stage";
import type { FlowState } from "./state/stage";
import { GAP } from "./tokens";
import { FeedbackHost } from "@/features/feedback";
import SyncBanner from "@/features/persistence/Component/SyncBanner";
import Wallet from "@/components/Wallet";
import { useKeybind } from "@/hooks";
import { PgExplorer, PgView } from "@/utils";
import { AppNav, ProjectList } from "@/widgets/app-nav";
import { Assistant } from "@/widgets/assistant";
import { LayoutShell } from "@/widgets/layout-shell";
import { ModalHost, ToastHost } from "@/widgets/overlays";
import { RailFooter, SessionFooter } from "@/widgets/session-footer";
import type { Disposable } from "@/utils/types";

/**
 * The Flow layout, with no header: `LayoutShell` places four columns, the
 * navigation (`AppNav`, holding the logo, the project list, and the
 * session footer, `SessionFooter`: the cluster row, and the account row that
 * opens the account menu; on the rail that footer gives way to `RailFooter`'s
 * cluster dot and account button), the assistant, the files
 * column, and the stage router over its collapsible console, with the shell's
 * stage bar (`BaseStageBar`) and then the `StageBar` stage tabs across the
 * last two. The sync banner sits above all four, full width.
 *
 * The feedback form and its state sit in `FeedbackHost`, above the frame, not
 * in the footer with the account menu: below `LAYOUT_BREAKPOINTS.left` the footer
 * is in a Sheet that unmounts on close, and crossing that width swaps it for
 * the rail, so a draft or a send held in the footer would go with it.
 */
const Flow = () => (
  <FeedbackHost>
    <FlowFrame />
  </FeedbackHost>
);

const FlowFrame = () => {
  const [state, setState] = useState<FlowState>(INITIAL_FLOW_STATE);
  const [lesson, setLesson] = useState<LessonState>(INITIAL_LESSON_STATE);
  const [reading, setReading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsFocus, setSettingsFocus] = useState<SettingsFocus>("panel");

  useEffect(() => {
    const subs = [
      PgFlow.init(),
      PgLesson.init(),
      PgDeployHistory.init(),
      PgFlow.onDidChange(setState),
      PgLesson.onDidChange(setLesson),
    ];
    return () => subs.forEach((s) => s.dispose());
  }, []);

  const openGallery = () => PgView.setModal(NewWorkspaceModal);
  // Toggles rather than opens: the footer's cluster row and the account
  // menu's Settings, the rail's dot and ⌘, all lead in, so a second use of one
  // has to be the way out. Opening closes the
  // navigation's Sheet below `LAYOUT_BREAKPOINTS.left` (`closeSheet`): the
  // footer sits in it, and its modal overlay would cover the panel and trap
  // focus away from it.
  const toggleSettings =
    (closeSheet: () => void) =>
    (focus: SettingsFocus = "panel") => {
      if (!settingsOpen) closeSheet();
      setSettingsFocus(focus);
      setSettingsOpen((open) => !open);
    };

  // `PgKeybind` reads Meta as Ctrl, so this is ⌘, on a Mac and Ctrl+,
  // elsewhere. The key has no Sheet of its own to close, so it takes the one
  // the navigation last handed over: below `LAYOUT_BREAKPOINTS.left` the
  // navigation's Sheet may be open, and its overlay would cover the settings.
  const closeNavSheet = useRef<() => void>(() => undefined);
  useKeybind("Ctrl+,", () => toggleSettings(closeNavSheet.current)(), [
    settingsOpen,
  ]);

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

  const described = describeStep(lesson);

  const read = () => setReading(true);

  // A learner who fixes the code while the page is open should come back
  // to the editor, not to the next step's prose.
  useEffect(() => {
    setReading(false);
  }, [described?.step.id]);

  // Entering the lesson lands on the page -- once (D34). Declared after
  // the effect above so that, on the commit where both fire (a load
  // moves the cursor too), open wins. The record learns `opened` from
  // the Reader once the page content actually loads, which moves the
  // record's tail off `enter` -- so the next state returns null here and
  // the effect is inert; closing the sheet by hand does not reopen it,
  // while a page that failed to load gets another chance on re-entry.
  const entryStep = entryReading(lesson);
  useEffect(() => {
    if (entryStep) read();
    // `read` is recreated every render; the step id is the real trigger
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryStep?.id]);

  return (
    <Wrapper>
      {/* In flow, not floating: it is a blocking question, and the file it
          names has to stay visible beneath it */}
      <BannerSlot>
        <SyncBanner />
      </BannerSlot>
      <LayoutShell
        nav={({ collapsed, toggle, closeSheet }) => {
          closeNavSheet.current = closeSheet;
          return (
            <AppNav
              collapsed={collapsed}
              onToggle={toggle}
              logo={<Logomark aria-hidden="true" />}
              projects={<ProjectList />}
              footer={
                <SessionFooter
                  settingsOpen={settingsOpen}
                  onToggleSettings={toggleSettings(closeSheet)}
                />
              }
              railFooter={
                <RailFooter
                  settingsOpen={settingsOpen}
                  onToggleSettings={toggleSettings(closeSheet)}
                />
              }
            />
          );
        }}
        stageTabs={<StageBar />}
        files={({ collapsed }) => <LeftPanel collapsed={collapsed} />}
        stage={
          <Center>
            <ObjectiveBand
              state={lesson}
              flow={state}
              onRead={read}
              onOpenGallery={openGallery}
            />
            <Stage>
              <StageRouter stage={state.stage} />
              {reading && described && (
                <Reader
                  key={described.step.id}
                  step={described.step}
                  position={described.number}
                  criterion={described.verifiedBy}
                  offersAttest={
                    described.offersPrimary &&
                    graderClass(described.step.verify) === "attestation"
                  }
                  onLoaded={() => PgLesson.opened(described.step.id)}
                  onClose={() => setReading(false)}
                  onAttest={() => {
                    PgLesson.attest();
                    setReading(false);
                  }}
                />
              )}
            </Stage>
          </Center>
        }
        console={({ open, toggle }) => (
          <ConsoleDrawer open={open} onToggle={toggle} />
        )}
        assistant={({ open, toggle, ...widen }) => (
          <Right>
            {/* The head carries "Collapse assistant", and Widen while the
                shell says it can widen. Hidden, the column takes no width and
                the stage bar carries "Expand assistant" (design.md, "Frame
                chrome (5.25)") */}
            {open && <Assistant widen={widen} onHide={toggle} />}
          </Right>
        )}
      />

      <GearSidebar
        open={settingsOpen}
        focus={settingsFocus}
        onClose={() => setSettingsOpen(false)}
      />

      <Wallet />
      <ModalHost />
      <ToastHost />
    </Wrapper>
  );
};

export default Flow;

// The three utilities repeat what the styled rule below already sets, so the
// screen does not change. They are here so that Tailwind reaching the page
// can be checked on a screen every visit renders: `e2e/tailwind.e2e.spec.ts`
// reads their rules out of the utilities layer, and CI greps the built CSS.
const Wrapper = styled.div.attrs({
  className: "flex flex-col overflow-hidden",
})`
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

// Empty while there is no conflict, and then takes no room at all
const BannerSlot = styled.div`
  padding: 0 ${GAP} ${GAP};

  &:empty {
    display: none;
  }
`;

// The stage's column. The frame is flush (design.md, "Frame chrome (5.25)"):
// no card edges, the page's background; the shell draws the dividers.
const Center = styled.div`
  ${({ theme }) => css`
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
    background: ${theme.colors.default.bgPrimary};
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

const Right = styled.aside`
  ${({ theme }) => css`
    position: relative;
    width: 100%;
    height: 100%;
    background: ${theme.colors.default.bgPrimary};
    display: flex;
    flex-direction: column;
    overflow: hidden;
  `}
`;
