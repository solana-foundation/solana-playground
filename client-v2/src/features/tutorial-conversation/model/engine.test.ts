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
import { memoryWorkspace, stubRunner } from "./ports";
import type { Judge, Runner } from "./ports";
import { FINISH_DELAY_MS } from "./clock";
import { parseProgress } from "./progress";
import type { RunResult } from "./progress";
import { PgConversation, STORAGE_KEY } from "./store";
import { INTERRUPTED, view } from "./view";
import type { ConversationView, Turn } from "./view";
import { PgExplorer } from "../../../utils/explorer/explorer";
import { writeWorkspaceFile } from "../../../utils/explorer/workspace-file";
import { PgTutorial } from "../../../utils/tutorial/tutorial";
import type { Disposable } from "../../../utils/types";
import type { TutorialDefinition } from "@/entities/tutorial";
import { initLogger, memoryProvider, resetLogger } from "@/shared/lib/logger";
import {
  initTelemetry,
  memoryProvider as memoryEvents,
  resetTelemetry,
} from "@/shared/lib/telemetry";

/**
 * The ticket's two acceptance criteria: Hello Anchor walks from the intro
 * to the finish through the store with stubbed runs, and a reload after
 * every action restores the same feed.
 */

const NAME = "Hello Anchor";
const definition = hello as unknown as TutorialDefinition;
const LATER = Date.now() + 1e9;

let file: Record<string, unknown>;
let sub: Disposable | null = null;
let logged: ReturnType<typeof memoryProvider>;
let events: ReturnType<typeof memoryEvents>;

const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
};

const setWorkspace = (name: string | null) => {
  (PgExplorer as { currentWorkspaceName: string | null }).currentWorkspaceName =
    name;
};

/** A goal passes on a result of its own kind, as 3.2's checks will insist */
const byKind: Judge = (goal, result) => {
  if (!result.ok) return false;
  if (goal.kind === "build") return result.act === "build";
  if (goal.kind === "deploy")
    return result.act === "deploy" || result.act === "buildDeploy";
  return result.act === "run" || result.act === "call";
};

const built: RunResult = {
  act: "build",
  ok: true,
  seconds: 1.6,
  instructions: ["hello"],
};
const deployed = (upgraded: boolean): RunResult => ({
  act: upgraded ? "buildDeploy" : "deploy",
  ok: true,
  seconds: 3,
  programId: "Prog111",
  signature: upgraded ? "sigUp" : "sigDeploy",
  upgraded,
  lamports: 1_500_000,
  instructions: ["hello"],
});
const ran: RunResult = {
  act: "run",
  ok: true,
  seconds: 1.6,
  signatures: ["sigRun"],
  line: "Program log: Hello, World!",
};
const called: RunResult = {
  act: "call",
  ok: true,
  seconds: 1.6,
  signatures: ["sigCall"],
  line: "Program log: Hello, Alex!",
};

const open = (
  workspace = memoryWorkspace({ "src/lib.rs": "" }),
  runner: Runner = stubRunner([])
) => {
  setWorkspace(NAME);
  sub = PgConversation.init({ workspace, runner, judge: byKind });
  return workspace;
};

const close = () => {
  sub?.dispose();
  sub = null;
};

const asWhole = (t: Turn): Turn => Object.assign({}, t, { whole: true });

/** The feed as the live store sees it, every turn whole */
const liveView = () => PgConversation.view(LATER) as ConversationView;

/** The feed a fresh load of what was saved would show */
const reloadedView = (): ConversationView => {
  const saved = JSON.parse(JSON.stringify(file[STORAGE_KEY]));
  const progress = parseProgress(saved);
  if (!progress) throw new Error("the save did not parse");
  return view(
    definition,
    { progress, stage: null },
    { now: LATER, loadedAt: LATER }
  );
};

/** Does one thing to the store, then checks a reload would show the same feed */
const step = async (act: () => void) => {
  act();
  await settle();
  const live = liveView();
  const reloaded = reloadedView();
  // The reloaded feed renders every turn whole; the live one only those
  // from before its load. `asWhole` copies a turn field for field with
  // `whole` set
  expect(reloaded.turns).toEqual(live.turns.map(asWhole));
  expect(reloaded.live?.id).toBe(live.live?.id);
  expect(reloaded.steps).toEqual(live.steps);
  expect(reloaded.placeholder).toBe(live.placeholder);
};

