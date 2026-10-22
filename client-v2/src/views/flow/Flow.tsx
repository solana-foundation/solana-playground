import { useEffect, useRef, useState } from "react";
import styled, { css } from "styled-components";

import ConsoleDrawer from "./console/ConsoleDrawer";
import NewWorkspaceModal from "./gallery/NewWorkspaceModal";
import Logomark from "./header/Logomark";
import StageBar from "./header/StageBar";
import LeftPanel from "./left/LeftPanel";
import { keepTab } from "./left/kept-column";
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
import StageRouter from "./stages/StageRouter";
import { PgDeployHistory } from "./state/deploy-history";
import { INITIAL_FLOW_STATE, PgFlow } from "./state/stage";
import type { FlowState } from "./state/stage";
import { GAP } from "./tokens";
import { FeedbackHost } from "@/features/feedback";
import {
  SETTINGS_TRIGGER_ATTR,
  type SettingsFocus,
  type SettingsExit,
  type SettingsRequest,
} from "@/shared/lib/settings-request";
import SyncBanner from "@/features/persistence/Component/SyncBanner";
import Wallet from "@/components/Wallet";
import { useKeybind } from "@/hooks";
import { closeOpenLayers } from "@/shared/lib/close-open-layers";
import { createLogger } from "@/shared/lib/logger";
import { PgExplorer, PgView } from "@/utils";
import { useViewport } from "@/shared/lib/hooks/use-viewport";
import { AppNav, ProjectList } from "@/widgets/app-nav";
import { catalogPage, catalogSlot, useCatalogPage } from "@/widgets/catalog";
import { Assistant, openConnectDialog } from "@/widgets/assistant";
import { homeSlot, useStartView } from "@/widgets/home";
import { LayoutShell } from "@/widgets/layout-shell";
import { ModalHost, ToastHost } from "@/widgets/overlays";
import { RailFooter, SessionFooter } from "@/widgets/session-footer";
import { SettingsPage, settingsTelemetry } from "@/widgets/settings-page";
import { markNetworkChosen, SetupList } from "@/widgets/setup-list";

/**
 * The Flow layout, with no header: `LayoutShell` places four columns, the
 * navigation (`AppNav`, holding the logo, the project list, and the
 * session footer, `SessionFooter`: the cluster row, and the account row that
 * opens the account menu; on the rail that footer gives way to `RailFooter`'s
 * cluster dot and account button), the assistant, the files
 * column, and the stage router over its collapsible console, with the shell's
 * stage bar (`BaseStageBar`) and then the `StageBar` stage tabs across the
 * last two. The sync banner sits above all four, full width. On `/` with no
 * project, `useStartView` hands the shell `homeSlot`, and Home stands where
 * the assistant and the work go.
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

const log = createLogger("flow:settings");

/**
 * Where focus goes back when the control that opened the settings is gone: a
 * checklist step that the pick ticked, a footer the navigation's Sheet took
 * with it. The first control that opens the settings still on screen, else
 * the control that opens the navigation.
 */
const fallbackFocus = () =>
  [
    ...document.querySelectorAll<HTMLElement>(
      `[${SETTINGS_TRIGGER_ATTR}], [data-sidebar="trigger"]`
    ),
  ].find((el) => el.getClientRects().length > 0);

/** Open, the settings page remembers where focus was, to give it back */
type SettingsState =
  | { open: false }
  | { open: true; focus: SettingsFocus; returnTo: HTMLElement | null };

