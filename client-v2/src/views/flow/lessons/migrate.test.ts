import { isV1, isV2, migrateV1 } from "./migrate";
import { foldRecord } from "./ledger";
import { EMPTY_STORED } from "./events";
import type { LessonPath } from "./types";

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
      isV1({ completedStepIds: ["a"], skippedStepIds: [], currentStepId: "b" })
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
    expect(isV2({ v: 2, snapshot: { marks: [], cursor: 3 }, events: [] })).toBe(
      false
    );
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
          { seq: 6, at: 6, actor: "learner", type: "opened", stepId: "write" },
        ],
      })
    ).toBe(true);
  });
});
