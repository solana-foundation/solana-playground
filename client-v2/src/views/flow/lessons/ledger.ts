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

if (import.meta.vitest) {
  const { describe, it, expect, beforeAll } = import.meta.vitest;
  type LessonActor = import("./events").LessonActor;
  describe("views/flow/lessons/ledger", () => {
    let EMPTY_STORED: typeof import("./events").EMPTY_STORED;
    let nextSeq: typeof import("./events").nextSeq;
    beforeAll(async () => {
      ({ EMPTY_STORED, nextSeq } = await import("./events"));
    });
    const hints: [string, string, string] = ["a", "b", "c"];

    const PATH: LessonPath = {
      tutorial: "Hello Anchor",
      steps: [
        {
          id: "write",
          objective: "Define hello",
          verifiedBy: "the interface shows hello",
          verify: { kind: "idl", instruction: "hello" },
          hints,
        },
        {
          id: "deploy",
          objective: "Deploy it",
          verifiedBy: "it is on devnet",
          verify: { kind: "deployed" },
          hints,
        },
        {
          id: "client",
          objective: "Call it from the client",
          verifiedBy: "you have read the page",
          verify: { kind: "read", at: "interact" },
          hints,
        },
      ],
    };

    /** Append events with seq/at assigned in order, learner unless said */
    const record = (
      ...events: Array<
        Partial<LessonRecordEvent> & Pick<LessonRecordEvent, "type">
      >
    ): StoredLesson => ({
      v: 2,
      events: events.map(
        (e, i) =>
          ({
            seq: i + 1,
            at: (i + 1) * 1000,
            actor:
              e.type === "graded" || e.type === "checked"
                ? "toolchain"
                : "learner",
            ...e,
          } as LessonRecordEvent)
      ),
    });

    const graded = (...stepIds: string[]) =>
      ({ type: "graded", stepIds } as const);
    const pass = (stepId: string, actor: LessonActor = "learner") =>
      ({ type: "pass", stepId, actor } as const);
    const attest = (stepId: string, actor: LessonActor = "learner") =>
      ({ type: "attest", stepId, actor } as const);
    const move = (to: string | "end") => ({ type: "move", to } as const);
    const attempt = (startedAt: number) =>
      ({ type: "attempt", startedAt } as const);
    const hint = (stepId: string, r: number) =>
      ({ type: "hint", stepId, rung: r } as const);
    const opened = (stepId: string) => ({ type: "opened", stepId } as const);

    const marksOf = (v: LessonView) =>
      PATH.steps.map((s) => v.marks.get(s.id) ?? "open");

    describe("the ledger fold", () => {
      it("starts every step open, cursor and frontier at 0", () => {
        const v = foldRecord(PATH, record());
        expect(marksOf(v)).toEqual(["open", "open", "open"]);
        expect(v.cursor).toBe(0);
        expect(v.frontier).toBe(0);
      });

      it("proves a graded step and moves the cursor off it", () => {
        const v = foldRecord(PATH, record(graded("write")));
        expect(v.marks.get("write")).toBe("proved");
        expect(v.cursor).toBe(1);
        expect(v.frontier).toBe(1);
      });

      it("grades per step, not forward from the frontier", () => {
        // Both steps flip in one event, whatever route the learner took
        const v = foldRecord(PATH, record(graded("write", "deploy")));
        expect(marksOf(v)).toEqual(["proved", "proved", "open"]);
        expect(v.cursor).toBe(2);
      });

      it("D-a: a graded naming other steps never moves a reviewing cursor", () => {
        const v = foldRecord(
          PATH,
          record(graded("write"), move("write"), graded("deploy"))
        );
        expect(v.cursor).toBe(0);
        expect(v.marks.get("deploy")).toBe("proved");
      });

      it("D-b: a mark event on a step behind the frontier is refused", () => {
        const behind = record(graded("write", "deploy"), move("write"));
        const view = foldRecord(PATH, behind);
        const late = {
          seq: 3,
          at: 3000,
          actor: "learner",
          type: "attest",
          stepId: "write",
        } as const;
        expect(admits(PATH, view, late)).toBe(false);

        const withIt = foldRecord(PATH, {
          ...behind,
          events: [...behind.events, late],
        });
        expect(marksOf(withIt)).toEqual(marksOf(view));
        expect(withIt.cursor).toBe(view.cursor);
      });

      it("D-c: no event kind but graded ever reaches proved", () => {
        const candidates: Array<
          Partial<LessonRecordEvent> & Pick<LessonRecordEvent, "type">
        > = [
          { type: "enter" },
          { type: "checked", stepId: "write" },
          pass("write"),
          attest("write"),
          move("write"),
          attempt(1),
          hint("write", 1),
        ];
        for (const ev of candidates) {
          const v = foldRecord(PATH, record(ev));
          expect(v.marks.get("write")).not.toBe("proved");
        }
      });

      it("a click on the frontier read step lands as attested, never proved", () => {
        const v = foldRecord(
          PATH,
          record(graded("write", "deploy"), attest("client"))
        );
        expect(v.marks.get("client")).toBe("attested");
        expect(v.cursor).toBe("end");
        expect(v.frontier).toBe("end");
      });

      it("passes only at the frontier, only machine-graded, only humans", () => {
        // At the frontier, human: the edge exists
        expect(marksOf(foldRecord(PATH, record(pass("write"))))).toEqual([
          "passed",
          "open",
          "open",
        ]);
        // A toolchain pass is refused
        expect(
          foldRecord(PATH, record(pass("write", "toolchain"))).marks.get(
            "write"
          )
        ).toBe("open");
        // Behind the frontier: no edge
        expect(
          foldRecord(PATH, record(pass("deploy"))).marks.get("deploy")
        ).toBe("open");
        // An attestation kind cannot be passed -- its escape is attest
        const atRead = record(graded("write", "deploy"), pass("client"));
        expect(foldRecord(PATH, atRead).marks.get("client")).toBe("open");
      });

      it("attests only attestation kinds", () => {
        expect(
          foldRecord(PATH, record(attest("write"))).marks.get("write")
        ).toBe("open");
      });

      it("repairs a passed step into proved when a later grade lands", () => {
        const v = foldRecord(PATH, record(pass("write"), graded("write")));
        expect(v.marks.get("write")).toBe("proved");
      });

      it("keeps terminal marks terminal", () => {
        const v = foldRecord(
          PATH,
          record(
            graded("write", "deploy"),
            attest("client"),
            attest("client"),
            pass("client"),
            graded("client")
          )
        );
        expect(v.marks.get("client")).toBe("attested");
      });

      it("migrated actors count as human, toolchain does not", () => {
        expect(
          foldRecord(PATH, record(pass("write", "unknown"))).marks.get("write")
        ).toBe("passed");
      });
    });

    describe("the cursor fold", () => {
      it("moves to any non-open step, and refuses open ones ahead", () => {
        const proved = record(graded("write"));
        expect(
          foldRecord(PATH, { ...proved, events: [...proved.events] }).cursor
        ).toBe(1);

        const back = foldRecord(PATH, record(graded("write"), move("write")));
        expect(back.cursor).toBe(0);

        const ahead = foldRecord(PATH, record(graded("write"), move("client")));
        expect(ahead.cursor).toBe(1);
      });

      it("reaches end only when the frontier is end", () => {
        const early = foldRecord(PATH, record(graded("write"), move("end")));
        expect(early.cursor).toBe(1);

        const done = foldRecord(
          PATH,
          record(graded("write", "deploy"), attest("client"), move("client"))
        );
        expect(done.cursor).toBe(2);
        const toEnd = foldRecord(
          PATH,
          record(
            graded("write", "deploy"),
            attest("client"),
            move("client"),
            move("end")
          )
        );
        expect(toEnd.cursor).toBe("end");
      });

      it("pass moves the cursor to the next legal position", () => {
        const v = foldRecord(PATH, record(pass("write")));
        expect(v.cursor).toBe(1);
        expect(v.frontier).toBe(1);
      });

      it("keeps the cursor where a grade left it across a reload's enter", () => {
        // The learner reviews, returns to "deploy", a build proves it, the
        // cursor walks on -- reopening the lesson must not walk it back
        const walked = record(
          graded("write"),
          move("write"),
          move("deploy"),
          graded("deploy")
        );
        expect(foldRecord(PATH, walked).cursor).toBe(2);
        const reloaded = record(
          graded("write"),
          move("write"),
          move("deploy"),
          graded("deploy"),
          { type: "enter" }
        );
        expect(foldRecord(PATH, reloaded).cursor).toBe(2);
      });

      it("enter restores the last move target", () => {
        const v = foldRecord(
          PATH,
          record(graded("write"), move("write"), { type: "enter" })
        );
        expect(v.cursor).toBe(0);
      });

      it("enter falls back to the frontier when no move was recorded", () => {
        const v = foldRecord(PATH, record(graded("write"), { type: "enter" }));
        expect(v.cursor).toBe(1);
      });
    });

    describe("legality", () => {
      it("is the frontier plus everything no longer open", () => {
        const v = foldRecord(PATH, record(graded("write")));
        expect(legal(PATH, v, 0)).toBe(true);
        expect(legal(PATH, v, 1)).toBe(true);
        expect(legal(PATH, v, 2)).toBe(false);
        expect(legal(PATH, v, "end")).toBe(false);
      });

      it("admits end once every step is behind the learner", () => {
        const v = foldRecord(
          PATH,
          record(graded("write", "deploy"), attest("client"))
        );
        expect(legal(PATH, v, "end")).toBe(true);
      });

      it("prevLegal and nextLegal walk the legal set only", () => {
        const v = foldRecord(PATH, record(graded("write"), move("write")));
        expect(prevLegal(PATH, v)).toBeNull();
        expect(nextLegal(PATH, v)).toBe(1);

        const done = foldRecord(
          PATH,
          record(graded("write", "deploy"), attest("client"), move("write"))
        );
        expect(nextLegal(PATH, done)).toBe(1);
        const atLast = foldRecord(
          PATH,
          record(graded("write", "deploy"), attest("client"), move("client"))
        );
        expect(nextLegal(PATH, atLast)).toBe("end");

        const fresh = foldRecord(PATH, record());
        expect(prevLegal(PATH, fresh)).toBeNull();
        expect(nextLegal(PATH, fresh)).toBeNull();
      });
    });

    describe("admits", () => {
      it("refuses a move to where the cursor already stands", () => {
        const v = foldRecord(PATH, record());
        const ev = {
          seq: 1,
          at: 1000,
          actor: "learner",
          type: "move",
          to: "write",
        } as const;
        expect(admits(PATH, v, ev)).toBe(false);
      });

      it("always admits the recorded facts", () => {
        const v = foldRecord(PATH, record());
        for (const ev of [
          { type: "enter" } as const,
          { type: "attempt", startedAt: 5 } as const,
          { type: "checked", stepId: "write" } as const,
          { type: "hint", stepId: "write", rung: 1 } as const,
        ]) {
          expect(
            admits(PATH, v, { seq: 1, at: 1, actor: "learner", ...ev })
          ).toBe(true);
        }
      });

      it("admits a graded only when some named step has the edge", () => {
        const v = foldRecord(PATH, record(graded("write")));
        const again: LessonRecordEvent = {
          seq: 9,
          at: 9,
          actor: "toolchain",
          type: "graded",
          stepIds: ["write"],
        };
        expect(admits(PATH, v, again)).toBe(false);
        const repair: LessonRecordEvent = {
          ...again,
          type: "graded",
          stepIds: ["write", "deploy"],
        };
        expect(admits(PATH, v, repair)).toBe(true);
      });
    });

    describe("opened pages", () => {
      it("folds opened into a set and never touches marks or cursor", () => {
        const v = foldRecord(PATH, record(opened("write"), opened("deploy")));
        expect([...v.opened]).toEqual(["write", "deploy"]);
        expect(marksOf(v)).toEqual(["open", "open", "open"]);
        expect(v.cursor).toBe(0);
      });

      it("admits opened once per step", () => {
        const v = foldRecord(PATH, record(opened("write")));
        expect(
          admits(PATH, v, {
            seq: 2,
            at: 2,
            actor: "learner",
            type: "opened",
            stepId: "write",
          })
        ).toBe(false);
        expect(
          admits(PATH, v, {
            seq: 2,
            at: 2,
            actor: "learner",
            type: "opened",
            stepId: "deploy",
          })
        ).toBe(true);
      });

      it("refuses opened for a step the path does not have", () => {
        const v = foldRecord(PATH, record());
        expect(
          admits(PATH, v, {
            seq: 1,
            at: 1,
            actor: "learner",
            type: "opened",
            stepId: "nowhere",
          })
        ).toBe(false);
      });

      it("restores opened from a snapshot", () => {
        const v = foldRecord(PATH, {
          v: 2,
          snapshot: { marks: [], cursor: "write", opened: ["write"] },
          events: [],
        });
        expect(v.opened.has("write")).toBe(true);
      });
    });

    describe("queries over the log", () => {
      it("attempted is true once an attempt lands after first arrival", () => {
        const v = foldRecord(PATH, record(graded("write"), attempt(50)));
        expect(attempted(PATH, v, "deploy")).toBe(true);
      });

      it("an attempt before the arrival does not count", () => {
        const v = foldRecord(PATH, record(attempt(50), graded("write")));
        expect(attempted(PATH, v, "deploy")).toBe(false);
      });

      it("attempted survives review navigation", () => {
        const v = foldRecord(
          PATH,
          record(graded("write"), attempt(50), move("write"), move("deploy"))
        );
        expect(attempted(PATH, v, "deploy")).toBe(true);
      });

      it("rung counts the hint events per step", () => {
        const v = foldRecord(
          PATH,
          record(hint("write", 1), hint("write", 2), hint("deploy", 1))
        );
        expect(rung(v, "write")).toBe(2);
        expect(rung(v, "deploy")).toBe(1);
        expect(rung(v, "client")).toBe(0);
      });

      it("cursorStep names the step under the cursor", () => {
        expect(cursorStep(PATH, foldRecord(PATH, record()))?.id).toBe("write");
        const done = foldRecord(
          PATH,
          record(graded("write", "deploy"), attest("client"))
        );
        expect(cursorStep(PATH, done)).toBeNull();
      });
    });

    describe("trimming", () => {
      type Payload = Parameters<typeof record>[number];

      /** `n` attempt payloads -- the filler that grows a record */
      const attempts = (n: number): Payload[] =>
        Array.from({ length: n }, () => attempt(1));

      /** Like `record`, but from plain arrays so long series read flat */
      const recordFrom = (...groups: Payload[][]): StoredLesson =>
        record(...groups.flat());

      /** Append attempts with real seqs until the record passes the cap */
      const grownPastCap = (r: StoredLesson): StoredLesson => {
        const events = r.events.slice();
        while (events.length <= TRIM_CAP) {
          events.push({
            seq: events[events.length - 1].seq + 1,
            at: 1,
            actor: "learner",
            type: "attempt",
            startedAt: 1,
          });
        }
        return { v: 2, snapshot: r.snapshot, events };
      };

      it("returns the same object while under the cap", () => {
        expect(trimRecord(PATH, EMPTY_STORED)).toBe(EMPTY_STORED);

        const one = record(attempt(1));
        expect(trimRecord(PATH, one)).toBe(one);

        const atCap = recordFrom(attempts(TRIM_CAP));
        expect(trimRecord(PATH, atCap)).toBe(atCap);
      });

      it("keeps the last TRIM_KEEP events once past the cap", () => {
        const long = recordFrom(attempts(TRIM_CAP + 1));
        const trimmed = trimRecord(PATH, long);
        expect(trimmed.events).toHaveLength(TRIM_KEEP);
        expect(trimmed.events[0].seq).toBe(TRIM_CAP + 1 - TRIM_KEEP + 1);
        expect(nextSeq(trimmed)).toBe(TRIM_CAP + 2);
      });

      it("folding a trimmed record matches folding the whole record", () => {
        // An early move in the dropped prefix, a grade in the kept tail --
        // the trim half of the D-d defect: the learner must not be thrown
        // back to where they last explicitly moved
        const whole = recordFrom([move("write")], attempts(TRIM_CAP - 1), [
          graded("write"),
        ]);
        const trimmed = trimRecord(PATH, whole);
        expect(trimmed.events.length).toBeLessThan(whole.events.length);

        const a = foldRecord(PATH, whole);
        const b = foldRecord(PATH, trimmed);
        expect(b.cursor).toBe(a.cursor);
        expect(marksOf(b)).toEqual(marksOf(a));
        expect(b.frontier).toBe(a.frontier);
      });

      it("a second trim folds the prior snapshot into the next one", () => {
        const first = trimRecord(
          PATH,
          recordFrom([graded("write")], attempts(TRIM_CAP))
        );
        const again = trimRecord(PATH, grownPastCap(first));
        const v = foldRecord(PATH, again);
        expect(v.marks.get("write")).toBe("proved");
        expect(v.cursor).toBe(1);
      });

      it("carries the opened set into the snapshot", () => {
        const whole = recordFrom([opened("write")], attempts(TRIM_CAP));
        const trimmed = trimRecord(PATH, whole);
        expect(trimmed.events.some((e) => e.type === "opened")).toBe(false);
        expect(trimmed.snapshot?.opened).toEqual(["write"]);
        expect(foldRecord(PATH, trimmed).opened.has("write")).toBe(true);
      });
    });

    describe("folding from a snapshot", () => {
      const trimmed: StoredLesson = {
        v: 2,
        snapshot: { marks: [["write", "proved"]], cursor: "write" },
        events: [],
      };

      it("carries the snapshot's marks", () => {
        const v = foldRecord(PATH, trimmed);
        expect(v.marks.get("write")).toBe("proved");
        expect(v.frontier).toBe(1);
      });

      it("restores the snapshot's cursor", () => {
        expect(foldRecord(PATH, trimmed).cursor).toBe(0);
      });

      it("still restores it through a later enter", () => {
        const v = foldRecord(PATH, {
          ...trimmed,
          events: [{ seq: 121, at: 1, actor: "learner", type: "enter" }],
        });
        expect(v.cursor).toBe(0);
      });

      it("falls back to the frontier when the cursor's step is gone", () => {
        const v = foldRecord(PATH, {
          v: 2,
          snapshot: { marks: [["write", "proved"]], cursor: "removed-step" },
          events: [],
        });
        expect(v.cursor).toBe(1);
      });
    });

    describe("properties over random series", () => {
      const RANK: Record<LessonMark, number> = {
        open: 0,
        passed: 1,
        attested: 1,
        proved: 2,
      };

      // Deterministic PRNG: property runs must be reproducible
      const lcg = (seed: number) => () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };

      const randomEvent = (
        rand: () => number,
        seq: number
      ): LessonRecordEvent => {
        const ids = PATH.steps.map((s) => s.id);
        const id = ids[Math.floor(rand() * ids.length)];
        const base = { seq, at: seq, actor: "learner" as const };
        switch (Math.floor(rand() * 8)) {
          case 0:
            return {
              ...base,
              actor: "toolchain",
              type: "graded",
              stepIds: ids.filter(() => rand() < 0.4),
            };
          case 1:
            return { ...base, type: "pass", stepId: id };
          case 2:
            return { ...base, type: "attest", stepId: id };
          case 3:
            return { ...base, type: "move", to: rand() < 0.15 ? "end" : id };
          case 4:
            return { ...base, type: "attempt", startedAt: seq };
          case 5:
            return { ...base, type: "hint", stepId: id, rung: 1 };
          case 6:
            return { ...base, type: "opened", stepId: id };
          default:
            return { ...base, type: "enter" };
        }
      };

      it("marks never move down and terminal marks never change", () => {
        const rand = lcg(42);
        for (let run = 0; run < 60; run++) {
          const events: LessonRecordEvent[] = [];
          let prev = foldRecord(PATH, { v: 2, events });
          for (let i = 0; i < 40; i++) {
            events.push(randomEvent(rand, i + 1));
            const next = foldRecord(PATH, { v: 2, events });
            for (const s of PATH.steps) {
              const a = prev.marks.get(s.id) ?? "open";
              const b = next.marks.get(s.id) ?? "open";
              expect(RANK[b]).toBeGreaterThanOrEqual(RANK[a]);
              if (a === "proved" || a === "attested") expect(b).toBe(a);
            }
            prev = next;
          }
        }
      });

      it("legality only grows", () => {
        const rand = lcg(7);
        const positions: Array<number | "end"> = [0, 1, 2, "end"];
        for (let run = 0; run < 60; run++) {
          const events: LessonRecordEvent[] = [];
          let prev = foldRecord(PATH, { v: 2, events });
          for (let i = 0; i < 40; i++) {
            events.push(randomEvent(rand, i + 1));
            const next = foldRecord(PATH, { v: 2, events });
            for (const p of positions) {
              if (legal(PATH, prev, p)) expect(legal(PATH, next, p)).toBe(true);
            }
            prev = next;
          }
        }
      });

      it("the cursor is always legal", () => {
        const rand = lcg(2026);
        for (let run = 0; run < 60; run++) {
          const events: LessonRecordEvent[] = [];
          for (let i = 0; i < 40; i++) {
            events.push(randomEvent(rand, i + 1));
            const v = foldRecord(PATH, { v: 2, events });
            expect(legal(PATH, v, v.cursor)).toBe(true);
          }
        }
      });
    });
  });
}
