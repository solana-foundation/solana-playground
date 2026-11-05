/* eslint-disable unicorn/no-null -- tutorial flow v2 predates this rule; cleanup tracked from SF#94 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The store's own collaborators, as `store.test.ts` stubs them
const { explorer } = vi.hoisted(() => ({
  explorer: {
    currentWorkspaceName: "Hello Anchor" as string | null,
    PATHS: { ROOT_DIR_PATH: "/" },
    onDidSwitchWorkspace: () => ({ dispose: () => {} }),
    fs: { exists: async () => false, readToJSON: async () => ({}) },
  },
}));
vi.mock("../../../utils/explorer/explorer", () => ({ PgExplorer: explorer }));
vi.mock("@/utils/explorer", () => ({ PgExplorer: explorer }));
vi.mock("../../../utils/explorer/workspace-file", () => ({
  writeWorkspaceFile: vi.fn(async () => {}),
}));
vi.mock("../../../utils/tutorial/tutorial", async () => ({
  PgTutorial: {
    all: [
      {
        name: "Hello Anchor",
        definition: (
          await import("../../../tutorials/hello-anchor/tutorial.json")
        ).default,
      },
    ],
  },
  storageDataPath: () => ".workspace/tutorial-storage.json",
}));
vi.mock("../../../utils/view", () => ({ PgView: { setToast: vi.fn() } }));
vi.mock("@/entities/tutorial", async () => ({
  slugOf: (await import("@/entities/tutorial/model/definition/check")).slugOf,
  tutorialTelemetry: (await import("@/entities/tutorial/model/telemetry"))
    .tutorialTelemetry,
}));
// The feature's entry also loads the real runners; the mode needs the store
vi.mock("@/features/tutorial-conversation", async () => ({
  PgConversation: (await import("@/features/tutorial-conversation/model/store"))
    .PgConversation,
}));
vi.mock("@/views/sidebar/assistant/store", () => ({
  PgAssistant: { addToolCall: vi.fn() },
}));

import { judgeGoal } from "@/features/tutorial-conversation/model/goals";
import {
  memoryWorkspace,
  stubRunner,
} from "@/features/tutorial-conversation/model/ports";
import { PgConversation } from "@/features/tutorial-conversation/model/store";

import { tutorialMode } from "./mode";

/** A clock past every turn the lesson paces */
const LATER = Date.now() + 1e9;

const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
};

let sub: { dispose: () => void } | null = null;

beforeEach(async () => {
  sub = PgConversation.init({
    workspace: memoryWorkspace(),
    runner: stubRunner([]),
    judge: judgeGoal,
  });
  await settle();
});

afterEach(() => {
  sub?.dispose();
  vi.restoreAllMocks();
});

describe("typed I'm stuck, through the live assistant's hint tool", () => {
  it("posts the open question's hint with no I'm stuck pill, and leaves the question open", async () => {
    PgConversation.start();
    await settle();
    vi.spyOn(Date, "now").mockReturnValue(LATER);
    expect(PgConversation.view()?.live?.id).toBe("s1.q1");

    const hint = tutorialMode({ openMenu: vi.fn() }).tools.find(
      (tool) => tool.name === "hint"
    );
    expect(await hint?.run({})).toContain("The hint is posted");

    const v = PgConversation.view();
    expect(v?.turns.some((t) => t.kind === "hint")).toBe(true);
    expect(v?.turns.some((t) => t.id.startsWith("you:hint"))).toBe(false);
    expect(v?.live).toMatchObject({ id: "s1.q1", open: true });
    expect(await hint?.run({})).toContain("already shown");
  });
});
