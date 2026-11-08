import { useEffect, useRef, useState } from "react";

import { openConnectDialog } from "@/app/ConnectDialog";
import { openShareGistDialogFor, ShareButton } from "@/app/ShareGistDialog";
import Wallet from "@/components/Wallet";
import { FeedbackHost } from "@/features/feedback";
import SyncBanner from "@/features/persistence/Component/SyncBanner";
import { useKeybind } from "@/hooks";
import { closeOpenLayers } from "@/shared/lib/close-open-layers";
import { useViewport } from "@/shared/lib/hooks/use-viewport";
import { createLogger } from "@/shared/lib/logger";
import { Outlet, OutletContent, useOutletNode } from "@/shared/lib/outlet";
import {
  SETTINGS_TRIGGER_ATTR,
  type SettingsExit,
  type SettingsFocus,
  type SettingsRequest,
} from "@/shared/lib/settings-request";
import { LogoLockup } from "@/shared/ui/logo";
import { Pattern } from "@/shared/ui/pattern";
import { Tag } from "@/shared/ui/tag";
import { PgCommon, PgExplorer, PgTutorial, PgView } from "@/utils";
import { AppNav, ProjectList, readProjectFiles } from "@/widgets/app-nav";
import { Assistant, useTurn } from "@/widgets/assistant";
import { catalogPage, catalogSlot, useCatalogPage } from "@/widgets/catalog";
import { homeSlot, useStartView } from "@/widgets/home";
import { CONSOLE_KEY, keyLabel, LayoutShell } from "@/widgets/layout-shell";
import { ModalHost, ToastHost } from "@/widgets/overlays";
import { RailFooter, SessionFooter } from "@/widgets/session-footer";
import { SettingsPage, settingsTelemetry } from "@/widgets/settings-page";
import { SetupList } from "@/widgets/setup-list";
import {
  StageNotice,
  StatusChip,
  StatusRail,
  StatusRow,
} from "@/widgets/status";
import {
  TutorialComposer,
  TutorialConversation,
  useConversationMarks,
  useConversationStartOver,
  useConversationSteps,
} from "@/widgets/tutorial-conversation";
import {
  BaseTutorialPhoneHead,
  useTutorialFrame,
  useTutorialSpace,
} from "@/widgets/tutorial-frame";
import {
  TutorialWorkspace,
  useTutorialTerminal,
  type WorkspaceLayout,
} from "@/widgets/tutorial-workspace";

import ConsoleDrawer from "./console/ConsoleDrawer";
import StageBar from "./header/StageBar";
import LeftPanel from "./left/LeftPanel";
import StageRouter from "./stages/StageRouter";
import { PgDeployHistory } from "./state/deploy-history";
import type { FlowState } from "./state/stage";
import { INITIAL_FLOW_STATE, PgFlow } from "./state/stage";
import { useStagesOffered } from "./use-stages-offered";
import { useViewPath } from "./use-view-path";

/**
 * The Flow layout, with no header: `LayoutShell` places four columns, the
 * navigation (`AppNav`, holding the logo, the project list, and the
 * session footer, `SessionFooter`: the status row (`StatusRow`), and the
 * account row that opens the account menu; on the rail that footer gives way
 * to `RailFooter`'s status dots (`StatusRail`) and account button), the
 * assistant, the files
 * column, and the stage router over its collapsible console, with the shell's
 * stage bar (`BaseStageBar`) and then the `StageBar` stage tabs across the
 * last two (a tutorial's frame draws neither the tabs nor the files column).
 * The sync banner sits above all four, full width. On `/` with no project,
 * `useStartView` hands the shell `homeSlot`, and Home stands where the
 * assistant and the work go.
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
 * A tutorial's chat: the feed, and its composer at the foot (3.6). The frame
 * has no assistant panel (`LayoutShellProps.tutorial`), so the one live
 * assistant turn is held here while the chat shows, and the panel's own
 * holds it again once the frame goes. Mounted once, through `chatNode`,
 * which the frame and the phone layout both show.
 */
