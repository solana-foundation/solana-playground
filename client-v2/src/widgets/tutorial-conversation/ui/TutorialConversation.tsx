/* eslint-disable max-params, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

import type { StepJumpVia } from "@/entities/tutorial";
import {
  docRequestFor,
  requestCode,
  requestDoc,
  slugOf,
} from "@/entities/tutorial";
import { isSignInFailure, PgSession, useSignedIn } from "@/features/auth";
import type {
  ConversationState,
  RunResult,
  Turn,
} from "@/features/tutorial-conversation";
import {
  isSignedOut,
  isUnconfirmed,
  isUnreachable,
  judgeGoal,
  PgCallPanel,
  PgConversation,
  realDeployWatch,
  realWorkspace,
  stepOfBeat,
  tutorialRunner,
  watchBuildSource,
  watchDeploys,
} from "@/features/tutorial-conversation";
import { useBalance, useWallet } from "@/hooks";
import { useViewport } from "@/shared/lib/hooks/use-viewport";
import { createLogger } from "@/shared/lib/logger";
import {
  BUTTON_FAILED_TOAST,
  markUnavailableHere,
  reportButtonFailure,
} from "@/shared/lib/report-button-failure";
import { Spinner } from "@/shared/ui/spinner";
import { PgProgramInfo, PgWallet } from "@/utils";
import { PgEditor } from "@/utils/editor";
import { PgExplorer } from "@/utils/explorer";
import { PgTutorial } from "@/utils/tutorial";
import { PgView } from "@/utils/view";
import { PgFlow } from "@/views/flow/state/stage";
import { PgAssistant } from "@/views/sidebar/assistant/store";

import {
  airdropContextOf,
  withAirdropContextFor,
} from "../model/airdrop-context";
import { explainPrompt, whenAnswered } from "../model/explain";
import type { FeedMarks } from "../model/marks";
import { marksOf } from "../model/marks";
import { mergeFeed } from "../model/merge";
import { tutorialMode } from "../model/mode";
import { announceDeploys } from "../model/runner";
import { tutorialTelemetry } from "../model/telemetry";
import BaseAnswer from "./BaseAnswer";
import BaseAskedBubble from "./BaseAskedBubble";
import BaseFeed from "./BaseFeed";
import { typing } from "./keys";
import { PhoneLayoutContext, phoneLayoutOf } from "./phone";
import type { TurnHandlers } from "./TurnView";
import TurnView from "./TurnView";

const log = createLogger("tutorial-conversation:feed");

/** How many lines sit above a line the feed shows in the editor */
const LINES_ABOVE = 8;
/**
 * How long typing rests before the engine reads the file for a question's
 * key line: the explorer announces every keystroke, and the engine needs only
 * where the typing stopped
 */
const EDIT_REST_MS = 300;

/**
 * The engine's state, re-rendering on every notification. Counted rather
 * than stored: when a turn falls due, the store's timer announces the same
 * state object (`_set` in `PgConversation`), and the view it then answers is
 * what moved; React would skip a `setState` of an object it already holds.
 */
export const useConversationState = (): ConversationState => {
  const [, render] = useReducer((n: number) => n + 1, 0);
  useEffect(() => PgConversation.onDidChange(render).dispose, []);
  return PgConversation.state;
};

/** Files whose read failed, so a card re-rendering logs it once, not per render */
const unreadable = new Set<string>();

/**
 * A workspace file's content as the explorer holds it, or null when there is
 * no such file or no workspace yet. Called while rendering, so it never
 * throws: a read that fails anyway is logged once per file and draws no lines.
 */
const read = (file: string): string | null => {
  if (!PgExplorer.currentWorkspaceName) return null;
  try {
    return (
      PgExplorer.getFileContent(PgExplorer.convertToFullPath(file)) ?? null
    );
  } catch (e) {
    if (!unreadable.has(file)) {
      unreadable.add(file);
      log.warn("could not read a file a card shows", {
        context: { file, error: e instanceof Error ? e.message : String(e) },
      });
    }
    return null;
  }
};

