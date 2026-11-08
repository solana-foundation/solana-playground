/* eslint-disable max-params, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
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

import { checkDefinition } from "@/entities/tutorial/model/definition/check";
import type {
  ActBeat,
  Goal,
  TutorialDefinition,
} from "@/entities/tutorial/model/definition/types";
import { initLogger, memoryProvider, resetLogger } from "@/shared/lib/logger";

import counter from "../../../tutorials/__tests__/counter-anchor/tutorial.json";
import helloIdl from "../../../tutorials/hello-anchor/docs/idl.md";
import helloProgramStructure from "../../../tutorials/hello-anchor/docs/program-structure.md";
import helloPrograms from "../../../tutorials/hello-anchor/docs/programs.md";
import helloTransactions from "../../../tutorials/hello-anchor/docs/transactions.md";
import hello from "../../../tutorials/hello-anchor/tutorial.json";
import lumberjackCustomErrors from "../../../tutorials/lumberjack/docs/custom-errors.md";
import lumberjackPdas from "../../../tutorials/lumberjack/docs/pdas.md";
import lumberjackSysvarAccounts from "../../../tutorials/lumberjack/docs/sysvar-accounts.md";
import lumberjack from "../../../tutorials/lumberjack/tutorial.json";
import { PgExplorer } from "../../../utils/explorer/explorer";
import { writeWorkspaceFile } from "../../../utils/explorer/workspace-file";
import { PgTutorial } from "../../../utils/tutorial/tutorial";
import type { Disposable } from "../../../utils/types";
import { PgView } from "../../../utils/view";
import type { Judge, Runner } from "./ports";
import { memoryWorkspace } from "./ports";
import type { RunResult } from "./progress";
import { PgConversation, STORAGE_KEY } from "./store";

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

/**
 * A goal passes on a result of its own kind; a `refused` goal only on a
 * refusal of its own instruction
 */
const byKind: Judge = (goal, result) => {
  if (goal.kind === "refused") {
    return (
      !result.ok &&
      "refused" in result &&
      result.refused?.instruction === goal.instruction
    );
  }
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

/** How many presses of a call land before the program refuses it */
const LANDED_BEFORE_REFUSAL = 5;

/**
 * A runner that answers each act with a passing result of its kind, except
 * the first build of a step that plans a failure, which fails with the log
 * line its `failsWith` names, and a call on a step whose goal is a refusal,
 * which lands `LANDED_BEFORE_REFUSAL` times and is then refused
 */
const goalRunner = (d: TutorialDefinition): Runner => {
  const plannedBuilds = new Map(
    d.steps
      .filter((s) => s.planned !== undefined)
      .map((s) => [
        s.beats.find((b): b is ActBeat => b.kind === "act" && b.act === "build")
          ?.id,
        s.failsWith ?? "",
      ])
  );
  const refusals = new Map(
    d.steps.flatMap((s) =>
      s.goal.kind === "refused"
        ? s.beats
            .filter((b): b is ActBeat => b.kind === "act" && b.act === "call")
            .map((b) => [b.id, s.goal] as const)
        : []
    )
  );
  const presses = new Map<string, number>();
  const instructions = instructionsOf(d);
  return {
    run: async (act, input) => {
      const results: Record<typeof act, RunResult> = {
        airdrop: {
          act: "airdrop",
          ok: true,
          seconds: 1,
          balance: 2_000_000_000,
          airdropped: 2_000_000_000,
        },
        build: plannedBuilds.has(input.beatId)
          ? {
              act: "build",
              ok: false,
              reason: "compiler",
              seconds: 1,
              // A failure is planned only with a parsed compiler error
              error: {
                code: "E0000",
                file: d.steps[0].file,
                line: 1,
                column: 1,
                message: "planned",
              },
              log: plannedBuilds.get(input.beatId) ?? "",
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
      const goal = refusals.get(input.beatId);
      if (act === "call" && goal?.kind === "refused") {
        const n = (presses.get(input.beatId) ?? 0) + 1;
        presses.set(input.beatId, n);
        if (n > LANDED_BEFORE_REFUSAL) {
          const refusal: Extract<RunResult, { refused?: unknown }> = {
            act: "call",
            ok: false,
            seconds: 1,
            message: "Transaction failed",
            log: "",
            refused: {
              instruction: goal.instruction,
              // As the program names it: Anchor numbers custom errors
              // from 6000
              error: goal.error
                ? {
                    code: goal.error.code ?? 6000,
                    name: goal.error.name ?? null,
                  }
                : null,
            },
          };
          return refusal;
        }
      }
      return results[act];
    },
  };
};

/** The call acts of steps whose goal is a refusal, by beat */
const refusedCalls = (d: TutorialDefinition) =>
  d.steps.flatMap((s) =>
    s.goal.kind === "refused"
      ? s.beats
          .filter((b): b is ActBeat => b.kind === "act" && b.act === "call")
          .map((b) => [b.id] as const)
      : []
  );

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
  [
    "Counter Anchor, written from AUTHORING.md alone",
    { json: counter, docs: {} },
  ],
  [
    "Hello Anchor",
    {
      json: hello,
      docs: {
        "idl.md": helloIdl,
        "program-structure.md": helloProgramStructure,
        "programs.md": helloPrograms,
        "transactions.md": helloTransactions,
      },
    },
  ],
  [
    "Lumberjack, with a refusal on a repeating card",
    {
      json: lumberjack,
      docs: {
        "custom-errors.md": lumberjackCustomErrors,
        "pdas.md": lumberjackPdas,
        "sysvar-accounts.md": lumberjackSysvarAccounts,
      },
    },
  ],
])("%s through the engine", (_name, { json, docs }) => {
  it("passes the check", () => {
    const d = json as unknown as TutorialDefinition;
    // A definition's next names another tutorial, which this check of one
    // definition does not load
    const known = new Set(d.finish.next === null ? [] : [d.finish.next]);
    expect(checkDefinition(d, known, { docs })).toEqual([]);
  });

  it("walks from the intro to the finish", async () => {
    const d = json as unknown as TutorialDefinition;
    await walk(d);

    const saved = file[STORAGE_KEY] as {
      passed: string[];
      runs: Record<string, { status: string }[]>;
    };
    expect(saved.passed).toEqual(d.steps.map((s) => s.id));
    // A refusal passed its step only after the presses that landed
    for (const [beatId] of refusedCalls(d)) {
      expect(saved.runs[beatId].map((r) => r.status)).toEqual(
        Array.from({ length: LANDED_BEFORE_REFUSAL + 1 }, (_, i) =>
          i < LANDED_BEFORE_REFUSAL ? "ok" : "refused"
        )
      );
    }
    expect(logged.entries.filter((e) => e.level === "error")).toEqual([]);
    expect(PgView.setToast).not.toHaveBeenCalled();
  });
});
