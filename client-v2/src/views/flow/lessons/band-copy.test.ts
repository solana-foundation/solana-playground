// Importing `INITIAL_LESSON_STATE` as a value pulls in `./store`'s real
// module chain, which reaches `../../../utils` and, through it, generated
// globals (`GLOBAL_SETTINGS`) that exist only once the app has actually
// booted -- see `store.test.ts` and `console/status.test.ts` for the same
// mock, needed for the same reason.
vi.mock("../../../utils", () => ({
  PgExplorer: {
    currentWorkspaceName: null,
    onDidSwitchWorkspace: vi.fn(() => ({ dispose: vi.fn() })),
  },
  PgProgramInfo: { idl: null },
  PgTutorial: { getStorage: vi.fn() },
}));

import {
  assistantLabel,
  describeFinish,
  describeStep,
  positionLabel,
  primaryLabel,
  readLabel,
} from "./band-copy";
import { foldRecord } from "./ledger";
import { INITIAL_LESSON_STATE } from "./store";
import type { LessonState } from "./store";
import type { LessonRecordEvent } from "./events";
import type { LessonPath } from "./types";

const hints: [string, string, string] = ["a", "b", "c"];

const PATH: LessonPath = {
  tutorial: "Hello Anchor",
  steps: [
    {
      id: "one",
      objective: "Define hello",
      verifiedBy: "the interface shows hello",
      verify: { kind: "idl", instruction: "hello" },
      hints,
    },
    {
      id: "two",
      objective: "Deploy it",
      verifiedBy: "it is on devnet",
      verify: { kind: "deployed" },
      hints,
    },
  ],
};

const READ_PATH: LessonPath = {
  tutorial: "Hello Anchor",
  steps: [
    {
      id: "one",
      objective: "Read the intro",
      verifiedBy: "you have marked this page as read",
      verify: { kind: "read", at: "write" },
      hints,
    },
  ],
};

const withEvents = (
  path: LessonPath,
  events: LessonRecordEvent[]
): LessonState => ({
  path,
  record: { v: 2, events },
  loadFailed: false,
});

describe("primaryLabel", () => {
  it("names the action that proves the step", () => {
    expect(primaryLabel({ kind: "idl", instruction: "hello" })).toBe(
      "Build to prove this"
    );
    expect(primaryLabel({ kind: "build-passes" })).toBe("Build to prove this");
    expect(primaryLabel({ kind: "deployed" })).toBe("Deploy to prove this");
  });

  it("never says an attestation verifies anything", () => {
    expect(primaryLabel({ kind: "read", at: "write" })).toBe("Mark as read");
  });
});

describe("describeStep", () => {
  it("is null outside a lesson", () => {
    expect(describeStep(INITIAL_LESSON_STATE)).toBeNull();
  });

  it("names the current step, its position and its criterion", () => {
    const d = describeStep(withEvents(PATH, []));
    expect(d).toMatchObject({
      number: "Step 1 of 2",
      position: 1,
      objective: "Define hello",
      verifiedBy: "Verified when the interface shows hello.",
      mark: "open",
      opened: false,
      offersPrimary: true,
    });
  });

  it("knows whether the page has been opened", () => {
    const opened = withEvents(PATH, [
      { seq: 1, at: 1, actor: "learner", type: "opened", stepId: "one" },
    ]);
    expect(describeStep(opened)?.opened).toBe(true);
  });

  it("is null once the path is finished", () => {
    const done = withEvents(PATH, [
      {
        seq: 1,
        at: 1,
        actor: "toolchain",
        type: "graded",
        stepIds: ["one", "two"],
      },
    ]);
    expect(describeStep(done)).toBeNull();
  });

  it("does not claim a read step is machine-checked", () => {
    const d = describeStep(withEvents(READ_PATH, []));
    expect(d).toMatchObject({
      number: "Step 1 of 1",
      objective: "Read the intro",
      verifiedBy:
        "Not machine-checked -- continue when you have marked this page as read.",
      offersPrimary: true,
    });
  });

  it("offers no primary behind the frontier and names the mark", () => {
    const back = withEvents(PATH, [
      {
        seq: 1,
        at: 1,
        actor: "toolchain",
        type: "graded",
        stepIds: ["one"],
      },
      { seq: 2, at: 2, actor: "learner", type: "move", to: "one" },
    ]);
    const d = describeStep(back);
    expect(d).toMatchObject({
      number: "Step 1 of 2",
      mark: "proved",
      offersPrimary: false,
      verifiedBy: "Proved -- the interface shows hello.",
    });
  });

  it("never says a passed step is done, and offers the repair", () => {
    // The skip valve's own copy promises the mark "clears itself if
    // you come back and prove it" -- so coming back must offer the
    // proving action, which the `passed -> proved` edge makes honest
    const passed = withEvents(PATH, [
      { seq: 1, at: 1, actor: "learner", type: "pass", stepId: "one" },
      { seq: 2, at: 2, actor: "learner", type: "move", to: "one" },
    ]);
    expect(describeStep(passed)).toMatchObject({
      mark: "passed",
      offersPrimary: true,
      verifiedBy: "Skipped -- not verified.",
    });
  });
});

