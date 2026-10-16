// Same mock as `store.test.ts`, for the same reason: importing the store
// as a value reaches `../../../utils` and its generated globals.
vi.mock("../../../utils", () => ({
  PgExplorer: {
    currentWorkspaceName: null,
    onDidSwitchWorkspace: vi.fn(() => ({ dispose: vi.fn() })),
  },
  PgProgramInfo: { idl: null },
  PgTutorial: { getStorage: vi.fn() },
}));

import { entryReading } from "./reading";
import { INITIAL_LESSON_STATE, reduceLesson } from "./store";
import type { LessonState } from "./store";
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
      readPage: () => "# One",
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

/** Enter the lesson, carrying the given record as a reload would */
const load = (state = INITIAL_LESSON_STATE): LessonState =>
  reduceLesson(state, {
    type: "load",
    path: PATH,
    record: state.record,
    at: 1,
  });

describe("entryReading", () => {
  it("is null outside a lesson", () => {
    expect(entryReading(INITIAL_LESSON_STATE)).toBeNull();
  });

  it("names the cursor step on enter when its page is unopened", () => {
    expect(entryReading(load())?.id).toBe("one");
  });

  it("is null once the page has been opened", () => {
    const state = reduceLesson(load(), {
      type: "opened",
      stepId: "one",
      at: 2,
    });
    expect(entryReading(state)).toBeNull();
    // ...and stays null on the next enter, since the record remembers
    expect(entryReading(load(state))).toBeNull();
  });

  it("is null when the tail is not enter", () => {
    const state = reduceLesson(load(), { type: "hint", at: 2 });
    expect(entryReading(state)).toBeNull();
  });

  it("is null when the cursor step has no page", () => {
    const state = reduceLesson(load(), { type: "pass", at: 2 });
    // The cursor is now on "two", which has no page; enter again
    expect(entryReading(load(state))).toBeNull();
  });

  it("is null at the end of the path", () => {
    let state = reduceLesson(load(), { type: "pass", at: 2 });
    state = reduceLesson(state, { type: "pass", at: 3 });
    expect(entryReading(load(state))).toBeNull();
  });
});
