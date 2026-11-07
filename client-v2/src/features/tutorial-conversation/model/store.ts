/* eslint-disable layers/curry-order, max-params, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import type { Idl } from "@coral-xyz/anchor";

import type { TutorialDefinition } from "@/entities/tutorial";
import { slugOf } from "@/entities/tutorial";
import { createLogger } from "@/shared/lib/logger";

import { PgExplorer } from "../../../utils/explorer/explorer";
import { writeWorkspaceFile } from "../../../utils/explorer/workspace-file";
import { PgTutorial, storageDataPath } from "../../../utils/tutorial/tutorial";
import type { Disposable } from "../../../utils/types";
import { PgView } from "../../../utils/view";
import { judgeGoal } from "./goals";
import { groundOf, insertBlock, typedKey, withOwnText } from "./landing";
import type { Judge, RunInput, Runner, Workspace } from "./ports";
import { failedResult } from "./ports";
import type {
  ApplyFailure,
  ConversationProgress,
  Cursor,
  PassedVia,
  RunResult,
  UnreadTx,
} from "./progress";
import { freshProgress, parseProgress } from "./progress";
import { WorkspaceMovedError } from "./real-workspace";
import type { Action, Effect, EngineContext, EngineState } from "./reducer";
import {
  actOf,
  INITIAL_ENGINE_STATE,
  panelInput,
  reduce,
  stepOfBeat,
} from "./reducer";
import { route } from "./route";
import { tutorialTelemetry } from "./telemetry";
import type { ConversationView } from "./view";
import { isLaterAirdrop, view } from "./view";

const log = createLogger("tutorial-conversation:store");

/** An effect that reads or writes the workspace's files */
const touchesFiles = (effect: Effect): boolean =>
  effect.kind === "restore" ||
  effect.kind === "apply" ||
  effect.kind === "create" ||
  effect.kind === "write";

/** A file effect the lesson's script queued, not the learner's Apply: it
 * belongs to the walk it was queued in. An Apply checks its own line. */
const isScripted = (effect: Effect): boolean =>
  effect.kind === "restore" ||
  effect.kind === "create" ||
  effect.kind === "write";

/** The store's state: a context while the open workspace is a conversation tutorial */
export interface ConversationState {
  /** Null whenever the open workspace is not a tutorial with a definition */
  context: EngineContext | null;
  engine: EngineState;
  /**
   * Set when the load could not tell a clean first visit (no saved file) from
   * a read that failed or a file holding something this engine never wrote.
   * The store refuses to write while this is set: overwriting a real save with
   * a fresh one would be worse than keeping this session in memory.
   */
  loadFailed: boolean;
  /** When the save was loaded: turns from before it render whole */
  loadedAt: number;
  /**
   * Later airdrop acts whose funded check is pending, or whose press that
   * check made still runs, by beat id: the feed hides them meanwhile
   * (`ViewOptions.probing`). Never saved
   */
  probing: readonly string[];
}

export const INITIAL_CONVERSATION_STATE: ConversationState = {
  context: null,
  engine: INITIAL_ENGINE_STATE,
  loadFailed: false,
  loadedAt: 0,
  probing: [],
};

/** The key under which the engine saves in the tutorial's storage */
export const STORAGE_KEY = "conversation";

/**
 * How long a later airdrop card stays hidden waiting for the balance check:
 * a devnet read that hangs must not leave the feed with nothing to press. A
 * late "funded" still presses the card, now shown
 */
export const PROBE_TIMEOUT_MS = 5000;

/**
 * The storage file of a tutorial's workspace, as a full path. Reads and
 * writes go to this path, resolved once from the tutorial's name, so a
 * workspace switch while one is in flight cannot move it to the next
 * workspace (`PgTutorial.getStorage` resolves against the open one at write
 * time, which is why the store does not use it).
 */
const storagePath = (name: string) =>
  `${PgExplorer.PATHS.ROOT_DIR_PATH}${name}/${storageDataPath()}`;

export interface ConversationPorts {
  workspace: Workspace;
  /** Required: a frame that forgets it fails to compile, rather than ship a
   * lesson whose every act fails with "not wired" */
  runner: Runner;
  /** Required, so a frame or a test says which judge it means. `judgeGoal`
   * is the real one, and the store's fallback when a tutorial opens before
   * `init`: a judge that passed any ok result would pass step 4 on the
   * upgrade before any call */
  judge: Judge;
}

/**
 * The conversation tutorial the learner is in, if any.
 *
 * One entry point: the cards and the composer call the methods below, each
 * of which is one reducer action. The reducer's effects are drained here,
 * through the ports `init` was given, and every change to the save (never a
 * stage change, and nothing while the load failed) is written under
 * `conversation` in the tutorial's own storage file, which project sync
 * carries.
 */
export class PgConversation {
  static get state(): ConversationState {
    return PgConversation._state;
  }

  /** The feed's turns and the live card at `now`, memoized per state and time */
  static view(now = Date.now()): ConversationView | null {
    const s = PgConversation._state;
    if (!s.context) return null;
    if (PgConversation._viewOf !== s || PgConversation._viewAt !== now) {
      PgConversation._view = view(s.context.definition, s.engine, {
        now,
        loadedAt: s.loadedAt,
        probing: s.probing,
      });
      PgConversation._viewOf = s;
      PgConversation._viewAt = now;
    }
    return PgConversation._view;
  }

  static onDidChange(cb: (s: ConversationState) => void): Disposable {
    PgConversation._listeners.add(cb);
    cb(PgConversation._state);
    return { dispose: () => PgConversation._listeners.delete(cb) };
  }