const TutorialChat = ({
  onAllTutorials,
  onOpenMenu,
}: {
  onAllTutorials: () => void;
  onOpenMenu: () => void;
}) => {
  const turn = useTurn({ open: openConnectDialog });
  // The composer counts a question only once the assistant has it
  const send = (text: string) =>
    turn.send(text).then((outcome) => outcome === "sent");
  return (
    <>
      <TutorialConversation
        onAllTutorials={onAllTutorials}
        onOpenMenu={onOpenMenu}
      />
      <div className="px-5 pb-4">
        <TutorialComposer
          turn={{
            send,
            stop: turn.stop,
            busy: turn.busy,
            input: turn.input,
            setInput: turn.setInput,
          }}
        />
      </div>
    </>
  );
};

/**
 * Whether focus can land on `el`: on screen, and not inside an `inert` part,
 * such as a phone page out of view, where `focus()` does nothing
 */
const canTakeFocus = (el: HTMLElement) =>
  el.isConnected &&
  el.getClientRects().length > 0 &&
  el.closest("[inert]") === null;

/**
 * Ends the `visibility` transitions under `root`. The shell's reveal starts
 * one on every control with `transition-all` (the design system's `Button`),
 * and until its first frame the control still computes `hidden`, where
 * `focus()` does nothing: on a slow machine the refocus after the settings
 * closed landed there, and focus stayed on the body (HOO-2290).
 */
const revealAtOnce = (root: Element) => {
  for (const animation of root.getAnimations({ subtree: true })) {
    if (
      animation instanceof CSSTransition &&
      animation.transitionProperty === "visibility"
    ) {
      animation.finish();
    }
  }
};

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
 * out of reach: a footer the rail swapped out, the network indicator on the phone's menu page once Work shows. The
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

/**
 * Share a project as a gist from the phone's Code head, the phone's place
 * for the header's Share; the dialog counts and reports its own outcome
 */
const shareFromCodeHead = (name: string) =>
  void openShareGistDialogFor("header")(
    () => readProjectFiles(name, PgExplorer.fs),
    name
  );

