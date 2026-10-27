// The connected band only maps the lesson state onto `BaseObjectiveBand`'s
// props; the base is replaced with a probe that keeps the props it was given.
// Everything the readiness line reads is stubbed: it is not under test here.
vi.mock("../../../utils", () => ({
  PgCommand: { build: { execute: vi.fn() } },
  PgConnection: { onDidChangeCluster: vi.fn() },
  PgExplorer: {},
  PgGlobal: {},
  PgProgramInfo: { uuid: null, importedProgram: null, lastBuildFailed: false },
  PgSettings: {},
  PgTerminal: {},
  PgTutorial: {},
  PgView: {},
}));
vi.mock("../../../constants", () => ({ DEFAULT_ENDPOINT: {} }));
vi.mock("../../../hooks", () => ({
  useBalance: () => null,
  useProgramInfo: () => {},
  useRenderOnChange: () => null,
  useWallet: () => null,
}));
vi.mock("../../../features/auth", () => ({
  PgSession: { get: () => null, onDidChange: vi.fn() },
}));
vi.mock("../../sidebar/assistant/store", () => ({ PgAssistant: {} }));

// Each `reportButtonFailure` call: the action that did not happen, and the
// error it got
const told = vi.hoisted(() => [] as { action: string; error: unknown }[]);
vi.mock("@/shared/lib/report-button-failure", () => ({
  reportButtonFailure: (action: string) => (error: unknown) => {
    told.push({ action, error });
  },
}));

const { drawn } = vi.hoisted(() => ({
  drawn: [] as Record<string, unknown>[],
}));
vi.mock("./BaseObjectiveBand", () => ({
  BaseObjectiveBand: (props: Record<string, unknown>) => {
    drawn.push(props);
    return null;
  },
}));

import { render } from "@testing-library/react";

import ObjectiveBand from "./ObjectiveBand";
import type { BaseObjectiveBandProps } from "./BaseObjectiveBand";
import type { LessonRecordEvent, StoredLesson } from "./events";
import type { LessonState } from "./store";
import type { LessonPath } from "./types";
import { INITIAL_FLOW_STATE } from "../state/stage";
import { PgCommand } from "../../../utils";

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

// One small helper per event kind, each naming every field
const enter = (seq: number): LessonRecordEvent => ({
  seq,
  at: 0,
  actor: "learner",
  type: "enter",
});
const graded = (seq: number, stepId: string): LessonRecordEvent => ({
  seq,
  at: 0,
  actor: "toolchain",
  type: "graded",
  stepIds: [stepId],
});
const move = (seq: number, to: string | "end"): LessonRecordEvent => ({
  seq,
  at: 0,
  actor: "learner",
  type: "move",
  to,
});
const pass = (seq: number, stepId: string): LessonRecordEvent => ({
  seq,
  at: 0,
  actor: "learner",
  type: "pass",
  stepId,
});
const attest = (seq: number, stepId: string): LessonRecordEvent => ({
  seq,
  at: 0,
  actor: "learner",
  type: "attest",
  stepId,
});

const recordOf = (events: LessonRecordEvent[]): StoredLesson => ({
  v: 2,
  events,
});

const stateOf = (record: StoredLesson): LessonState => ({
  path: PATH,
  record,
  loadFailed: false,
});

const drawBand = (record: StoredLesson) => {
  drawn.length = 0;
  render(
    <ObjectiveBand
      state={stateOf(record)}
      flow={INITIAL_FLOW_STATE}
      onRead={() => {}}
      onOpenGallery={() => {}}
    />
  );
  return drawn.at(-1) as BaseObjectiveBandProps;
};

describe("ObjectiveBand", () => {
  it("counts only confirmed steps toward the meter on an open band", () => {
    const props = drawBand(
      recordOf([enter(1), graded(2, "one"), move(3, "two")])
    );
    expect(props.kind).toBe("step");
    expect(props.position).toEqual({
      label: "Step 2 of 3",
      short: "2/3",
      progress: 1 / 3,
    });
  });

  it("says done on the finished band, and a skipped step does not fill the meter", () => {
    const props = drawBand(
      recordOf([
        enter(1),
        graded(2, "one"),
        move(3, "two"),
        pass(4, "two"),
        move(5, "three"),
        attest(6, "three"),
        move(7, "end"),
      ])
    );
    expect(props.kind).toBe("finished");
    expect(props.position.short).toBe("done");
    expect(props.position.progress).toBe(2 / 3);
  });

  // Under Home no terminal is mounted, so the command cannot run; the click
  // must tell the user rather than leave an unhandled rejection
  it("tells the user when proving the step fails", async () => {
    const failure = new Error("The terminal is not open.");
    vi.mocked(PgCommand.build.execute).mockRejectedValueOnce(failure);
    told.length = 0;
    const props = drawBand(recordOf([enter(1)]));
    expect(props.kind).toBe("step");
    if (props.kind !== "step") return;

    props.prove!.onClick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(told).toEqual([{ action: "check the step", error: failure }]);
  });
});
