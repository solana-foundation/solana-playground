import type { Mock } from "vitest";
vi.mock("../../sidebar/assistant/bridge/build-output", () => ({
  PgBuildOutput: {
    latest: null,
    onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
  },
  stripKnownNoise: vi.fn((s) => s),
}));
vi.mock("../../../utils", () => ({
  PgCommand: {
    build: {
      onDidStart: vi.fn(() => ({ dispose: vi.fn() })),
      onDidFinish: vi.fn(() => ({ dispose: vi.fn() })),
    },
    deploy: {
      onDidStart: vi.fn(() => ({ dispose: vi.fn() })),
      onDidFinish: vi.fn(() => ({ dispose: vi.fn() })),
    },
  },
  PgExplorer: {
    onDidSwitchWorkspace: vi.fn(() => ({ dispose: vi.fn() })),
  },
  PgGlobal: {
    deployState: "ready",
  },
  PgProgramInfo: {
    lastBuildFailed: null,
    onChain: null,
    onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeOnChain: vi.fn(() => ({ dispose: vi.fn() })),
  },
}));

import { INITIAL_FLOW_STATE, PgFlow, countErrors } from "./stage";
import type { BuildOutput } from "../../sidebar/assistant/bridge/build-output";

/** The mocked build-output module, in the shape the factory above gives it:
 * `latest` is a plain field here, where the real class has a getter. */
const mockedBuildOutput = async () =>
  (await import("../../sidebar/assistant/bridge/build-output")) as unknown as {
    PgBuildOutput: { latest: Partial<BuildOutput> | null; onDidChange: Mock };
    stripKnownNoise: Mock;
  };

describe("PgFlow.reduce", () => {
  it("starts on write with everything upcoming", () => {
    expect(INITIAL_FLOW_STATE).toEqual({
      stage: "write",
      build: "upcoming",
      buildSettled: "upcoming",
      deploy: "upcoming",
      interact: "upcoming",
      buildErrorCount: 0,
      buildMs: null,
      buildStartedAt: null,
    });
  });

  it("keeps the settled status while a retry is in flight", () => {
    const failed = PgFlow.reduce(INITIAL_FLOW_STATE, {
      type: "build-finish",
      failed: true,
      errorCount: 0,
      ms: 5,
    });
    expect(failed.buildSettled).toBe("failed");
    const retrying = PgFlow.reduce(failed, { type: "build-start", at: 2000 });
    expect(retrying.build).toBe("running");
    expect(retrying.buildSettled).toBe("failed");
  });

  it("build-start marks build running, routes to build, records `at`", () => {
    const s = PgFlow.reduce(INITIAL_FLOW_STATE, {
      type: "build-start",
      at: 1000,
    });
    expect(s.build).toBe("running");
    expect(s.stage).toBe("build");
    expect(s.buildStartedAt).toBe(1000);
  });

  it("failed build is failed with a count; deploy stays upcoming", () => {
    const s = PgFlow.reduce(INITIAL_FLOW_STATE, {
      type: "build-finish",
      failed: true,
      errorCount: 2,
      ms: 2900,
    });
    expect(s.build).toBe("failed");
    expect(s.buildErrorCount).toBe(2);
    expect(s.buildMs).toBe(2900);
    expect(s.deploy).toBe("upcoming");
  });

  it("successful build is done and stays on the build surface", () => {
    const building = PgFlow.reduce(INITIAL_FLOW_STATE, {
      type: "build-start",
      at: 1,
    });
    const s = PgFlow.reduce(building, {
      type: "build-finish",
      failed: false,
      errorCount: 0,
      ms: 3100,
    });
    expect(s.build).toBe("done");
    expect(s.stage).toBe("build");
  });

  it("successful build does not pull the user away from another stage", () => {
    const elsewhere = PgFlow.reduce(
      PgFlow.reduce(INITIAL_FLOW_STATE, { type: "build-start", at: 1 }),
      { type: "set-stage", stage: "write" }
    );
    const s = PgFlow.reduce(elsewhere, {
      type: "build-finish",
      failed: false,
      errorCount: 0,
      ms: 3100,
    });
    expect(s.stage).toBe("write");
  });

  it("deploy-finish ok marks deploy done and interact active", () => {
    const built = PgFlow.reduce(INITIAL_FLOW_STATE, {
      type: "build-finish",
      failed: false,
      errorCount: 0,
      ms: 1,
    });
    const s = PgFlow.reduce(built, { type: "deploy-finish", ok: true });
    expect(s.deploy).toBe("done");
    expect(s.interact).toBe("active");
    expect(s.stage).toBe("deploy");
  });

  it("set-stage only changes the route", () => {
    const s = PgFlow.reduce(INITIAL_FLOW_STATE, {
      type: "set-stage",
      stage: "interact",
    });
    expect(s.stage).toBe("interact");
    expect(s.build).toBe("upcoming");
  });

  it("workspace-change resets to the initial state", () => {
    const built = PgFlow.reduce(INITIAL_FLOW_STATE, {
      type: "build-start",
      at: 1000,
    });
    expect(PgFlow.reduce(built, { type: "workspace-change" })).toEqual(
      INITIAL_FLOW_STATE
    );
  });
});