  /** "Type it myself", or "I'll fix it myself": where the caret should go */
  static onDidRequestFocus(
    cb: (focus: { file: string; line: number | "landing" }) => void
  ): Disposable {
    PgConversation._focusListeners.add(cb);
    return { dispose: () => PgConversation._focusListeners.delete(cb) };
  }

  /** An unplanned failure to explain through the live assistant */
  static onDidRequestExplain(
    cb: (request: { beatId: string; result: RunResult }) => void
  ): Disposable {
    PgConversation._explainListeners.add(cb);
    return { dispose: () => PgConversation._explainListeners.delete(cb) };
  }

  /**
   * A result card's Log: the workspace that holds the terminal opens it.
   * With no workspace listening (none mounted, or not active) a press does
   * nothing.
   */
  static onDidRequestLog(cb: () => void): Disposable {
    PgConversation._logListeners.add(cb);
    return { dispose: () => PgConversation._logListeners.delete(cb) };
  }

  /**
   * Open the terminal, where the run printed its lines. A listener that
   * throws is logged, and the others still hear it.
   */
  static showLog() {
    for (const cb of PgConversation._logListeners) {
      try {
        cb();
      } catch (e) {
        log.error(e, { report: true, context: { what: "open the terminal" } });
      }
    }
  }

  static start() {
    PgConversation._dispatch({ type: "start", at: Date.now() });
  }

  static pick(beatId: string, option: number) {
    PgConversation._dispatch({ type: "pick", beatId, option, at: Date.now() });
  }

  /**
   * The question's hint: its H key or Hint button, or the live assistant's
   * Hint tool (`byAssistant`), which posts it with no "I'm stuck" pill
   */
  static hint(beatId: string, opts: { byAssistant?: boolean } = {}) {
    PgConversation._dispatch(
      opts.byAssistant
        ? { type: "hint", beatId, at: Date.now(), byAssistant: true }
        : { type: "hint", beatId, at: Date.now() }
    );
  }

  /** The question's Skip button */
  static skip(beatId: string) {
    PgConversation._dispatch({ type: "skip", beatId, at: Date.now() });
  }

  static typeIt(beatId: string) {
    PgConversation._dispatch({ type: "typeIt", beatId, at: Date.now() });
  }

  /** The learner changed a file; `content` is the whole file now */
  static edit(file: string, content: string) {
    PgConversation._dispatch({ type: "edit", file, content, at: Date.now() });
  }

  /** An act card pressed, or its composer word */
  static act(beatId: string, args?: Record<string, string>) {
    PgConversation._dispatch({ type: "act", beatId, args, at: Date.now() });
  }

  /** "Check again" on an unconfirmed run or call: reads, never sends */
  static recheck(beatId: string) {
    PgConversation._dispatch({
      type: "act",
      beatId,
      recheck: true,
      at: Date.now(),
    });
  }

  /** A step's goal met outside the feed: the Call panel or a client run */
  static passed(via: Exclude<PassedVia, "chat">, result: RunResult) {
    PgConversation._dispatch({ type: "passed", via, result, at: Date.now() });
  }

  /**
   * The program deployed outside the cards (`watchDeploys`): the Call panel
   * and the call acts go on with its IDL, or the tutorial's shipped one when
   * it ships one or the build returned none
   */
  static deployed(idl: Idl | undefined) {
    PgConversation._dispatch({
      type: "deployed",
      ...(idl ? { idl } : {}),
      at: Date.now(),
    });
  }

  /**
   * A Call panel call, through the same runner as the call act, and into the
   * engine as a `passed`: the result stays in the panel, and the feed shows
   * only the win it may bring. Cards do not wait for it: one pressed mid-call
   * reports the capture as busy and can be pressed again.
   */
  static callFromPanel(
    call: NonNullable<RunInput["call"]>
  ): Promise<RunResult> {
    return PgConversation._runFromPanel((input) => input, call);
  }

  /**
   * The panel's Check again on a call devnet has not read back: reads what it
   * sent, sends nothing
   */
  static recheckFromPanel(
    unconfirmed: UnreadTx[],
    call: NonNullable<RunInput["call"]>
  ): Promise<RunResult> {
    return PgConversation._runFromPanel(
      (input) => ({ ...input, recheck: unconfirmed }),
      call
    );
  }

  private static async _runFromPanel(
    withInput: (input: RunInput) => RunInput,
    call: NonNullable<RunInput["call"]>
  ): Promise<RunResult> {
    const { context, engine } = PgConversation._state;
    const ports = PgConversation._ports;
    if (!context || !ports) {
      return failedResult("call", "Open the tutorial's lesson first.");
    }
    let result: RunResult;
    try {
      result = await ports.runner.run(
        "call",
        withInput(panelInput(context.definition, engine.progress, call)),
        () => {}
      );
    } catch (e) {
      log.error(e, { report: true });
      result = failedResult("call", e instanceof Error ? e.message : String(e));
    }
    // Another tutorial opened, or this one started over: not its step's call
    const now = PgConversation._state;
    if (
      now.context?.definition.name === context.definition.name &&
      now.engine.progress.restartedAt === engine.progress.restartedAt
    ) {
      PgConversation.passed("call_panel", result);
    }
    return result;
  }

  static explain(beatId: string) {
    PgConversation._dispatch({ type: "explain", beatId, at: Date.now() });
  }

  /** The assistant's answer to an unplanned failure's Explain has ended */
  static answered(beatId: string) {
    PgConversation._dispatch({ type: "answered", beatId, at: Date.now() });
  }

  /** "Show me the fix": write the step's target into its file */
  static showFix(beatId: string) {
    PgConversation._dispatch({ type: "showFix", beatId, at: Date.now() });
  }

  static fixMyself(beatId: string) {
    PgConversation._dispatch({ type: "fixMyself", beatId, at: Date.now() });
  }

