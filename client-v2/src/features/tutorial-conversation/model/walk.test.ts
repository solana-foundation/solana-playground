import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../utils/explorer/explorer", () => ({
  PgExplorer: {
    currentWorkspaceName: null as string | null,
    PATHS: { ROOT_DIR_PATH: "/" },
    onDidSwitchWorkspace: vi.fn(() => ({ dispose: vi.fn() })),
    fs: { exists: vi.fn(async () => false), readToJSON: vi.fn() },
  },
}));
vi.mock("../../../utils/explorer/workspace-file", () => ({
  writeWorkspaceFile: vi.fn(),
}));
vi.mock("../../../utils/tutorial/tutorial", () => ({
  PgTutorial: { all: [] as unknown[] },
  storageDataPath: () => ".workspace/tutorial-storage.json",
}));
vi.mock("../../../utils/view", () => ({ PgView: { setToast: vi.fn() } }));
vi.mock("@/entities/tutorial", async () => ({
  slugOf: (await import("@/entities/tutorial/model/definition/check")).slugOf,
  tutorialTelemetry: (await import("@/entities/tutorial/model/telemetry"))
    .tutorialTelemetry,
}));

import hello from "../../../tutorials/hello-anchor/tutorial.json";
import counter from "../../../tutorials/__tests__/counter-anchor/tutorial.json";
import { memoryWorkspace } from "./ports";
import type { Judge, Runner } from "./ports";
import type { RunResult } from "./progress";
import { PgConversation, STORAGE_KEY } from "./store";
import { PgExplorer } from "../../../utils/explorer/explorer";
import { writeWorkspaceFile } from "../../../utils/explorer/workspace-file";
import { PgTutorial } from "../../../utils/tutorial/tutorial";
import type { Disposable } from "../../../utils/types";
import { PgView } from "../../../utils/view";
import { checkDefinition } from "@/entities/tutorial/model/definition/check";
import type {
  ActBeat,
  Goal,
  TutorialDefinition,
} from "@/entities/tutorial/model/definition/types";
import { initLogger, memoryProvider, resetLogger } from "@/shared/lib/logger";

/**
 * The proof that a definition written from `AUTHORING.md` runs with no code
 * change: it passes the check, and a walker that knows nothing of any one
 * tutorial answers every question right, presses every card and Next, and
 * reaches the finish, each step's files landing as its target. Hello Anchor
 * walks too, so the walker is not shaped to the fixture, and it alone covers
 * the planned failure, which the blind-written fixture does not have. Runs
 * are stubbed and the judge matches a result's kind to the goal's, so a
 * goal's `log` and `args` are not judged here: that is `goals.ts`'s job.
 */

let file: Record<string, unknown>;
let sub: Disposable | null = null;
let logged: ReturnType<typeof memoryProvider>;

const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
};

/** A goal passes on a result of its own kind */
const byKind: Judge = (goal, result) => {
  if (!result.ok) return false;
  if (goal.kind === "build") return result.act === "build";
  if (goal.kind === "deploy")
    return result.act === "deploy" || result.act === "buildDeploy";
  return result.act === "run" || result.act === "call";
};

/** Every instruction any step's goal names */
const instructionsOf = (d: TutorialDefinition) =>
  d.steps.flatMap((s) => goalInstructions(s.goal));

const goalInstructions = (goal: Goal): string[] => {
  if (goal.kind === "build") return goal.instructions ?? [];
  if (goal.kind === "call") return [goal.instruction];
  return [];
};

/**
 * A runner that answers each act with a passing result of its kind, except
 * the first build of a step that plans a failure, which fails
 */
const goalRunner = (d: TutorialDefinition): Runner => {
  const plannedBuilds = new Set(
    d.steps
      .filter((s) => s.planned !== undefined)
      .map(
        (s) =>
          s.beats.find(
            (b): b is ActBeat => b.kind === "act" && b.act === "build"
          )?.id
      )
  );
  const instructions = instructionsOf(d);
  return {
    run: async (act, input) => {
      const results: Record<typeof act, RunResult> = {
        build: plannedBuilds.has(input.beatId)
          ? {
              act: "build",
              ok: false,
              seconds: 1,
              // A failure is planned only with a parsed compiler error
              error: {
                code: "E0000",
                file: d.steps[0].file,
                line: 1,
                column: 1,
                message: "planned",
              },
              log: "error[E0000]: planned",
            }
          : { act: "build", ok: true, seconds: 1, instructions },
        deploy: {
          act: "deploy",
          ok: true,
          seconds: 1,
          programId: "Prog111",
          signature: "sigDeploy",
          upgraded: false,
          lamports: 1,
          instructions,
        },
        buildDeploy: {
          act: "buildDeploy",
          ok: true,
          seconds: 1,
          programId: "Prog111",
          signature: "sigUp",
          upgraded: true,
          lamports: 1,
          instructions,
        },
        run: {
          act: "run",
          ok: true,
          seconds: 1,
          signatures: ["s"],
          line: "",
          called: [],
        },
        call: {
          act: "call",
          ok: true,
          seconds: 1,
          signatures: ["s"],
          line: "",
          called: [],
        },
      };
      return results[act];
    },
  };
};