describe("countErrors", () => {
  it("counts real diagnostics, not the summary lines", async () => {
    // The factory's identity function: `mockReset` (see `vitest.config.ts`)
    // restores it before each test anyway; restated so the test reads alone.
    const { stripKnownNoise } = await mockedBuildOutput();
    vi.mocked(stripKnownNoise).mockImplementation((s: string) => s);

    const stderr = `error[E0308]: mismatched types
  --> src/lib.rs:12:18
   |
12 |         let x: u64 = "1";
   |                ---   ^^^ expected \`u64\`, found \`&str\`

error: aborting due to previous error

error: could not compile \`hello\` due to previous error`;
    expect(countErrors(stderr)).toBe(1);
  });
});

describe("PgFlow.init wiring", () => {
  // Every subscription `init` makes has to hand back a disposable, whatever
  // an earlier test set its mock to. These tests are about the build and
  // deploy events, so the restore subscription just needs to not throw.
  beforeEach(async () => {
    const { PgProgramInfo } = await import("../../../utils");
    vi.mocked(PgProgramInfo.onDidChangeOnChain).mockReturnValue({
      dispose: vi.fn(),
    });
  });

  it("deploy-finish detects success and failure via result shape", async () => {
    const { PgCommand, PgExplorer, PgGlobal } = await import("../../../utils");
    PgGlobal.deployState = "ready";
    let deployCallback:
      | Parameters<typeof PgCommand.deploy.onDidFinish>[0]
      | undefined;

    // Store and verify all mocks return disposables
    const buildStartMock = vi.mocked(PgCommand.build.onDidStart);
    const buildStartReturn = { dispose: vi.fn() };
    buildStartMock.mockReturnValueOnce(buildStartReturn);

    const buildFinishMock = vi.mocked(PgCommand.build.onDidFinish);
    const buildFinishReturn = { dispose: vi.fn() };
    buildFinishMock.mockReturnValueOnce(buildFinishReturn);

    const buildOutputMock = (await mockedBuildOutput()).PgBuildOutput
      .onDidChange;
    const buildOutputReturn = { dispose: vi.fn() };
    buildOutputMock.mockReturnValueOnce(buildOutputReturn);

    const deployStartMock = vi.mocked(PgCommand.deploy.onDidStart);
    const deployStartReturn = { dispose: vi.fn() };
    deployStartMock.mockReturnValueOnce(deployStartReturn);

    const deployFinishMock = vi.mocked(PgCommand.deploy.onDidFinish);
    const deployFinishReturn = { dispose: vi.fn() };
    deployFinishMock.mockImplementation((cb) => {
      deployCallback = cb;
      return deployFinishReturn;
    });

    const workspaceChangeMock = vi.mocked(PgExplorer.onDidSwitchWorkspace);
    const workspaceChangeReturn = { dispose: vi.fn() };
    workspaceChangeMock.mockReturnValueOnce(workspaceChangeReturn);

    const sub = PgFlow.init();

    // Verify the callback was captured
    expect(deployCallback).toBeDefined();

    // Test error case
    deployCallback!({ err: new Error("deploy failed") });
    expect(PgFlow.state.deploy).toBe("failed");
    expect(PgFlow.state.stage).toBe("deploy");

    // Test success case
    deployCallback!({ ok: undefined });
    expect(PgFlow.state.deploy).toBe("done");
    expect(PgFlow.state.interact).toBe("active");
    expect(PgFlow.state.stage).toBe("deploy");

    // Clean up
    sub.dispose();
  });

  it("ignores a deploy-finish caused only by a pause or resume click", async () => {
    const { PgCommand, PgExplorer, PgGlobal } = await import("../../../utils");
    let deployStartCallback:
      | Parameters<typeof PgCommand.deploy.onDidStart>[0]
      | undefined;
    let deployFinishCallback:
      | Parameters<typeof PgCommand.deploy.onDidFinish>[0]
      | undefined;

    vi.mocked(PgCommand.build.onDidStart).mockReturnValueOnce({
      dispose: vi.fn(),
    });
    vi.mocked(PgCommand.build.onDidFinish).mockReturnValueOnce({
      dispose: vi.fn(),
    });
    (await mockedBuildOutput()).PgBuildOutput.onDidChange.mockReturnValueOnce({
      dispose: vi.fn(),
    });
    vi.mocked(PgCommand.deploy.onDidStart).mockImplementation((cb) => {
      deployStartCallback = cb;
      return { dispose: vi.fn() };
    });
    vi.mocked(PgCommand.deploy.onDidFinish).mockImplementation((cb) => {
      deployFinishCallback = cb;
      return { dispose: vi.fn() };
    });
    vi.mocked(PgExplorer.onDidSwitchWorkspace).mockReturnValueOnce({
      dispose: vi.fn(),
    });

    const sub = PgFlow.init();

    deployStartCallback!(null);
    expect(PgFlow.state.deploy).toBe("running");

    // A second click while loading flips `deployState` to "paused" and
    // resolves with `ok: undefined` -- not a real completion.
    PgGlobal.deployState = "paused";
    deployFinishCallback!({ ok: undefined });
    expect(PgFlow.state.deploy).toBe("running");

    // Clicking again to resume flips it to "loading" and also resolves
    // immediately -- still not a real completion.
    PgGlobal.deployState = "loading";
    deployFinishCallback!({ ok: undefined });
    expect(PgFlow.state.deploy).toBe("running");

    // The deploy command itself always settles back to "ready" before its
    // own real finish event fires, success or failure.
    PgGlobal.deployState = "ready";
    deployFinishCallback!({ ok: undefined });
    expect(PgFlow.state.deploy).toBe("done");

    sub.dispose();
  });

  it("fails the build when it never reaches the compiler", async () => {
    const { PgCommand, PgExplorer, PgGlobal } = await import("../../../utils");
    PgGlobal.deployState = "ready";
    const buildOutputModule = await mockedBuildOutput();
    buildOutputModule.PgBuildOutput.latest = null;

    let buildStartCallback:
      | Parameters<typeof PgCommand.build.onDidStart>[0]
      | undefined;
    let buildFinishCallback:
      | Parameters<typeof PgCommand.build.onDidFinish>[0]
      | undefined;

    vi.mocked(PgCommand.build.onDidStart).mockImplementation((cb) => {
      buildStartCallback = cb;
      return { dispose: vi.fn() };
    });
    vi.mocked(PgCommand.build.onDidFinish).mockImplementation((cb) => {
      buildFinishCallback = cb;
      return { dispose: vi.fn() };
    });
    vi.mocked(buildOutputModule.PgBuildOutput.onDidChange).mockReturnValueOnce({
      dispose: vi.fn(),
    });
    vi.mocked(PgCommand.deploy.onDidStart).mockReturnValueOnce({
      dispose: vi.fn(),
    });
    vi.mocked(PgCommand.deploy.onDidFinish).mockReturnValueOnce({
      dispose: vi.fn(),
    });
    vi.mocked(PgExplorer.onDidSwitchWorkspace).mockReturnValueOnce({
      dispose: vi.fn(),
    });

    const sub = PgFlow.init();

    buildStartCallback!(null);
    expect(PgFlow.state.build).toBe("running");

    // The build server was unreachable: the `build` command rejects and
    // `PgBuildOutput` never received a value for this run.
    buildFinishCallback!({ err: new Error("Failed to fetch") });
    expect(PgFlow.state.build).toBe("failed");
    expect(PgFlow.state.buildErrorCount).toBe(0);

    sub.dispose();
  });

  it("ignores build.onDidFinish's err when real output already arrived", async () => {
    const { PgCommand, PgExplorer, PgGlobal } = await import("../../../utils");
    PgGlobal.deployState = "ready";
    const buildOutputModule = await mockedBuildOutput();

    let buildStartCallback:
      | Parameters<typeof PgCommand.build.onDidStart>[0]
      | undefined;
    let buildFinishCallback:
      | Parameters<typeof PgCommand.build.onDidFinish>[0]
      | undefined;

    vi.mocked(PgCommand.build.onDidStart).mockImplementation((cb) => {
      buildStartCallback = cb;
      return { dispose: vi.fn() };
    });
    vi.mocked(PgCommand.build.onDidFinish).mockImplementation((cb) => {
      buildFinishCallback = cb;
      return { dispose: vi.fn() };
    });
    vi.mocked(buildOutputModule.PgBuildOutput.onDidChange).mockReturnValueOnce({
      dispose: vi.fn(),
    });
    vi.mocked(PgCommand.deploy.onDidStart).mockReturnValueOnce({
      dispose: vi.fn(),
    });
    vi.mocked(PgCommand.deploy.onDidFinish).mockReturnValueOnce({
      dispose: vi.fn(),
    });
    vi.mocked(PgExplorer.onDidSwitchWorkspace).mockReturnValueOnce({
      dispose: vi.fn(),
    });

    const sub = PgFlow.init();

    buildStartCallback!(null);
    // The real build output for this run already arrived and was handled.
    buildOutputModule.PgBuildOutput.latest = {
      stderr: "error: could not compile `hello`",
      failed: true,
      at: Date.now() + 1000,
    };

    buildFinishCallback!({ err: new Error("build command threw") });
    // Still "running" -- the onDidFinish handler declined to dispatch a
    // second, redundant `build-finish` on top of the real one.
    expect(PgFlow.state.build).toBe("running");

    buildOutputModule.PgBuildOutput.latest = null;
    sub.dispose();
  });
});

