/**
 * The lesson's persisted record: an append-only series of events.
 *
 * Nothing else is stored. The per-step marks and the learner's position
 * are folds over this series (see `ledger.ts`), so the record can never
 * disagree with itself the way v1's three fields could.
 */

/**
 * Who an event came from. `unknown` exists only on events synthesized
 * by the v1 migration, so the record never claims provenance it does
 * not have.
 */
export type LessonActor = "learner" | "toolchain" | "unknown";

/** What the toolchain knows about a step. `proved` and `attested` are
 * terminal; only `graded` -- the toolchain's own event -- reaches
 * `proved`. */
export type LessonMark = "open" | "proved" | "attested" | "passed";

interface LessonEventBase {
  /** Monotonic within one record, starting at 1 */
  seq: number;
  /** Wall clock; `null` only on migrated events, which must not claim
   * a time nobody recorded */
  at: number | null;
  actor: LessonActor;
  /** Present when a learner approved an agent proposal -- the learner
   * still moved, the agent only proposed */
  via?: "agent";
}

/**
 * Steps are referenced by id, never by index: ids are the stable
 * storage key, so editing a path cannot shift what an old log means.
 *
 * There is no `checked` with a positive verdict -- an on-demand grader
 * that says yes emits `graded`, so `checked` only records a negative.
 * `attempt` carries the flow's own `buildStartedAt` as its identity,
 * which is what keeps one build from being recorded once per store
 * notification.
 */
export type LessonRecordEvent = LessonEventBase &
  (
    | { type: "enter" }
    | { type: "graded"; stepIds: string[] }
    | { type: "checked"; stepId: string; output?: string }
    | { type: "pass"; stepId: string }
    | { type: "attest"; stepId: string }
    | { type: "move"; to: string | "end" }
    | { type: "attempt"; startedAt: number }
    | { type: "hint"; stepId: string; rung: number }
    /** The learner opened this step's page. Recorded once per step;
     * proves nothing -- `attest` is the only edge a read step has */
    | { type: "opened"; stepId: string }
  );

/**
 * What a trim leaves behind for the events it drops: the fold at the
 * cut -- every mark, the opened set, plus the cursor -- so the kept
 * tail replays over it exactly as it replayed over the dropped prefix.
 * Only the step-local `attempt`/`hint` history ages out, which is why
 * the tail is bounded rather than empty.
 */
export interface LessonSnapshot {
  marks: Array<[string, LessonMark]>;
  /** Step id under the cursor at the cut, or `end` */
  cursor: string | "end";
  /** Step ids whose page was opened, so the fact survives a trim like the
   * rest of the record */
  opened?: string[];
}

export interface StoredLesson {
  v: 2;
  /** Absent until the first trim */
  snapshot?: LessonSnapshot;
  events: LessonRecordEvent[];
}

// Frozen: the load path detects a failed read by identity against this
// sentinel, so a mutation anywhere would poison every fresh lesson
const NO_EVENTS: LessonRecordEvent[] = [];
Object.freeze(NO_EVENTS);
export const EMPTY_STORED: StoredLesson = Object.freeze({
  v: 2,
  events: NO_EVENTS,
});

/**
 * @returns the seq the next appended event should carry. A trimmed
 * record always keeps a non-empty tail, so an empty `events` means a
 * genuinely fresh record.
 */
export const nextSeq = (r: StoredLesson): number =>
  r.events.length ? r.events[r.events.length - 1].seq + 1 : 1;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("views/flow/lessons/events", () => {
    const attempt = (seq: number): LessonRecordEvent => ({
      seq,
      at: seq * 1000,
      actor: "learner",
      type: "attempt",
      startedAt: seq,
    });

    const record = (events: LessonRecordEvent[]): StoredLesson => ({
      v: 2,
      events,
    });

    describe("EMPTY_STORED", () => {
      it("is frozen -- the load path detects a failed read by identity against it", () => {
        expect(Object.isFrozen(EMPTY_STORED)).toBe(true);
        expect(Object.isFrozen(EMPTY_STORED.events)).toBe(true);
      });
    });

    describe("nextSeq", () => {
      it("starts a fresh record at 1", () => {
        expect(nextSeq(EMPTY_STORED)).toBe(1);
      });

      it("continues from the last event", () => {
        expect(nextSeq(record([attempt(1), attempt(2)]))).toBe(3);
      });
    });
  });
}