const FlowFrame = () => {
  const [state, setState] = useState<FlowState>(INITIAL_FLOW_STATE);
  const [lesson, setLesson] = useState<LessonState>(INITIAL_LESSON_STATE);
  const [reading, setReading] = useState(false);
  const [settings, setSettings] = useState<SettingsState>({ open: false });
  const settingsOpen = settings.open;
  const viewport = useViewport();
  const phone = viewport === "phone";

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
  // Back to the control that opened them, once the shell is no longer inert,
  // or, when that is gone, to `fallbackFocus`
  const refocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (settings.open) return;
    if (refocus.current?.isConnected) refocus.current.focus();
    else fallbackFocus()?.focus();
    refocus.current = null;
  }, [settings.open]);
  const closeSettings = (via: SettingsExit) => {
    if (!settings.open) return;
    // The page covers the app, so every open dialog (an import, a Custom
    // value, and any opened over it) came from it and goes with it
    for (const { id } of PgView.getOpenModals()) PgView.closeModal(null, id);
    settingsTelemetry.track("settings_closed", { via });
    refocus.current = settings.returnTo;
    setSettings({ open: false });
  };
  // The settings page covers the app, so of the ways in only ⌘, can still be
  // used while it is open: that is the one request that closes it. Opening
  // closes the navigation's Sheet below `LAYOUT_BREAKPOINTS.left`
  // (`closeSheet`): the footer sits in it, and the Sheet portals to `body`,
  // outside the hidden shell, so its overlay would cover the page and trap
  // focus away from it.
  const toggleSettings =
    (closeSheet: () => void) =>
    ({ from, focus, returnTo }: SettingsRequest) => {
      if (settings.open) return closeSettings("key");
      const active = document.activeElement;
      closeSheet();
      // A menu, popover or tooltip still open would float over the page;
      // closed first, and its trigger stands in for the item focus was on
      closeOpenLayers()
        .then((trigger) => {
          settingsTelemetry.track("settings_opened", { from });
          setSettings({
            open: true,
            focus,
            returnTo:
              returnTo ??
              trigger ??
              (active instanceof HTMLElement && active !== document.body
                ? active
                : null),
          });
        })
        .catch((error) =>
          log.error(error, {
            report: true,
            context: { step: "close open layers", from },
          })
        );
    };

  // Opens, never toggles: the checklist's "Choose a network" must not shut
  // settings that are already open
  const openSettings =
    (closeSheet: () => void) =>
    (focus: SettingsFocus = "page") => {
      if (settings.open) return;
      toggleSettings(closeSheet)({ from: "setup", focus });
    };

  // `PgKeybind` reads Meta as Ctrl, so this is ⌘, on a Mac and Ctrl+,
  // elsewhere. The key has no Sheet of its own to close, so it takes the one
  // the navigation last handed over: below `LAYOUT_BREAKPOINTS.left` the
  // navigation's Sheet may be open, and its overlay would cover the settings.
  const closeNavSheet = useRef<() => void>(() => undefined);
  useKeybind(
    "Ctrl+,",
    () => toggleSettings(closeNavSheet.current)({ from: "key", focus: "page" }),
    [settings]
  );

  const page = useStartView();
  // The Tutorials or Programs page shown, if any (`widgets/catalog`)
  const catalog = useCatalogPage();

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
      {/* The app stays mounted under the settings page, invisible and inert
          (design.md, "Settings as a full page (5.20)"): `Write` must never
          unmount, and with `display: contents` and `visibility` the shell
          keeps its boxes, so no panel sees a resize and folds on its own */}
      <div
        className={settings.open ? "contents invisible" : "contents"}
        inert={settings.open}
      >
        {/* In flow, not floating: it is a blocking question, and the file it
          names has to stay visible beneath it */}
        <BannerSlot>
          <SyncBanner />
        </BannerSlot>
        <LayoutShell
          home={homeSlot(
            page.view,
            viewport,
            () => page.leaveHome("continue"),
            (p) => catalogPage.open(p, "home")
          )}
          keepWork={page.workKept}
          cover={catalogSlot(catalog)}
          nav={({ collapsed, toggle, closeSheet }) => {
            closeNavSheet.current = closeSheet;
            return (
              <AppNav
                // Home and the open project show in place of the work, which
                // the navigation's Sheet (or a phone's menu page) covers
                onHome={() => {
                  closeSheet();
                  // A page makes way: over Home that is all Home asks for,
                  // over the work Home follows
                  if (catalog) {
                    catalogPage.close();
                    if (page.view === "home") return;
                  }
                  page.showHome("nav");
                }}
                current={catalog ?? undefined}
                onOpenPage={(p) => {
                  catalogPage.open(p, "nav");
                  // The navigation's Sheet, or a phone's menu page, would
                  // cover the page it just opened
                  closeSheet();
                }}
                onClosePage={catalogPage.close}
                collapsed={collapsed}
                onToggle={toggle}
                logo={<Logomark aria-hidden="true" />}
                projects={
                  <ProjectList
                    onPicked={catalogPage.close}
                    onPickCurrent={() => {
                      page.leaveHome("current-project");
                      closeSheet();
                    }}
                  />
                }
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
                setup={
                  <SetupList
                    onConnectAssistant={() => openConnectDialog("setup")}
                    onChooseNetwork={() => openSettings(closeSheet)("network")}
                  />
                }
              />
            );
          }}
          stageTabs={<StageBar />}
          files={({ collapsed }) => <LeftPanel collapsed={collapsed} />}
          stage={({ openFiles }) => (
            <Center>
              <ObjectiveBand
                state={lesson}
                flow={state}
                onRead={read}
                onOpenGallery={openGallery}
                compact={
                  phone
                    ? {
                        // Below `LAYOUT_BREAKPOINTS.phone`, where the band is
                        // compact, the Files sheet mounts the column fresh, and
                        // it reads its tab from the per-project memory
                        // (`kept-column.ts`)
                        onOpenSteps: () => {
                          keepTab(PgExplorer.currentWorkspaceId, "steps");
                          openFiles();
                        },
                      }
                    : undefined
                }
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
          )}
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

        <Wallet />
      </div>

      {settings.open && (
        <SettingsPage
          focus={settings.focus}
          onClose={closeSettings}
          onChooseNetwork={markNetworkChosen}
        />
      )}

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