describe("PgFlow.reduce, restoring a workspace after a reload", () => {
  it("marks build done when the workspace's last build succeeded", () => {
    const s = PgFlow.reduce(INITIAL_FLOW_STATE, {
      type: "restore",
      built: false,
      deployed: false,
    });
    expect(s.build).toBe("done");
  });

  /**
   * `build-finish` points at Deploy as the next step. A restored build has to
   * do the same, or a reload leaves the learner with a finished Build and
   * nothing saying where to go -- which is the reported bug one stage earlier.
   */
  it("points at Deploy as the next step, the way finishing a build does", () => {
    const s = PgFlow.reduce(INITIAL_FLOW_STATE, {
      type: "restore",
      built: false,
      deployed: false,
    });
    expect(s.deploy).toBe("active");
  });

  it("leaves Deploy alone when the recorded build failed", () => {
    const s = PgFlow.reduce(INITIAL_FLOW_STATE, {
      type: "restore",
      built: true,
      deployed: false,
    });
    expect(s.deploy).toBe("upcoming");
  });

  it("marks build failed when the workspace's last build failed", () => {
    const s = PgFlow.reduce(INITIAL_FLOW_STATE, {
      type: "restore",
      built: true,
      deployed: false,
    });
    expect(s.build).toBe("failed");
  });

  it("leaves build alone when the workspace has never been built", () => {
    const s = PgFlow.reduce(INITIAL_FLOW_STATE, {
      type: "restore",
      built: null,
      deployed: false,
    });
    expect(s.build).toBe("upcoming");
  });

  it("offers Interact for a program that is already on-chain", () => {
    const s = PgFlow.reduce(INITIAL_FLOW_STATE, {
      type: "restore",
      built: false,
      deployed: true,
    });
    expect(s.deploy).toBe("done");
    expect(s.interact).toBe("active");
  });

  /**
   * `buildSettled` picks the Build surface. Left at `upcoming` by a restore,
   * the stepper would read "built" while the surface still offered a first
   * build.
   */
  it("settles the build surface too, not just the stepper", () => {
    const s = PgFlow.reduce(INITIAL_FLOW_STATE, {
      type: "restore",
      built: false,
      deployed: false,
    });
    expect(s.buildSettled).toBe("done");
  });

  it("does not overwrite a build that is running right now", () => {
    const running = PgFlow.reduce(INITIAL_FLOW_STATE, {
      type: "build-start",
      at: 1000,
    });
    // The workspace's persisted verdict belongs to the *previous* build.
    const s = PgFlow.reduce(running, {
      type: "restore",
      built: false,
      deployed: false,
    });
    expect(s.build).toBe("running");
  });
});

