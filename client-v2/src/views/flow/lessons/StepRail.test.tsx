// The connected rail only maps the record onto `BaseStepRail`'s rows; the
// base is replaced with a probe that keeps the rows it was given
vi.mock("../../../utils", () => ({
  PgCommand: {},
  PgExplorer: {},
  PgGlobal: {},
  PgProgramInfo: {},
  PgSettings: {},
  PgTerminal: {},
  PgTutorial: {},
  PgView: {},
}));
vi.mock("../../../constants", () => ({ DEFAULT_ENDPOINT: {} }));

const { drawn } = vi.hoisted(() => ({
  drawn: [] as { meta: string; status: string }[][],
}));
vi.mock("./BaseStepRail", async (importOriginal) => {
  const original = await importOriginal<typeof import("./BaseStepRail")>();
  return {
    __esModule: true,
    railStatus: original.railStatus,
    default: ({ rows }: { rows: { meta: string; status: string }[] }) => {
      drawn.push(rows);
      return null;
    },
  };
});

import { render } from "@testing-library/react";

import StepRail from "./StepRail";
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
    {
      id: "three",
      objective: "Read the wrap-up",
      verifiedBy: "you have marked this page as read",
      verify: { kind: "read", at: "interact" },
      hints,
    },
  ],
};

const enter = (seq: number): LessonRecordEvent => ({
  seq,
  at: 0,
  actor: "learner",
  type: "enter",
});
const pass = (seq: number, stepId: string): LessonRecordEvent => ({
  seq,
  at: 0,
  actor: "learner",
  type: "pass",
  stepId,
});
const move = (seq: number, to: string | "end"): LessonRecordEvent => ({
  seq,
  at: 0,
  actor: "learner",
  type: "move",
  to,
});

const metaOf = (events: LessonRecordEvent[]) => {
  drawn.length = 0;
  render(
    <StepRail
      state={{ path: PATH, record: { v: 2, events }, loadFailed: false }}
    />
  );
  return drawn.at(-1)!.map((row) => row.meta);
};

describe("StepRail", () => {
  it("says what the frontier aims at and that the rest is locked", () => {
    expect(metaOf([enter(1)])).toEqual(["aiming at build", "locked", "locked"]);
  });

  it("says a skipped step is not verified and aims the next at its stage", () => {
    expect(metaOf([enter(1), pass(2, "one"), move(3, "two")])).toEqual([
      "skipped — not verified",
      "aiming at deploy",
      "locked",
    ]);
  });

  it("aims a read step at the stage it reads beside", () => {
    expect(
      metaOf([
        enter(1),
        pass(2, "one"),
        move(3, "two"),
        pass(4, "two"),
        move(5, "three"),
      ])
    ).toEqual([
      "skipped — not verified",
      "skipped — not verified",
      "aiming at interact",
    ]);
  });
});
