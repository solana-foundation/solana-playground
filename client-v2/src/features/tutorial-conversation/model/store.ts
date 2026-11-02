import { slugOf } from "@/entities/tutorial";
import type { TutorialDefinition } from "@/entities/tutorial";
import { createLogger } from "@/shared/lib/logger";

import { insertBlock, typedKey, withOwnText } from "./landing";
import { failedResult, passingJudge } from "./ports";
import type { Judge, Runner, Workspace } from "./ports";
import { WorkspaceMovedError } from "./real-workspace";
import { freshProgress, parseProgress } from "./progress";
import type { ConversationProgress, PassedVia, RunResult } from "./progress";
import { INITIAL_ENGINE_STATE, reduce, stepOfBeat } from "./reducer";
import type { Action, Effect, EngineContext, EngineState } from "./reducer";
import { tutorialTelemetry } from "./telemetry";
import { view } from "./view";
import type { ConversationView } from "./view";
import { PgExplorer } from "../../../utils/explorer/explorer";
import { writeWorkspaceFile } from "../../../utils/explorer/workspace-file";
import { PgTutorial, storageDataPath } from "../../../utils/tutorial/tutorial";
import type { Disposable } from "../../../utils/types";
import { PgView } from "../../../utils/view";

const log = createLogger("tutorial-conversation:store");

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
}

export const INITIAL_CONVERSATION_STATE: ConversationState = {
  context: null,
  engine: INITIAL_ENGINE_STATE,
  loadFailed: false,
  loadedAt: 0,
};

/** The key under which the engine saves, beside the old lesson's `lesson` */
export const STORAGE_KEY = "conversation";

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
  /** Required for the same reason: `passingJudge` would pass step 4 on the
   * upgrade before any call; task 3.2's judge is the one to wire */
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

  static start() {
    PgConversation._dispatch({ type: "start", at: Date.now() });
  }

  static pick(beatId: string, option: number) {
    PgConversation._dispatch({ type: "pick", beatId, option, at: Date.now() });
  }

  static hint(beatId: string) {
    PgConversation._dispatch({ type: "hint", beatId, at: Date.now() });
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

  /** A step's goal met outside the feed: the Call panel or a client run */
  static passed(via: Exclude<PassedVia, "chat">, result: RunResult) {
    PgConversation._dispatch({ type: "passed", via, result, at: Date.now() });
  }

  static explain(beatId: string) {
    PgConversation._dispatch({ type: "explain", beatId, at: Date.now() });
  }

  static fixMyself(beatId: string) {
    PgConversation._dispatch({ type: "fixMyself", beatId, at: Date.now() });
  }

  static next() {
    PgConversation._dispatch({ type: "next", at: Date.now() });
  }

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
      judge: ports?.judge ?? passingJudge,
    };

    // A save of this tutorial still in flight lands first, so the read
    // sees it rather than the older file
    await PgConversation._persisting.get(name);

    let progress: ConversationProgress = freshProgress();
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
    PgConversation._set({
      context,
      engine: { progress, stage: null },
      loadFailed,
      loadedAt: Date.now(),
    });
    if (loadFailed) {
      void PgConversation._tellLoadFailed(name);
    } else {
      // A later failed load of this tutorial is told again
      PgConversation._told.delete(`load:${name}`);
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
    PgConversation._state = next;
    PgConversation._schedule();
    for (const cb of PgConversation._listeners) cb(next);
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
    /** A write or a run landing after a switch must not touch the new workspace */
    const stillOpen = () => PgExplorer.currentWorkspaceName === name;

    for (const effect of effects) {
      try {
        await PgConversation._carryOut(context, effect, ports, name, stillOpen);
      } catch (e) {
        // A listener or the tracker threw: the effects after it still run
        log.error(e, {
          report: true,
          context: { effect: effect.kind, tutorial: name },
        });
      }
    }
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
        if (left.length) {
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
          const placed = insertBlock(
            base,
            block,
            step?.target[effect.file],
            step?.start[effect.file] ?? ""
          );
          await ports.workspace.write(effect.file, placed.code, name);
          if (!stillOpen()) {
            PgConversation._landedLate(name, effect.file);
            break;
          }
          PgConversation._dispatch({
            type: "written",
            beatId: effect.beatId,
            wrote: { file: effect.file, lines: placed.lines },
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
   * moved between the write and the dispatch */
  private static _landedLate(name: string, path: string) {
    log.warn(
      `A write to ${path} for ${name} landed after the workspace moved on; its lines are not recorded`
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

  /** `load:<name>` and `save:<name>`: which toasts this session has shown */
  private static readonly _told = new Set<string>();
  /** One write at a time per tutorial, the latest save last */
  private static readonly _persisting = new Map<string, Promise<void>>();
  private static _state: ConversationState = INITIAL_CONVERSATION_STATE;
  private static _ports: Required<ConversationPorts> | null = null;
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
}
