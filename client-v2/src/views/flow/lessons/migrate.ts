import { admits, foldRecord } from "./ledger";
import { nextSeq } from "./events";
import type { LessonRecordEvent, StoredLesson } from "./events";
import { graderClass } from "./verify";
import type { LessonPath } from "./types";

/** The record shape #19 shipped: three fields, no provenance */
export interface LessonProgressV1 {
  completedStepIds: string[];
  skippedStepIds?: string[];
  currentStepId: string | null;
}

export const isV1 = (raw: unknown): raw is LessonProgressV1 => {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as Record<string, unknown>;
  return (
    Array.isArray(r.completedStepIds) &&
    (r.currentStepId === null || typeof r.currentStepId === "string")
  );
};

const MARKS = ["open", "proved", "attested", "passed"];

// The fold consumes the snapshot unguarded (`new Map(marks)`,
// `new Set(opened)`), so a malformed one must fail here, into the load's
// `loadFailed` refusal, rather than crash or fold garbage
const isSnapshot = (raw: unknown): boolean => {
  if (typeof raw !== "object" || raw === null) return false;
  const s = raw as Record<string, unknown>;
  return (
    Array.isArray(s.marks) &&
    s.marks.every(
      (m) =>
        Array.isArray(m) && typeof m[0] === "string" && MARKS.includes(m[1])
    ) &&
    typeof s.cursor === "string" &&
    (s.opened === undefined ||
      (Array.isArray(s.opened) &&
        s.opened.every((id) => typeof id === "string")))
  );
};

// The fold walks events just as unguarded (`ev.type`, `for (const id of
// ev.stepIds)`), and the first fold runs outside the load's try -- a
// malformed element must fail here, not as an unhandled rejection
const isEvent = (raw: unknown): boolean => {
  if (typeof raw !== "object" || raw === null) return false;
  const e = raw as Record<string, unknown>;
  if (typeof e.seq !== "number") return false;
  if (e.at !== null && typeof e.at !== "number") return false;
  if (typeof e.actor !== "string") return false;

  switch (e.type) {
    case "enter":
      return true;
    case "graded":
      return (
        Array.isArray(e.stepIds) &&
        e.stepIds.every((id) => typeof id === "string")
      );
    case "checked":
    case "pass":
    case "attest":
    case "opened":
      return typeof e.stepId === "string";
    case "move":
      return typeof e.to === "string";
    case "attempt":
      return typeof e.startedAt === "number";
    case "hint":
      return typeof e.stepId === "string" && typeof e.rung === "number";
    default:
      return false;
  }
};

export const isV2 = (raw: unknown): raw is StoredLesson => {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as Record<string, unknown>;
  return (
    r.v === 2 &&
    Array.isArray(r.events) &&
    r.events.every(isEvent) &&
    (r.snapshot === undefined || isSnapshot(r.snapshot))
  );
};

/**
 * Replay a v1 record into events, once.
 *
 * The mapping is per kind, not per field, because v1's
 * `completedStepIds` is exactly the field that conflated the two: an
 * id there whose step is an attestation kind was necessarily put there
 * by a click, so it migrates to `attested`; every other id migrates to
 * `proved`; skips migrate to `passed`. Every synthesized event carries
 * `at: null` and `actor: "unknown"`, so the record never claims
 * provenance it does not have.
 *
 * Events are appended through the same `admits` guard live dispatch
 * uses, which is what collapses D-b's duplicate ids on the way in: the
 * second event for a step whose mark is already terminal has no edge
 * to travel on, so it is never written.
 */
