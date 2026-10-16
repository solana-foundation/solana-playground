import {
  admits,
  attempted,
  cursorStep,
  foldRecord,
  legal,
  nextLegal,
  prevLegal,
  rung,
  TRIM_CAP,
  TRIM_KEEP,
  trimRecord,
} from "./ledger";
import type { LessonView } from "./ledger";
import { EMPTY_STORED, nextSeq } from "./events";
import type {
  LessonActor,
  LessonMark,
  LessonRecordEvent,
  StoredLesson,
} from "./events";
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

/** Append events with seq/at assigned in order, learner unless said */
const record = (
  ...events: Array<Partial<LessonRecordEvent> & Pick<LessonRecordEvent, "type">>
): StoredLesson => ({
  v: 2,
  events: events.map(
    (e, i) =>
      ({
        seq: i + 1,
        at: (i + 1) * 1000,
        actor:
          e.type === "graded" || e.type === "checked" ? "toolchain" : "learner",
        ...e,
      } as LessonRecordEvent)
  ),
});

const graded = (...stepIds: string[]) => ({ type: "graded", stepIds } as const);
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
      foldRecord(PATH, record(pass("write", "toolchain"))).marks.get("write")
    ).toBe("open");
    // Behind the frontier: no edge
    expect(foldRecord(PATH, record(pass("deploy"))).marks.get("deploy")).toBe(
      "open"
    );
    // An attestation kind cannot be passed -- its escape is attest
    const atRead = record(graded("write", "deploy"), pass("client"));
    expect(foldRecord(PATH, atRead).marks.get("client")).toBe("open");
  });

  it("attests only attestation kinds", () => {
    expect(foldRecord(PATH, record(attest("write"))).marks.get("write")).toBe(
      "open"
    );
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
      expect(admits(PATH, v, { seq: 1, at: 1, actor: "learner", ...ev })).toBe(
        true
      );
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

  const randomEvent = (rand: () => number, seq: number): LessonRecordEvent => {
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