/** Where a file opens with a line in view, before the editor can scroll it */
const savePosition = (path: string, line: number) =>
  PgExplorer.saveEditorPosition(path, {
    cursor: { from: 0, to: 0 },
    topLineNumber: Math.max(1, line - LINES_ABOVE),
  });

/**
 * Show a file's `line` in the editor. The file already open scrolls the line
 * to a third of its height (`PgEditor.revealLine`); a file being opened reads
 * its saved position, set first, with eight lines above the line. A file the
 * workspace does not hold, or no workspace at all, is refused with a toast
 * (`reportButtonFailure`), never a throw out of the click.
 * TODO(tutorial-flow-v2 2.2): lighting the lines again is the editor's
 * (HOO-2349)
 *
 * @returns where the line is: `shown` in the open editor, `opening` while
 * the file opens, or null when it was refused
 */
const showLine = (file: string, line: number): "shown" | "opening" | null => {
  const refuse = reportButtonFailure(`open ${file}`);
  try {
    const path = PgExplorer.convertToFullPath(file);
    // A compiler's location, or a quote, can name a file the workspace does
    // not hold; saving a position for it would throw
    if (!PgExplorer.getFile(path)) {
      const missing = new Error(`${file} is not in this workspace`);
      markUnavailableHere(missing, "it is not in this project");
      refuse(missing);
      return null;
    }
    // Saved too for the open file: an editor not mounted yet reads it later
    savePosition(path, line);
    // The line is the point: a doc page in front gives way to the code
    requestCode();
    if (PgExplorer.currentFilePath === path) {
      PgEditor.revealLine(path, line);
      return "shown";
    }
    PgExplorer.openFile(path);
    return "opening";
  } catch (e) {
    // No workspace current (one switching), or the explorer refused the open
    refuse(e);
    return null;
  }
};

/**
 * A step's file at its top, after a jump to the step. The jump already moved
 * the feed; a step whose file is gone (renamed, or replaced by a later step's
 * start) leaves the editor as it is rather than raising a failure for it.
 */
const showStepFile = (file: string) => {
  let there: boolean;
  try {
    there = !!PgExplorer.getFile(PgExplorer.convertToFullPath(file));
  } catch (e) {
    // No workspace current, one switching: the feed moved; the editor waits
    log.debug("no workspace to open a jumped-to step's file in", {
      context: { file, error: e instanceof Error ? e.message : String(e) },
    });
    return;
  }
  if (!there) {
    log.debug("a jumped-to step's file is not in the workspace", {
      context: { file },
    });
    return;
  }
  showLine(file, 1);
};

/**
 * Open `file` in the editor now, and again once a later create in the
 * workspace leaves it there. Entering a step writes its start files after
 * the engine's state has moved on (the store drains its effects), and on
 * Start the preview's tab did not survive step 1's start files being written
 * over it (seen in the browser, 2 Nov 2026), so opening once at the move was
 * not enough.
 *
 * @returns a disposer for the subscription
 */
const openWhenWritten = (file: string): (() => void) => {
  const path = PgExplorer.convertToFullPath(file);
  if (PgExplorer.getFile(path)) PgExplorer.openFile(path);
  const created = PgExplorer.onDidCreateItem(() => {
    if (!PgExplorer.getFile(path)) return;
    created.dispose();
    PgExplorer.openFile(path);
  });
  return () => created.dispose();
};

/**
 * The step the lesson enters opens its main file, as the spec's "the
 * workspace swaps the preview for the step's start files" reads. The first
 * cursor of each load (`ConversationState.loadedAt`) is not an entry: the
 * store reads the save after the first render, and a reload restores the
 * workspace's own tabs.
 */
const useOpenEnteredStep = (state: ConversationState) => {
  const cursor = state.engine.progress.cursor;
  const stepId = cursor.kind === "step" ? cursor.stepId : null;
  const { context, loadedAt } = state;
  const seen = useRef<{ loadedAt: number; stepId: string | null } | null>(null);
  useEffect(() => {
    const before = seen.current;
    seen.current = { loadedAt, stepId };
    // No save yet, or a load: nothing was entered
    if (!context || !before || before.loadedAt !== loadedAt) return;
    if (!stepId || stepId === before.stepId) return;
    const step = context.definition.steps.find((s) => s.id === stepId);
    return step ? openWhenWritten(step.file) : undefined;
  }, [stepId, loadedAt, context]);
};