export const migrateV1 = (
  path: LessonPath,
  v1: LessonProgressV1
): StoredLesson => {
  let record: StoredLesson = { v: 2, events: [] };

  type MigratedPayload =
    | { type: "graded"; stepIds: string[] }
    | { type: "attest"; stepId: string }
    | { type: "pass"; stepId: string }
    | { type: "move"; to: string | "end" };

  const append = (ev: MigratedPayload) => {
    const candidate = {
      ...ev,
      seq: nextSeq(record),
      at: null,
      actor: "unknown",
    } as LessonRecordEvent;
    if (!admits(path, foldRecord(path, record), candidate)) return;
    record = { v: 2, events: [...record.events, candidate] };
  };

  // Walk the path in order so the frontier guards hold while replaying:
  // by the time a skipped or attested step is reached, everything
  // before it is already non-open
  for (const step of path.steps) {
    for (const id of v1.completedStepIds) {
      if (id !== step.id) continue;
      if (graderClass(step.verify) === "attestation") {
        append({ type: "attest", stepId: step.id });
      } else {
        append({ type: "graded", stepIds: [step.id] });
      }
    }
    if ((v1.skippedStepIds ?? []).includes(step.id)) {
      // v1 offered its skip on any kind; on an attestation step the
      // click means the same thing `attest` does, and `pass` would be
      // refused by the fold, silently re-opening the step
      if (graderClass(step.verify) === "attestation") {
        append({ type: "attest", stepId: step.id });
      } else {
        append({ type: "pass", stepId: step.id });
      }
    }
  }

  if (v1.currentStepId !== null) {
    append({ type: "move", to: v1.currentStepId });
  }

  return record;
};