  static next() {
    PgConversation._dispatch({ type: "next", at: Date.now() });
  }

  /**
   * The live step back to how it was entered: its files to the step's
   * start, its beats unreached, so it plays again from its first beat. The
   * appended wrote card's Reset; refused while an act runs or once the step
   * has passed.
   */
  static restartStep() {
    PgConversation._dispatch({ type: "restartStep", at: Date.now() });
  }

  /**
   * A message typed in the composer, routed in the spec's order (`route`):
   * a live action's word runs it, with its pill (a word the engine does not
   * act on goes to the assistant instead); a word while a question
   * is open posts the refusal; anything else is the assistant's, which the
   * caller sends. The word and its action share one time, so the pill sits
   * before what the action posts.
   */
  static say(text: string): "lesson" | "assistant" {
    const at = Date.now();
    const routed = route(text, PgConversation.view()?.live ?? null, at);
    switch (routed.kind) {
      case "word": {
        const before = PgConversation._state;
        PgConversation._dispatch({
          type: "word",
          word: routed.word,
          text: text.trim(),
          then: routed.action,
          at,
        });
        if (PgConversation._state !== before) return "lesson";
        // The view showed the action live and the engine refused it: the
        // message goes to the assistant rather than vanishing
        log.info("A typed word's action did not run; routed to the assistant", {
          context: { word: routed.word },
        });
        return "assistant";
      }
      case "refused":
        PgConversation._dispatch({
          type: "refuseWord",
          word: routed.word,
          text: text.trim(),
          at,
        });
        return "lesson";
      case "assistant":
        return "assistant";
    }
  }

  /**
   * A composer message reached the live assistant; it is only counted, on the
   * step it was asked on: `cursor` is where the lesson stood at the send, since
   * the answer that reports it can outlast that step
   */
  static asked(cursor: Cursor) {
    PgConversation._dispatch({ type: "asked", cursor, at: Date.now() });
  }

  /** A finish chip pressed, by its index in the definition's chips */
  static chip(index: number) {
    PgConversation._dispatch({ type: "chip", index, at: Date.now() });
  }

  /** The assistant's Propose a change: one line, as an apply card */
  static propose(proposal: {
    id: string;
    file: string;
    line: number;
    before: string;
    after: string;
  }) {
    PgConversation._dispatch({ type: "propose", proposal, at: Date.now() });
  }

  /** The apply card's "Apply to <file>"; a second press while one is in flight is ignored, and the first settles the card */
  static apply(id: string) {
    if (PgConversation._applying.has(id)) {
      log.debug("Apply pressed while an Apply is in flight", {
        context: { id },
      });
      return;
    }
    PgConversation._dispatch({ type: "apply", id, at: Date.now() });
  }

  /**
   * The apply card's "Keep it". Ignored while an Apply is in flight: the
   * write may already be on its way, and settling as kept would leave the
   * file changed under a card that says it was not.
   */
  static keep(id: string) {
    if (PgConversation._applying.has(id)) {
      log.debug("Keep it pressed while an Apply is in flight", {
        context: { id },
      });
      return;
    }
    PgConversation._dispatch({ type: "keep", id, at: Date.now() });
  }

  /** Proposals whose Apply is reading or writing the file */
  private static _applying = new Set<string>();

  /** Back to the intro. The frame confirms first; the assistant's thread stays */
  static startOver() {
    PgConversation._dispatch({ type: "startOver", at: Date.now() });
  }

  /**
   * Subscribe to the explorer and load the open workspace's save. Call once
   * from the frame, with the ports the acts run through.
   */
  static init(ports: ConversationPorts): Disposable {
    PgConversation._ports = {
      workspace: ports.workspace,
      runner: ports.runner,
      judge: ports.judge,
    };
    // Once a session: `init` is called once from the frame
    PgConversation._told.clear();
    PgConversation._persisting.clear();

    const subs: Disposable[] = [
      PgExplorer.onDidSwitchWorkspace(() => {
        void PgConversation._load();
      }),
    ];
    void PgConversation._load();
    return {
      dispose: () => {
        subs.forEach((s) => s.dispose());
        PgConversation._clearTimer();
      },
    };
  }

