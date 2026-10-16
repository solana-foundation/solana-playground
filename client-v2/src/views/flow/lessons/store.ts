import type { Idl } from "@coral-xyz/anchor";

import { EMPTY_STORED, nextSeq } from "./events";
import type { LessonActor, LessonRecordEvent, StoredLesson } from "./events";
import { hintPrompt, RUNG_COUNT } from "./hints";
import {
  admits,
  attempted,
  cursorStep,
  foldRecord,
  nextLegal,
  prevLegal,
  rung,
  trimRecord,
} from "./ledger";
import type { LessonView } from "./ledger";
import { isV1, isV2, migrateV1 } from "./migrate";
import { getLessonPath } from "./registry";
import type { LessonPath } from "./types";
import { graderClass, isSatisfied } from "./verify";
import { PgFlow } from "../state/stage";
import type { FlowState } from "../state/stage";
import { PgExplorer, PgProgramInfo, PgTutorial, PgView } from "../../../utils";
import type { Disposable } from "../../../utils";

export interface LessonState {
  /** `null` whenever the active workspace is not a lesson with a path */
  path: LessonPath | null;
  /** The event log -- the only thing stored; everything the UI shows
   * is a fold over it (`foldRecord` in `ledger.ts`) */
  record: StoredLesson;
  /**
   * Set when the most recent load could not tell a clean first visit
   * (no saved file yet, the record is genuinely empty) apart from a
   * read that failed silently. `_persist` refuses to write while this
   * is set: appending to a log needs the prior log, so an unreadable
   * file must refuse the write rather than replace a real record with
   * a shorter one.
   */
  loadFailed: boolean;
}

export const INITIAL_LESSON_STATE: LessonState = {
  path: null,
  record: EMPTY_STORED,
  loadFailed: false,
};

/**
 * What the store can be asked. Each action carries `at` so the reducer
 * stays pure -- the wall clock is the caller's to read. The reducer
 * turns an action into at most a couple of appended record events; an
 * action whose event has no edge returns the same state object.
 */
export type LessonAction =
  | {
      type: "load";
      path: LessonPath | null;
      record?: StoredLesson;
      loadFailed?: boolean;
      at: number;
    }
  | { type: "evaluate"; flow: FlowState; idl: Idl | null; at: number }
  | { type: "pass"; at: number }
  | { type: "attest"; at: number }
  | { type: "move"; to: string | "end"; at: number }
  | { type: "hint"; at: number }
  | { type: "opened"; stepId: string; at: number };

/** Append one event, through the same guard the fold replays with */
const append = (
  state: LessonState,
  payload:
    | { type: "enter" }
    | { type: "graded"; stepIds: string[] }
    | { type: "pass"; stepId: string }
    | { type: "attest"; stepId: string }
    | { type: "move"; to: string | "end" }
    | { type: "attempt"; startedAt: number }
    | { type: "hint"; stepId: string; rung: number }
    | { type: "opened"; stepId: string },
  actor: LessonActor,
  at: number
): LessonState => {
  if (!state.path) return state;
  const path = state.path;

  const ev = {
    ...payload,
    seq: nextSeq(state.record),
    at,
    actor,
  } as LessonRecordEvent;
  if (!admits(path, foldRecord(path, state.record), ev)) return state;

  const record = trimRecord(path, {
    v: 2,
    snapshot: state.record.snapshot,
    events: state.record.events.concat(ev),
  });
  return { path: state.path, record, loadFailed: state.loadFailed };
};

/** Pure reducer, so the machine's rules are testable without a browser */
export const reduceLesson = (
  state: LessonState,
  action: LessonAction
): LessonState => {
  switch (action.type) {
    case "load": {
      if (!action.path) return INITIAL_LESSON_STATE;
      const loaded: LessonState = {
        path: action.path,
        record: action.record ?? EMPTY_STORED,
        loadFailed: action.loadFailed ?? false,
      };
      return append(loaded, { type: "enter" }, "learner", action.at);
    }

    case "evaluate": {
      if (!state.path) return state;
      const { flow, idl } = action;
      let next = state;

      // The attempt first: a build that starts and later proves a step
      // arrives as two separate `PgFlow` notifications, so the attempt
      // is already behind the `graded` that moves the cursor -- which
      // is what keeps the new step's ladder capped at rung one
      if (
        flow.buildStartedAt !== null &&
        !next.record.events.some(
          (e) => e.type === "attempt" && e.startedAt === flow.buildStartedAt
        )
      ) {
        next = append(
          next,
          { type: "attempt", startedAt: flow.buildStartedAt },
          "learner",
          action.at
        );
      }

      // Grade every open or passed step against current state,
      // whatever route the learner took -- a grade is a fact about
      // their code, not a claim about their route
      const view = foldRecord(state.path, next.record);
      const stepIds = state.path.steps
        .filter((s) => {
          const mark = view.marks.get(s.id);
          return (
            (mark === "open" || mark === "passed") &&
            graderClass(s.verify) !== "attestation" &&
            isSatisfied(s.verify, flow, idl)
          );
        })
        .map((s) => s.id);
      if (stepIds.length > 0) {
        next = append(
          next,
          { type: "graded", stepIds },
          "toolchain",
          action.at
        );
      }
      return next;
    }

    case "pass": {
      const step = onFrontier(state);
      if (!step) return state;
      return append(
        state,
        { type: "pass", stepId: step.id },
        "learner",
        action.at
      );
    }

    case "attest": {
      const step = onFrontier(state);
      if (!step) return state;
      return append(
        state,
        { type: "attest", stepId: step.id },
        "learner",
        action.at
      );
    }

    case "move":
      return append(
        state,
        { type: "move", to: action.to },
        "learner",
        action.at
      );

    case "hint": {
      if (!state.path) return state;
      const view = foldRecord(state.path, state.record);
      const step = cursorStep(state.path, view);
      if (!step) return state;

      const used = rung(view, step.id);
      // The unaided first attempt caps the ladder at rung one
      const ceiling = attempted(state.path, view, step.id) ? RUNG_COUNT : 1;
      if (used >= ceiling) return state;

      return append(
        state,
        { type: "hint", stepId: step.id, rung: used + 1 },
        "learner",
        action.at
      );
    }

    case "opened":
      return append(
        state,
        { type: "opened", stepId: action.stepId },
        "learner",
        action.at
      );
  }
};

