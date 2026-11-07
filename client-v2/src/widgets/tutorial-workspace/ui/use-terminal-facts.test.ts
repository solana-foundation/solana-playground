/* eslint-disable unicorn/no-null -- tutorial flow v2 predates this rule; cleanup tracked from SF#94 */
import { beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  /** The engine on a step whose planned failure names `failsWith` */
  conversation: {
    context: null as null | {
      definition: { steps: { id: string; failsWith?: string }[] };
    },
    engine: {
      progress: {
        cursor: { kind: "step", stepId: "s", fail: false } as {
          kind: string;
          stepId?: string;
          fail?: boolean;
        },
      },
    },
  },
  latest: null as null | {
    stderr: string;
    failed: boolean;
    at: number;
    workspace: string | null;
  },
}));

vi.mock("@/utils", () => ({
  PgExplorer: { currentWorkspaceName: "Hello Anchor" },
  PgProgramInfo: { idl: null },
}));
vi.mock("@/views/flow/state/stage", () => ({ PgFlow: {} }));
vi.mock("@/features/tutorial-conversation", () => ({
  PgConversation: {
    get state() {
      return h.conversation;
    },
  },
}));
// The real `stripKnownNoise`: `parseBuildReport` reads it
vi.mock(
  "@/views/sidebar/assistant/bridge/build-output",
  async (importOriginal) => {
    const real = await importOriginal<
      typeof import("@/views/sidebar/assistant/bridge/build-output")
    >();
    return {
      stripKnownNoise: real.stripKnownNoise,
      PgBuildOutput: {
        get latest() {
          return h.latest;
        },
      },
    };
  }
);

let pickedDiagnostic: typeof import("./use-terminal-facts").pickedDiagnostic;
let PLANNED: string;
beforeAll(async () => {
  pickedDiagnostic = (await import("./use-terminal-facts")).pickedDiagnostic;
  PLANNED = (
    await import("@/features/tutorial-conversation/model/build-logs.fixture")
  ).PLANNED;
});

describe("widgets/tutorial-workspace/ui/use-terminal-facts", () => {
  it("marks the line the card names, past the macro symptom the log puts first", () => {
    h.latest = {
      stderr: PLANNED,
      failed: true,
      at: 1,
      workspace: "Hello Anchor",
    };
    expect(pickedDiagnostic()).toMatchObject({
      code: "E0412",
      file: "src/lib.rs",
      line: 9,
    });
  });

  it("marks the error the step's planned failure names, as the card does", () => {
    h.latest = {
      stderr: PLANNED,
      failed: true,
      at: 1,
      workspace: "Hello Anchor",
    };
    h.conversation.context = {
      definition: { steps: [{ id: "s", failsWith: "unresolved import" }] },
    };
    expect(pickedDiagnostic()).toMatchObject({ code: "E0432", line: 5 });
    h.conversation.context = null;
  });

  it("marks nothing for another workspace's output", () => {
    h.latest = { stderr: PLANNED, failed: true, at: 1, workspace: "Other" };
    expect(pickedDiagnostic()).toBeNull();
  });
});