  private static async _load() {
    // A fresh load asks again about a card still live and never run
    PgConversation._asked.clear();
    const name = PgExplorer.currentWorkspaceName;
    const definition = name ? PgConversation._definitionOf(name) : null;
    if (!name || !definition) {
      PgConversation._set(INITIAL_CONVERSATION_STATE);
      return;
    }
    // The same workspace opened again (a sync pass re-opens it) while an act
    // runs: a reload would read the run as interrupted and drop its result
    const current = PgConversation._state;
    if (
      current.context?.definition.name === name &&
      Object.values(current.engine.progress.runs).some(
        (rs) => rs.at(-1)?.status === "started"
      )
    ) {
      log.info(
        `${name} opened again while an act runs; the save is not reloaded`
      );
      return;
    }
    const ports = PgConversation._ports;
    const context: EngineContext = {
      definition,
      slug: slugOf(definition.name),
      judge: ports?.judge ?? judgeGoal,
    };

    // A save of this tutorial still in flight lands first, so the read
    // sees it rather than the older file
    await PgConversation._persisting.get(name);

    let progress: ConversationProgress = freshProgress();
    /** Acts the save holds in flight: this load interrupts them */
    let inFlight: string[] = [];
    let loadFailed = false;
    let reason: string | null = null;
    const path = storagePath(name);
    try {
      if (await PgExplorer.fs.exists(path)) {
        const data: unknown = await PgExplorer.fs.readToJSON(path);
        const loaded =
          typeof data === "object" && data !== null
            ? (data as Record<string, unknown>)[STORAGE_KEY]
            : undefined;
        if (loaded === undefined) {
          progress = freshProgress();
        } else {
          const dropped: string[] = [];
          const parsed = parseProgress(loaded, (key) => dropped.push(key));
          if (dropped.length) {
            // Entries this engine cannot read: a newer build's, or corrupt.
            // Writing the save back without them would delete them for
            // good, and sync would carry the deletion, so the load fails
            // and the file is kept as it is
            log.error(
              `The saved progress of ${name} holds entries this engine cannot read: ${dropped.join(
                ", "
              )}`,
              { report: true }
            );
            reason = "holds entries this engine cannot read";
            loadFailed = true;
          } else if (!parsed) {
            // The file holds something this engine never wrote. Refusing to
            // write is cheaper than being wrong about it.
            reason = "not a version 1 save";
            loadFailed = true;
          } else if (!PgConversation._knows(definition, parsed)) {
            // A step or beat the definition no longer has, or a cursor past
            // its beats: the engine could act on nothing
            reason = "names what the definition does not have";
            loadFailed = true;
          } else {
            progress = parsed;
            inFlight = PgConversation._inFlight(loaded);
          }
        }
      }
    } catch (e) {
      // The file could not be checked, read or parsed
      log.error(e, { report: true, context: { name, path } });
      reason = "could not be read";
      loadFailed = true;
    }
    if (loadFailed) {
      log.error(`The saved progress of ${name} ${reason}`, { report: true });
    }

    // The workspace may have moved on while the read was in flight
    if (PgExplorer.currentWorkspaceName !== name) return;
    // The learner acted on this tutorial while the read was in flight: the
    // progress in memory is newer than what was read, and its own save
    // follows. Replacing it would drop a run just started, and its result
    // after it. Only progress counts: a balance check ending (`probing`)
    // changes nothing a save holds
    const now = PgConversation._state;
    if (
      now.engine.progress !== current.engine.progress &&
      now.context?.definition.name === name
    ) {
      log.info(
        `${name} changed while its save was read; the save is not reloaded`
      );
      return;
    }
    PgConversation._set({
      context,
      engine: { progress, stage: null },
      loadFailed,
      loadedAt: Date.now(),
      probing: [],
    });
    if (loadFailed) {
      void PgConversation._tellLoadFailed(name);
    } else {
      // A later failed load of this tutorial is told again
      PgConversation._told.delete(`load:${name}`);
      if (inFlight.length) {
        PgConversation._afterReload(name, inFlight).catch((e) =>
          log.error(e, { report: true, context: { name, inFlight } })
        );
      }
    }
  }

  /** Beat ids whose last saved run is still `started`, read from the raw save */
  private static _inFlight(loaded: unknown): string[] {
    const runs =
      typeof loaded === "object" && loaded !== null
        ? (loaded as { runs?: unknown }).runs
        : undefined;
    if (typeof runs !== "object" || runs === null) return [];
    return Object.entries(runs as Record<string, unknown>)
      .filter(([, rs]) => {
        const last = Array.isArray(rs) ? rs.at(-1) : undefined;
        return (
          typeof last === "object" &&
          last !== null &&
          (last as { status?: unknown }).status === "started"
        );
      })
      .map(([beatId]) => beatId);
  }

  /**
   * The runs a reload interrupted: the save is written back at once, so they
   * read as interrupted (and are measured) once, not on every load. A deploy
   * that landed before the reload is recognised from the chain and posts its
   * result; every other run is measured as interrupted.
   */
  // TODO(HOO-2356 cards PR): the runner reads the program id from
  // `PgProgramInfo`, which loads with the workspace on its own schedule; a
  // lookup that runs first finds no id and the run stays interrupted, which
  // costs the learner one more press (an upgrade of the same id), not a
  // second program. The frame that wires the runner awaits it there.
  private static async _afterReload(name: string, beatIds: string[]) {
    PgConversation._persist(name, PgConversation._state.engine.progress);
    const runner = PgConversation._ports?.runner;
    const interrupted: string[] = [];
    for (const beatId of beatIds) {
      const run = PgConversation._state.engine.progress.runs[beatId]?.at(-1);
      const act = PgConversation._state.context
        ? actOf(PgConversation._state.context.definition, beatId)
        : null;
      let result: RunResult | null = null;
      if (run?.status === "interrupted" && act && runner?.recognise) {
        try {
          result = await runner.recognise(act, run.at);
        } catch (e) {
          // The chain could not be read: the card stays interrupted, and
          // running it again deploys or upgrades the same program id
          log.warn(`Could not look up an interrupted ${act} of ${name}`, {
            context: { reason: e instanceof Error ? e.message : String(e) },
          });
        }
      }
      // The learner left while the chain was read: what is collected belongs
      // to this tutorial, and the store now holds another one
      if (PgExplorer.currentWorkspaceName !== name) {
        log.info(
          `Left ${name} while looking up its interrupted runs; they stay unmeasured`
        );
        return;
      }
      if (result) {
        PgConversation._dispatch({
          type: "recognised",
          beatId,
          result,
          at: Date.now(),
        });
      } else {
        interrupted.push(beatId);
      }
    }
    if (interrupted.length) {
      PgConversation._dispatch({
        type: "interrupted",
        beatIds: interrupted,
        at: Date.now(),
      });
    }
  }