/**
 * The finished program beside the intro card is a preview, read only as the
 * spec's "A tutorial opens on its intro card" has it: the editor refuses
 * typing until Start, and again after Start over. On the phone Code is read
 * only throughout (tutorial-phone, "Chat and Code are two spaces"). Leaving
 * the tutorial, or widening past the frame's width after Start, unlocks it.
 */
const useLockedPreview = (state: ConversationState, phone: boolean) => {
  const locked =
    !!state.context && (phone || state.engine.progress.cursor.kind === "intro");
  useEffect(() => {
    if (!locked) return;
    const hold = PgEditor.holdReadOnly("preview");
    return () => hold.dispose();
  }, [locked]);
};

/** Marks that failed to compute, by message, so a re-render logs each once */
const unmarked = new Set<string>();

/**
 * The feed's marks for a file of the open tutorial, or null outside one.
 * Computed while the frame renders, so it never throws: marks are
 * decoration, and a failure here draws no lines rather than taking the
 * workspace down.
 */
const marksNow = (file: string): FeedMarks | null => {
  try {
    const context = PgConversation.state.context;
    const view = PgConversation.view();
    if (!context || !view) return null;
    return marksOf(context.definition, view, read)(file);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!unmarked.has(message)) {
      unmarked.add(message);
      log.error(e, { report: true, context: { file, what: "line marks" } });
    }
    return null;
  }
};

/**
 * Hands the engine a file the learner changed, as the explorer holds it.
 * The engine reads it for an open question's key line and ignores a file no
 * question writes to.
 */
const sendEdit = (path: string) => {
  try {
    if (!PgConversation.state.context || !PgExplorer.currentWorkspaceName) {
      return;
    }
    const content = PgExplorer.getFileContent(path);
    if (content === undefined) {
      // Renamed or deleted while the typing rested: nothing left to read
      log.debug("an edited file is gone before the engine read it", {
        context: { path },
      });
      return;
    }
    PgConversation.edit(PgExplorer.getRelativePath(path), content);
  } catch (e) {
    // A workspace switching under the timer; the next change sends again
    log.warn("could not hand the engine an edit", {
      context: { path, error: e instanceof Error ? e.message : String(e) },
    });
  }
};

/**
 * Show a file's line and put the caret there. The editor stays mounted and
 * swaps its file as the open lands, so it takes focus a frame later; a
 * refused open leaves the focus alone.
 */
const showLineWithCaret = (file: string, line: number) => {
  const shown = showLine(file, line);
  if (shown === "shown") PgEditor.focus();
  if (shown === "opening") requestAnimationFrame(() => PgEditor.focus());
};

/**
 * The editor and the engine, both ways. A change to the open file reaches
 * the engine (`edit`) once the typing rests, so a question's key line typed
 * by hand resolves it; the file is taken when it changes, and a change to
 * another file first sends the pending one, so a quick tab switch never
 * sends the wrong file. The engine's request for the caret ("Type it
 * myself", "I'll fix it myself") opens the file at the line, the landing as
 * the feed draws it, and focuses the editor unless the open was refused.
 */
const useEditorLink = () => {
  useEffect(() => {
    let pending: { path: string; timer: number } | null = null;
    const flush = () => {
      if (!pending) return;
      window.clearTimeout(pending.timer);
      const { path } = pending;
      pending = null;
      sendEdit(path);
    };
    const saved = PgExplorer.onDidSaveFile(() => {
      const path = PgExplorer.currentFilePath;
      if (!path) return;
      if (pending && pending.path !== path) flush();
      if (pending) window.clearTimeout(pending.timer);
      pending = { path, timer: window.setTimeout(flush, EDIT_REST_MS) };
    });

    const focus = PgConversation.onDidRequestFocus(({ file, line }) => {
      const at =
        line === "landing" ? marksNow(file)?.landing?.lines[0] ?? 1 : line;
      showLineWithCaret(file, at);
    });
    return () => {
      if (pending) window.clearTimeout(pending.timer);
      saved.dispose();
      focus.dispose();
    };
  }, []);
};

