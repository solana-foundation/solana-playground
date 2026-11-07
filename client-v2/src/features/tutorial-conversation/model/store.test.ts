/* eslint-disable layers/curry-order, max-params, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import type { Idl } from "@coral-xyz/anchor";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requireFor } from "@/test-utils/require-for";

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
// The entity's barrel loads UI that reads the build's globals on import;
// the store needs only these two from it
vi.mock("@/entities/tutorial", async () => ({
  slugOf: (await import("@/entities/tutorial/model/definition/check")).slugOf,
  tutorialTelemetry: (await import("@/entities/tutorial/model/telemetry"))
    .tutorialTelemetry,
}));

import { initLogger, memoryProvider, resetLogger } from "@/shared/lib/logger";
import {
  initTelemetry,
  memoryProvider as memoryEvents,
  resetTelemetry,
} from "@/shared/lib/telemetry";

import hello from "../../../tutorials/hello-anchor/tutorial.json";
import { PgExplorer } from "../../../utils/explorer/explorer";
import { writeWorkspaceFile } from "../../../utils/explorer/workspace-file";
import { PgTutorial } from "../../../utils/tutorial/tutorial";
import type { Disposable } from "../../../utils/types";
import { PgView } from "../../../utils/view";
import { PgCallPanel } from "./call-panel";
import { TICK_MS } from "./clock";
import { judgeGoal } from "./goals";
import type { Judge, Runner, Workspace } from "./ports";
import { memoryWorkspace, stubRunner } from "./ports";
import type { RunResult } from "./progress";
import { freshProgress } from "./progress";
import {
  INITIAL_CONVERSATION_STATE,
  PgConversation,
  PROBE_TIMEOUT_MS,
  STORAGE_KEY,
} from "./store";

/** What the Test form's defaults give an instruction's accounts */
const formAccounts = vi.hoisted(() => ({
  current: [] as {
    name: string;
    isSigner: boolean;
    generator: { type: string; value?: string };
  }[],
}));
vi.mock("../../../utils/program-interaction/instruction", () => ({
  createGeneratableInstruction: () => ({
    values: { accounts: formAccounts.current },
  }),
}));
vi.mock("../../../utils/terminal", () => ({
  PgTerminal: { println: vi.fn() },
}));

const NAME = "Hello Anchor";
/** A clock past every turn the tests post */
const LATER = Date.now() + 1e9;

const setWorkspace = (name: string | null) => {
  (PgExplorer as { currentWorkspaceName: string | null }).currentWorkspaceName =
    name;
};

/** The storage file's JSON, one object per test; `exists` says whether it is there */
let file: Record<string, unknown>;
let exists: boolean;

const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
};

let logged: ReturnType<typeof memoryProvider>;
let events: ReturnType<typeof memoryEvents>;
let sub: Disposable | null = null;

const OK_BUILD: RunResult = {
  act: "build",
  ok: true,
  seconds: 1.6,
  instructions: ["hello"],
};
/** A wallet the faucet topped up to 2 SOL */
const AIRDROPPED: RunResult = {
  act: "airdrop",
  ok: true,
  seconds: 1,
  balance: 2_000_000_000,
  airdropped: 2_000_000_000,
};

const open = (
  name: string | null,
  ports: {
    workspace?: Workspace;
    runner?: Runner;
    judge?: Judge;
  } = {}
) => {
  setWorkspace(name);
  sub = PgConversation.init({
    workspace: ports.workspace ?? memoryWorkspace(),
    runner: ports.runner ?? stubRunner([]),
    judge: ports.judge ?? judgeGoal,
  });
};

/** The storage file as the store reads and writes it: `file` is its JSON */
const mockStorage = () => {
  vi.mocked(PgExplorer.fs.exists).mockImplementation(async () => exists);
  vi.mocked(PgExplorer.fs.readToJSON).mockImplementation(async () => {
    if (!exists) throw new Error("ENOENT");
    return JSON.parse(JSON.stringify(file));
  });
  vi.mocked(writeWorkspaceFile).mockImplementation(async (path, data) => {
    writtenTo.push(path);
    file = JSON.parse(data);
    exists = true;
  });
};

/** Every path the store wrote its save to */
let writtenTo: string[] = [];
const SAVE_PATH = `/${NAME}/.workspace/tutorial-storage.json`;

/** The explorer's switch, as the store subscribed to it */
const switchWorkspace = (name: string | null) => {
  setWorkspace(name);
  const calls = vi.mocked(PgExplorer.onDidSwitchWorkspace).mock.calls;
  const cb = calls[calls.length - 1][0] as () => unknown;
  cb();
};

beforeEach(() => {
  file = {};
  exists = false;
  writtenTo = [];
  mockStorage();
  // Without its shipped IDLs: these tests hold the panel to the IDL each
  // deploy brought (the shipped one wins is the reducer's test)
  const plain = structuredClone(hello);
  for (const step of plain.steps) delete step.idl;
  vi.mocked(PgTutorial).all = [{ name: NAME, definition: plain }] as never;
  logged = memoryProvider();
  initLogger({ providers: [logged] });
  events = memoryEvents();
  initTelemetry({ providers: [events] });
});

const close = () => {
  sub?.dispose();
  sub = null;
};

afterEach(async () => {
  close();
  open(null);
  await settle();
  close();
  resetLogger();
  resetTelemetry();
});