  /** Whether every step and beat the save names is in the definition */
  private static _knows(
    definition: TutorialDefinition,
    progress: ConversationProgress
  ): boolean {
    const steps = new Set(definition.steps.map((s) => s.id));
    const beats = new Set(
      definition.steps.flatMap((s) =>
        s.beats.concat(s.onFail ?? []).map((b) => b.id)
      )
    );
    const cursorStep =
      progress.cursor.kind === "step" ? [progress.cursor.stepId] : [];
    const orphan = [
      ...cursorStep.filter((id) => !steps.has(id)),
      ...PgConversation._cursorPastItsBeats(definition, progress),
      ...Object.keys(progress.beats).filter((id) => !beats.has(id)),
      ...Object.keys(progress.runs).filter((id) => !beats.has(id)),
      ...Object.keys(progress.times).filter((id) => !steps.has(id)),
      ...progress.passed.filter((id) => !steps.has(id)),
    ];
    if (orphan.length === 0) return true;
    log.error(
      `The saved progress of ${
        definition.name
      } names ids the definition does not have: ${orphan.join(", ")}`,
      { report: true }
    );
    return false;
  }

  /** The cursor's step as an orphan when its beat index or its `fail` is
   * past what the step holds, so a shrunk definition reads as a failed load */
  private static _cursorPastItsBeats(
    definition: TutorialDefinition,
    progress: ConversationProgress
  ): string[] {
    const cursor = progress.cursor;
    if (cursor.kind !== "step") return [];
    const step = definition.steps.find((s) => s.id === cursor.stepId);
    if (!step) return [];
    const beats = cursor.fail ? step.onFail : step.beats;
    if (!beats || cursor.beat > beats.length)
      return [`cursor:${cursor.stepId}`];
    return [];
  }

  /** The learner hears once per tutorial that this session is not being saved */
  private static async _tellLoadFailed(name: string) {
    if (PgConversation._told.has(`load:${name}`)) return;
    PgConversation._told.add(`load:${name}`);
    try {
      const { default: LoadFailedToast } = await import(
        "../ui/LoadFailedToast"
      );
      PgView.setToast(LoadFailedToast, {
        options: { name: "tutorial-load-failed" },
      });
    } catch (e) {
      log.error(e, { report: true });
    }
  }

  private static _definitionOf(name: string): TutorialDefinition | null {
    return PgTutorial.all.find((t) => t.name === name)?.definition ?? null;
  }

  private static _dispatch(action: Action) {
    const s = PgConversation._state;
    if (!s.context) return;
    if (!PgConversation._ports) {
      // Nothing would carry the effects out, so no state is committed either
      log.error(`${action.type} dispatched before PgConversation.init`, {
        report: true,
      });
      return;
    }
    const { state: engine, effects } = reduce(s.context, s.engine, action);
    if (engine === s.engine && effects.length === 0) return;

    if (engine !== s.engine) {
      // A new walk: the files go back to how it starts, and a scripted file
      // effect still queued from the old one must not write over them. Its
      // airdrop cards are live again, so the funded probe asks about them anew
      if (action.type === "startOver" || action.type === "restartStep") {
        PgConversation._walk++;
        PgConversation._asked.clear();
      }
      // Start over is the one write allowed over a save that could not be
      // read: it is the learner's "discard it", and the only way out
      const loadFailed = action.type === "startOver" ? false : s.loadFailed;
      if (s.loadFailed && !loadFailed) {
        log.info(
          `Start over replaces the unreadable saved progress of ${s.context.definition.name}`
        );
      }
      PgConversation._set({ ...s, engine, loadFailed });
      // Only the save is written, never a stage change: the file is synced,
      // and an identical rewrite reads as a change on the other device
      if (engine.progress !== s.engine.progress) {
        // The tutorial's name is captured now: by the time the write lands,
        // a workspace switch could have moved the state on
        const name = s.context.definition.name;
        if (!loadFailed) PgConversation._persist(name, engine.progress);
      }
    }
    void PgConversation._drain(s.context, effects);
  }

  private static _set(next: ConversationState) {
    // The probe is asked before anyone renders, so a later airdrop it hides
    // is never drawn first
    const s = PgConversation._pressIfFunded(PgConversation._settled(next));
    PgConversation._state = s;
    PgConversation._schedule();
    for (const cb of PgConversation._listeners) cb(s);
  }

  /** `probing` without the acts whose press the probe made has ended */
  private static _settled(s: ConversationState): ConversationState {
    const runs = s.engine.progress.runs;
    const probing = s.probing.filter((id) => {
      const last = runs[id]?.at(-1);
      return !last || last.status === "started";
    });
    return probing.length === s.probing.length ? s : { ...s, probing };
  }

  /** The store's state with one act no longer probing */
  private static _unprobe(beatId: string) {
    const s = PgConversation._state;
    if (!s.probing.includes(beatId)) return;
    PgConversation._set({
      ...s,
      probing: s.probing.filter((id) => id !== beatId),
    });
  }

  /**
   * The airdrop act the cursor just reached and nothing landed yet, by beat
   * id: the one card `_pressIfFunded` may press. A card whose latest run
   * failed or a reload interrupted counts, so a reload onto it checks the
   * balance again. Null on any other beat, and while a run is in flight
   */
  private static _reachedAirdrop(s: ConversationState): string | null {
    const p = s.engine.progress;
    if (!s.context || s.loadFailed || p.cursor.kind !== "step") return null;
    const { stepId, beat, fail } = p.cursor;
    if (p.passed.includes(stepId)) return null;
    const step = s.context.definition.steps.find((st) => st.id === stepId);
    const reached = (fail ? step?.onFail ?? [] : step?.beats ?? [])[beat - 1];
    if (reached?.kind !== "act" || reached.act !== "airdrop") return null;
    if (!p.beats[reached.id]) return null;
    const last = p.runs[reached.id]?.at(-1);
    if (last?.status === "ok" || last?.status === "started") return null;
    return reached.id;
  }