/** Each file of a step's target, as the workspace holds it at the step's win */
const expectTarget = (
  d: TutorialDefinition,
  stepId: string,
  files: Record<string, string>
) => {
  const step = d.steps.find((s) => s.id === stepId);
  for (const [path, content] of Object.entries(step?.target ?? {})) {
    expect(files[path]?.trimEnd(), `${stepId}: ${path}`).toBe(
      content.trimEnd()
    );
  }
};

/** Answers whatever the conversation waits on, until the finish */
const walk = async (d: TutorialDefinition) => {
  const workspace = memoryWorkspace(
    Object.assign({}, d.steps[0].start) as Record<string, string>
  );
  (PgExplorer as { currentWorkspaceName: string | null }).currentWorkspaceName =
    d.name;
  vi.mocked(PgTutorial).all = [{ name: d.name, definition: d }] as never;
  sub = PgConversation.init({
    workspace,
    runner: goalRunner(d),
    judge: byKind,
  });
  await settle();

  for (let moves = 0; moves < 200; moves++) {
    const live = PgConversation.view(Date.now() + 1e9)?.live;
    if (!live) break;
    if (live.kind === "intro") PgConversation.start();
    else if (live.kind === "ask")
      PgConversation.pick(live.beatId, live.ask.answer);
    else if (live.kind === "act") {
      const args = Object.fromEntries(
        (live.act.call?.args ?? []).map((a) => [a, "x"])
      );
      PgConversation.act(live.beatId, args);
    } else if (live.kind === "result" && live.open)
      PgConversation.explain(live.beatId);
    else if (live.kind === "win") {
      expectTarget(d, live.stepId, workspace.files);
      PgConversation.next();
    } else throw new Error(`the walk cannot answer a live ${live.kind}`);
    await settle();
  }
  await vi.waitFor(
    () =>
      expect(PgConversation.state.engine.progress.finishedAt).not.toBeNull(),
    { timeout: 2000 }
  );
  return workspace;
};

beforeEach(() => {
  file = {};
  vi.mocked(PgExplorer.fs.exists).mockImplementation(
    async () => STORAGE_KEY in file
  );
  vi.mocked(PgExplorer.fs.readToJSON).mockImplementation(async () => {
    if (!(STORAGE_KEY in file)) throw new Error("ENOENT");
    return JSON.parse(JSON.stringify(file));
  });
  vi.mocked(writeWorkspaceFile).mockImplementation(async (_path, data) => {
    file = JSON.parse(data);
  });
  logged = memoryProvider();
  initLogger({ providers: [logged] });
  vi.mocked(PgView.setToast).mockClear();
});

afterEach(() => {
  sub?.dispose();
  sub = null;
  (PgExplorer as { currentWorkspaceName: string | null }).currentWorkspaceName =
    null;
  resetLogger();
});

describe.each([
  ["Counter Anchor, written from AUTHORING.md alone", counter],
  ["Hello Anchor", hello],
])("%s through the engine", (_name, json) => {
  it("passes the check", () => {
    const d = json as unknown as TutorialDefinition;
    // Hello Anchor's next is upstream's Counter PDA Tutorial, which only the
    // catalog knows
    const known = new Set(d.finish.next === null ? [] : [d.finish.next]);
    expect(checkDefinition(d, known, { docs: {} })).toEqual([]);
  });

  it("walks from the intro to the finish", async () => {
    const d = json as unknown as TutorialDefinition;
    await walk(d);

    const saved = file[STORAGE_KEY] as { passed: string[] };
    expect(saved.passed).toEqual(d.steps.map((s) => s.id));
    expect(logged.entries.filter((e) => e.level === "error")).toEqual([]);
    expect(PgView.setToast).not.toHaveBeenCalled();
  });
});