/** The cursor's step, only while it stands at the frontier -- the one
 * place the learner's escape valves exist */
const onFrontier = (state: LessonState) => {
  if (!state.path) return null;
  const view = foldRecord(state.path, state.record);
  if (view.cursor !== view.frontier) return null;
  return cursorStep(state.path, view);
};

/**
 * A fresh wrapper per `getStorage` call: the storage's `setItem` mutates
 * the default it was handed (`readToJSONOrDefault` returns it by
 * reference on a missing or unreadable file), so a shared object would
 * leak one lesson's record into the next lesson's load and break the
 * `loaded === EMPTY_STORED` failed-read check below.
 */
const storageDefault = (): { lesson: StoredLesson } => ({
  lesson: EMPTY_STORED,
});

/**
 * Mirrors the private path inside `PgTutorial.getStorage`. Duplicated
 * rather than exported so this file only reads `utils`, never edits it;
 * `PgExplorer.fs.exists` is what tells a missing file apart from a file
 * that exists but failed to parse, which `getStorage` itself cannot.
 */
const STORAGE_PATH = ".workspace/tutorial-storage.json";

/**
 * The lesson the learner is in, if any.
 *
 * One entry point for everything that happens to a lesson: the UI's
 * calls land here as events carrying `actor: "learner"`, the evaluator
 * lands `graded` as the toolchain's, and the record is written through
 * to `PgTutorial.getStorage` (`.workspace/tutorial-storage.json` inside
 * the lesson's own workspace). The log assumes a single writing tab;
 * `loadFailed` guards the worst case.
 */
export class PgLesson {
  static get state(): LessonState {
    return PgLesson._state;
  }

  /** The folds over the current record, memoized per state object */
  static view(): LessonView | null {
    if (!PgLesson._state.path) return null;
    if (PgLesson._viewOf !== PgLesson._state) {
      PgLesson._view = foldRecord(PgLesson._state.path, PgLesson._state.record);
      PgLesson._viewOf = PgLesson._state;
    }
    return PgLesson._view;
  }

  static onDidChange(cb: (s: LessonState) => void): Disposable {
    PgLesson._listeners.add(cb);
    cb(PgLesson._state);
    return { dispose: () => PgLesson._listeners.delete(cb) };
  }

  /** Affirm the attestation step at the frontier ("Mark as read") */
  static attest() {
    PgLesson._dispatch({ type: "attest", at: Date.now() });
  }

  /** Move past the frontier step without proof -- recorded as `passed` */
  static pass() {
    PgLesson._dispatch({ type: "pass", at: Date.now() });
  }

  /** Whether the pass edge exists right now: the cursor stands on the
   * frontier and the step there is machine-graded. Both skip valves --
   * the rail's and the chat's -- are this one edge. */
  static canPass(): boolean {
    const { path } = PgLesson._state;
    const view = PgLesson.view();
    if (!path || !view) return false;
    if (view.cursor !== view.frontier) return false;
    const step = cursorStep(path, view);
    return !!step && graderClass(step.verify) !== "attestation";
  }

  /** Pure navigation to any legal position */
  static move(to: string | "end") {
    PgLesson._dispatch({ type: "move", to, at: Date.now() });
  }

  /** Go back to the nearest legal position */
  static moveBack() {
    PgLesson._moveTo(prevLegal);
  }

  /** Return towards the frontier, one legal position at a time */
  static moveForward() {
    PgLesson._moveTo(nextLegal);
  }

  /**
   * Climb one hint rung on the cursor's step, if one is available.
   *
   * @returns the prompt to send, or `null` when this step has no rung
   * left -- the ladder is spent, or the first-attempt cap is holding
   */
  static requestHint(): string | null {
    const { path } = PgLesson._state;
    const view = PgLesson.view();
    if (!path || !view) return null;
    const step = cursorStep(path, view);
    if (!step) return null;

    const used = rung(view, step.id);
    const before = PgLesson._state;
    PgLesson._dispatch({ type: "hint", at: Date.now() });
    if (PgLesson._state === before) return null;

    return hintPrompt(step, used + 1);
  }

