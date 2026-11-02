import { useEffect, useRef, useState } from "react";

import ConsoleDrawer from "./console/ConsoleDrawer";
import NewWorkspaceModal from "./gallery/NewWorkspaceModal";
import StageBar from "./header/StageBar";
import LeftPanel from "./left/LeftPanel";
import LessonBar from "./lessons/LessonBar";
import ObjectiveBand from "./lessons/ObjectiveBand";
import Reader from "./lessons/Reader";
// The barrel registers every lesson path as a side effect, so importing
// it here is also what populates the registry for the whole app.
import { describeStep, INITIAL_LESSON_STATE, PgLesson } from "./lessons";
import type { LessonState } from "./lessons";
import StageRouter from "./stages/StageRouter";
import { PgDeployHistory } from "./state/deploy-history";
import { INITIAL_FLOW_STATE, PgFlow } from "./state/stage";
import type { FlowState } from "./state/stage";
import { FeedbackHost } from "@/features/feedback";
import {
  SETTINGS_TRIGGER_ATTR,
  type SettingsFocus,
  type SettingsExit,
  type SettingsRequest,
} from "@/shared/lib/settings-request";
import SyncBanner from "@/features/persistence/Component/SyncBanner";
import { openConnectDialog } from "@/app/ConnectDialog";
import Wallet from "@/components/Wallet";
import { useKeybind } from "@/hooks";
import { closeOpenLayers } from "@/shared/lib/close-open-layers";
import { createLogger } from "@/shared/lib/logger";
import { LogoLockup } from "@/shared/ui/logo";
import { Pattern } from "@/shared/ui/pattern";
import { PgView } from "@/utils";
import { useViewport } from "@/shared/lib/hooks/use-viewport";
import { AppNav, ProjectList } from "@/widgets/app-nav";
import { catalogPage, catalogSlot, useCatalogPage } from "@/widgets/catalog";
import { Assistant } from "@/widgets/assistant";
import { homeSlot, useStartView } from "@/widgets/home";
import { LayoutShell } from "@/widgets/layout-shell";
import { ModalHost, ToastHost } from "@/widgets/overlays";
import { RailFooter, SessionFooter } from "@/widgets/session-footer";
import { SettingsPage, settingsTelemetry } from "@/widgets/settings-page";
import { SetupList } from "@/widgets/setup-list";

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
 * in the footer with the account menu: below `LAYOUT_BREAKPOINTS.phone` the
 * footer is on the pager's menu page, and crossing that width swaps it for
 * the rail, so a draft or a send held in the footer would go with it.
 */
const Flow = () => (
  <FeedbackHost>
    <FlowFrame />
  </FeedbackHost>
);

const log = createLogger("flow:settings");

/**
 * Whether focus can land on `el`: on screen, and not inside an `inert` part,
 * such as a phone page out of view, where `focus()` does nothing
 */
const canTakeFocus = (el: HTMLElement) =>
  el.isConnected &&
  el.getClientRects().length > 0 &&
  el.closest("[inert]") === null;

/**
 * Focuses `el` once it shows. The shell comes back from `invisible`, and a
 * control with `transition-all` (the design system's buttons) animates the
 * visibility it inherits, so for a frame or more it is still hidden and
 * `focus()` does nothing. A frame that is slow to come, as under the
 * window's pattern on a loaded machine, made that a lost focus. Bounded: a
 * control that never shows is left alone. Returns a cancel.
 */
const focusWhenShown = (el: HTMLElement, frames = 30): (() => void) => {
  if (getComputedStyle(el).visibility === "visible") {
    el.focus();
    return () => {};
  }
  if (frames === 0) return () => {};
  let cancel = () => {};
  const id = requestAnimationFrame(() => {
    cancel = focusWhenShown(el, frames - 1);
  });
  return () => {
    cancelAnimationFrame(id);
    cancel();
  };
};

/**
 * Where focus goes back when the control that opened the settings is gone or
 * out of reach: a footer the rail swapped out, a cluster row on the phone's menu page once Work shows. The
 * first control that opens the settings still in reach, else the control
 * that opens the navigation.
 */
