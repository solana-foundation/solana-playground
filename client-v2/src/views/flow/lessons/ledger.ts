import { graderClass } from "./verify";
import type { LessonMark, LessonRecordEvent, StoredLesson } from "./events";
import type { LessonPath, LessonStep } from "./types";

/**
 * The two folds over the lesson's event log: a per-step ledger of
 * marks, and a single cursor. Splitting them is the whole design --
 * what the toolchain knows about a step and where the learner stands
 * are different axes, and v1 conflating them is where all three
 * shipped defects lived. Every guard here reads the event it is
 * handed, never the accumulated fold.
 */

export type LessonPosition = number | "end";

export interface LessonView {
  /** Every step of the path has an entry, `open` by default */
  marks: ReadonlyMap<string, LessonMark>;
  cursor: LessonPosition;
  /** The first `open` step, or `end` when none is */
  frontier: LessonPosition;
  /** seq of the event that first put the cursor on each position; the
   * initial position arrives at seq 0, before any event */
  firstArrival: ReadonlyMap<number, number>;
  /** seqs of `attempt` events, in order */
  attempts: readonly number[];
  /** `hint` event counts per step id */
  rungs: ReadonlyMap<string, number>;
  /** Step ids whose page the learner has opened, ever */
  opened: ReadonlySet<string>;
}

/** A toolchain event cannot take the learner's escape valves */
const isHuman = (ev: LessonRecordEvent) => ev.actor !== "toolchain";

const indexOf = (path: LessonPath, stepId: string) =>
  path.steps.findIndex((s) => s.id === stepId);

const frontierOf = (
  path: LessonPath,
  marks: ReadonlyMap<string, LessonMark>
): LessonPosition => {
  const i = path.steps.findIndex((s) => (marks.get(s.id) ?? "open") === "open");
  return i === -1 ? "end" : i;
};

const legalWith = (
  path: LessonPath,
  marks: ReadonlyMap<string, LessonMark>,
  frontier: LessonPosition,
  p: LessonPosition
): boolean => {
  if (p === "end") return frontier === "end";
  if (p < 0 || p >= path.steps.length) return false;
  const mark = marks.get(path.steps[p].id) ?? "open";
  return mark !== "open" || p === frontier;
};

/** Mutable while folding; frozen into a `LessonView` at the end */
interface FoldState {
  marks: Map<string, LessonMark>;
  cursor: LessonPosition;
  firstArrival: Map<number, number>;
  attempts: number[];
  rungs: Map<string, number>;
  opened: Set<string>;
}

const resolve = (path: LessonPath, to: string | "end"): LessonPosition | null =>
  to === "end" ? "end" : ((i) => (i === -1 ? null : i))(indexOf(path, to));

/**
 * After a fired mark edge at `k` there is always a legal position
 * ahead (everything before the new frontier is non-open, and `end` is
 * legal once the frontier is), so the stay-put fallback is defensive
 * only -- reachable for a hand-edited log, never for one this module
 * wrote.
 */
const nextLegalAfter = (
  path: LessonPath,
  marks: ReadonlyMap<string, LessonMark>,
  k: number
): LessonPosition | null => {
  const frontier = frontierOf(path, marks);
  for (let j = k + 1; j < path.steps.length; j++) {
    if (legalWith(path, marks, frontier, j)) return j;
  }
  return frontier === "end" ? "end" : null;
};

const arrive = (state: FoldState, seq: number) => {
  if (state.cursor === "end") return;
  if (!state.firstArrival.has(state.cursor)) {
    state.firstArrival.set(state.cursor, seq);
  }
};

/**
 * Apply the mark table for one event.
 *
 * @returns the step indices whose mark changed -- the cursor fold's
 * "did this edge fire" question, asked of the event rather than of the
 * accumulated record
 */