const FlowFrame = () => {
  const [state, setState] = useState<FlowState>(INITIAL_FLOW_STATE);
  const [settings, setSettings] = useState<SettingsState>({ open: false });
  const settingsOpen = settings.open;
  const viewport = useViewport();

  useEffect(() => {
    const subs = [
      PgFlow.init(),
      PgDeployHistory.init(),
      PgFlow.onDidChange(setState),
    ];
    return () => subs.forEach((s) => s.dispose());
  }, []);

  const shell = useRef<HTMLDivElement>(null);
  // Back to the control that opened them, once the shell is no longer inert
  // and its reveal's `visibility` transitions are over (`revealAtOnce`),
  // or, when that is gone or out of reach, to `fallbackFocus`. Only when they
  // close: on load, with the settings never opened, focus stays where the
  // browser puts it, not on a trigger whose tooltip opens on focus (HOO-2240)
  const refocus = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    const closed = wasOpen.current && !settings.open;
    wasOpen.current = settings.open;
    if (!closed) return;
    if (shell.current) revealAtOnce(shell.current);
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
  // Home, the page shown and the work, each on its own URL
  useViewPath({
    view: page.view,
    homeVia: page.homeVia,
    catalog: catalog ?? undefined,
  });

  // A tutorial with a definition opens in its frame (`tutorial-flow-v2`
  // 2.1), its chat holding the conversation (3.3), whose engine runs Start
  // over, and the composer under the feed (3.6).
  const openMenu = useRef<() => void>(() => {});
  const conversation = useConversationStartOver();
  const marks = useConversationMarks();
  // One chat for the frame and the phone layout, rendered into this node and
  // shown by whichever of the two is drawn, as the stage and the console are:
  // crossing the frame's width moves the node, so `useTurn` stays mounted and
  // keeps the composer's draft and the Stop of an answer streaming. Mounted
  // only while one of them is drawn (`chatShown`)
  const chatNode = useOutletNode("flex min-h-0 flex-1 flex-col");
  const chatOutlet = (
    <Outlet node={chatNode} className="flex min-h-0 flex-1 flex-col" />
  );
  const tutorial = useTutorialFrame({
    // Back to the list the tutorial came from; the navigation's own way
    // there, so it reads as `nav`
    onBack: () => catalogPage.open("tutorials", "nav"),
    onStartOver: conversation.onStartOver,
    passed: conversation.passed,
    body: chatOutlet,
  });

  // The frame's workspace (2.2): its head and tree over the stage, and its
  // own terminal line, on a wide window, where the frame shows
  const inFrame = tutorial.frame !== undefined && viewport === "wide";
  const terminal = useTutorialTerminal();

  // Under the frame's width a tutorial is the phone's (5.1): its header over
  // two spaces, the chat and the code, which the shell lays out. A tablet
  // gets the same screens, the chat centred (DES-160)
  const onPhone = tutorial.frame !== undefined && !inFrame;
  // Where the shell draws a chat Outlet: the frame on the work, or under a
  // page over it; the phone layout on the work only. Nowhere else may the
  // chat stay mounted: on wide Home the assistant panel holds the one live
  // turn, and a chat out of the page would still answer Enter, starting or
  // advancing a step nobody sees
  const chatShown =
    tutorial.frame !== undefined &&
    page.view === "work" &&
    (inFrame || catalog === null);
  // The live assistant's open_menu tool (3.6) opens the frame's navigation,
  // which exists only once the frame is built from the body above. Below the
  // frame's width that navigation is not drawn: the phone's steps sheet is
  // the menu there
  const [phoneSteps, setPhoneSteps] = useState(false);
  useEffect(() => {
    openMenu.current = onPhone
      ? () => setPhoneSteps(true)
      : () => tutorial.frame?.nav.onOpenChange(true);
  });
  let workspaceLayout: WorkspaceLayout | undefined;
  if (onPhone) workspaceLayout = "phone";
  else if (inFrame) workspaceLayout = "frame";
  const steps = useConversationSteps();
  const space = useTutorialSpace({
    name: tutorial.frame ? PgTutorial.current?.name : undefined,
    wrote: steps.wrote,
    finished: steps.finished,
    loaded: steps.loaded,
    phone: onPhone,
  });
  const tutorialSlot = tutorial.frame && {
    ...tutorial.frame,
    phone: {
      head: (
        <BaseTutorialPhoneHead
          name={PgTutorial.current?.name ?? ""}
          steps={steps.steps}
          live={steps.live}
          started={steps.started}
          finished={steps.finished}
          minutes={steps.minutes}
          space={space.space}
          dot={space.dot}
          passed={conversation.passed ?? 0}
          onBack={() => catalogPage.open("tutorials", "nav")}
          onSpace={space.setSpace}
          onJump={steps.jump}
          onStartOver={conversation.onStartOver}
          sheetOpen={phoneSteps}
          onSheetOpenChange={setPhoneSteps}
        />
      ),
      chat: chatOutlet,
      space: space.space,
      onSpace: space.setSpace,
    },
  };
  // None before a tutorial's Start: its intro offers only Start
  const stagesOffered = useStagesOffered();
  // Narrow too: a tutorial's build state lives in the chat and the terminal
  // strip, never on a Build page (Almaz, 3 Nov; HOO-2355)
  const shownStage =
    tutorial.frame !== undefined || !stagesOffered ? "write" : state.stage;

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
        ref={shell}
        className={settings.open ? "contents invisible" : "contents"}
        inert={settings.open}
      >
        {/* In flow, not floating: it is a blocking question, and the file it
          names has to stay visible beneath it */}
        <div className="px-2 pb-2 empty:hidden">
          <SyncBanner />
        </div>
        <LayoutShell
          phoneStatus={
            <StatusChip
              onOpenNetwork={() =>
                toggleSettings(closeNavSheet.current)({
                  from: "cluster",
                  focus: "network",
                })
              }
              onConnectAi={() => openConnectDialog("status")}
            />
          }
          home={homeSlot(
            page.view,
            viewport,
            () => page.leaveHome("continue"),
            (p) => catalogPage.open(p, "home")
          )}
          keepWork={page.workKept}
          cover={catalogSlot(catalog)}
          stageBarActions={<ShareButton />}
          onShare={shareFromCodeHead}
          tutorial={tutorialSlot}
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
                // The frame, and so its pin, shows on a wide window only
                pin={viewport === "wide" ? tutorial.pin : undefined}
                logo={
                  // Beta beside the lockup, on the line of "Playground"
                  <span className="flex items-end gap-2">
                    <LogoLockup aria-hidden="true" />
                    <Tag
                      variant="neutral"
                      className="mb-px h-4 px-1 text-[0.5625rem] text-foreground"
                    >
                      Beta
                    </Tag>
                  </span>
                }
                projects={(open) => (
                  <ProjectList
                    onPicked={catalogPage.close}
                    onShareGist={openShareGistDialogFor("project_menu")}
                    onPickCurrent={() => {
                      page.leaveHome("current-project");
                      closeSheet();
                    }}
                    empty={{
                      onStartProject: () => open("new-project"),
                      onOpenTutorials: () => open("tutorials"),
                    }}
                  />
                )}
                footer={
                  <SessionFooter
                    page={menuPage}
                    closeSheet={closeSheet}
                    status={
                      <StatusRow
                        settingsOpen={settingsOpen}
                        onOpenNetwork={() =>
                          toggleSettings(closeSheet)({
                            from: "cluster",
                            focus: "network",
                          })
                        }
                        onConnectAi={() => openConnectDialog("status")}
                      />
                    }
                    onToggleSettings={toggleSettings(closeSheet)}
                  />
                }
                railFooter={
                  <RailFooter
                    status={
                      <StatusRail
                        settingsOpen={settingsOpen}
                        onOpenNetwork={() =>
                          toggleSettings(closeSheet)({
                            from: "rail",
                            focus: "network",
                          })
                        }
                        onConnectAi={() => openConnectDialog("status")}
                      />
                    }
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
          // eslint-disable-next-line unicorn/no-null -- tutorial flow v2 predates this rule; cleanup tracked from SF#94
          stageTabs={stagesOffered ? <StageBar /> : null}
          // The editor's tab row belongs to Write, which stays mounted,
          // hidden, on the other stages
          showTabs={shownStage === "write"}
          files={({ collapsed, phone }) => (
            <LeftPanel collapsed={collapsed} sheet={phone} />
          )}
          stage={({ console }) => (
            <TutorialWorkspace
              layout={workspaceLayout}
              console={console}
              marks={marks}
              keys={{
                files: keyLabel("Ctrl+E", PgCommon.getOS()),
                terminal: keyLabel(CONSOLE_KEY, PgCommon.getOS()),
              }}
            >
              {/* The stage's column. The frame is flush (design.md, "Frame
                  chrome (5.25)"): no card edges and no fill of its own, so a
                  stage with nothing in it yet shows the window's pattern, as
                  the prototype's does; the editor paints its own ground over
                  it. The shell draws the dividers. */}
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                {/* Why work waits: offline on every stage, a cluster that
                    does not answer on Deploy and Interact (Spec 08 NET-01,
                    NET-02) */}
                <StageNotice
                  stage={shownStage}
                  onOpenNetwork={() =>
                    toggleSettings(closeNavSheet.current)({
                      from: "stage",
                      focus: "network",
                    })
                  }
                />
                {/* `flex` matters: Primary's own wrapper sizes itself with
                    flex: 1; min-height: 0, which only takes effect inside a
                    flex container. Without it the editor's height collapses
                    to its content size and Monaco never gets a real box to
                    paint into. A tutorial's frame shows the editor alone: its
                    steps, builds and deploys are the chat's
                    (`tutorial-frame-2nov`). The router stays mounted on the
                    Write stage, whose editor must never unmount */}
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <StageRouter
                    stage={shownStage}
                    tabs={stagesOffered && tutorial.frame === undefined}
                    // On the network choice, as the cluster row opens it
                    onChangeNetwork={() =>
                      toggleSettings(closeNavSheet.current)({
                        from: "stage",
                        focus: "network",
                      })
                    }
                  />
                </div>
              </div>
            </TutorialWorkspace>
          )}
          console={({ open, toggle }) => (
            <ConsoleDrawer
              open={open}
              onToggle={toggle}
              tutorial={tutorial.frame ? terminal : undefined}
            />
          )}
          assistant={({ open, toggle, ...widen }) => (
            // No fill, so the conversation sits on the window's pattern, as
            // the prototype's does. A tutorial's chat never sits here: the
            // frame and the phone layout (5.1) show the one chat, `chatNode`
            <aside className="relative flex h-full w-full flex-col overflow-hidden">
              {/* The head carries "Collapse assistant", and Widen while the
                shell says it can widen. Hidden, the column takes no width and
                the stage bar carries "Expand assistant" (design.md, "Frame
                chrome (5.25)") */}
              {open && !onPhone && (
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

      {chatShown && (
        <OutletContent node={chatNode}>
          <TutorialChat
            onAllTutorials={() => catalogPage.open("tutorials", "nav")}
            onOpenMenu={() => openMenu.current()}
          />
        </OutletContent>
      )}
      <ModalHost />
      <ToastHost />
    </div>
  );
};

export default Flow;