  /**
   * A funded wallet's airdrop card passes by itself (HOO-2677): when the
   * lesson reaches a live airdrop card, the runner is asked once whether the
   * wallet covers the deploy, and if it does the card is pressed as the
   * learner would press it. Not funded leaves the card live; a probe that
   * throws is reported and leaves it live too. A press while the probe is in
   * flight wins: the answer then finds a run and presses nothing. Asked once
   * per card per walk (`_asked`).
   *
   * A later airdrop that never ran is hidden while the probe is out
   * (`probing`), for at most PROBE_TIMEOUT_MS, and while the press it made
   * runs, so a funded wallet's passes unseen (designers, 7 Nov). Returns the
   * state with it marked.
   */
  private static _pressIfFunded(s: ConversationState): ConversationState {
    const beatId = PgConversation._reachedAirdrop(s);
    const isFunded = PgConversation._ports?.runner.isFunded;
    if (!beatId || !isFunded || !s.context) return s;
    const name = s.context.definition.name;
    const key = `${name}:${beatId}`;
    if (PgConversation._asked.has(key)) return s;
    PgConversation._asked.add(key);
    const isHidden =
      isLaterAirdrop(s.context.definition, beatId) &&
      !s.engine.progress.runs[beatId]?.length;
    const isStillLive = () =>
      PgExplorer.currentWorkspaceName === name &&
      PgConversation._reachedAirdrop(PgConversation._state) === beatId;
    // A check that hangs shows the card after PROBE_TIMEOUT_MS
    const timer = isHidden
      ? setTimeout(() => PgConversation._unprobe(beatId), PROBE_TIMEOUT_MS)
      : undefined;
    isFunded()
      .finally(() => {
        if (timer !== undefined) clearTimeout(timer);
      })
      .then((yes) => {
        if (yes && isStillLive()) PgConversation.act(beatId);
        // Short, or the card moved on: it shows; a press keeps it hidden
        // until its run ends (`_settled`)
        if (
          !yes ||
          PgConversation._state.engine.progress.runs[beatId]?.at(-1)?.status !==
            "started"
        ) {
          PgConversation._unprobe(beatId);
        }
      })
      .catch((e: unknown) => {
        log.error(e, {
          report: true,
          context: { what: "check the wallet's balance", tutorial: name },
        });
        PgConversation._unprobe(beatId);
      });
    return isHidden ? { ...s, probing: s.probing.concat(beatId) } : s;
  }

  /** The next moment the feed changes on its own: a turn arriving, or the finish */
  private static _schedule() {
    PgConversation._clearTimer();
    const v = PgConversation.view();
    if (!v) return;
    const now = Date.now();
    if (v.finishAt !== null) {
      const at = v.finishAt;
      PgConversation._timer = setTimeout(
        () =>
          PgConversation._dispatch({
            type: "finish",
            at: Math.max(at, Date.now()),
          }),
        Math.max(0, at - now)
      );
      return;
    }
    if (v.nextAt !== null) {
      PgConversation._timer = setTimeout(
        () => PgConversation._set(PgConversation._state),
        Math.max(0, v.nextAt - now)
      );
    }
  }

  private static _clearTimer() {
    if (PgConversation._timer !== null) clearTimeout(PgConversation._timer);
    PgConversation._timer = null;
  }

  private static async _drain(context: EngineContext, effects: Effect[]) {
    const ports = PgConversation._ports;
    if (!ports) return;
    const name = context.definition.name;
    /** The walk these effects were reduced in, captured at dispatch */
    const walk = PgConversation._walk;
    /** A write or a run landing after a switch must not touch the new workspace */
    const stillOpen = () => PgExplorer.currentWorkspaceName === name;
    /** A scripted file effect also belongs to its walk: Start over or a
     * step's restart has put the files back since */
    const current = () => stillOpen() && walk === PgConversation._walk;

    const carryOut = async (effect: Effect) => {
      try {
        await PgConversation._carryOut(
          context,
          effect,
          ports,
          name,
          isScripted(effect) ? current : stillOpen
        );
      } catch (e) {
        // A listener or the tracker threw: the effects after it still run
        log.error(e, {
          report: true,
          context: { effect: effect.kind, tutorial: name },
        });
      }
    };

    for (const effect of effects) {
      if (!touchesFiles(effect)) {
        await carryOut(effect);
        continue;
      }
      // In flight from the moment it is queued, not when it starts: a Keep it
      // pressed while it waits behind another write would settle the card as
      // kept and the Apply would still change the line
      if (effect.kind === "apply") PgConversation._applying.add(effect.id);
      // One file effect at a time across actions: a restore queued by Start
      // over lands after a write already in flight, never under it
      await PgConversation._queueFileEffect(async () => {
        if (isScripted(effect) && walk !== PgConversation._walk) {
          log.info(
            `A ${effect.kind} for ${name} queued before a restart was dropped`
          );
          return;
        }
        await carryOut(effect);
        if (isScripted(effect) && walk !== PgConversation._walk) {
          log.info(
            `A ${effect.kind} for ${name} was in flight at a restart; what it had left to write was dropped`
          );
        }
      });
    }
  }

  /** Runs `job` after every file effect queued before it; `job` never rejects */
  private static _queueFileEffect(job: () => Promise<void>): Promise<void> {
    const next = PgConversation._fileEffects.then(job);
    PgConversation._fileEffects = next;
    return next;
  }

  /** The workspace moved while the port was in flight: expected, not an error */
  private static _moved(e: unknown, name: string, what: string): boolean {
    if (!(e instanceof WorkspaceMovedError)) return false;
    log.warn(`The ${what} for ${name} was dropped: ${e.message}`);
    return true;
  }