describe("readLabel", () => {
  it("points at the page until it has been opened", () => {
    expect(readLabel(2, false)).toBe("Read step 2 first");
    expect(readLabel(2, true)).toBe("Read the page");
  });
});

describe("positionLabel", () => {
  it("counts within the path and says done past its end", () => {
    const start = withEvents(PATH, []);
    expect(positionLabel(PATH, foldRecord(PATH, start.record))).toBe("1 of 2");
    const done = withEvents(PATH, [
      {
        seq: 1,
        at: 1,
        actor: "toolchain",
        type: "graded",
        stepIds: ["one", "two"],
      },
    ]);
    expect(positionLabel(PATH, foldRecord(PATH, done.record))).toBe("done");
  });
});

describe("describeFinish", () => {
  it("is null while any step is ahead", () => {
    expect(describeFinish(INITIAL_LESSON_STATE)).toBeNull();
    expect(describeFinish(withEvents(PATH, []))).toBeNull();
  });

  it("summarises an all-proved path", () => {
    const done = withEvents(PATH, [
      {
        seq: 1,
        at: 1,
        actor: "toolchain",
        type: "graded",
        stepIds: ["one", "two"],
      },
    ]);
    expect(describeFinish(done)).toEqual({
      number: "2 of 2 steps",
      objective: "You have finished Hello Anchor.",
      verifiedBy: "2 proved.",
    });
  });

  it("names attested and skipped steps in the record's own words", () => {
    const attested = withEvents(READ_PATH, [
      { seq: 1, at: 1, actor: "learner", type: "attest", stepId: "one" },
    ]);
    expect(describeFinish(attested)?.verifiedBy).toBe("1 marked read.");

    const skipped = withEvents(PATH, [
      { seq: 1, at: 1, actor: "learner", type: "pass", stepId: "one" },
      {
        seq: 2,
        at: 2,
        actor: "toolchain",
        type: "graded",
        stepIds: ["two"],
      },
    ]);
    expect(describeFinish(skipped)?.verifiedBy).toBe(
      "1 proved, 1 skipped -- go back to prove it."
    );
  });
});

describe("assistantLabel", () => {
  it("invites the learner to open the door", () => {
    expect(assistantLabel(0, false)).toBe("I'm stuck");
    expect(assistantLabel(0, true)).toBe("I'm stuck");
  });

  it("counts the rungs already spent", () => {
    expect(assistantLabel(1, true)).toBe("Another hint (2 of 3)");
    expect(assistantLabel(2, true)).toBe("Another hint (3 of 3)");
  });

  it("says why it is waiting when the cap is holding", () => {
    expect(assistantLabel(1, false)).toBe("Try it first");
  });

  it("says when the ladder is spent", () => {
    expect(assistantLabel(3, true)).toBe("No hints left");
  });
});