/**
 * The feed's line marks for the workspace's editor (`TutorialWorkspace`'s
 * `marks`). They refresh on each notification of the conversation, so the
 * landing follows the lesson and the typing once it has rested, not each
 * keystroke.
 */
export const useConversationMarks = () => {
  useConversationState();
  return (file: string) => {
    const marks = marksNow(file);
    if (!marks) return {};
    return {
      written: [...marks.written],
      arriving: marks.arriving,
      landing: marks.landing,
    };
  };
};

/** The first line, counted from 1, where `after` differs from `before` */
const firstChange = (before: string, after: string): number => {
  const a = before.split("\n");
  const b = after.split("\n");
  const i = b.findIndex((line, n) => line !== a[n]);
  return i === -1 ? 1 : i + 1;
};

/**
 * "Show me the fix": the engine writes the step's target into its file, and
 * the editor shows the first line that changes, where the fix lands.
 */
const showFix = (beatId: string) => {
  const definition = PgConversation.state.context?.definition;
  const step = definition ? stepOfBeat(definition, beatId) : null;
  const target = step?.target[step.file];
  if (!step || target === undefined) return;
  const line = firstChange(read(step.file) ?? "", target);
  PgConversation.showFix(beatId);
  showLine(step.file, line);
};

/**
 * The tutorial's runner, announcing each deploy and build-and-deploy to
 * `PgFlow`: the terminal bar, the drawer's first open and the amber
 * "changed since the last deploy" follow it as they follow the deploy command.
 */
const runner = announceDeploys(
  tutorialRunner,
  PgFlow,
  () => PgExplorer.currentWorkspaceName
);

/**
 * "Create wallet" on a deploy that found none: the Playground wallet, made in
 * this browser as the Setup modal makes it (`PgWallet.add` makes it the
 * current wallet too), then the deploy runs again.
 */
const createWallet = (beatId: string) => {
  if (!PgWallet.accounts.length) PgWallet.add();
  PgConversation.act(beatId);
};

/**
 * "Sign in with GitHub" on a build the server refused for sign-in: GitHub in
 * a popup, so the page and the step stay where they are; once signed in the
 * card offers Build (HOO-2661)
 */
const signIn = () =>
  // `from`: the session effect keeps the tutorial open rather than opening
  // the account's newest project
  PgSession.signInFor("tutorial")([]).catch(signInFailed);

/**
 * A sign-in that did not finish. A closed or blocked popup is expected and
 * its own words say what to do, as the assistant's sign-in shows them; any
 * other failure is a button's failure.
 */
const signInFailed = (error: unknown) => {
  if (!isSignInFailure(error)) return reportButtonFailure("sign in")(error);
  log.info("sign-in from the build card did not finish", {
    context: { error: String(error) },
  });
  const text = (error as Error).message;
  PgView.setToast(() => <span>{text}</span>, {
    options: { name: BUTTON_FAILED_TOAST, id: BUTTON_FAILED_TOAST },
  });
};

/**
 * A refusal for sign-in while this browser thinks someone is signed in: the
 * session expired on the server. Read it again, so the card offers the
 * sign-in rather than a Build the server refuses on every press.
 */
const useSessionCheckOnRefusal = (live: Turn | undefined | null) => {
  const refusedId =
    live?.kind === "result" && isSignedOut(live.result) ? live.id : undefined;
  useEffect(() => {
    if (!refusedId || !PgSession.get()) return;
    PgSession.refresh().catch((error: unknown) => {
      // The card keeps offering Build; the next refusal asks again
      log.warn("could not read the session after a refusal for sign-in", {
        context: { error: String(error) },
      });
    });
  }, [refusedId]);
};

/**
 * ⌘↵ on an open result: the card's one way on. A build server that never
 * answered builds again; a refusal for sign-in signs in, or builds once
 * someone is; a transaction devnet has not read back is checked again; any
 * other failure is explained.
 */
const pressResult = (beatId: string, result: RunResult) => {
  if (isUnconfirmed(result)) {
    PgConversation.recheck(beatId);
  } else if (
    isUnreachable(result) ||
    (isSignedOut(result) && PgSession.get())
  ) {
    PgConversation.act(beatId);
  } else if (isSignedOut(result)) {
    void signIn();
  } else {
    PgConversation.explain(beatId);
  }
};