  /** Record that the learner opened this step's page. A fact, not a
   * proof: it drives the read signpost and gates the entry auto-open,
   * never a mark. */
  static opened(stepId: string) {
    PgLesson._dispatch({ type: "opened", stepId, at: Date.now() });
  }

  /** Subscribe to client events. Call once from the Flow layout. */
  static init(): Disposable {
    const load = async () => {
      const path = getLessonPath(PgExplorer.currentWorkspaceName);
      if (!path) {
        PgLesson._dispatch({ type: "load", path: null, at: Date.now() });
        return;
      }

      let record = EMPTY_STORED;
      let loadFailed = false;
      try {
        const storage = PgTutorial.getStorage(storageDefault());
        const hasFile = await PgExplorer.fs.exists(STORAGE_PATH);
        const loaded: unknown = await storage.getItem("lesson");
        // `getItem` cannot actually throw -- `readToJSONOrDefault`
        // swallows every read or parse error and returns the same
        // default a genuine first visit would also produce. Checking
        // the file's existence separately is what tells the two apart.
        if (hasFile && loaded === EMPTY_STORED) {
          loadFailed = true;
        } else if (loaded == null || loaded === EMPTY_STORED) {
          record = EMPTY_STORED;
        } else if (isV2(loaded)) {
          record = loaded;
        } else if (isV1(loaded)) {
          // The one-time replay: v1's fields become events that carry
          // no timestamp and no actor, so the record never claims
          // provenance it does not have
          record = migrateV1(path, loaded);
        } else {
          // A file exists and holds something neither version wrote.
          // Refusing to write is cheaper than being wrong about it.
          loadFailed = true;
        }
      } catch (e) {
        console.error("lesson load failed", e);
        loadFailed = true;
      }
      PgLesson._dispatch({
        type: "load",
        path,
        record,
        loadFailed,
        at: Date.now(),
      });
    };

    const subs: Disposable[] = [
      PgExplorer.onDidSwitchWorkspace(load),
      PgFlow.onDidChange((flow) =>
        PgLesson._dispatch({
          type: "evaluate",
          flow,
          idl: PgProgramInfo.idl ?? null,
          at: Date.now(),
        })
      ),
    ];

    load();
    return { dispose: () => subs.forEach((s) => s.dispose()) };
  }

  private static _moveTo(pick: typeof prevLegal) {
    const { path } = PgLesson._state;
    const view = PgLesson.view();
    if (!path || !view) return;
    const p = pick(path, view);
    if (p === null) return;
    PgLesson.move(p === "end" ? "end" : path.steps[p].id);
  }

  private static _dispatch(action: LessonAction) {
    const next = reduceLesson(PgLesson._state, action);
    if (next === PgLesson._state) return;

    PgLesson._state = next;

    // The lesson's own name is captured now, at the moment the write is
    // queued, rather than read back out of `PgLesson._state` inside
    // `_persist` once its await settles -- by then a workspace switch
    // could have already moved `_state` on, and `_persist` would be
    // guarding against the wrong name.
    if (action.type !== "load" && next.path) {
      void PgLesson._persist(next.path.tutorial, next.record, next.loadFailed);
    }
    for (const cb of PgLesson._listeners) cb(next);
  }

  /**
   * @param tutorial the lesson this write belongs to, captured when the
   * write was queued
   * @param record the record to write, captured the same way
   * @param loadFailed whether the load that produced `record` could not
   * tell a real empty record apart from a failed read -- if so, the
   * write is skipped rather than risk shortening the real record
   */
  private static async _persist(
    tutorial: string,
    record: StoredLesson,
    loadFailed: boolean
  ) {
    if (loadFailed) return;
    // The workspace may have moved on while this write was queued --
    // see the comment at the call site. Writing progress into whatever
    // workspace happens to be current when the write finally lands
    // would be worse than skipping it.
    if (PgExplorer.currentWorkspaceName !== tutorial) return;

    try {
      const storage = PgTutorial.getStorage(storageDefault());
      await storage.setItem("lesson", record);
    } catch (e) {
      // The in-memory record is still correct for this session; a reload
      // loses its tail. Every failure goes to the console, and the learner
      // is told once -- a toast on every step would cost more than the
      // steps it reports.
      console.warn("Lesson progress could not be saved:", e);
      if (!PgLesson._toldSaveFailed) {
        PgLesson._toldSaveFailed = true;
        const { default: SaveFailedToast } = await import("./SaveFailedToast");
        PgView.setToast(SaveFailedToast);
      }
    }
  }

  /** Whether this session has already shown the save-failure toast */
  private static _toldSaveFailed = false;
  private static _state: LessonState = INITIAL_LESSON_STATE;
  private static _view: LessonView | null = null;
  private static _viewOf: LessonState | null = null;
  private static readonly _listeners = new Set<(s: LessonState) => void>();
}