const applyMarks = (
  path: LessonPath,
  state: FoldState,
  ev: LessonRecordEvent
): number[] => {
  const frontier = frontierOf(path, state.marks);
  const flipped: number[] = [];

  const flip = (i: number, mark: LessonMark) => {
    state.marks.set(path.steps[i].id, mark);
    flipped.push(i);
  };

  switch (ev.type) {
    case "graded": {
      // The "satisfied against current state" half of this guard lives
      // at the emitter, which is the only place that can ask it; the
      // replay still refuses attestation kinds and terminal marks
      for (const id of ev.stepIds) {
        const i = indexOf(path, id);
        if (i === -1) continue;
        const mark = state.marks.get(id) ?? "open";
        const machine = graderClass(path.steps[i].verify) !== "attestation";
        if (machine && (mark === "open" || mark === "passed")) {
          flip(i, "proved");
        }
      }
      return flipped;
    }

    case "pass": {
      const i = indexOf(path, ev.stepId);
      if (i === -1 || i !== frontier || !isHuman(ev)) return flipped;
      if (graderClass(path.steps[i].verify) === "attestation") return flipped;
      flip(i, "passed");
      return flipped;
    }

    case "attest": {
      const i = indexOf(path, ev.stepId);
      if (i === -1 || i !== frontier || !isHuman(ev)) return flipped;
      if (graderClass(path.steps[i].verify) !== "attestation") return flipped;
      flip(i, "attested");
      return flipped;
    }

    // An edge with no guard is a bug; an event with no edge is a
    // recorded fact
    default:
      return flipped;
  }
};

const applyCursor = (
  path: LessonPath,
  state: FoldState,
  ev: LessonRecordEvent,
  flipped: number[]
) => {
  const frontier = frontierOf(path, state.marks);

  switch (ev.type) {
    case "move": {
      const p = resolve(path, ev.to);
      if (p !== null && legalWith(path, state.marks, frontier, p)) {
        state.cursor = p;
        arrive(state, ev.seq);
      }
      return;
    }

    case "graded": {
      // D-a's fix: the guard reads the event's own set, so a grade
      // landing elsewhere cannot move a reviewing cursor. Several
      // steps can prove in one event, so the cursor keeps walking
      // while its own step is in that set -- and no further.
      if (state.cursor === "end") return;
      if (!flipped.includes(state.cursor)) return;
      while (state.cursor !== "end" && flipped.includes(state.cursor)) {
        const next = nextLegalAfter(path, state.marks, state.cursor);
        if (next === null) break;
        state.cursor = next;
      }
      arrive(state, ev.seq);
      return;
    }

    case "pass":
    case "attest": {
      if (flipped.length === 0) return;
      const next = nextLegalAfter(path, state.marks, flipped[0]);
      if (next !== null) state.cursor = next;
      arrive(state, ev.seq);
      return;
    }

    // `enter` is a recorded fact like the rest: the replay already
    // carries the cursor, so re-deriving it here could only lose the
    // position a mark edge earned (the reload half of the D-d defect)
    case "enter":
    case "attempt":
    case "checked":
    case "hint":
    case "opened":
      return;
  }
};

/** Fold the whole record -- snapshot first, then every event */
export const foldRecord = (
  path: LessonPath,
  record: StoredLesson
): LessonView => {
  const marks = new Map<string, LessonMark>(record.snapshot?.marks ?? []);
  for (const s of path.steps) {
    if (!marks.has(s.id)) marks.set(s.id, "open");
  }
  const state: FoldState = {
    marks,
    cursor: 0,
    firstArrival: new Map(),
    attempts: [],
    rungs: new Map(),
    opened: new Set(record.snapshot?.opened ?? []),
  };

  // The initial position: the snapshot's cursor while it still names a
  // legal position (the path may have been edited since), else the
  // frontier
  const frontier = frontierOf(path, marks);
  const target = record.snapshot ? resolve(path, record.snapshot.cursor) : null;
  state.cursor =
    target !== null && legalWith(path, marks, frontier, target)
      ? target
      : frontier;
  arrive(state, 0);

  for (const ev of record.events) {
    if (ev.type === "attempt") state.attempts.push(ev.seq);
    if (ev.type === "hint") {
      state.rungs.set(ev.stepId, (state.rungs.get(ev.stepId) ?? 0) + 1);
    }
    if (ev.type === "opened") state.opened.add(ev.stepId);
    const flipped = applyMarks(path, state, ev);
    applyCursor(path, state, ev, flipped);
  }

  return {
    marks: state.marks,
    cursor: state.cursor,
    frontier: frontierOf(path, state.marks),
    firstArrival: state.firstArrival,
    attempts: state.attempts,
    rungs: state.rungs,
    opened: state.opened,
  };
};

export const legal = (
  path: LessonPath,
  view: LessonView,
  p: LessonPosition
): boolean => legalWith(path, view.marks, view.frontier, p);