const fallbackFocus = () =>
  [
    ...document.querySelectorAll<HTMLElement>(
      `[${SETTINGS_TRIGGER_ATTR}], [data-sidebar="trigger"]`
    ),
  ].find(canTakeFocus);

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
  // or, when that is gone or out of reach, to `fallbackFocus`. Only when they
  // close: on load, with the settings never opened, focus stays where the
  // browser puts it, not on a trigger whose tooltip opens on focus (HOO-2240)
  const refocus = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    const closed = wasOpen.current && !settings.open;
    wasOpen.current = settings.open;
    if (!closed) return;
    const target =
      refocus.current && canTakeFocus(refocus.current)
        ? refocus.current
        : fallbackFocus();
    refocus.current = null;
    if (target) return focusWhenShown(target);
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
  // leaves the navigation (`closeSheet`): on a phone the footer sits on the
  // menu page, and the settings show over Work.
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

  // `PgKeybind` reads Meta as Ctrl, so this is ⌘, on a Mac and Ctrl+,
  // elsewhere. The key has no way of its own to leave the navigation, so it
  // takes the one the navigation last handed over: on a phone the menu page
  // may be in view.
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

  return (
    // `h-dvh` is the visible height: on iPad and iPhone Safari 100vh is the
    // height with the toolbar hidden, so the foot of the navigation started
    // under it. `isolate` is the window's stacking context, so the pattern can
    // sit under it all
    <div className="relative isolate flex h-dvh w-screen flex-col overflow-hidden bg-surface-base">
      {/* One ground for the whole window, as the prototype lays it, so the
          grid runs on unbroken wherever a pane lets it through: faint, a
          quarter of the landing's strength, rising from the bottom edge, and
          lit where the pointer is. The nav and the files cover it. It sits
          below everything in the window's own stacking context (`isolation`
          on the window's root), on a compositing layer of its own: the light
          repaints it on every frame it moves, and nothing above it should
          repaint with it. */}
      <Pattern
        rest={0.025}
        lit={0.07}
        fade={1}
        className="-z-10 will-change-transform"
      />
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
        <div className="px-2 pb-2 empty:hidden">
          <SyncBanner />
        </div>
        <LayoutShell
          home={homeSlot(
            page.view,
            viewport,
            () => page.leaveHome("continue"),
            (p) => catalogPage.open(p, "home")
          )}
          keepWork={page.workKept}
          cover={catalogSlot(catalog)}
          nav={({ collapsed, toggle, closeSheet, phone: menuPage }) => {
            closeNavSheet.current = closeSheet;
            return (
              <AppNav
                // Home and the open project show in place of the work, which
                // a phone's menu page covers
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
                homeShown={page.view === "home"}
                onOpenPage={(p) => {
                  catalogPage.open(p, "nav");
                  // A phone's menu page would cover the page it just opened
                  closeSheet();
                }}
                onClosePage={catalogPage.close}
                closeSheet={closeSheet}
                phone={menuPage}
                collapsed={collapsed}
                onToggle={toggle}
                logo={<LogoLockup aria-hidden="true" />}
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
                    page={menuPage}
                    closeSheet={closeSheet}
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
                    defaultFolded={menuPage}
                    onConnectAssistant={() => openConnectDialog("setup")}
                  />
                }
              />
            );
          }}
          stageTabs={<StageBar />}
          files={({ collapsed, toggle, phone }) => (
            <LeftPanel
              collapsed={collapsed}
              onHide={phone ? undefined : toggle}
              startOn={phone ? "files" : undefined}
            />
          )}
          stage={() => (
            // The stage's column. The frame is flush (design.md, "Frame
            // chrome (5.25)"): no card edges and no fill of its own, so a
            // stage with nothing in it yet shows the window's pattern, as the
            // prototype's does; the editor paints its own ground over it. The
            // shell draws the dividers.
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <ObjectiveBand
                state={lesson}
                onRead={read}
                onOpenGallery={openGallery}
                phone={phone}
              />
              {/* `flex` matters: Primary's own wrapper sizes itself with
                  flex: 1; min-height: 0, which only takes effect inside a flex
                  container. Without it the editor's height collapses to its
                  content size and Monaco never gets a real box to paint into.
                  `relative`: the lesson reader covers the stage, not the whole
                  layout */}
              <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                <StageRouter stage={state.stage} />
                {reading && described && (
                  <Reader
                    key={described.step.id}
                    step={described.step}
                    onLoaded={() => PgLesson.opened(described.step.id)}
                    onClose={() => setReading(false)}
                  />
                )}
              </div>
              {/* On a phone the step's controls sit at the foot of the code,
                  under the thumb; the band above folds to the ask */}
              {phone && (
                <LessonBar
                  state={lesson}
                  onRead={read}
                  onOpenGallery={openGallery}
                />
              )}
            </div>
          )}
          console={({ open, toggle }) => (
            <ConsoleDrawer open={open} onToggle={toggle} />
          )}
          assistant={({ open, toggle, ...widen }) => (
            // No fill, so the conversation sits on the window's pattern, as
            // the prototype's does
            <aside className="relative flex h-full w-full flex-col overflow-hidden">
              {/* The head carries "Collapse assistant", and Widen while the
                shell says it can widen. Hidden, the column takes no width and
                the stage bar carries "Expand assistant" (design.md, "Frame
                chrome (5.25)") */}
              {open && (
                <Assistant
                  widen={widen}
                  onHide={toggle}
                  openConnect={openConnectDialog}
                />
              )}
            </aside>
          )}
        />

        <Wallet />
      </div>

      {settings.open && (
        <SettingsPage focus={settings.focus} onClose={closeSettings} />
      )}

      <ModalHost />
      <ToastHost />
    </div>
  );
};

export default Flow;
