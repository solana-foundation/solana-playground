// Importing `INITIAL_LESSON_STATE` as a value pulls in `./store`'s real
// module chain, which reaches `../../../../utils` and, through it, generated
// globals (`GLOBAL_SETTINGS`) that exist only once the app has actually
// booted -- see `views/flow/lessons/store.test.ts` and `band-copy.test.ts`
// for the same mock, needed for the same reason.
vi.mock("../../../../utils", () => ({
  PgExplorer: {
    currentWorkspaceName: null,
    onDidSwitchWorkspace: vi.fn(() => ({ dispose: vi.fn() })),
  },
  PgProgramInfo: { idl: null },
  PgTutorial: { getStorage: vi.fn() },
}));

import { describeLesson } from "./lesson-context";
import { INITIAL_LESSON_STATE } from "../../../flow/lessons/store";
import type { LessonPath } from "../../../flow/lessons/types";

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

describe("describeLesson", () => {
  it("is null outside a lesson", () => {
    expect(describeLesson(INITIAL_LESSON_STATE)).toBeNull();
  });

  it("describes the current step", () => {
    expect(
      describeLesson({
        ...INITIAL_LESSON_STATE,
        path: PATH,
        record: { v: 2, events: [] },
      })
    ).toEqual({
      name: "Hello Anchor",
      stepIndex: 1,
      stepCount: 2,
      objective: "Define hello",
      verifiedBy: "the interface shows hello",
      satisfied: false,
    });
  });

  it("reports a finished path without a current step", () => {
    const done = describeLesson({
      path: PATH,
      record: {
        v: 2,
        events: [
          {
            seq: 1,
            at: 1,
            actor: "toolchain",
            type: "graded",
            stepIds: ["one", "two"],
          },
        ],
      },
      loadFailed: false,
    });
    expect(done).toEqual({
      name: "Hello Anchor",
      stepIndex: 2,
      stepCount: 2,
      objective: "Deploy it",
      verifiedBy: "it is on devnet",
      satisfied: true,
    });
  });
});