/** The nearest legal position behind the cursor, for the back arrow */
export const prevLegal = (
  path: LessonPath,
  view: LessonView
): LessonPosition | null => {
  const from = view.cursor === "end" ? path.steps.length : view.cursor;
  for (let j = from - 1; j >= 0; j--) {
    if (legal(path, view, j)) return j;
  }
  return null;
};

/** The nearest legal position ahead, for the forward arrow */
export const nextLegal = (
  path: LessonPath,
  view: LessonView
): LessonPosition | null => {
  if (view.cursor === "end") return null;
  for (let j = view.cursor + 1; j < path.steps.length; j++) {
    if (legal(path, view, j)) return j;
  }
  return legal(path, view, "end") ? "end" : null;
};

/**
 * Whether an event has anything to do: a mark edge to travel, a legal
 * move that goes somewhere new. The dispatcher refuses what this
 * refuses, so the log never records a click the table has no row for
 * -- while the recorded facts (`enter`, `attempt`, `checked`, `hint`)
 * are always admitted, except `opened`, which is new only the first
 * time for a step the path actually has.
 */
export const admits = (
  path: LessonPath,
  view: LessonView,
  ev: LessonRecordEvent
): boolean => {
  switch (ev.type) {
    case "graded":
    case "pass":
    case "attest": {
      const state: FoldState = {
        marks: new Map(view.marks),
        cursor: view.cursor,
        firstArrival: new Map(),
        attempts: [],
        rungs: new Map(),
        opened: new Set(),
      };
      return applyMarks(path, state, ev).length > 0;
    }
    case "move": {
      const p = resolve(path, ev.to);
      return p !== null && p !== view.cursor && legal(path, view, p);
    }
    // A fact, but one that is only new the first time, and only about a
    // step the path has -- the log never records an id nobody can
    // render. A snapshot written before a path edit may still seed stale
    // ids into the set; they are harmless, only ever `has`-checked.
    case "opened":
      return indexOf(path, ev.stepId) !== -1 && !view.opened.has(ev.stepId);
    case "enter":
    case "attempt":
    case "checked":
    case "hint":
      return true;
  }
};

/** Trim once the log grows past this many events... */
export const TRIM_CAP = 200;
/** ...down to this many, so trims stay rare rather than per-append */
export const TRIM_KEEP = 120;

/**
 * Trim a record past the cap to a snapshot plus a bounded tail. The
 * snapshot is the fold at the cut, so the tail replays over it exactly
 * as it replayed over the dropped prefix -- a trim can never change
 * what the whole record folds to.
 *
 * @returns the same object while under the cap
 */
export const trimRecord = (path: LessonPath, r: StoredLesson): StoredLesson => {
  if (r.events.length <= TRIM_CAP) return r;

  const cut = foldRecord(path, {
    v: 2,
    snapshot: r.snapshot,
    events: r.events.slice(0, -TRIM_KEEP),
  });
  return {
    v: 2,
    snapshot: {
      marks: [...cut.marks.entries()],
      cursor: cut.cursor === "end" ? "end" : path.steps[cut.cursor].id,
      opened: [...cut.opened],
    },
    events: r.events.slice(-TRIM_KEEP),
  };
};

export const stepAt = (
  path: LessonPath,
  p: LessonPosition
): LessonStep | null => (p === "end" ? null : path.steps[p] ?? null);

/** The step under the cursor, or `null` at `end` */
export const cursorStep = (
  path: LessonPath,
  view: LessonView
): LessonStep | null => stepAt(path, view.cursor);

/**
 * @returns a 1-based step number, or one past the end when finished,
 * so the UI can render "4 of 4" and "done" from the same value
 */
export const positionNumber = (path: LessonPath, view: LessonView): number =>
  view.cursor === "end" ? path.steps.length + 1 : view.cursor + 1;

/**
 * Whether an `attempt` landed after the cursor's *first* arrival at
 * this step -- first, not last, so walking back and forth cannot take
 * a spent hint ladder away.
 */
export const attempted = (
  path: LessonPath,
  view: LessonView,
  stepId: string
): boolean => {
  const arrival = view.firstArrival.get(indexOf(path, stepId));
  if (arrival === undefined) return false;
  return view.attempts.some((seq) => seq > arrival);
};

/** How many hint rungs this step has spent, ever -- rungs survive a
 * reload now that they live in the record */
export const rung = (view: LessonView, stepId: string): number =>
  view.rungs.get(stepId) ?? 0;