  private static async _carryOut(
    context: EngineContext,
    effect: Effect,
    ports: Required<ConversationPorts>,
    name: string,
    stillOpen: () => boolean
  ) {
    switch (effect.kind) {
      case "event":
        tutorialTelemetry.track(effect.name, effect.params);
        break;
      case "focus":
        for (const cb of PgConversation._focusListeners) {
          cb({ file: effect.file, line: effect.line });
        }
        break;
      case "explain":
        for (const cb of PgConversation._explainListeners) {
          cb({ beatId: effect.beatId, result: effect.result });
        }
        break;
      case "restore": {
        // Whole files, in order; a file that fails is logged and left to
        // the learner, the others still land
        const left: string[] = [];
        for (const path of effect.remove) {
          if (!stillOpen()) {
            left.push(path);
            continue;
          }
          try {
            await ports.workspace.remove(path, name);
          } catch (e) {
            if (!PgConversation._moved(e, name, `removal of ${path}`)) {
              log.error(e, { report: true, context: { name, path } });
            }
          }
        }
        for (const [path, content] of Object.entries(effect.files)) {
          if (!stillOpen()) {
            left.push(path);
            continue;
          }
          try {
            await ports.workspace.write(path, content, name);
          } catch (e) {
            if (!PgConversation._moved(e, name, `restore of ${path}`)) {
              log.error(e, { report: true, context: { name, path } });
            }
          }
        }
        if (left.length && PgExplorer.currentWorkspaceName === name) {
          // A restart came mid-restore: its own restore, queued behind this
          // one, puts every file back, so nothing is lost
          log.info(
            `The restore for ${name} stopped at a restart; left to the next restore: ${left.join(
              ", "
            )}`
          );
        } else if (left.length) {
          // The workspace moved mid-restore: the file holds the old lesson
          // and the save the new one, so the team hears of it
          log.warn(
            `The restore for ${name} stopped at the workspace switch; not restored: ${left.join(
              ", "
            )}`,
            { report: true }
          );
        }
        break;
      }
      case "apply": {
        const failed = (reason: ApplyFailure) =>
          PgConversation._dispatch({
            type: "applyFailed",
            id: effect.id,
            reason,
            at: Date.now(),
          });
        const applied = () =>
          PgConversation._dispatch({
            type: "applied",
            id: effect.id,
            at: Date.now(),
          });
        const where = { name, file: effect.file, id: effect.id };
        PgConversation._applying.add(effect.id);
        try {
          if (!stillOpen()) {
            log.info("An Apply was left behind by a workspace switch", {
              context: where,
            });
            break;
          }
          const content = await ports.workspace.read(effect.file, name);
          const lines = content?.split("\n") ?? null;
          const current = lines?.[effect.line - 1];
          if (lines && current === effect.after && current !== effect.before) {
            // An earlier Apply wrote it and its result never landed (the
            // workspace switched under it): the line already reads as proposed
            applied();
            break;
          }
          if (!lines) {
            log.warn("A proposal's file is gone before Apply", {
              context: { name, file: effect.file },
            });
            failed("gone");
            break;
          }
          if (current !== effect.before) {
            // The learner changed the line since the proposal: writing now
            // would overwrite their edit
            log.warn(`A proposal's line moved before Apply`, {
              context: { name, file: effect.file, line: effect.line },
            });
            failed("moved");
            break;
          }
          lines[effect.line - 1] = effect.after;
          if (!stillOpen()) {
            log.info("An Apply was left behind by a workspace switch", {
              context: where,
            });
            break;
          }
          await ports.workspace.write(effect.file, lines.join("\n"), name);
          if (!stillOpen()) {
            PgConversation._landedLate(name, effect.file);
            break;
          }
          applied();
          // TODO(tutorial-flow-v2 4.2): a deployed file changed this way gets
          // the redeploy nudge
        } catch (e) {
          if (PgConversation._moved(e, name, `apply to ${effect.file}`)) break;
          log.error(e, {
            report: true,
            context: { name, path: effect.file },
          });
          failed("write");
        } finally {
          PgConversation._applying.delete(effect.id);
        }
        break;
      }
      case "create": {
        try {
          if (!stillOpen()) break;
          const exists =
            (await ports.workspace.read(effect.path, name)) !== null;
          if (!stillOpen()) break;
          if (!exists) await ports.workspace.write(effect.path, "", name);
          if (!stillOpen()) {
            PgConversation._landedLate(name, effect.path);
            break;
          }
          PgConversation._dispatch({
            type: "written",
            beatId: effect.beatId,
            wrote: { file: effect.path, lines: [], created: true },
            at: effect.at,
          });
        } catch (e) {
          if (PgConversation._moved(e, name, `creation of ${effect.path}`)) {
            break;
          }
          log.error(e, {
            report: true,
            context: { name, path: effect.path },
          });
          PgConversation._writeFailed(effect.beatId, name);
        }
        break;
      }
      case "write": {
        try {
          if (!stillOpen()) break;
          const step = stepOfBeat(context.definition, effect.beatId);
          const before = (await ports.workspace.read(effect.file, name)) ?? "";
          if (!stillOpen()) break;
          // A key line the learner typed is replaced by the block around it,
          // keeping their own `msg!` words
          let base = before;
          let block = effect.block;
          const at = effect.key ? typedKey(before, effect.key) : null;
          if (at !== null) {
            const rows = before.split("\n");
            block = withOwnText(block, rows[at - 1]);
            rows.splice(at - 1, 1);
            base = rows.join("\n");
          }
          const { reference, start } = groundOf(effect, step);
          const placed = insertBlock(base, block, reference, start);
          await ports.workspace.write(effect.file, placed.code, name);
          if (!stillOpen()) {
            PgConversation._landedLate(name, effect.file);
            break;
          }
          PgConversation._dispatch({
            type: "written",
            beatId: effect.beatId,
            wrote: placed.appended
              ? { file: effect.file, lines: placed.lines, appended: true }
              : { file: effect.file, lines: placed.lines },
            at: effect.at,
          });
        } catch (e) {
          if (PgConversation._moved(e, name, `write to ${effect.file}`)) {
            break;
          }
          // The question stays resolved and the block is not in the file:
          // the card says so (`writeFailed`) and the learner types it
          log.error(e, {
            report: true,
            context: { name, path: effect.file },
          });
          PgConversation._writeFailed(effect.beatId, name);
        }
        break;
      }
      case "run": {
        let result: RunResult;
        try {
          result = await ports.runner.run(effect.act, effect.input, (stage) =>
            PgConversation._dispatch({
              type: "stage",
              beatId: effect.beatId,
              startedAt: effect.startedAt,
              label: stage.label,
              index: stage.index,
              count: stage.count,
              detail: stage.detail,
              at: Date.now(),
            })
          );
        } catch (e) {
          log.error(e, { report: true });
          result = failedResult(
            effect.act,
            e instanceof Error ? e.message : String(e)
          );
        }
        if (!stillOpen()) {
          // The result is lost with the switch: a landed deploy reads as
          // interrupted and may be run again, so the team hears of it
          log.warn(
            `A ${effect.act} result for ${name} arrived after the workspace moved on (ok: ${result.ok})`,
            { report: result.ok && effect.act !== "build" }
          );
          break;
        }
        const before = PgConversation._state.engine;
        PgConversation._dispatch({
          type: "ended",
          beatId: effect.beatId,
          startedAt: effect.startedAt,
          result,
          at: Date.now(),
        });
        if (PgConversation._state.engine === before) {
          // Start over, or a later run of the same act, left this run
          // behind: its result is lost, and a landed deploy spent SOL
          log.warn(
            `A ${effect.act} result for ${name} arrived for a run no longer in flight (ok: ${result.ok})`,
            { report: result.ok && effect.act !== "build" }
          );
        }
        break;
      }
    }
  }