if (import.meta.vitest) {
  const { describe, it, expect, beforeAll } = import.meta.vitest;
  let EMPTY_STORED: typeof import("./events").EMPTY_STORED;
  beforeAll(async () => {
    ({ EMPTY_STORED } = await import("./events"));
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

  describe("migrateV1", () => {
    it("replays a v1 record into the ledger it always claimed", () => {
      const r = migrateV1(PATH, {
        completedStepIds: ["write", "deploy"],
        currentStepId: "client",
      });
      const v = foldRecord(PATH, r);
      expect(v.marks.get("write")).toBe("proved");
      expect(v.marks.get("deploy")).toBe("proved");
      expect(v.marks.get("client")).toBe("open");
      expect(v.cursor).toBe(2);
    });

    it("migrates a completed read step to attested, never proved", () => {
      const r = migrateV1(PATH, {
        completedStepIds: ["write", "deploy", "client"],
        currentStepId: null,
      });
      const v = foldRecord(PATH, r);
      expect(v.marks.get("client")).toBe("attested");
      expect(v.cursor).toBe("end");
    });

    it("migrates skips to passed", () => {
      const r = migrateV1(PATH, {
        completedStepIds: [],
        skippedStepIds: ["write"],
        currentStepId: "deploy",
      });
      const v = foldRecord(PATH, r);
      expect(v.marks.get("write")).toBe("passed");
      expect(v.cursor).toBe(1);
    });

    it("migrates a skipped read step to attested, so the lesson stays done", () => {
      // v1 offered its skip on any step kind, so shipped records hold
      // read steps in `skippedStepIds`; replaying those as `pass` would
      // be refused and re-open a finished lesson
      const r = migrateV1(PATH, {
        completedStepIds: ["write", "deploy"],
        skippedStepIds: ["client"],
        currentStepId: null,
      });
      const v = foldRecord(PATH, r);
      expect(v.marks.get("client")).toBe("attested");
      expect(v.cursor).toBe("end");
      expect(v.frontier).toBe("end");
    });

    it("collapses D-b's duplicate completions on the way in", () => {
      const r = migrateV1(PATH, {
        completedStepIds: ["write", "deploy", "deploy", "deploy", "deploy"],
        currentStepId: "client",
      });
      expect(
        r.events.filter((e) => e.type === "graded" || e.type === "attest")
      ).toHaveLength(2);
      const v = foldRecord(PATH, r);
      expect(v.marks.get("deploy")).toBe("proved");
    });

    it("never synthesizes a timestamp or claims an actor", () => {
      const r = migrateV1(PATH, {
        completedStepIds: ["write"],
        skippedStepIds: ["deploy"],
        currentStepId: "client",
      });
      expect(r.events.length).toBeGreaterThan(0);
      for (const e of r.events) {
        expect(e.at).toBeNull();
        expect(e.actor).toBe("unknown");
      }
    });

    it("restores the position the learner stood on", () => {
      const r = migrateV1(PATH, {
        completedStepIds: ["write", "deploy"],
        currentStepId: "write",
      });
      expect(foldRecord(PATH, r).cursor).toBe(0);
    });

    it("leaves the cursor at the frontier when v1 had no pointer", () => {
      const r = migrateV1(PATH, {
        completedStepIds: ["write"],
        currentStepId: null,
      });
      expect(foldRecord(PATH, r).cursor).toBe(1);
    });

    it("ignores ids that name no step", () => {
      const r = migrateV1(PATH, {
        completedStepIds: ["gone", "write"],
        currentStepId: "also-gone",
      });
      const v = foldRecord(PATH, r);
      expect(v.marks.get("write")).toBe("proved");
      expect(v.cursor).toBe(1);
    });
  });

  describe("shape guards", () => {
    it("recognize v1", () => {
      expect(isV1({ completedStepIds: [], currentStepId: null })).toBe(true);
      expect(
        isV1({
          completedStepIds: ["a"],
          skippedStepIds: [],
          currentStepId: "b",
        })
      ).toBe(true);
      expect(isV1(EMPTY_STORED)).toBe(false);
      expect(isV1(null)).toBe(false);
      expect(isV1({ anything: 1 })).toBe(false);
    });

    it("recognize v2", () => {
      expect(isV2(EMPTY_STORED)).toBe(true);
      expect(isV2({ v: 2, events: [] })).toBe(true);
      expect(isV2({ completedStepIds: [], currentStepId: null })).toBe(false);
      expect(isV2({ v: 1, events: [] })).toBe(false);
      expect(isV2("junk")).toBe(false);
    });

    it("refuses a malformed snapshot instead of folding garbage", () => {
      // The fold does `new Map(marks)` / `new Set(opened)` unguarded, so a
      // shape the types promise but storage does not hold must fail here,
      // into the load's `loadFailed` refusal
      const good = {
        v: 2,
        snapshot: { marks: [["write", "proved"]], cursor: "write" },
        events: [],
      };
      expect(isV2(good)).toBe(true);
      expect(
        isV2({
          v: 2,
          snapshot: {
            marks: [["write", "proved"]],
            cursor: "write",
            opened: ["write"],
          },
          events: [],
        })
      ).toBe(true);
      expect(
        isV2({
          v: 2,
          snapshot: {
            marks: [["write", "proved"]],
            cursor: "write",
            opened: "write",
          },
          events: [],
        })
      ).toBe(false);
      expect(
        isV2({
          v: 2,
          snapshot: { marks: ["write"], cursor: "write" },
          events: [],
        })
      ).toBe(false);
      expect(
        isV2({ v: 2, snapshot: { marks: [], cursor: 3 }, events: [] })
      ).toBe(false);
    });

    it("refuses malformed events instead of crashing the fold", () => {
      // The first fold runs outside the load's try; an element the fold
      // cannot walk must be refused here, into `loadFailed`
      expect(isV2({ v: 2, events: [null] })).toBe(false);
      expect(
        isV2({
          v: 2,
          events: [{ seq: 1, at: 1, actor: "toolchain", type: "graded" }],
        })
      ).toBe(false);
      expect(isV2({ v: 2, events: [{ type: "enter" }] })).toBe(false);
      expect(
        isV2({
          v: 2,
          events: [
            { seq: 1, at: 1, actor: "learner", type: "enter" },
            {
              seq: 2,
              at: null,
              actor: "toolchain",
              type: "graded",
              stepIds: ["write"],
            },
            { seq: 3, at: 3, actor: "learner", type: "move", to: "end" },
            { seq: 4, at: 4, actor: "learner", type: "attempt", startedAt: 4 },
            {
              seq: 5,
              at: 5,
              actor: "learner",
              type: "hint",
              stepId: "write",
              rung: 1,
            },
            {
              seq: 6,
              at: 6,
              actor: "learner",
              type: "opened",
              stepId: "write",
            },
          ],
        })
      ).toBe(true);
    });
  });
}