describe("PgFlow.init, seeding a reloaded page", () => {
  /** Wire every subscription `init` makes, handing back the two callbacks
   * this suite drives. Each mock returns its own disposable. */
  const initWithCapturedCallbacks = async () => {
    const { PgCommand, PgExplorer, PgProgramInfo } = await import(
      "../../../utils"
    );
    const buildOutputModule = await mockedBuildOutput();
    let workspaceChange: (() => void) | undefined;
    let onChainChange: (() => void) | undefined;

    vi.mocked(PgCommand.build.onDidStart).mockReturnValue({
      dispose: vi.fn(),
    });
    vi.mocked(PgCommand.build.onDidFinish).mockReturnValue({
      dispose: vi.fn(),
    });
    vi.mocked(buildOutputModule.PgBuildOutput.onDidChange).mockReturnValue({
      dispose: vi.fn(),
    });
    vi.mocked(PgCommand.deploy.onDidStart).mockReturnValue({
      dispose: vi.fn(),
    });
    vi.mocked(PgCommand.deploy.onDidFinish).mockReturnValue({
      dispose: vi.fn(),
    });
    vi.mocked(PgExplorer.onDidSwitchWorkspace).mockImplementation((cb) => {
      workspaceChange = cb;
      return { dispose: vi.fn() };
    });
    vi.mocked(PgProgramInfo.onDidChangeOnChain).mockImplementation((cb) => {
      onChainChange = () => cb(PgProgramInfo.onChain);
      return { dispose: vi.fn() };
    });

    const sub = PgFlow.init();
    return {
      sub,
      reset: () => workspaceChange!(),
      onChainArrived: () => onChainChange!(),
    };
  };

  it("reads Deploy and Interact back from the on-chain program", async () => {
    // `onChain` is a getter on the real class, a plain field on the mock
    const { PgProgramInfo } = (await import("../../../utils")) as unknown as {
      PgProgramInfo: {
        lastBuildFailed: boolean | null;
        onChain: { deployed: boolean } | null;
      };
    };
    const wiring = await initWithCapturedCallbacks();
    wiring.reset();

    // The workspace built cleanly and its program is live on the cluster.
    PgProgramInfo.lastBuildFailed = false;
    PgProgramInfo.onChain = { deployed: true };
    wiring.onChainArrived();

    expect(PgFlow.state.build).toBe("done");
    expect(PgFlow.state.deploy).toBe("done");
    expect(PgFlow.state.interact).toBe("active");

    PgProgramInfo.lastBuildFailed = null;
    PgProgramInfo.onChain = null;
    wiring.sub.dispose();
  });
});