  /** The block is in the file but its record cannot be saved: the workspace
   * moved, or the lesson restarted, between the write and the dispatch */
  private static _landedLate(name: string, path: string) {
    log.warn(
      `A write to ${path} for ${name} landed after the workspace moved on or the lesson restarted; its lines are not recorded`
    );
  }

  /** A write that did not land, told to the card unless the workspace moved */
  private static _writeFailed(beatId: string, name: string) {
    if (PgExplorer.currentWorkspaceName !== name) return;
    PgConversation._dispatch({ type: "writeFailed", beatId, at: Date.now() });
  }

  /**
   * Writes the save under `conversation` in the tutorial's storage file,
   * keeping the file's other keys. Writes to one tutorial run one at a time,
   * in order, so the latest save lands last; the path is resolved once from
   * the name, so a switch mid-write cannot move it.
   *
   * @param name the tutorial this write belongs to, captured when queued
   * @param progress the save to write, captured the same way
   */
  private static _persist(name: string, progress: ConversationProgress) {
    const previous = PgConversation._persisting.get(name) ?? Promise.resolve();
    const next = previous
      .catch(() => {
        // `_write` reports its own failure; the chain only has to go on
      })
      .then(() => PgConversation._write(name, progress));
    PgConversation._persisting.set(name, next);
  }

  private static async _write(name: string, progress: ConversationProgress) {
    const path = storagePath(name);
    try {
      let data: Record<string, unknown> = {};
      if (await PgExplorer.fs.exists(path)) {
        const read: unknown = await PgExplorer.fs.readToJSON(path);
        if (typeof read === "object" && read !== null) {
          data = read as Record<string, unknown>;
        }
      }
      data[STORAGE_KEY] = progress;
      await writeWorkspaceFile(path, JSON.stringify(data));
      // A later failing streak is told again
      PgConversation._told.delete(`save:${name}`);
    } catch (e) {
      // The in-memory save is still right for this session; a reload loses
      // its tail. Reported every time, told to the learner once per tutorial.
      log.error(e, { report: true, context: { name, path } });
      if (!PgConversation._told.has(`save:${name}`)) {
        PgConversation._told.add(`save:${name}`);
        try {
          const { default: SaveFailedToast } = await import(
            "../ui/SaveFailedToast"
          );
          PgView.setToast(SaveFailedToast, {
            options: { name: "tutorial-save-failed" },
          });
        } catch (toastError) {
          log.error(toastError, { report: true });
        }
      }
    }
  }

  /** Bumped by Start over and a step's restart; see `_drain` */
  private static _walk = 0;
  /** The tail of the file-effect queue (`_queueFileEffect`) */
  private static _fileEffects: Promise<void> = Promise.resolve();
  /** `load:<name>` and `save:<name>`: which toasts this session has shown */
  private static readonly _told = new Set<string>();
  /** One write at a time per tutorial, the latest save last */
  private static readonly _persisting = new Map<string, Promise<void>>();
  private static _state: ConversationState = INITIAL_CONVERSATION_STATE;
  private static _ports: Required<ConversationPorts> | null = null;
  /**
   * Airdrop cards the funded probe asked about since the last load or new
   * walk, as `<tutorial>:<beatId>`: once per card per walk, not on every
   * re-render
   */
  private static _asked = new Set<string>();
  private static _timer: ReturnType<typeof setTimeout> | null = null;
  private static _view: ConversationView | null = null;
  private static _viewOf: ConversationState | null = null;
  private static _viewAt = 0;
  private static readonly _listeners = new Set<
    (s: ConversationState) => void
  >();
  private static readonly _focusListeners = new Set<
    (focus: { file: string; line: number | "landing" }) => void
  >();
  private static readonly _explainListeners = new Set<
    (request: { beatId: string; result: RunResult }) => void
  >();
  private static readonly _logListeners = new Set<() => void>();
}