beforeEach(() => {
  file = {};
  vi.mocked(PgExplorer.fs.exists).mockImplementation(
    async () => STORAGE_KEY in file
  );
  vi.mocked(PgTutorial).all = [{ name: NAME, definition: hello }] as never;
  vi.mocked(PgExplorer.fs.readToJSON).mockImplementation(async () => {
    if (!(STORAGE_KEY in file)) throw new Error("ENOENT");
    return JSON.parse(JSON.stringify(file));
  });
  vi.mocked(writeWorkspaceFile).mockImplementation(async (_path, data) => {
    file = JSON.parse(data);
  });
  logged = memoryProvider();
  initLogger({ providers: [logged] });
  events = memoryEvents();
  initTelemetry({ providers: [events] });
});

afterEach(async () => {
  close();
  setWorkspace(null);
  sub = PgConversation.init({
    workspace: memoryWorkspace(),
    runner: stubRunner([]),
    judge: byKind,
  });
  await settle();
  close();
  resetLogger();
  resetTelemetry();
});

describe("Hello Anchor through the engine", () => {
  it("walks from the intro to the finish with stubbed runs, reloading at every beat", async () => {
    const failed: RunResult = {
      act: "build",
      ok: false,
      seconds: 1.2,
      error: {
        code: "E0412",
        file: "src/lib.rs",
        line: 9,
        column: 32,
        message: "cannot find type `Hello` in this scope",
      },
      log: "error[E0412]: cannot find type `Hello` in this scope",
    };
    const runner = stubRunner([
      { stages: ["Building"], result: failed },
      { stages: ["Building"], result: built },
      {
        stages: ["Writing buffer", "Deploying", "Uploading IDL", "Confirming"],
        result: deployed(false),
      },
      { stages: ["Running"], result: ran },
      {
        stages: [
          "Building",
          "Writing buffer",
          "Deploying",
          "Upgrading IDL",
          "Confirming",
        ],
        result: deployed(true),
      },
      { stages: ["Sending"], result: called },
    ]);
    const workspace = open(undefined, runner);
    await settle();
    expect(liveView().live?.kind).toBe("intro");

    const [program, deploy, client, named] = definition.steps;
    const target = (s: typeof program, path: string) =>
      s.target[path].trimEnd();

    // Step 1, through the planned failure
    await step(() => PgConversation.start());
    expect(liveView().live?.id).toBe("s1.q1");
    await step(() => PgConversation.pick("s1.q1", 0));
    await step(() => PgConversation.pick("s1.q1", 1));
    await step(() => PgConversation.act("s1.build"));
    expect(liveView().live).toMatchObject({
      id: "result:s1.build:0",
      planned: program.planned,
      open: true,
    });
    await step(() => PgConversation.explain("s1.build"));
    expect(liveView().live?.id).toBe("f1.q2");
    await step(() => PgConversation.pick("f1.q2", 2));
    expect(workspace.files["src/lib.rs"]).toBe(target(program, "src/lib.rs"));
    await step(() => PgConversation.act("f1.build"));
    expect(liveView().live?.id).toBe("win:write-program");
    expect(liveView().turns.find((t) => t.id === "s1.q1")).toMatchObject({
      outcome: "retry",
      attempts: 2,
    });
    expect(liveView().turns.find((t) => t.id === "f1.q2")).toMatchObject({
      outcome: "first_try",
    });

    // Step 2
    await step(() => PgConversation.next());
    expect(liveView().live?.id).toBe("s2.q2");
    await step(() => PgConversation.hint("s2.q2"));
    await step(() => PgConversation.pick("s2.q2", 0));
    await step(() => PgConversation.act("s2.deploy"));
    expect(liveView().live?.id).toBe("win:deploy");
    expect(workspace.files["src/lib.rs"]).toBe(target(deploy, "src/lib.rs"));

    // Step 3: client.ts is created, then the pick writes the call
    await step(() => PgConversation.next());
    expect(workspace.files["client/client.ts"]).toBe("");
    await step(() => PgConversation.pick("s3.q3", 2));
    expect(workspace.files["client/client.ts"]).toBe(
      target(client, "client/client.ts")
    );
    await step(() => PgConversation.act("s3.run"));
    expect(liveView().live?.id).toBe("win:call-client");
    expect(
      liveView().turns.find((t) => t.id === "win:call-client")
    ).toMatchObject({ via: "client" });

    // Step 4: the name, the upgrade, then the call with an argument
    await step(() => PgConversation.next());
    await step(() => PgConversation.pick("s4.q4", 1));
    expect(workspace.files["src/lib.rs"]).toBe(target(named, "src/lib.rs"));
    await step(() => PgConversation.act("s4.ship"));
    // The upgrade is not the goal: the call act follows
    expect(liveView().live?.id).toBe("s4.call");
    await step(() => PgConversation.act("s4.call", { name: "Alex" }));
    expect(runner.runs.at(-1)).toEqual({
      act: "call",
      input: {
        beatId: "s4.call",
        call: { instruction: "hello", args: { name: "Alex" } },
      },
    });
    expect(liveView().live).toMatchObject({
      id: "win:greet-by-name",
      last: true,
    });

    // The finish follows the last win on its own
    await vi.waitFor(
      () =>
        expect(PgConversation.state.engine.progress.finishedAt).not.toBeNull(),
      {
        timeout: 2000,
      }
    );
    await step(() => {});
    const done = liveView();
    expect(done.live).toBeNull();
    // The test answers questions before their scripted arrival, which the
    // feed never lets a learner do, so the finish is found, not last by time
    const lastWin = done.turns.find((t) => t.id === "win:greet-by-name");
    const finish = done.turns.find((t) => t.kind === "finish");
    expect(finish).toBeDefined();
    expect(finish!.at).toBeGreaterThanOrEqual(lastWin!.at + FINISH_DELAY_MS);
    expect(done.placeholder).toBe("Ask anything");
    expect(done.steps.map((s) => s.state)).toEqual([
      "done",
      "done",
      "done",
      "done",
    ]);

    const saved = file[STORAGE_KEY] as {
      passed: string[];
      finishedAt: number | null;
    };
    expect(saved.passed).toEqual([
      "write-program",
      "deploy",
      "call-client",
      "greet-by-name",
    ]);
    expect(saved.finishedAt).not.toBeNull();
    expect(events.events.map((e) => e.name)).toEqual([
      "tutorial_started",
      "tutorial_finished",
    ]);
    expect(events.events[1].params).toMatchObject({
      tutorial: "hello-anchor",
      seconds: expect.any(Number),
    });
    expect(logged.entries.filter((e) => e.level === "error")).toEqual([]);
  });

  it("a reload during a run shows the act interrupted, never resumed", async () => {
    const runner: Runner = { run: () => new Promise(() => {}) };
    open(undefined, runner);
    await settle();
    await step(() => PgConversation.start());
    await step(() => PgConversation.pick("s1.q1", 1));
    PgConversation.act("s1.build");
    await settle();
    expect(liveView().live).toMatchObject({ id: "s1.build", state: "running" });

    const reloaded = reloadedView();
    expect(reloaded.live).toMatchObject({
      id: "s1.build",
      state: "interrupted",
      note: INTERRUPTED,
    });
    expect(reloaded.turns.filter((t) => t.kind === "result")).toEqual([]);
  });

  it("start over returns to the intro and a new start counts again", async () => {
    const workspace = open();
    await settle();
    await step(() => PgConversation.start());
    await step(() => PgConversation.pick("s1.q1", 1));
    await step(() => PgConversation.startOver());
    expect(liveView().live?.kind).toBe("intro");
    expect(PgConversation.state.engine.progress.restartedAt).not.toBeNull();
    // The preview is back in the workspace
    expect(workspace.files["src/lib.rs"]).toBe(
      definition.intro.files["src/lib.rs"]
    );
    await step(() => PgConversation.start());
    expect(events.events.map((e) => e.name)).toEqual([
      "tutorial_started",
      "tutorial_started",
    ]);
    // Start put step 1's start files back (the first write beat's boilerplate
    // landed on top at once) and took the preview's client away
    expect(workspace.files["src/lib.rs"]).toBe(
      'use anchor_lang::prelude::*;\n\ndeclare_id!("11111111111111111111111111111111");'
    );
    expect(workspace.files["client/client.ts"]).toBeUndefined();
    const restartedAt = PgConversation.state.engine.progress.restartedAt;
    expect(restartedAt).not.toBeNull();
    await step(() => PgConversation.pick("s1.q1", 1));
    expect(workspace.files["src/lib.rs"]).toBe(
      definition.steps[0].target["src/lib.rs"]
        .trimEnd()
        .replace("\n\n#[derive(Accounts)]\npub struct Hello {}", "")
    );
    expect((file[STORAGE_KEY] as { restartedAt: number }).restartedAt).toBe(
      restartedAt
    );
  });
});
