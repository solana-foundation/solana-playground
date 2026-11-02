import { useCallback, useEffect, useReducer, useRef } from "react";

import {
  PgConversation,
  judgeGoal,
  realWorkspace,
  unwiredRunner,
} from "@/features/tutorial-conversation";
import type { ConversationState } from "@/features/tutorial-conversation";
import type { StepJumpVia } from "@/entities/tutorial";
import { createLogger } from "@/shared/lib/logger";
import {
  markUnavailableHere,
  reportButtonFailure,
} from "@/shared/lib/report-button-failure";
import { Spinner } from "@/shared/ui/spinner";
import { PgEditor } from "@/utils/editor";
import { PgExplorer } from "@/utils/explorer";
import { barProgress } from "../model/step-bar";
import { tutorialTelemetry } from "../model/telemetry";
import BaseFeed from "./BaseFeed";
import TurnView from "./TurnView";
import type { TurnHandlers } from "./TurnView";
import { typing } from "./keys";

const log = createLogger("tutorial-conversation:feed");

/** How many lines sit above a line the feed shows in the editor */
const LINES_ABOVE = 8;

/**
 * The engine's state, re-rendering on every notification. Counted rather
 * than stored: when a turn falls due, the store's timer announces the same
 * state object (`_set` in `PgConversation`), and the view it then answers is
 * what moved; React would skip a `setState` of an object it already holds.
 */
const useConversationState = (): ConversationState => {
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
 */
const showLine = (file: string, line: number) => {
  const refuse = reportButtonFailure(`open ${file}`);
  try {
    const path = PgExplorer.convertToFullPath(file);
    // A compiler's location, or a quote, can name a file the workspace does
    // not hold; saving a position for it would throw
    if (!PgExplorer.getFile(path)) {
      const missing = new Error(`${file} is not in this workspace`);
      markUnavailableHere(missing, "it is not in this project");
      refuse(missing);
      return;
    }
    // Saved too for the open file: an editor not mounted yet reads it later
    savePosition(path, line);
    if (PgExplorer.currentFilePath === path) PgEditor.revealLine(path, line);
    else PgExplorer.openFile(path);
  } catch (e) {
    // No workspace current (one switching), or the explorer refused the open
    refuse(e);
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
 * typing until Start, and again after Start over. Leaving the tutorial
 * unlocks it.
 */
const useLockedPreview = (state: ConversationState) => {
  const onIntro =
    !!state.context && state.engine.progress.cursor.kind === "intro";
  useEffect(() => {
    if (!onIntro) return;
    PgEditor.setReadOnly(true);
    return () => PgEditor.setReadOnly(false);
  }, [onIntro]);
};

const handlers: TurnHandlers = {
  start: () => PgConversation.start(),
  pick: (beatId, option) => PgConversation.pick(beatId, option),
  hint: (beatId) => PgConversation.hint(beatId),
  skip: (beatId) => PgConversation.skip(beatId),
  act: (beatId, args) => PgConversation.act(beatId, args),
  explain: (beatId) => PgConversation.explain(beatId),
  fixMyself: (beatId) => PgConversation.fixMyself(beatId),
  next: () => PgConversation.next(),
  restartStep: () => PgConversation.restartStep(),
  showLine,
};

/**
 * The tutorial conversation in the frame's chat: it starts the engine for the
 * open workspace, draws the feed from the engine's view, and turns each
 * card's press into the engine's action. ⌘↵ presses the live act, or Explain
 * on an open failure, unless the learner is typing; a call act with arguments
 * waits for its own fields, where Enter sends.
 */
export const TutorialConversation = () => {
  useEffect(
    () =>
      PgConversation.init({
        workspace: realWorkspace,
        // TODO(tutorial-flow-v2 4.1): the run tickets (4.1 to 4.3) replace
        // the unwired runner; until then every act ends in its failed card
        runner: unwiredRunner,
        judge: judgeGoal,
      }).dispose,
    []
  );
  const state = useConversationState();
  const context = state.context;
  useOpenEnteredStep(state);
  useLockedPreview(state);
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
        PgConversation.explain(live.beatId);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

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
      showStepFile(definition.steps[index].file);
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

  if (!context || !view) {
    return (
      <div className="grid flex-1 place-items-center">
        <Spinner aria-label="Loading the tutorial" className="size-5" />
      </div>
    );
  }

  const progress = state.engine.progress;
  const running = view.turns.some(
    (t) => t.kind === "act" && t.state === "running"
  );
  return (
    <BaseFeed
      turns={view.turns}
      live={view.live}
      steps={view.steps}
      progress={barProgress(context.definition, progress)}
      onJump={onJump}
      onBack={onBack}
      renderTurn={(turn, live) => (
        <TurnView
          turn={turn}
          definition={context.definition}
          live={live}
          running={running}
          passed={progress.passed}
          read={read}
          on={handlers}
        />
      )}
    />
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