describe("PgConversation", () => {
  it("passes a card's Log to whoever holds the terminal, until it lets go", () => {
    const opened = vi.fn();
    const logSub = PgConversation.onDidRequestLog(opened);
    PgConversation.showLog();
    expect(opened).toHaveBeenCalledTimes(1);
    logSub.dispose();
    PgConversation.showLog();
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it("still opens the terminal when another Log listener throws", () => {
    const throws = PgConversation.onDidRequestLog(() => {
      throw new Error("listener");
    });
    const opened = vi.fn();
    const logSub = PgConversation.onDidRequestLog(opened);
    expect(() => PgConversation.showLog()).not.toThrow();
    expect(opened).toHaveBeenCalledTimes(1);
    throws.dispose();
    logSub.dispose();
  });

  it("is empty for a workspace without a definition", async () => {
    vi.mocked(PgTutorial).all = [] as never;
    open(NAME);
    await settle();
    expect(PgConversation.state).toBe(INITIAL_CONVERSATION_STATE);
    expect(PgConversation.view()).toBeNull();
  });

  it("loads the open workspace's save and marks a started run interrupted", async () => {
    exists = true;
    const saved = freshProgress();
    saved.startedAt = 1000;
    saved.passed = ["write-program"];
    saved.cursor = { kind: "step", stepId: "deploy", beat: 2, fail: false };
    saved.beats = {
      "s2.why": { kind: "said", at: 2000 },
      "s2.q2": { kind: "open", at: 2700, wrong: [] },
    };
    saved.runs = { "s1.build": [{ status: "started", at: 1500 }] };
    saved.times = {
      "write-program": { from: 1000, to: 1900, via: "chat" },
      deploy: { from: 2000, to: null },
    };
    file = { lesson: { v: 2, events: [] }, [STORAGE_KEY]: saved };
    open(NAME);
    await settle();

    const { context, engine, loadFailed } = PgConversation.state;
    expect(context?.slug).toBe("hello-anchor");
    expect(loadFailed).toBe(false);
    expect(engine.progress.runs["s1.build"]).toEqual([
      { status: "interrupted", at: 1500 },
    ]);
    expect(engine.progress.cursor).toEqual(saved.cursor);
    const v = PgConversation.view(LATER);
    expect(v?.live?.id).toBe("s2.q2");
    expect(v?.turns.every((t) => t.whole)).toBe(true);
  });

  it("persists a pick under conversation and leaves the file's other keys alone", async () => {
    const lesson = { v: 2, events: [{ seq: 1 }] };
    file = { lesson };
    exists = true;
    open(NAME);
    await settle();
    PgConversation.start();
    await settle();
    expect(events.events.map((e) => e.name)).toEqual(["tutorial_started"]);
    const q1 = PgConversation.view(LATER)?.live;
    expect(q1?.id).toBe("s1.q1");
    PgConversation.pick("s1.q1", 1);
    await settle();

    const saved = file[STORAGE_KEY] as { beats: Record<string, unknown> };
    expect(saved.beats["s1.q1"]).toMatchObject({ kind: "picked", attempts: 1 });
    expect(file.lesson).toEqual(lesson);
  });

  it("drains a write through the workspace port and records the lines it took", async () => {
    const workspace = memoryWorkspace({ "src/lib.rs": "" });
    open(NAME, { workspace });
    await settle();
    PgConversation.start();
    await settle();
    expect(workspace.files["src/lib.rs"]).toBe(
      'use anchor_lang::prelude::*;\n\ndeclare_id!("11111111111111111111111111111111");'
    );
    expect(PgConversation.state.engine.progress.beats["s1.boil"]).toMatchObject(
      { kind: "written", wrote: { file: "src/lib.rs", lines: [1, 2, 3] } }
    );

    PgConversation.pick("s1.q1", 1);
    await settle();
    expect(workspace.files["src/lib.rs"]).toBe(
      hello.steps[0].target["src/lib.rs"]
        .replace(/\n+$/, "")
        .replace("\n\n#[derive(Accounts)]\npub struct Hello {}", "")
    );
    expect(PgConversation.state.engine.progress.beats["s1.q1"]).toMatchObject({
      kind: "picked",
      wrote: { file: "src/lib.rs", lines: [5, 6, 7, 8, 9, 10, 11, 12, 13] },
    });
    const saved = file[STORAGE_KEY] as { beats: Record<string, unknown> };
    expect(saved.beats["s1.q1"]).toMatchObject({
      wrote: { lines: [5, 6, 7, 8, 9, 10, 11, 12, 13] },
    });
  });

  it("lands a write where its own ref has it", async () => {
    const OLD = "fn already_there() {}";
    const PLANNED = "fn planned() {}";
    const own = JSON.parse(JSON.stringify(hello));
    // The step starts on one line, and its first write puts a block the
    // step's target lacks above it, where the write's ref has it
    own.steps[0].start["src/lib.rs"] = `${OLD}\n`;
    own.steps[0].beats[0].writes = {
      file: "src/lib.rs",
      block: PLANNED,
      ref: `${PLANNED}\n${OLD}\n`,
    };
    vi.mocked(PgTutorial).all = [{ name: NAME, definition: own }] as never;
    const workspace = memoryWorkspace({ "src/lib.rs": "" });
    open(NAME, { workspace });
    await settle();
    PgConversation.start();
    await settle();
    // Against the step's target the block is unknown and would go to the end
    expect(workspace.files["src/lib.rs"]).toBe(`${PLANNED}\n${OLD}`);
    expect(PgConversation.state.engine.progress.beats["s1.boil"]).toMatchObject(
      { kind: "written", wrote: { file: "src/lib.rs", lines: [1] } }
    );
  });

  it("fills around a typed key line, keeping the learner's words", async () => {
    const workspace = memoryWorkspace({ "src/lib.rs": "" });
    open(NAME, { workspace });
    await settle();
    PgConversation.start();
    await settle();
    const typed = `${workspace.files["src/lib.rs"]}\n\n    msg!("Hi there");\n`;
    await workspace.write("src/lib.rs", typed, NAME);
    PgConversation.edit("src/lib.rs", typed);
    await settle();
    expect(PgConversation.state.engine.progress.beats["s1.q1"]).toMatchObject({
      kind: "typed",
      wrote: { file: "src/lib.rs" },
    });
    expect(workspace.files["src/lib.rs"]).toContain('msg!("Hi there");');
    expect(workspace.files["src/lib.rs"]).toContain("#[program]");
  });

  it("creates a file for a create beat, once", async () => {
    const workspace = memoryWorkspace({ "src/lib.rs": "" });
    const runner = stubRunner([
      { stages: ["Building"], result: OK_BUILD },
      { result: AIRDROPPED },
      {
        result: {
          act: "deploy",
          ok: true,
          seconds: 1,
          programId: "p",
          signature: "s",
          upgraded: false,
          lamports: 1,
          instructions: ["hello"],
        },
      },
    ]);
    open(NAME, { workspace, runner });
    await settle();
    PgConversation.start();
    await settle();
    PgConversation.pick("s1.q1", 1);
    await settle();
    PgConversation.act("s1.build");
    await settle();
    expect(PgConversation.state.engine.progress.passed).toEqual([
      "write-program",
    ]);
    PgConversation.next();
    await settle();
    PgConversation.skip("s2.q2");
    await settle();
    PgConversation.act("s2.airdrop");
    await settle();
    PgConversation.act("s2.deploy");
    await settle();
    PgConversation.next();
    await settle();
    expect(workspace.files["client/client.ts"]).toBe("");
    expect(PgConversation.state.engine.progress.beats["s3.file"]).toMatchObject(
      {
        kind: "written",
        wrote: { file: "client/client.ts", lines: [], created: true },
      }
    );
  });

  it("runs an act through the runner, showing its stages, and passes the step", async () => {
    const runner = stubRunner([{ stages: ["Building"], result: OK_BUILD }]);
    open(NAME, { runner });
    await settle();
    PgConversation.start();
    await settle();
    PgConversation.pick("s1.q1", 1);
    await settle();
    const stages: unknown[] = [];
    const watch = PgConversation.onDidChange((s) =>
      stages.push(s.engine.stage)
    );
    PgConversation.act("s1.build");
    await settle();
    watch.dispose();
    expect(runner.runs).toEqual([
      {
        act: "build",
        input: {
          beatId: "s1.build",
          failsWith: "cannot find type `Hello` in this scope",
        },
      },
    ]);
    expect(stages).toContainEqual({
      beatId: "s1.build",
      label: "Building",
      index: 1,
      count: 1,
    });
    expect(PgConversation.state.engine.stage).toBeNull();
    expect(PgConversation.state.engine.progress.passed).toEqual([
      "write-program",
    ]);
    expect(PgConversation.view(LATER)?.live?.id).toBe("win:write-program");
  });

  it("writes the save once per act, never per stage", async () => {
    let release: (r: RunResult) => void = () => {};
    const runner: Runner = {
      run: (_act, _input, onStage) =>
        new Promise<RunResult>((r) => {
          release = r;
          onStage({ label: "Writing buffer", index: 1, count: 3 });
          onStage({ label: "Deploying", index: 2, count: 3 });
          onStage({ label: "Confirming", index: 3, count: 3 });
        }),
    };
    open(NAME, { runner });
    await settle();
    PgConversation.start();
    await settle();
    PgConversation.pick("s1.q1", 1);
    await settle();
    const before = vi.mocked(writeWorkspaceFile).mock.calls.length;
    PgConversation.act("s1.build");
    await settle();
    expect(PgConversation.state.engine.stage).toMatchObject({ index: 3 });
    expect(vi.mocked(writeWorkspaceFile).mock.calls.length).toBe(before + 1);
    release(OK_BUILD);
    await settle();
    expect(vi.mocked(writeWorkspaceFile).mock.calls.length).toBe(before + 2);
  });

  it.each([
    ["beats", { "s9.gone": { kind: "said", at: 1 } }],
    ["runs", { "s9.gone": [{ status: "interrupted", at: 1 }] }],
    ["times", { gone: { from: 1, to: null } }],
  ])(
    "treats a save with an unknown id under %s as a failed load",
    async (section, entry) => {
      exists = true;
      const saved = freshProgress();
      saved.startedAt = 1000;
      saved.cursor = {
        kind: "step",
        stepId: "write-program",
        beat: 0,
        fail: false,
      };
      saved.times = { "write-program": { from: 1000, to: null } };
      Object.assign(saved[section as "beats" | "runs" | "times"], entry);
      file = { [STORAGE_KEY]: saved };
      open(NAME);
      await settle();
      expect(PgConversation.state.loadFailed).toBe(true);
      expect(
        logged.entries.some((e) =>
          `${e.message ?? ""}${e.error?.message ?? ""}`.includes("gone")
        )
      ).toBe(true);
    }
  );

  it("treats a cursor past its step's beats as a failed load", async () => {
    exists = true;
    const saved = freshProgress();
    saved.startedAt = 1000;
    saved.cursor = { kind: "step", stepId: "deploy", beat: 9, fail: false };
    saved.times = { deploy: { from: 1000, to: null } };
    file = { [STORAGE_KEY]: saved };
    open(NAME);
    await settle();
    expect(PgConversation.state.loadFailed).toBe(true);
  });

  it("a save with entries this engine cannot read is a failed load, named by key", async () => {
    exists = true;
    const saved = freshProgress();
    saved.startedAt = 1000;
    saved.cursor = {
      kind: "step",
      stepId: "write-program",
      beat: 1,
      fail: false,
    };
    saved.times = { "write-program": { from: 1000, to: null } };
    saved.beats = { "s1.boil": { kind: "sung", at: 1 } as never };
    file = { [STORAGE_KEY]: saved };
    open(NAME);
    await settle();
    expect(PgConversation.state.loadFailed).toBe(true);
    expect(
      logged.entries.some((e) =>
        `${e.message ?? ""}${e.error?.message ?? ""}`.includes("beats.s1.boil")
      )
    ).toBe(true);
  });

  it("loads a save inside the planned failure", async () => {
    exists = true;
    const saved = freshProgress();
    saved.startedAt = 1000;
    saved.cursor = {
      kind: "step",
      stepId: "write-program",
      beat: 2,
      fail: true,
    };
    saved.beats = {
      "s1.boil": {
        kind: "written",
        at: 1000,
        wrote: { file: "src/lib.rs", lines: [1, 2, 3] },
      },
      "s1.what": { kind: "said", at: 1100 },
      "s1.q1": {
        kind: "picked",
        at: 2000,
        openedAt: 1200,
        option: 1,
        attempts: 1,
        wrong: [],
      },
      "s1.build": { kind: "said", at: 2100 },
      "f1.explain": { kind: "said", at: 4000 },
      "f1.q2": { kind: "open", at: 4700, wrong: [] },
    };
    saved.runs = {
      "s1.build": [
        {
          status: "failed",
          at: 3000,
          took: 900,
          result: {
            act: "build",
            ok: false,
            reason: "compiler",
            seconds: 0.9,
            error: null,
            log: "x",
          },
          planned: true,
        },
      ],
    };
    saved.times = { "write-program": { from: 1000, to: null } };
    file = { [STORAGE_KEY]: saved };
    open(NAME);
    await settle();
    expect(PgConversation.state.loadFailed).toBe(false);
    expect(PgConversation.view(LATER)?.live?.id).toBe("f1.q2");
  });

  it("writes the save at the tutorial's own path, even after a switch", async () => {
    const releases: (() => void)[] = [];
    vi.mocked(writeWorkspaceFile).mockImplementation(async (path, data) => {
      await new Promise<void>((r) => releases.push(r));
      writtenTo.push(path);
      file = JSON.parse(data);
      exists = true;
    });
    open(NAME);
    await settle();
    PgConversation.start();
    await settle();
    setWorkspace("Other");
    // Start persists twice (the start, then s1.boil written), one at a time
    while (releases.length) {
      requireFor("a held release")(releases.shift())();
      await settle();
    }
    expect(writtenTo).toEqual([SAVE_PATH, SAVE_PATH]);
    expect(logged.entries.filter((e) => e.level === "error")).toEqual([]);
  });

  it("writes saves one at a time, the latest last, past a failed one", async () => {
    let calls = 0;
    let releaseFirst: () => void = () => {};
    vi.mocked(writeWorkspaceFile).mockImplementation(async (path, data) => {
      calls++;
      if (calls === 1) {
        await new Promise<void>((r) => {
          releaseFirst = r;
        });
        throw new Error("the first write failed");
      }
      writtenTo.push(path);
      file = JSON.parse(data);
      exists = true;
    });
    open(NAME);
    await settle();
    // Start persists twice in a row: the started save, then s1.boil written
    PgConversation.start();
    await settle();
    expect(writtenTo).toEqual([]);
    releaseFirst();
    // The failed write tells the learner (a dynamic import) before the
    // chain moves on to the next save
    await vi.waitFor(() => expect(writtenTo).toEqual([SAVE_PATH]));
    expect(
      (file[STORAGE_KEY] as { beats: Record<string, { kind: string }> }).beats[
        "s1.boil"
      ].kind
    ).toBe("written");
  });

  it("does not reload the same workspace while an act runs, and does once it ends", async () => {
    let release: (r: RunResult) => void = () => {};
    const runner: Runner = {
      run: () =>
        new Promise<RunResult>((r) => {
          release = r;
        }),
    };
    open(NAME, { runner });
    await settle();
    PgConversation.start();
    await settle();
    PgConversation.pick("s1.q1", 1);
    await settle();
    PgConversation.act("s1.build");
    await settle();
    switchWorkspace(NAME);
    await settle();
    expect(PgConversation.state.engine.progress.runs["s1.build"]).toEqual([
      { status: "started", at: expect.any(Number) },
    ]);
    release(OK_BUILD);
    await settle();
    expect(PgConversation.state.engine.progress.passed).toEqual([
      "write-program",
    ]);
    // With nothing running, the same switch reloads from the file
    const fresh = freshProgress();
    fresh.startedAt = 5;
    file = { [STORAGE_KEY]: fresh };
    switchWorkspace(NAME);
    await settle();
    expect(PgConversation.state.engine.progress.startedAt).toBe(5);
  });

  it("a reload whose read an act overtook keeps the act, not the older save", async () => {
    let release: (r: RunResult) => void = () => {};
    const runner: Runner = {
      run: () =>
        new Promise<RunResult>((r) => {
          release = r;
        }),
    };
    open(NAME, { runner });
    await settle();
    PgConversation.start();
    await settle();
    PgConversation.pick("s1.q1", 1);
    await settle();
    // The save as it stands before the act, held until the act has started
    const before = JSON.parse(JSON.stringify(file)) as unknown;
    let read: () => void = () => {};
    vi.mocked(PgExplorer.fs.readToJSON).mockImplementationOnce(
      () =>
        new Promise((r) => {
          read = () => r(before);
        })
    );
    switchWorkspace(NAME);
    await settle();
    PgConversation.act("s1.build");
    await settle();
    read();
    await settle();
    expect(PgConversation.state.engine.progress.runs["s1.build"]).toEqual([
      { status: "started", at: expect.any(Number) },
    ]);
    release(OK_BUILD);
    await settle();
    expect(PgConversation.state.engine.progress.passed).toEqual([
      "write-program",
    ]);
  });

  it("a reload waits for a save of the same tutorial still in flight", async () => {
    const releases: (() => void)[] = [];
    vi.mocked(writeWorkspaceFile).mockImplementation(async (path, data) => {
      await new Promise<void>((r) => releases.push(r));
      writtenTo.push(path);
      file = JSON.parse(data);
      exists = true;
    });
    open(NAME);
    await settle();
    PgConversation.start();
    await settle();
    switchWorkspace(NAME);
    await settle();
    // The reload has not replaced the state with the older file
    expect(PgConversation.state.engine.progress.startedAt).not.toBeNull();
    while (releases.length) {
      requireFor("a held release")(releases.shift())();
      await settle();
    }
    expect(PgConversation.state.engine.progress.startedAt).not.toBeNull();
    expect(
      (file[STORAGE_KEY] as { startedAt: number | null }).startedAt
    ).not.toBeNull();
  });

  it("a runner that throws ends the run as a failed result", async () => {
    const runner = {
      runs: [],
      run: async () => {
        throw new Error("server down");
      },
    };
    open(NAME, { runner });
    await settle();
    PgConversation.start();
    await settle();
    PgConversation.pick("s1.q1", 1);
    await settle();
    PgConversation.act("s1.build");
    await settle();
    expect(PgConversation.state.engine.progress.runs["s1.build"]).toMatchObject(
      [
        {
          status: "failed",
          result: { act: "build", ok: false, log: "server down" },
        },
      ]
    );
    expect(logged.entries.filter((e) => e.level === "error")).toHaveLength(1);
  });

  it("a failing write logs it and records writeFailed", async () => {
    const workspace: Workspace = {
      read: async () => "",
      write: async () => {
        throw new Error("disk full");
      },
      remove: async () => {},
    };
    open(NAME, { workspace });
    await settle();
    PgConversation.start();
    await settle();
    expect(PgConversation.state.engine.progress.beats["s1.boil"]).toEqual({
      kind: "said",
      at: expect.any(Number),
      writeFailed: true,
    });
    expect(
      PgConversation.view(LATER)?.turns.find((t) => t.id === "wrote:s1.boil")
    ).toMatchObject({ failed: true });
    // One for the start files' restore, one for the block
    expect(logged.entries.filter((e) => e.level === "error")).toHaveLength(2);
  });

  it("start over clears a failed load and writes a fresh save", async () => {
    exists = true;
    file = { [STORAGE_KEY]: { version: 7 } };
    open(NAME);
    await settle();
    expect(PgConversation.state.loadFailed).toBe(true);
    await vi.waitFor(() =>
      expect(vi.mocked(PgView.setToast)).toHaveBeenCalledTimes(1)
    );
    PgConversation.startOver();
    await settle();
    expect(PgConversation.state.loadFailed).toBe(false);
    expect(file[STORAGE_KEY]).toMatchObject({ version: 1, passed: [] });
    PgConversation.start();
    await settle();
    const saved = file[STORAGE_KEY] as { startedAt: number | null };
    expect(saved.startedAt).not.toBeNull();
  });

  it("treats a save naming a step the definition lacks as a failed load", async () => {
    exists = true;
    const saved = freshProgress();
    saved.startedAt = 1000;
    saved.cursor = { kind: "step", stepId: "renamed", beat: 0, fail: false };
    saved.times = { renamed: { from: 1000, to: null } };
    file = { [STORAGE_KEY]: saved };
    open(NAME);
    await settle();
    expect(PgConversation.state.loadFailed).toBe(true);
    expect(PgConversation.view(LATER)?.live?.kind).toBe("intro");
    expect(
      logged.entries.some((e) =>
        `${e.message ?? ""}${e.error?.message ?? ""}`.includes("renamed")
      )
    ).toBe(true);
  });

  it("acts again on an interrupted run and keeps the first as a record", async () => {
    exists = true;
    const saved = freshProgress();
    saved.startedAt = 1000;
    saved.passed = ["write-program"];
    saved.cursor = { kind: "step", stepId: "deploy", beat: 4, fail: false };
    saved.beats = {
      "s2.why": { kind: "said", at: 2000 },
      "s2.q2": {
        kind: "skipped",
        at: 2800,
        openedAt: 2700,
        via: "button",
        wrong: [],
      },
      "s2.airdrop": { kind: "said", at: 3000 },
      "s2.deploy": { kind: "said", at: 3500 },
    };
    saved.runs = {
      "s2.airdrop": [{ status: "ok", at: 3100, took: 200, result: AIRDROPPED }],
      "s2.deploy": [{ status: "started", at: 4000 }],
    };
    saved.times = {
      "write-program": { from: 1000, to: 1900, via: "chat" },
      deploy: { from: 2000, to: null },
    };
    file = { [STORAGE_KEY]: saved };
    const runner = stubRunner([
      {
        result: {
          act: "deploy",
          ok: true,
          seconds: 3,
          programId: "p",
          signature: "s",
          upgraded: false,
          lamports: 1,
          instructions: ["hello"],
        },
      },
    ]);
    open(NAME, { runner });
    await settle();
    expect(PgConversation.view(LATER)?.live).toMatchObject({
      id: "s2.deploy",
      state: "interrupted",
    });
    PgConversation.act("s2.deploy");
    await settle();
    expect(
      PgConversation.state.engine.progress.runs["s2.deploy"]
    ).toMatchObject([{ status: "interrupted", at: 4000 }, { status: "ok" }]);
    expect(PgConversation.state.engine.progress.passed).toEqual([
      "write-program",
      "deploy",
    ]);
    const ids = PgConversation.view(LATER)?.turns.map((t) => t.id) ?? [];
    expect(ids).toEqual(
      expect.arrayContaining(["s2.deploy", "result:s2.deploy:1", "win:deploy"])
    );
  });

  /** A save with step 2's deploy in flight at 4000, as a reload finds it */
  const deployInFlight = () => {
    const saved = freshProgress();
    saved.startedAt = 1000;
    saved.passed = ["write-program"];
    saved.cursor = { kind: "step", stepId: "deploy", beat: 4, fail: false };
    saved.beats = {
      "s2.why": { kind: "said", at: 2000 },
      "s2.q2": {
        kind: "skipped",
        at: 2800,
        openedAt: 2700,
        via: "button",
        wrong: [],
      },
      "s2.airdrop": { kind: "said", at: 3000 },
      "s2.deploy": { kind: "said", at: 3500 },
    };
    saved.runs = {
      "s2.airdrop": [{ status: "ok", at: 3100, took: 200, result: AIRDROPPED }],
      "s2.deploy": [{ status: "started", at: 4000 }],
    };
    saved.times = {
      "write-program": { from: 1000, to: 1900, via: "chat" },
      deploy: { from: 2000, to: null },
    };
    return saved;
  };
  const actionRuns = () =>
    events.events.filter((e) => e.name === "tutorial_action_run");

  it("posts a deploy the chain shows landed before the reload", async () => {
    exists = true;
    file = { [STORAGE_KEY]: deployInFlight() };
    const recognise = vi.fn<NonNullable<Runner["recognise"]>>(async () => ({
      act: "deploy",
      ok: true,
      seconds: 9,
      programId: "p",
      signature: "landedSig",
      upgraded: false,
      lamports: null,
      instructions: ["hello"],
    }));
    const runner: Runner = { run: stubRunner([]).run, recognise };
    open(NAME, { runner });
    await settle();
    expect(recognise).toHaveBeenCalledWith("deploy", 4000);
    expect(
      PgConversation.state.engine.progress.runs["s2.deploy"]
    ).toMatchObject([
      { status: "ok", at: 4000, result: { signature: "landedSig" } },
    ]);
    expect(PgConversation.state.engine.progress.passed).toEqual([
      "write-program",
      "deploy",
    ]);
    expect(actionRuns().map((e) => e.params)).toEqual([
      expect.objectContaining({ action: "deploy", outcome: "ok" }),
    ]);
  });

  it("measures a deploy as interrupted when the chain cannot be read", async () => {
    exists = true;
    file = { [STORAGE_KEY]: deployInFlight() };
    const runner: Runner = {
      run: stubRunner([]).run,
      recognise: async () => {
        throw new Error("fetch failed");
      },
    };
    open(NAME, { runner });
    await settle();
    expect(PgConversation.state.engine.progress.runs["s2.deploy"]).toEqual([
      { status: "interrupted", at: 4000 },
    ]);
    expect(actionRuns().map((e) => e.params)).toEqual([
      expect.objectContaining({ action: "deploy", outcome: "interrupted" }),
    ]);
  });

  it("posts nothing into another workspace when the learner leaves mid-lookup", async () => {
    exists = true;
    file = { [STORAGE_KEY]: deployInFlight() };
    let answer: (r: RunResult | null) => void = () => {};
    const runner: Runner = {
      run: stubRunner([]).run,
      recognise: () => new Promise((r) => (answer = r)),
    };
    open(NAME, { runner });
    await settle();
    switchWorkspace(null);
    await settle();
    answer({
      act: "deploy",
      ok: true,
      seconds: 9,
      programId: "p",
      signature: "late",
      upgraded: false,
      lamports: null,
      instructions: ["hello"],
    });
    await settle();
    expect(PgConversation.state.context).toBeNull();
    expect(actionRuns()).toEqual([]);
  });

  it("measures a run the reload interrupted once, and writes it back interrupted", async () => {
    exists = true;
    file = { [STORAGE_KEY]: deployInFlight() };
    const runner: Runner = {
      run: stubRunner([]).run,
      recognise: async () => null,
    };
    open(NAME, { runner });
    await settle();
    expect(actionRuns().map((e) => e.params)).toEqual([
      {
        tutorial: "hello-anchor",
        step: 2,
        action: "deploy",
        outcome: "interrupted",
        seconds: 0,
      },
    ]);
    const written = file[STORAGE_KEY] as { runs: Record<string, unknown> };
    expect(written.runs["s2.deploy"]).toEqual([
      { status: "interrupted", at: 4000 },
    ]);
    // The next load reads it interrupted already: nothing more is measured
    switchWorkspace(NAME);
    await settle();
    expect(actionRuns()).toHaveLength(1);
  });

  it("a load that lands after a workspace switch is dropped", async () => {
    let release: (value: unknown) => void = () => {};
    exists = true;
    vi.mocked(PgExplorer.fs.readToJSON).mockImplementation(
      () =>
        new Promise((r) => {
          release = r;
        })
    );
    open(NAME);
    await settle();
    setWorkspace("Other");
    release({});
    await settle();
    expect(PgConversation.state).toBe(INITIAL_CONVERSATION_STATE);
  });

  it("a reload inside the finish window still finishes", async () => {
    exists = true;
    const saved = freshProgress();
    saved.startedAt = 1000;
    saved.passed = ["write-program", "deploy", "call-client", "greet-by-name"];
    saved.cursor = {
      kind: "step",
      stepId: "greet-by-name",
      beat: 4,
      fail: false,
    };
    saved.times = {
      "write-program": { from: 1000, to: 1900, via: "chat" },
      deploy: { from: 2000, to: 2900, via: "chat" },
      "call-client": { from: 3000, to: 3900, via: "client" },
      "greet-by-name": { from: 4000, to: 4900, via: "chat" },
    };
    file = { [STORAGE_KEY]: saved };
    open(NAME);
    await settle();
    await vi.waitFor(() =>
      expect(PgConversation.state.engine.progress.finishedAt).not.toBeNull()
    );
    expect(events.events.map((e) => e.name)).toEqual(["tutorial_finished"]);
    expect(PgConversation.view(LATER)?.live).toBeNull();
  });

  it("a stale run's result cannot answer a new run of the same act", async () => {
    let releaseFirst: (r: RunResult) => void = () => {};
    let calls = 0;
    const runner: Runner = {
      run: () =>
        new Promise<RunResult>((r) => {
          calls++;
          if (calls === 1) releaseFirst = r;
          else r(OK_BUILD);
        }),
    };
    open(NAME, { runner });
    await settle();
    PgConversation.start();
    await settle();
    PgConversation.pick("s1.q1", 1);
    await settle();
    PgConversation.act("s1.build");
    await settle();
    PgConversation.startOver();
    await settle();
    // A later start: the new run's start time must differ from the first's
    await new Promise((r) => setTimeout(r, 5));
    PgConversation.start();
    await settle();
    PgConversation.pick("s1.q1", 1);
    await settle();
    // The second run answers at once and passes the step
    PgConversation.act("s1.build");
    await settle();
    expect(PgConversation.state.engine.progress.passed).toEqual([
      "write-program",
    ]);
    const before = PgConversation.state;
    releaseFirst({
      act: "build",
      ok: false,
      reason: "compiler",
      seconds: 1,
      error: null,
      log: "stale",
    });
    await settle();
    expect(PgConversation.state).toBe(before);
    expect(
      logged.entries.some(
        (e) =>
          e.level === "warn" &&
          (e.message ?? "").includes("no longer in flight")
      )
    ).toBe(true);
  });

  it("refuses to write while the load failed, and still shows the intro", async () => {
    exists = true;
    vi.mocked(PgExplorer.fs.readToJSON).mockRejectedValue(
      new Error("bad JSON")
    );
    open(NAME);
    await settle();
    expect(PgConversation.state.loadFailed).toBe(true);
    expect(PgConversation.view(LATER)?.live?.kind).toBe("intro");
    PgConversation.start();
    await settle();
    expect(writeWorkspaceFile).not.toHaveBeenCalled();
    expect(PgConversation.state.engine.progress.startedAt).not.toBeNull();
  });

  it("treats a save this engine never wrote as a failed load", async () => {
    exists = true;
    file = { [STORAGE_KEY]: { version: 7 } };
    open(NAME);
    await settle();
    expect(PgConversation.state.loadFailed).toBe(true);
    expect(logged.entries.some((e) => e.level === "error")).toBe(true);
  });

  it("a workspace switch mid-write does not write into the new workspace", async () => {
    let release: () => void = () => {};
    const written: [string, string][] = [];
    const workspace: Workspace = {
      read: async () => "",
      write: async (path, content) => {
        await new Promise<void>((r) => {
          release = r;
        });
        written.push([path, content]);
      },
      remove: async () => {},
    };
    open(NAME, { workspace });
    await settle();
    PgConversation.start();
    await settle();
    setWorkspace("Other");
    release();
    await settle();
    // Only the restore of step 1's start landed; the block write never ran
    expect(written).toEqual([["src/lib.rs", ""]]);
    expect(PgConversation.state.engine.progress.beats["s1.boil"]).toMatchObject(
      { kind: "said" }
    );
  });

  it("drops a scripted write held across Start over, so the intro's files stay", async () => {
    const files = memoryWorkspace({ "src/lib.rs": "" });
    let release: () => void = () => {};
    let held = false;
    const workspace: Workspace = {
      // The first read is the step's scripted write looking at the file:
      // it waits until the test lets it go
      read: async (path, name) => {
        if (!held) {
          held = true;
          await new Promise<void>((r) => {
            release = r;
          });
        }
        return files.read(path, name);
      },
      write: files.write,
      remove: files.remove,
    };
    open(NAME, { workspace });
    await settle();
    PgConversation.start();
    await settle();
    expect(held).toBe(true);
    PgConversation.startOver();
    await settle();
    release();
    await settle();
    expect(files.files["src/lib.rs"]).toBe(hello.intro.files["src/lib.rs"]);
    expect(PgConversation.state.engine.progress.cursor).toEqual({
      kind: "intro",
    });
    expect(
      logged.entries.some(
        (e) =>
          e.level === "info" && `${e.message ?? ""}`.includes("at a restart")
      )
    ).toBe(true);
  });

  it("start over writes a fresh save", async () => {
    open(NAME);
    await settle();
    PgConversation.start();
    await settle();
    PgConversation.startOver();
    await settle();
    expect(file[STORAGE_KEY]).toMatchObject({
      version: 1,
      passed: [],
      finishedAt: null,
      startedAt: null,
      restartedAt: expect.any(Number),
      cursor: { kind: "intro" },
    });
    expect(PgConversation.view(LATER)?.live?.kind).toBe("intro");
  });

  it("re-renders when the next turn arrives", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      vi.setSystemTime(10_000);
      open(NAME);
      await settle();
      let notified = 0;
      const watch = PgConversation.onDidChange(() => notified++);
      PgConversation.start();
      await settle();
      const before = notified;
      expect(PgConversation.view()?.nextAt).toBe(10_000 + TICK_MS);
      vi.advanceTimersByTime(TICK_MS);
      expect(notified).toBe(before + 1);
      watch.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("tells the learner once when a save fails", async () => {
    vi.mocked(writeWorkspaceFile).mockImplementation(async () => {
      throw new Error("quota");
    });
    open(NAME);
    await settle();
    PgConversation.start();
    await settle();
    PgConversation.pick("s1.q1", 1);
    await settle();
    await vi.waitFor(() =>
      expect(vi.mocked(PgView.setToast)).toHaveBeenCalledTimes(1)
    );
    expect(
      logged.entries.filter((e) => e.level === "error").length
    ).toBeGreaterThanOrEqual(1);
  });
});

describe("PgConversation's airdrop card", () => {
  const SOL = 1_000_000_000;
  const FOUND_FUNDED: RunResult = {
    act: "airdrop",
    ok: true,
    seconds: 0.4,
    balance: 3.2 * SOL,
    airdropped: 0,
  };

  /** A runner whose `isFunded` answers as given; every run lands as `results` say */
  const runnerWith = (
    funded: NonNullable<Runner["isFunded"]>,
    results: RunResult[] = [OK_BUILD, FOUND_FUNDED]
  ) => {
    const queue = results.slice();
    const run = vi.fn<Runner["run"]>(async (act) => {
      const next = queue.shift();
      if (!next) throw new Error(`no result scripted for ${act}`);
      return next;
    });
    return { run, isFunded: vi.fn(funded) };
  };

  /** Hello Anchor to step 2's airdrop card: built, Next, the question skipped */
  const toAirdrop = async (runner: Runner) => {
    open(NAME, { runner });
    await settle();
    PgConversation.start();
    await settle();
    PgConversation.pick("s1.q1", 1);
    await settle();
    PgConversation.act("s1.build");
    await settle();
    PgConversation.next();
    await settle();
    PgConversation.skip("s2.q2");
    await settle();
  };

  const airdropRuns = () =>
    PgConversation.state.engine.progress.runs["s2.airdrop"] ?? [];

  it("presses a funded wallet's airdrop card itself, and its record names the balance", async () => {
    const runner = runnerWith(async () => true);
    await toAirdrop(runner);
    expect(runner.isFunded).toHaveBeenCalledTimes(1);
    expect(runner.run).toHaveBeenLastCalledWith(
      "airdrop",
      expect.objectContaining({ beatId: "s2.airdrop" }),
      expect.any(Function)
    );
    expect(airdropRuns()).toMatchObject([{ status: "ok" }]);
    expect(
      PgConversation.view(LATER)?.turns.find((t) => t.id === "s2.airdrop")
    ).toMatchObject({ act: { record: "Your wallet has 3.2 SOL" } });
    expect(PgConversation.view(LATER)?.live?.id).toBe("s2.deploy");
  });

  it("leaves a wallet that is not funded its live card", async () => {
    // The store's own timer re-renders as the card's turns arrive
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const runner = runnerWith(async () => false);
      await toAirdrop(runner);
      expect(runner.isFunded).toHaveBeenCalledTimes(1);
      expect(airdropRuns()).toEqual([]);
      expect(PgConversation.view(LATER)?.live).toMatchObject({
        id: "s2.airdrop",
        state: "live",
      });
      // Asked once per load: a re-render on the same card asks nothing
      const changed = vi.fn();
      const changes = PgConversation.onDidChange(changed);
      vi.runOnlyPendingTimers();
      await settle();
      changes.dispose();
      expect(changed.mock.calls.length).toBeGreaterThan(1);
      expect(runner.isFunded).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a probe that throws, posts nothing and keeps the card live", async () => {
    const runner = runnerWith(async () => {
      throw new Error("RPC down");
    });
    await toAirdrop(runner);
    expect(airdropRuns()).toEqual([]);
    expect(PgConversation.view(LATER)?.live?.id).toBe("s2.airdrop");
    expect(
      logged.entries.filter(
        (e) => e.level === "error" && e.error?.message === "RPC down"
      )
    ).toMatchObject([{ report: true }]);
  });

  it("does not probe again for an airdrop that landed, after a reload either", async () => {
    const runner = runnerWith(async () => true);
    await toAirdrop(runner);
    expect(runner.isFunded).toHaveBeenCalledTimes(1);
    PgConversation.view(LATER);
    close();
    const again = runnerWith(async () => true, []);
    open(NAME, { runner: again });
    await settle();
    expect(
      PgConversation.state.engine.progress.runs["s2.airdrop"]
    ).toMatchObject([{ status: "ok" }]);
    expect(again.isFunded).not.toHaveBeenCalled();
    expect(again.run).not.toHaveBeenCalled();
  });

  it("runs once when the learner presses while the probe is in flight", async () => {
    let answer: (funded: boolean) => void = () => undefined;
    const runner = runnerWith(
      () => new Promise<boolean>((resolve) => (answer = resolve)),
      [
        OK_BUILD,
        {
          act: "airdrop",
          ok: true,
          seconds: 2,
          balance: 2 * SOL,
          airdropped: 2 * SOL,
        },
      ]
    );
    await toAirdrop(runner);
    expect(runner.isFunded).toHaveBeenCalledTimes(1);
    PgConversation.act("s2.airdrop");
    await settle();
    answer(true);
    await settle();
    expect(
      runner.run.mock.calls.filter(([act]) => act === "airdrop")
    ).toHaveLength(1);
    expect(airdropRuns()).toMatchObject([{ status: "ok" }]);
  });

  it("asks again after a reload onto a card that never ran", async () => {
    const runner = runnerWith(async () => false);
    await toAirdrop(runner);
    expect(runner.isFunded).toHaveBeenCalledTimes(1);
    close();
    const again = runnerWith(async () => true, [FOUND_FUNDED]);
    open(NAME, { runner: again });
    await settle();
    expect(again.isFunded).toHaveBeenCalledTimes(1);
    expect(airdropRuns()).toMatchObject([{ status: "ok" }]);
  });

  it("asks again after a reload onto a card the faucet refused, and presses it once funded", async () => {
    const refused: RunResult = {
      act: "airdrop",
      ok: false,
      seconds: 3,
      reason: "no_funds",
      message: "429 Too Many Requests",
      balance: 0,
      cost: 1.27 * SOL,
      address: "WaLLet",
    };
    const runner = runnerWith(async () => false, [OK_BUILD, refused]);
    await toAirdrop(runner);
    PgConversation.act("s2.airdrop");
    await settle();
    expect(airdropRuns()).toMatchObject([{ status: "failed" }]);
    // Within the session the refused card is not asked about again
    expect(runner.isFunded).toHaveBeenCalledTimes(1);
    close();
    const again = runnerWith(async () => true, [FOUND_FUNDED]);
    open(NAME, { runner: again });
    await settle();
    expect(again.isFunded).toHaveBeenCalledTimes(1);
    expect(airdropRuns()).toMatchObject([
      { status: "failed" },
      { status: "ok" },
    ]);
  });

  it("measures a refused airdrop as no_funds", async () => {
    const refused: RunResult = {
      act: "airdrop",
      ok: false,
      seconds: 3,
      reason: "no_funds",
      message: "429 Too Many Requests",
      balance: 0,
      cost: 1.27 * SOL,
      address: "WaLLet",
    };
    const runner = runnerWith(async () => false, [OK_BUILD, refused]);
    await toAirdrop(runner);
    PgConversation.act("s2.airdrop");
    await settle();
    expect(
      events.events
        .filter((e) => e.name === "tutorial_action_run")
        .map((e) => e.params)
        .filter((p) => p.action === "airdrop")
    ).toEqual([
      expect.objectContaining({
        tutorial: "hello-anchor",
        step: 2,
        action: "airdrop",
        outcome: "no_funds",
      }),
    ]);
  });

  it("asks again after a reload interrupted the card's run", async () => {
    const runner = {
      run: vi.fn<Runner["run"]>(async (act) =>
        act === "build" ? OK_BUILD : new Promise<RunResult>(() => undefined)
      ),
      isFunded: vi.fn(async () => false),
    };
    await toAirdrop(runner);
    PgConversation.act("s2.airdrop");
    await settle();
    expect(airdropRuns()).toMatchObject([{ status: "started" }]);
    // A page reload: the store starts from nothing and reads the save
    close();
    open(null);
    await settle();
    close();
    const again = runnerWith(async () => true, [FOUND_FUNDED]);
    open(NAME, { runner: again });
    await settle();
    expect(again.isFunded).toHaveBeenCalledTimes(1);
    expect(airdropRuns()).toMatchObject([
      { status: "interrupted" },
      { status: "ok" },
    ]);
  });

  it("asks again when a restart of the step reaches the card anew", async () => {
    const runner = runnerWith(
      async () => true,
      [OK_BUILD, FOUND_FUNDED, FOUND_FUNDED]
    );
    await toAirdrop(runner);
    expect(runner.isFunded).toHaveBeenCalledTimes(1);
    PgConversation.restartStep();
    await settle();
    PgConversation.skip("s2.q2");
    await settle();
    expect(runner.isFunded).toHaveBeenCalledTimes(2);
    expect(airdropRuns()).toMatchObject([{ status: "ok" }]);
  });
});

describe("PgConversation's later airdrop card (designers, 7 Nov)", () => {
  const SOL = 1_000_000_000;
  const CALLED: RunResult = {
    act: "call",
    ok: true,
    seconds: 1,
    signatures: ["sig"],
    line: "Program log: Hello, World!",
    called: [{ instruction: "hello", args: {} }],
  };
  /** Any ok result but an airdrop's passes its step, so the Call panel can pass steps 2 and 3 */
  const anyOk: Judge = (_goal, result) => result.ok && result.act !== "airdrop";

  /** A runner whose `isFunded` answers as given; every run lands as `results` say */
  const runnerWith = (
    funded: NonNullable<Runner["isFunded"]>,
    results: RunResult[]
  ) => {
    const queue = results.slice();
    const run = vi.fn<Runner["run"]>(async (act) => {
      const next = queue.shift();
      if (!next) throw new Error(`no result scripted for ${act}`);
      return next;
    });
    return { run, isFunded: vi.fn(funded) };
  };

  /** Hello Anchor to step 4's airdrop card, steps 2 and 3 passed from the Call panel */
  const toLaterAirdrop = async (runner: Runner) => {
    open(NAME, { runner, judge: anyOk });
    await settle();
    PgConversation.start();
    await settle();
    PgConversation.pick("s1.q1", 1);
    await settle();
    PgConversation.act("s1.build");
    await settle();
    PgConversation.next();
    await settle();
    PgConversation.passed("call_panel", CALLED);
    await settle();
    PgConversation.next();
    await settle();
    PgConversation.passed("call_panel", CALLED);
    await settle();
    PgConversation.next();
    await settle();
    PgConversation.pick("s4.q4", 1);
    await settle();
  };

  const shown = () => PgConversation.view(LATER)?.turns.map((t) => t.id) ?? [];
  const laterRuns = () =>
    PgConversation.state.engine.progress.runs["s4.airdrop"] ?? [];

  it("keeps the card and its say line out of the feed while it checks, and a funded wallet's never shows", async () => {
    let answer: (funded: boolean) => void = () => undefined;
    const runner = runnerWith(
      () => new Promise<boolean>((resolve) => (answer = resolve)),
      [
        OK_BUILD,
        {
          act: "airdrop",
          ok: true,
          seconds: 0.4,
          balance: 3.2 * SOL,
          airdropped: 0,
        },
      ]
    );
    await toLaterAirdrop(runner);
    expect(runner.isFunded).toHaveBeenCalledTimes(1);
    expect(PgConversation.state.probing).toEqual(["s4.airdrop"]);
    expect(shown()).not.toContain("s4.airdrop");
    expect(shown()).not.toContain("say:s4.airdrop");
    answer(true);
    await settle();
    expect(laterRuns()).toMatchObject([{ status: "ok" }]);
    expect(PgConversation.state.probing).toEqual([]);
    expect(shown()).not.toContain("s4.airdrop");
    expect(shown()).not.toContain("say:s4.airdrop");
    expect(PgConversation.view(LATER)?.live?.id).toBe("s4.ship");
  });

  it("shows the card and its say line once the check finds the wallet short", async () => {
    const runner = runnerWith(async () => false, [OK_BUILD]);
    await toLaterAirdrop(runner);
    expect(PgConversation.state.probing).toEqual([]);
    expect(shown()).toContain("say:s4.airdrop");
    expect(PgConversation.view(LATER)?.live).toMatchObject({
      id: "s4.airdrop",
      state: "live",
    });
  });

  it("shows the card when the check does not answer in time, and a late funded answer still presses it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let answer: (funded: boolean) => void = () => undefined;
      const runner = runnerWith(
        () => new Promise<boolean>((resolve) => (answer = resolve)),
        [
          OK_BUILD,
          {
            act: "airdrop",
            ok: true,
            seconds: 0.4,
            balance: 3.2 * SOL,
            airdropped: 0,
          },
        ]
      );
      await toLaterAirdrop(runner);
      expect(PgConversation.state.probing).toEqual(["s4.airdrop"]);
      vi.advanceTimersByTime(PROBE_TIMEOUT_MS);
      await settle();
      expect(PgConversation.state.probing).toEqual([]);
      expect(PgConversation.view(LATER)?.live?.id).toBe("s4.airdrop");
      answer(true);
      await settle();
      expect(laterRuns()).toMatchObject([{ status: "ok" }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the card when the check throws", async () => {
    const runner = runnerWith(async () => {
      throw new Error("RPC down");
    }, [OK_BUILD]);
    await toLaterAirdrop(runner);
    expect(PgConversation.state.probing).toEqual([]);
    expect(PgConversation.view(LATER)?.live?.id).toBe("s4.airdrop");
  });

  /** The faucet's refusal, as the airdrop act answers it */
  const REFUSED: RunResult = {
    act: "airdrop",
    ok: false,
    seconds: 3,
    reason: "no_funds",
    message: "429 Too Many Requests",
    balance: 0,
    cost: 1.27 * SOL,
    address: "WaLLet",
  };
  const airdropPresses = (runner: { run: ReturnType<typeof vi.fn> }) =>
    runner.run.mock.calls.filter(([act]) => act === "airdrop");

  it.each([
    ["finds the wallet short", () => Promise.resolve(false)],
    ["throws", () => Promise.reject(new Error("RPC down"))],
  ])(
    "shows the card when the check times out, and a late answer that %s presses nothing",
    async (_case, late) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        // Resolved with the late answer's promise, so a rejection rejects it
        let settleProbe: (answer: Promise<boolean>) => void = () => undefined;
        const runner = runnerWith(
          () => new Promise<boolean>((resolve) => (settleProbe = resolve)),
          [OK_BUILD]
        );
        await toLaterAirdrop(runner);
        expect(PgConversation.state.probing).toEqual(["s4.airdrop"]);
        vi.advanceTimersByTime(PROBE_TIMEOUT_MS);
        await settle();
        expect(PgConversation.state.probing).toEqual([]);
        expect(shown()).toContain("say:s4.airdrop");
        expect(PgConversation.view(LATER)?.live).toMatchObject({
          id: "s4.airdrop",
          state: "live",
        });
        settleProbe(late());
        await settle();
        expect(airdropPresses(runner)).toEqual([]);
        expect(laterRuns()).toEqual([]);
        expect(PgConversation.state.probing).toEqual([]);
        expect(PgConversation.view(LATER)?.live).toMatchObject({
          id: "s4.airdrop",
          state: "live",
        });
      } finally {
        vi.useRealTimers();
      }
    }
  );

  it("reports a check that throws after it timed out, once", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let fail: (e: Error) => void = () => undefined;
      const runner = runnerWith(
        () => new Promise<boolean>((_resolve, reject) => (fail = reject)),
        [OK_BUILD]
      );
      await toLaterAirdrop(runner);
      vi.advanceTimersByTime(PROBE_TIMEOUT_MS);
      await settle();
      fail(new Error("RPC down"));
      await settle();
      expect(
        logged.entries.filter(
          (e) => e.level === "error" && e.error?.message === "RPC down"
        )
      ).toMatchObject([{ report: true }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a press after the check found the wallet short fails into a live retry card", async () => {
    const runner = runnerWith(async () => false, [OK_BUILD, REFUSED]);
    await toLaterAirdrop(runner);
    expect(PgConversation.state.probing).toEqual([]);
    PgConversation.act("s4.airdrop");
    await settle();
    expect(airdropPresses(runner)).toHaveLength(1);
    expect(laterRuns()).toMatchObject([{ status: "failed" }]);
    expect(PgConversation.state.probing).toEqual([]);
    expect(shown()).toContain("s4.airdrop");
    expect(PgConversation.view(LATER)?.live).toMatchObject({
      id: "s4.airdrop:retry",
      state: "live",
    });
    // Within the session the refused card is not asked about again
    expect(runner.isFunded).toHaveBeenCalledTimes(1);
  });

  it("a press the check made that the faucet refuses shows the retry card", async () => {
    const runner = runnerWith(async () => true, [OK_BUILD, REFUSED]);
    await toLaterAirdrop(runner);
    expect(airdropPresses(runner)).toHaveLength(1);
    expect(laterRuns()).toMatchObject([{ status: "failed" }]);
    expect(PgConversation.state.probing).toEqual([]);
    expect(shown()).toContain("s4.airdrop");
    expect(PgConversation.view(LATER)?.live).toMatchObject({
      id: "s4.airdrop:retry",
      state: "live",
    });
  });

  it("presses nothing in another workspace when the check answers after a switch", async () => {
    let answer: (funded: boolean) => void = () => undefined;
    const runner = runnerWith(
      () => new Promise<boolean>((resolve) => (answer = resolve)),
      [OK_BUILD]
    );
    await toLaterAirdrop(runner);
    expect(PgConversation.state.probing).toEqual(["s4.airdrop"]);
    const written = writtenTo.length;
    switchWorkspace("Scratch");
    await settle();
    answer(true);
    await settle();
    expect(airdropPresses(runner)).toEqual([]);
    expect(PgConversation.state.context).toBeNull();
    expect(PgConversation.state.probing).toEqual([]);
    expect(writtenTo.slice(written)).toEqual([]);
  });
});

describe("PgCallPanel", () => {
  const helloIdl = (args: string[]) =>
    ({
      version: "0.1.0",
      name: "hello_anchor",
      instructions: [
        {
          name: "hello",
          accounts: [],
          args: args.map((name) => ({ name, type: "string" })),
        },
      ],
    } as unknown as Idl);

  /** A runner that deploys `idl` and answers every call with `hello` */
  const runnerOf = (idl: Idl) => {
    const run = vi.fn<Runner["run"]>(async (act) => {
      if (act === "build") return OK_BUILD;
      if (act === "airdrop") return AIRDROPPED;
      if (act === "deploy" || act === "buildDeploy") {
        return {
          act,
          ok: true,
          seconds: 1,
          programId: "He11o",
          signature: "dep",
          upgraded: false,
          lamports: 1,
          instructions: ["hello"],
          idl,
        };
      }
      return {
        act: "call",
        ok: true,
        seconds: 1,
        signatures: ["sig"],
        line: "Program log: Hello, World!",
        called: [{ instruction: "hello", args: {} }],
      };
    });
    return { run };
  };

  /** Hello Anchor up to its first deploy, landed, on step 2's win */
  const toDeployed = async (idl = helloIdl([])) => {
    const runner = runnerOf(idl);
    open(NAME, { runner });
    await settle();
    PgConversation.start();
    await settle();
    PgConversation.pick("s1.q1", 1);
    await settle();
    PgConversation.act("s1.build");
    await settle();
    PgConversation.next();
    await settle();
    PgConversation.skip("s2.q2");
    await settle();
    PgConversation.act("s2.airdrop");
    await settle();
    PgConversation.act("s2.deploy");
    await settle();
    return runner;
  };

  beforeEach(() => sessionStorage.clear());

  it("keeps the open panel, its chip and typed fields across a reload of the tab", async () => {
    await toDeployed(helloIdl(["name"]));
    PgCallPanel.show();
    PgCallPanel.type("name", "Alex");
    const picked = PgCallPanel.view?.instruction;

    // A reload: the module's memory is gone, the tab's own store is not
    (PgCallPanel as unknown as { _state: { tutorial: undefined } })._state = {
      tutorial: undefined,
    };

    expect(PgCallPanel.isOpen).toBe(true);
    expect(PgCallPanel.view?.instruction).toBe(picked);
    expect(PgCallPanel.view?.fields).toEqual([
      expect.objectContaining({ name: "name", value: "Alex" }),
    ]);
    PgCallPanel.close();
  });

  it("has no panel to open before a deploy", async () => {
    open(NAME);
    await settle();
    PgConversation.start();
    await settle();
    expect(PgCallPanel.callable).toBe(false);
    expect(PgCallPanel.view).toBeUndefined();
  });

  it("is callable once a deploy lands, with the dot until it is opened", async () => {
    await toDeployed();
    expect(PgCallPanel.callable).toBe(true);
    expect(PgCallPanel.dot).toBe(true);
    PgCallPanel.show();
    expect(PgCallPanel.dot).toBe(false);
    PgCallPanel.close();
    expect(PgCallPanel.dot).toBe(false);
  });

  it("shows a terminal redeploy's instructions, and saves them", async () => {
    await toDeployed();
    PgCallPanel.show();
    expect(PgCallPanel.view?.fields.map((f) => f.name)).toEqual([]);
    PgCallPanel.close();

    // The learner adds an argument, builds and types `deploy` in the terminal
    PgConversation.deployed(helloIdl(["name"]));
    await settle();
    expect(PgCallPanel.dot).toBe(true);
    PgCallPanel.show();
    expect(PgCallPanel.view?.fields).toEqual([
      expect.objectContaining({ name: "name", isNew: true }),
    ]);
    expect(
      (file.conversation as { deployed?: { added: string[] } }).deployed?.added
    ).toEqual(["hello.name"]);
  });

  it("keeps the form when the step moves on, and drops a call from before Start over", async () => {
    const { run } = await toDeployed(helloIdl(["name"]));
    PgCallPanel.show();
    const picked = PgCallPanel.view?.instruction;
    PgConversation.next();
    await settle();
    PgCallPanel.show();
    expect(PgCallPanel.view?.instruction).toBe(picked);

    let land: (r: RunResult) => void = () => {};
    run.mockImplementationOnce(
      () =>
        new Promise<RunResult>((resolve) => {
          land = resolve;
        })
    );
    const calling = PgConversation.callFromPanel({
      instruction: "hello",
      args: {},
    });
    await settle();
    PgConversation.startOver();
    await settle();
    land({
      act: "call",
      ok: true,
      seconds: 1,
      signatures: ["old"],
      line: "Program log: Map created",
      called: [{ instruction: "hello", args: {} }],
      wrote: [{ name: "map", address: "Old" }],
    });
    await calling;
    await settle();
    expect(PgConversation.state.engine.progress.accounts).toEqual({});
  });

  it("calls on the address an earlier call wrote to, Call off until it is known", async () => {
    formAccounts.current = [
      {
        name: "map",
        isSigner: false,
        generator: { type: "Custom", value: "" },
      },
    ];
    try {
      const { run } = await toDeployed();
      PgConversation.next();
      await settle();
      PgCallPanel.show();
      expect(PgCallPanel.view?.canCall).toBe(false);

      run.mockResolvedValueOnce({
        act: "call",
        ok: true,
        seconds: 1,
        signatures: ["init"],
        line: "Program log: Map created",
        called: [{ instruction: "hello", args: {} }],
        wrote: [{ name: "map", address: "Map1" }],
      });
      await PgConversation.callFromPanel({ instruction: "hello", args: {} });
      await settle();
      expect(PgCallPanel.view?.canCall).toBe(true);

      await PgCallPanel.call();
      await settle();
      expect(run).toHaveBeenLastCalledWith(
        "call",
        expect.objectContaining({
          call: {
            instruction: "hello",
            args: {},
            accounts: { map: "Map1" },
          },
        }),
        expect.any(Function)
      );
    } finally {
      formAccounts.current = [];
    }
  });

  it("offers Check again on a call devnet has not confirmed, which reads and sends nothing", async () => {
    const { run } = await toDeployed(helloIdl([]));
    PgConversation.next();
    await settle();
    PgCallPanel.show();
    const unconfirmed = [
      {
        signature: "5ig",
        calls: [{ instruction: "hello", args: {}, accounts: [], wrote: [] }],
      },
    ];
    run.mockResolvedValueOnce({
      act: "call",
      ok: false,
      seconds: 1,
      reason: "unconfirmed",
      message: "Devnet has not confirmed this transaction yet.",
      log: "",
      unconfirmed,
    });
    await PgCallPanel.call();
    await settle();
    expect(PgCallPanel.view?.canCall).toBe(false);
    expect(PgCallPanel.view?.canRecheck).toBe(true);

    await PgCallPanel.recheck();
    await settle();
    expect(run).toHaveBeenLastCalledWith(
      "call",
      expect.objectContaining({
        call: { instruction: "hello", args: {} },
        recheck: unconfirmed,
      }),
      expect.any(Function)
    );
  });

  it("passes step 3 from the panel, with the deployed IDL, and the win follows", async () => {
    const idl = helloIdl([]);
    const { run } = await toDeployed(idl);
    PgConversation.next();
    await settle();
    expect(PgConversation.state.engine.progress.passed).not.toContain(
      "call-client"
    );
    PgCallPanel.show();
    await PgCallPanel.call();
    await settle();
    expect(run).toHaveBeenLastCalledWith(
      "call",
      expect.objectContaining({
        call: { instruction: "hello", args: {} },
        idl,
        log: "Hello, World!",
      }),
      expect.any(Function)
    );
    const { progress } = PgConversation.state.engine;
    expect(progress.passed).toContain("call-client");
    expect(progress.times["call-client"].via).toBe("call_panel");
    expect(PgCallPanel.view?.result?.ok).toBe(true);
    expect(
      events.events.filter((e) => e.name === "tutorial_step_passed").at(-1)
        ?.params
    ).toMatchObject({ via: "call_panel", step: 3 });
  });

  it("shows no new field for a build that was not deployed", async () => {
    await toDeployed();
    // A build changes `PgProgramInfo.idl`, which the panel never reads
    PgCallPanel.show();
    expect(PgCallPanel.view?.fields).toEqual([]);
    expect(PgCallPanel.view?.signature).toBe("()");
  });
});

describe("PgConversation's composer", () => {
  /** A proposal for line 2 of src/lib.rs, which reads "old" when proposed */
  const propose = () =>
    PgConversation.propose({
      id: "p1",
      file: "src/lib.rs",
      line: 2,
      before: "old",
      after: "new",
    });
  const proposal = () => PgConversation.state.engine.progress.proposals[0];
  const named = (name: string) => events.events.filter((e) => e.name === name);

  it("counts a question on the step it was sent on, not the one the lesson reached since", async () => {
    open(NAME);
    await settle();
    PgConversation.start();
    await settle();
    PgConversation.asked({ kind: "intro" });
    await settle();
    expect(named("tutorial_question_asked")).toMatchObject([
      { name: "tutorial_question_asked", params: { step: 0 } },
    ]);
  });

  it("applies the line it proposed and leaves the others alone", async () => {
    const workspace = memoryWorkspace({ "src/lib.rs": "a\nold\nc" });
    open(NAME, { workspace });
    await settle();
    propose();
    PgConversation.apply("p1");
    await settle();
    expect(workspace.files["src/lib.rs"]).toBe("a\nnew\nc");
    expect(proposal().state).toBe("applied");
    expect(named("tutorial_change_applied")).toHaveLength(1);
  });

  it("ignores Keep it while an Apply waits behind another file write", async () => {
    const files = memoryWorkspace({ "src/lib.rs": "a\nold\nc" });
    let release: () => void = () => {};
    let held = false;
    const workspace: Workspace = {
      // The first read is Start's scripted write: it waits for the test
      read: async (path, name) => {
        if (!held) {
          held = true;
          await new Promise<void>((r) => {
            release = r;
          });
        }
        return files.read(path, name);
      },
      write: files.write,
      remove: files.remove,
    };
    open(NAME, { workspace });
    await settle();
    PgConversation.start();
    await settle();
    expect(held).toBe(true);
    propose();
    PgConversation.apply("p1");
    PgConversation.keep("p1");
    expect(proposal().state).toBe("open");
    release();
    await settle();
    expect(proposal().state).not.toBe("kept");
  });

  it("refuses an Apply once the learner changed the line, and writes nothing", async () => {
    const workspace = memoryWorkspace({ "src/lib.rs": "a\nmine\nc" });
    open(NAME, { workspace });
    await settle();
    propose();
    PgConversation.apply("p1");
    await settle();
    expect(workspace.files["src/lib.rs"]).toBe("a\nmine\nc");
    expect(proposal()).toMatchObject({ state: "open", applyFailed: "moved" });
    expect(named("tutorial_change_applied")).toHaveLength(0);
    // The failed Apply is over: Keep it answers again
    PgConversation.keep("p1");
    expect(proposal().state).toBe("kept");
  });

  it("says a file that is gone is gone, not a moved line", async () => {
    open(NAME, { workspace: memoryWorkspace({}) });
    await settle();
    propose();
    PgConversation.apply("p1");
    await settle();
    expect(proposal()).toMatchObject({ state: "open", applyFailed: "gone" });
    expect(named("tutorial_change_applied")).toHaveLength(0);
  });

  it("says a write failed as a write, not as a moved line", async () => {
    const workspace: Workspace = {
      read: async () => "a\nold\nc",
      write: async () => {
        throw new Error("disk full");
      },
      remove: async () => {},
    };
    open(NAME, { workspace });
    await settle();
    propose();
    PgConversation.apply("p1");
    await settle();
    expect(proposal()).toMatchObject({ state: "open", applyFailed: "write" });
    expect(logged.entries.filter((e) => e.level === "error")).toHaveLength(1);
  });

  it("holds Keep it while an Apply is writing, so the card never says kept over a changed file", async () => {
    const workspace = memoryWorkspace({ "src/lib.rs": "a\nold\nc" });
    let land = () => {};
    const slow: Workspace = {
      read: workspace.read,
      write: (path, content) =>
        new Promise<void>((resolve) => {
          land = () => {
            workspace.files[path] = content;
            resolve();
          };
        }),
      remove: workspace.remove,
    };
    open(NAME, { workspace: slow });
    await settle();
    propose();
    PgConversation.apply("p1");
    await settle();
    PgConversation.keep("p1");
    PgConversation.apply("p1");
    land();
    await settle();
    expect(workspace.files["src/lib.rs"]).toBe("a\nnew\nc");
    expect(proposal().state).toBe("applied");
    expect(named("tutorial_change_kept")).toHaveLength(0);
    expect(named("tutorial_change_applied")).toHaveLength(1);
  });

  it("settles as applied when an earlier Apply already wrote the line", async () => {
    const workspace = memoryWorkspace({ "src/lib.rs": "a\nnew\nc" });
    open(NAME, { workspace });
    await settle();
    propose();
    PgConversation.apply("p1");
    await settle();
    expect(proposal()).toMatchObject({ state: "applied" });
    expect(proposal().applyFailed).toBeUndefined();
  });

  it("sends a typed word to the assistant when the engine does not act on it", async () => {
    open(NAME);
    await settle();
    PgConversation.start();
    await settle();
    const before = PgConversation.state.engine.progress.said;
    // The view and the engine disagree: the view still shows the intro
    const intro = {
      id: "intro",
      kind: "intro",
      step: null,
      at: 0,
      whole: true,
    };
    const view = vi
      .spyOn(PgConversation, "view")
      .mockReturnValue({ live: intro } as unknown as ReturnType<
        typeof PgConversation.view
      >);
    try {
      expect(PgConversation.say("go")).toBe("assistant");
    } finally {
      view.mockRestore();
    }
    expect(PgConversation.state.engine.progress.said).toBe(before);
    expect(named("tutorial_word_sent")).toHaveLength(0);
  });

  it("routes a typed word to the lesson, a refused one to its refusal, and the rest to the assistant", async () => {
    open(NAME);
    await settle();
    expect(PgConversation.say("what is declare_id?")).toBe("assistant");
    expect(PgConversation.state.engine.progress.said).toEqual([]);

    expect(PgConversation.say("  Go! ")).toBe("lesson");
    await settle();
    const progress = PgConversation.state.engine.progress;
    expect(progress.startedAt).not.toBeNull();
    expect(progress.said).toEqual([
      { kind: "word", text: "Go!", at: progress.startedAt },
    ]);
    expect(named("tutorial_word_sent")[0].params).toMatchObject({
      word: "start",
      refused: false,
      step: 0,
    });
    // The pill sits before what its action posted, outside step 1
    const turns = PgConversation.view(LATER)?.turns ?? [];
    const pill = turns.findIndex((t) => t.id === "said:0");
    expect(turns[pill]).toMatchObject({ kind: "you", step: null });
    expect(pill).toBeLessThan(
      turns.findIndex((t) => t.id === "divider:write-program")
    );

    // The question is due once the lesson's paced lines have posted
    const now = vi.spyOn(Date, "now").mockReturnValue(LATER);
    try {
      expect(PgConversation.view()?.live?.id).toBe("s1.q1");
      expect(PgConversation.say("build")).toBe("lesson");
    } finally {
      now.mockRestore();
    }
    expect(PgConversation.state.engine.progress.said[1]).toMatchObject({
      kind: "refused",
      text: "build",
    });
  });
});