/** Where a copy the clipboard refused is told */
const copyFailed = reportButtonFailure("copy it");

export interface TutorialConversationProps {
  /** Open the catalog's Tutorials page */
  onAllTutorials: () => void;
  /** Open the frame's navigation, for the live assistant's open_menu tool */
  onOpenMenu: () => void;
}

/**
 * The live assistant in its tutorial mode while the feed is shown: the
 * lesson's context, reading tools and its four tools (`tutorialMode`), and
 * none of the assistant's own writing or running tools. The menu opener may change between renders; the
 * mode reads the latest.
 */
const useAssistantMode = (onOpenMenu: () => void) => {
  // The thread's exchanges are part of the feed: a reply streaming in redraws it
  const [, render] = useReducer((n: number) => n + 1, 0);
  useEffect(() => PgAssistant.onDidChange(render).dispose, []);
  const openMenu = useRef(onOpenMenu);
  useEffect(() => {
    openMenu.current = onOpenMenu;
  }, [onOpenMenu]);
  useEffect(
    () =>
      PgAssistant.setMode(tutorialMode({ openMenu: () => openMenu.current() }))
        .dispose,
    []
  );
  // A turn begun before the tutorial opened keeps the tools it started with,
  // and may still ask to write: a tutorial never allows it, and the feed
  // draws no approval card, so it is declined at once and the model answers
  useEffect(() => {
    let scheduled = false;
    const decline = () => {
      scheduled = false;
      const pending = PgAssistant.items.some(
        (i) => i.kind === "approval" && i.status === "pending"
      );
      if (!pending) return;
      log.info(
        "declined an approval a turn begun before the tutorial asked for"
      );
      PgAssistant.cancelPending();
    };
    // After the change that announced it: `requestApproval` announces the
    // card before it registers the answer that `cancelPending` gives
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(decline);
    };
    schedule();
    return PgAssistant.onDidChange(schedule).dispose;
  }, []);
};

/**
 * The handlers that read no prop and no definition; `TutorialConversation`
 * adds the ones that do (the next tutorial, All tutorials, the menu) and Copy
 * receipt's count
 */
const handlers: Omit<
  TurnHandlers,
  "openNextTutorial" | "allTutorials" | "openMenu" | "copyReceipt"
> = {
  start: () => PgConversation.start(),
  pick: (beatId, option) => PgConversation.pick(beatId, option),
  hint: (beatId) => PgConversation.hint(beatId),
  skip: (beatId) => PgConversation.skip(beatId),
  typeIt: (beatId) => PgConversation.typeIt(beatId),
  act: (beatId, args) => PgConversation.act(beatId, args),
  recheck: (beatId) => PgConversation.recheck(beatId),
  explain: (beatId) => PgConversation.explain(beatId),
  fixMyself: (beatId) => PgConversation.fixMyself(beatId),
  showFix,
  next: () => PgConversation.next(),
  restartStep: () => PgConversation.restartStep(),
  showLine,
  revealError: showLineWithCaret,
  openCall: () => PgCallPanel.show(),
  copyFailed: (error) => copyFailed(error),
  apply: (id) => PgConversation.apply(id),
  keep: (id) => PgConversation.keep(id),
  showLog: () => PgConversation.showLog(),
  createWallet,
  signIn,
};

/**
 * The tutorial a definition's `finish.next` names, by its slug among the
 * listed ones, or null. The loader drops a definition whose `next` names no
 * known tutorial, so a set `next` almost always finds one; it finds none
 * when it names a definition that was itself left out.
 */
const nextTutorialOf = (next: string | null): string | null =>
  next === null
    ? null
    : PgTutorial.all.find((t) => slugOf(t.name) === next)?.name ?? null;

/**
 * The tutorial conversation in the frame's chat: it starts the engine for the
 * open workspace, draws the feed from the engine's view merged with the live
 * assistant's thread (`mergeFeed`), and turns each card's press into the
 * engine's action. While it is mounted the assistant runs in the tutorial's
 * mode (`tutorialMode`): the lesson's context, reading tools, and no writing
 * or running. ⌘↵ presses the live act, or Explain on an open failure, unless
 * the learner is typing; a call act with arguments waits for its own fields,
 * where Enter sends. The finish card's "All tutorials" and the assistant's
 * menu open what other widgets own, so the frame passes both in.
 */
export const TutorialConversation = ({
  onAllTutorials,
  onOpenMenu,
}: TutorialConversationProps) => {
  useAssistantMode(onOpenMenu);
  useEffect(
    () =>
      PgConversation.init({
        workspace: realWorkspace,
        runner,
        judge: judgeGoal,
      }).dispose,
    []
  );
  // Every build's source, so a deploy can tell an edit since the last
  // passing build (`watchBuildSource`); once the globals exist
  useEffect(() => watchBuildSource(), []);
  // A deploy outside the cards, through the deploy command, is the program
  // the Call panel and the call acts talk to (`watchDeploys`)
  useEffect(
    () =>
      watchDeploys((idl) => PgConversation.deployed(idl), realDeployWatch())
        .dispose,
    []
  );
  // An unplanned failure's Explain goes to the assistant with its log; once
  // its answer ends, the engine offers "Show me the fix"
  useEffect(() => {
    const waits = new Set<() => void>();
    const sub = PgConversation.onDidRequestExplain(({ beatId, result }) => {
      PgAssistant.requestPrompt(explainPrompt(result), { send: true });
      // With no assistant connected the answer comes at once, inside the call
      let answered = false;
      let cancel: (() => void) | undefined;
      cancel = whenAnswered(PgAssistant, () => {
        answered = true;
        if (cancel) waits.delete(cancel);
        PgConversation.answered(beatId);
      });
      if (!answered) waits.add(cancel);
    });
    return () => {
      sub.dispose();
      waits.forEach((cancel) => cancel());
    };
  }, []);
  const state = useConversationState();
  const context = state.context;
  useOpenEnteredStep(state);
  useEditorLink();
  const view = PgConversation.view();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "Enter" || typing(e.target)) {
        return;
      }
      const live = PgConversation.view()?.live;
      // A call with a field to fill waits for it, where Enter sends
      const fields =
        live?.kind === "act" && live.act.act === "call"
          ? (live.act.call.args ?? []).filter((a) => typeof a === "string")
          : [];
      if (live?.kind === "act" && !fields.length) {
        e.preventDefault();
        PgConversation.act(live.beatId);
      } else if (live?.kind === "result" && live.open) {
        e.preventDefault();
        pressResult(live.beatId, live.result);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Read by the jump, which is made before the layout's own line below
  const onPhone = useRef(false);
  const onJump = useCallback(
    (index: number, from: number, via: StepJumpVia) => {
      const definition = PgConversation.state.context?.definition;
      const slug = PgConversation.state.context?.slug;
      if (!definition || !slug) return;
      tutorialTelemetry.track("tutorial_step_jumped", {
        tutorial: slug,
        step: index + 1,
        from: from + 1,
        via,
      });
      // On the phone a picked step takes the chat back to its divider
      // (tutorial-phone); opening its file would slide the screen to Code
      if (!onPhone.current) showStepFile(definition.steps[index].file);
    },
    []
  );
  const onBack = useCallback((step: number | null) => {
    const slug = PgConversation.state.context?.slug;
    if (!slug) return;
    tutorialTelemetry.track("tutorial_step_back", {
      tutorial: slug,
      step: step === null ? 0 : step + 1,
    });
  }, []);

  const next = context?.definition.finish.next ?? null;
  // Read each render: the tutorial list is the app's, not this component's
  const nextTutorial = nextTutorialOf(next);
  const viewport = useViewport();
  // Below the frame's width the feed runs in the phone layout: the header
  // draws the steps, and typing code is left to the desktop
  const layout = useMemo(() => phoneLayoutOf(viewport), [viewport]);
  const phone = layout.phone;
  onPhone.current = phone;
  // Until the session read answers, a refused build offers the sign-in
  const signedIn = useSignedIn() ?? false;
  // The live airdrop card reads the wallet it funds
  const wallet = useWallet();
  const balance = useBalance();
  const withAirdropLine = withAirdropContextFor(
    airdropContextOf({
      wallet: wallet
        ? {
            address: wallet.publicKey.toBase58(),
            balance: typeof balance === "number" ? balance : undefined,
            playground: !!wallet.isPg,
          }
        : undefined,
      hasAccounts: PgWallet.accounts.length > 0,
    })
  );
  useSessionCheckOnRefusal(view?.live);
  useLockedPreview(state, phone);
  const on = useMemo<TurnHandlers>(
    () => ({
      ...handlers,
      // The panel lives in the desktop's workspace; on the phone Code's head
      // holds Call
      openCall: phone ? undefined : handlers.openCall,
      typeIt: phone ? undefined : handlers.typeIt,
      openNextTutorial: () => {
        const slug = PgConversation.state.context?.slug;
        if (!nextTutorial || !next || !slug) {
          // The button only shows with a next tutorial; a context gone
          // mid-switch is the one way here
          log.warn("Next on the finish card had nothing to open", {
            context: { next, slug: slug ?? null },
          });
          return;
        }
        // Counted once it opened: a failed open is the toast's, not a learner
        // going on
        PgTutorial.open(nextTutorial)
          .then(() =>
            tutorialTelemetry.track("tutorial_next_opened", {
              tutorial: slug,
              next,
            })
          )
          .catch(reportButtonFailure(`open ${nextTutorial}`));
      },
      allTutorials: onAllTutorials,
      openMenu: onOpenMenu,
      copyReceipt: () => {
        const slug = PgConversation.state.context?.slug;
        if (slug) {
          tutorialTelemetry.track("tutorial_receipt_copied", {
            tutorial: slug,
          });
        }
      },
    }),
    [next, nextTutorial, onAllTutorials, onOpenMenu, phone]
  );

  if (!context || !view) {
    return (
      <div className="grid flex-1 place-items-center">
        <Spinner aria-label="Loading the tutorial" className="size-5" />
      </div>
    );
  }

  const progress = state.engine.progress;
  // A link to one of the tutorial's docs opens it as a tab beside the files;
  // with no workspace to show it, the link opens as a link
  const handleLink = (href: string) => {
    const request = docRequestFor(context.definition.docs)(href);
    return request ? requestDoc(request) : false;
  };
  const running = view.turns.some(
    (t) => t.kind === "act" && t.state === "running"
  );
  return (
    <PhoneLayoutContext.Provider value={layout}>
      <BaseFeed
        bar={!phone}
        entries={mergeFeed(
          view.turns,
          PgAssistant.items,
          progress.restartedAt,
          state.loadedAt
        )}
        renderExchange={(entry) =>
          entry.kind === "asked" ? (
            <BaseAskedBubble text={entry.text} />
          ) : (
            <BaseAnswer
              text={entry.text}
              tone={entry.tone}
              onLink={handleLink}
            />
          )
        }
        live={view.live}
        steps={view.steps}
        onJump={onJump}
        onBack={onBack}
        renderTurn={(turn, live) => (
          <TurnView
            turn={withAirdropLine(turn)}
            definition={context.definition}
            live={live}
            running={running}
            passed={progress.passed}
            read={read}
            nextTutorial={nextTutorial}
            programId={PgProgramInfo.pk?.toBase58() ?? null}
            signedIn={signedIn}
            on={on}
          />
        )}
      />
    </PhoneLayoutContext.Provider>
  );
};

/**
 * Whether the learner has pressed Start on `name`'s intro card. False while
 * the conversation holds another tutorial or none, as on a cold load before
 * the save is read: the intro offers nothing but Start until then.
 */
export const useConversationStarted = (name: string): boolean => {
  const state = useConversationState();
  return (
    state.context?.definition.name === name &&
    state.engine.progress.startedAt !== null
  );
};

/** What the frame's head needs from the conversation: Start over, and the steps passed */
export const useConversationStartOver = () => {
  const state = useConversationState();
  if (!state.context) return { onStartOver: undefined, passed: undefined };
  return {
    onStartOver: async () => PgConversation.startOver(),
    passed: state.engine.progress.passed.length,
  };
};
