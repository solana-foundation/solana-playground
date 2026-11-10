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
    airdrop: {
      onDidStart: vi.fn(() => ({ dispose: vi.fn() })),
      onDidEnd: vi.fn(() => ({ dispose: vi.fn() })),
    },
  },
  PgExplorer: {
    currentWorkspaceName: "proj",
    files: {},
    getCurrentSrcPath: vi.fn(() => "/proj/src/"),
    onDidSwitchWorkspace: vi.fn(() => ({ dispose: vi.fn() })),
    onDidInit: vi.fn(() => ({ dispose: vi.fn() })),
    onDidSaveFile: vi.fn(() => ({ dispose: vi.fn() })),
    onDidCreateItem: vi.fn(() => ({ dispose: vi.fn() })),
    onDidDeleteItem: vi.fn(() => ({ dispose: vi.fn() })),
    onDidRenameItem: vi.fn(() => ({ dispose: vi.fn() })),
    onDidReloadFiles: vi.fn(() => ({ dispose: vi.fn() })),
    isInitialized: true,
    getRelativePath: (path: string) => path.replace(/^\/ws\//, ""),
  },
  PgFramework: {
    hasProgram: vi.fn(() => true),
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

import { requireFor } from "../../../test-utils/require-for";
import { StoppedError } from "../../../utils/stopped";
import type { BuildOutput } from "../../sidebar/assistant/bridge/build-output";
import type { FlowEvent } from "./stage";
import {
  countErrors,
  INITIAL_FLOW_STATE,
  isSignInRefusal,
  PgFlow,
  programSourceIn,
  STAGES,
  stagesOf,
} from "./stage";

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
      buildStartedBefore: null,
      buildFailure: null,
      deployBeforeRun: null,
      stopped: null,
      airdrops: 0,
      hasProgram: true,
      sourceChanged: false,
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

  it("a build that settles clears the last one's failure", () => {
    const failed = PgFlow.reduce(INITIAL_FLOW_STATE, {
      type: "build-finish",
      failed: true,
      errorCount: 0,
      ms: 1,
      failure: { kind: "other", message: "Seahorse compile failed" },
    });
    expect(failed.buildFailure).toEqual({
      kind: "other",
      message: "Seahorse compile failed",
    });

    const s = PgFlow.reduce(failed, {
      type: "build-finish",
      failed: false,
      errorCount: 0,
      ms: 1,
    });
    expect(s.buildFailure).toBeNull();
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

  it("deploy-refused leaves a deployed program as it was, not failed", () => {
    const deployed = PgFlow.reduce(
      PgFlow.reduce(INITIAL_FLOW_STATE, {
        type: "deploy-start",
        from: "command",
      }),
      { type: "deploy-finish", ok: true, from: "command" }
    );
    const s = PgFlow.reduce(
      PgFlow.reduce(deployed, { type: "deploy-start", from: "command" }),
      {
        type: "deploy-refused",
      }
    );
    expect(s.deploy).toBe("done");
    expect(s.stopped).toBeNull();
  });

  it("deploy-finish ok marks deploy done and interact active", () => {
    const built = PgFlow.reduce(INITIAL_FLOW_STATE, {
      type: "build-finish",
      failed: false,
      errorCount: 0,
      ms: 1,
    });
    const s = PgFlow.reduce(built, {
      type: "deploy-finish",
      ok: true,
      from: "command",
    });
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

  it("workspace-change keeps the previous project's program answer", () => {
    const noProgram = PgFlow.reduce(INITIAL_FLOW_STATE, {
      type: "program",
      has: false,
    });
    const next = PgFlow.reduce(noProgram, { type: "workspace-change" });
    expect(next.hasProgram).toBe(false);
    expect(next.stage).toBe("write");
    expect(next.build).toBe("upcoming");
  });
});

describe("PgFlow.reduce, an airdrop", () => {
  it("marks the airdrop running from its start to its finish", () => {
    const running = PgFlow.reduce(INITIAL_FLOW_STATE, {
      type: "airdrop-start",
    });
    expect(running.airdrops).toBe(1);
    expect(PgFlow.reduce(running, { type: "airdrop-finish" }).airdrops).toBe(0);
  });

  it("stays running until the last of two overlapping airdrops finishes", () => {
    // The wallet's button and a typed `airdrop` each start a run of their own
    const start = { type: "airdrop-start" } as const;
    const two = PgFlow.reduce(PgFlow.reduce(INITIAL_FLOW_STATE, start), start);
    const one = PgFlow.reduce(two, { type: "airdrop-finish" });
    expect(one.airdrops).toBe(1);
    expect(PgFlow.reduce(one, { type: "airdrop-finish" }).airdrops).toBe(0);
  });

  it("never counts below none: a finish with no start changes nothing", () => {
    expect(PgFlow.reduce(INITIAL_FLOW_STATE, { type: "airdrop-finish" })).toBe(
      INITIAL_FLOW_STATE
    );
  });

  it("leaves the stages as they were", () => {
    const running = PgFlow.reduce(INITIAL_FLOW_STATE, {
      type: "airdrop-start",
    });
    expect(running.stage).toBe(INITIAL_FLOW_STATE.stage);
    expect(running.build).toBe(INITIAL_FLOW_STATE.build);
    expect(running.deploy).toBe(INITIAL_FLOW_STATE.deploy);
    expect(running.interact).toBe(INITIAL_FLOW_STATE.interact);
    expect(running.stopped).toBe(INITIAL_FLOW_STATE.stopped);
  });

  it("keeps running across a project switch: the wallet is not the project's", () => {
    const running = PgFlow.reduce(INITIAL_FLOW_STATE, {
      type: "airdrop-start",
    });
    expect(PgFlow.reduce(running, { type: "workspace-change" }).airdrops).toBe(
      1
    );
  });
});

// Spec 13: a stopped run shows no result; the stage goes back to where it was
describe("PgFlow.reduce, a stopped run", () => {
  const builtOnce = () =>
    PgFlow.reduce(
      PgFlow.reduce(INITIAL_FLOW_STATE, { type: "build-start", at: 1 }),
      {
        type: "build-finish",
        failed: false,
        errorCount: 0,
        ms: 3000,
      }
    );

  it("a stopped build goes back to the last settled build", () => {
    const rebuilding = PgFlow.reduce(builtOnce(), {
      type: "build-start",
      at: 9,
    });

    const s = PgFlow.reduce(rebuilding, { type: "build-stop" });

    expect(s.build).toBe("done");
    expect(s.buildMs).toBe(3000);
    expect(s.stopped).toBe("build");
  });

  // HOO-2422: a refusal to build for a signed-out user is not a failed build
  it("a build refused for sign-in goes back to the last settled build", () => {
    const rebuilding = PgFlow.reduce(builtOnce(), {
      type: "build-start",
      at: 9,
    });

    const s = PgFlow.reduce(rebuilding, {
      type: "build-finish",
      failed: true,
      errorCount: 0,
      ms: 40,
      failure: { kind: "signed-out", message: "Sign in with GitHub to build." },
    });

    expect(s.build).toBe("done");
    expect(s.buildSettled).toBe("done");
    expect(s.buildMs).toBe(3000);
    expect(s.buildFailure).toEqual({
      kind: "signed-out",
      message: "Sign in with GitHub to build.",
    });
  });

  const refusedOnce = () =>
    PgFlow.reduce(PgFlow.reduce(builtOnce(), { type: "build-start", at: 9 }), {
      type: "build-finish",
      failed: true,
      errorCount: 0,
      ms: 40,
      failure: { kind: "signed-out", message: "Sign in with GitHub to build." },
    });

  it("a new build drops the sign-in refusal", () => {
    const s = PgFlow.reduce(refusedOnce(), { type: "build-start", at: 20 });

    expect(s.buildFailure).toBeNull();
    expect(isSignInRefusal(s.buildFailure)).toBe(false);
  });

  it("signing in drops the sign-in refusal", () => {
    const s = PgFlow.reduce(refusedOnce(), { type: "signed-in" });

    expect(s.buildFailure).toBeNull();
    expect(s.build).toBe("done");
  });

  it("signing in leaves any other failure alone", () => {
    const failed = PgFlow.reduce(INITIAL_FLOW_STATE, {
      type: "build-finish",
      failed: true,
      errorCount: 0,
      ms: 1,
      failure: { kind: "no-answer", message: "Failed to fetch" },
    });

    expect(PgFlow.reduce(failed, { type: "signed-in" })).toBe(failed);
  });

  it("a deploy whose build was refused for sign-in did not fail", () => {
    const deploying = PgFlow.reduce(
      PgFlow.reduce(builtOnce(), {
        type: "deploy-start",
        from: "command",
      }),
      {
        type: "build-finish",
        failed: true,
        errorCount: 0,
        ms: 40,
        failure: {
          kind: "signed-out",
          message: "Sign in with GitHub to build.",
        },
      }
    );

    const s = PgFlow.reduce(deploying, {
      type: "deploy-finish",
      ok: false,
      from: "command",
      refusal: { kind: "signed-out", message: "Sign in with GitHub to build." },
    });

    expect(s.deploy).toBe("active");
    expect(s.stage).toBe("build");
    expect(isSignInRefusal(s.buildFailure)).toBe(true);
  });

  it("a deploy refused with no build before it puts the sign-in on Build", () => {
    const deploying = PgFlow.reduce(builtOnce(), {
      type: "deploy-start",
      from: "command",
    });

    const s = PgFlow.reduce(deploying, {
      type: "deploy-finish",
      ok: false,
      from: "command",
      refusal: { kind: "signed-out", message: "Sign in with GitHub to build." },
    });

    expect(s.stage).toBe("build");
    expect(s.build).toBe("done");
    expect(s.buildFailure).toEqual({
      kind: "signed-out",
      message: "Sign in with GitHub to build.",
    });
  });

  it("a stopped first build goes back to upcoming", () => {
    const building = PgFlow.reduce(INITIAL_FLOW_STATE, {
      type: "build-start",
      at: 1,
    });

    const s = PgFlow.reduce(building, { type: "build-stop" });

    expect(s.build).toBe("upcoming");
    expect(s.buildFailure).toBeNull();
  });

  it("a stopped deploy goes back to what Deploy showed before it", () => {
    const deploying = PgFlow.reduce(builtOnce(), {
      type: "deploy-start",
      from: "command",
    });
    expect(deploying.deploy).toBe("running");

    const s = PgFlow.reduce(deploying, { type: "deploy-stop" });

    expect(s.deploy).toBe("active");
    expect(s.interact).toBe("upcoming");
    expect(s.stopped).toBe("deploy");
  });

  it("a tutorial's deploy leaves the stage where it is, however it ends", () => {
    const writing = PgFlow.reduce(builtOnce(), {
      type: "set-stage",
      stage: "write",
    });
    const deploying = PgFlow.reduce(writing, {
      type: "deploy-start",
      from: "tutorial",
    });
    expect(deploying.stage).toBe("write");
    expect(deploying.deploy).toBe("running");

    for (const ok of [true, false]) {
      const s = PgFlow.reduce(deploying, {
        type: "deploy-finish",
        ok,
        from: "tutorial",
      });
      expect(s.stage).toBe("write");
      expect(s.deploy).toBe(ok ? "done" : "failed");
    }
  });

  it("a stop during a tutorial's deploy goes back to what Deploy showed", () => {
    const deploying = PgFlow.reduce(builtOnce(), {
      type: "deploy-start",
      from: "tutorial",
    });

    const s = PgFlow.reduce(deploying, { type: "deploy-stop" });

    expect(s.deploy).toBe("active");
    expect(s.stopped).toBe("deploy");
  });

  it("a second Deploy click keeps what Deploy showed before the run", () => {
    const deploying = PgFlow.reduce(builtOnce(), {
      type: "deploy-start",
      from: "command",
    });
    const pausedClick = PgFlow.reduce(deploying, {
      type: "deploy-start",
      from: "command",
    });

    const s = PgFlow.reduce(pausedClick, { type: "deploy-stop" });

    expect(s.deploy).toBe("active");
  });

  it("a stopped retry keeps the failed build it retried", () => {
    const failed = PgFlow.reduce(INITIAL_FLOW_STATE, {
      type: "build-finish",
      failed: true,
      errorCount: 2,
      ms: 5,
    });
    const retrying = PgFlow.reduce(failed, { type: "build-start", at: 9 });

    const s = PgFlow.reduce(retrying, { type: "build-stop" });

    expect(s.build).toBe("failed");
    expect(s.buildErrorCount).toBe(2);
  });

  it("a stopped retry keeps the start of the build it retried", () => {
    const started = PgFlow.reduce(INITIAL_FLOW_STATE, {
      type: "build-start",
      at: 3,
    });
    const failed = PgFlow.reduce(started, {
      type: "build-finish",
      failed: true,
      errorCount: 2,
      ms: 5,
    });
    const retrying = PgFlow.reduce(failed, { type: "build-start", at: 9 });

    const s = PgFlow.reduce(retrying, { type: "build-stop" });

    // The Build surface reads the failed run's report as current, not stale
    expect(s.buildStartedAt).toBe(3);
  });

  it("a stop of the build a deploy runs first reads as the build's", () => {
    const deploying = PgFlow.reduce(builtOnce(), {
      type: "deploy-start",
      from: "command",
    });
    const building = PgFlow.reduce(deploying, { type: "build-start", at: 9 });
    const buildStopped = PgFlow.reduce(building, { type: "build-stop" });

    const s = PgFlow.reduce(buildStopped, { type: "deploy-stop" });

    expect(s.stopped).toBe("build");
    expect(s.deploy).toBe("active");
    expect(s.build).toBe("done");
  });

  it("ignores a stop when nothing of its kind runs", () => {
    const done = builtOnce();

    expect(PgFlow.reduce(done, { type: "build-stop" })).toBe(done);
    expect(PgFlow.reduce(done, { type: "deploy-stop" })).toBe(done);
  });

  it("the next run clears the stop", () => {
    const stopped = PgFlow.reduce(
      PgFlow.reduce(builtOnce(), { type: "build-start", at: 9 }),
      { type: "build-stop" }
    );

    expect(
      PgFlow.reduce(stopped, { type: "build-start", at: 10 }).stopped
    ).toBeNull();
    expect(
      PgFlow.reduce(stopped, { type: "deploy-start", from: "command" }).stopped
    ).toBeNull();
  });
});

describe("countErrors", () => {
  it("counts real diagnostics, not the summary lines", async () => {
    const stderr = `error[E0308]: mismatched types
  --> src/lib.rs:12:18
   |
12 |         let x: u64 = "1";
   |                ---   ^^^ expected \`u64\`, found \`&str\`

error: aborting due to previous error

error: could not compile \`hello\` due to previous error`;
    expect(countErrors(stderr)).toBe(1);
  });

  it.each([
    ["an error with a code", "error[E0308]: mismatched types", 1],
    ["an error without one", "error: unresolved import `foo`", 1],
    ["the summary alone", "error: could not compile `hello`", 0],
  ])("counts %s", (_, stderr, count) => {
    expect(countErrors(stderr)).toBe(count);
  });
});

describe("PgFlow.init wiring", () => {
  it("follows the airdrop command from its start to its end", async () => {
    const { PgCommand } = await import("../../../utils");
    const listen = (mock: Mock) => {
      const box: { cb?: () => void } = {};
      mock.mockImplementationOnce((cb: () => void) => {
        box.cb = cb;
        return { dispose: vi.fn() };
      });
      return box;
    };
    const start = listen(vi.mocked(PgCommand.airdrop.onDidStart));
    // `onDidEnd`, which a run that printed only its help sends too
    const finish = listen(vi.mocked(PgCommand.airdrop.onDidEnd));

    const sub = PgFlow.init();
    requireFor("the airdrop start listener PgFlow.init subscribed")(start.cb)();
    expect(PgFlow.state.airdrops).toBe(1);
    requireFor("the airdrop end listener PgFlow.init subscribed")(finish.cb)();
    expect(PgFlow.state.airdrops).toBe(0);
    sub.dispose();
  });

  it("maps a stopped build or deploy to a stop, not a failure", async () => {
    const { PgCommand, PgExplorer, PgGlobal } = await import("../../../utils");
    PgGlobal.deployState = "ready";
    const buildOutputModule = await mockedBuildOutput();
    buildOutputModule.PgBuildOutput.latest = null;
    const capture = <T>(mock: Mock) => {
      const box: { cb?: T } = {};
      mock.mockImplementationOnce((cb: T) => {
        box.cb = cb;
        return { dispose: vi.fn() };
      });
      return box;
    };
    const buildStart = capture<(input: null) => void>(
      vi.mocked(PgCommand.build.onDidStart)
    );
    vi.mocked(buildOutputModule.PgBuildOutput.onDidChange).mockReturnValueOnce({
      dispose: vi.fn(),
    });
    const buildFinish = capture<(r: { err: unknown }) => void>(
      vi.mocked(PgCommand.build.onDidFinish)
    );
    const deployStart = capture<(input: null) => void>(
      vi.mocked(PgCommand.deploy.onDidStart)
    );
    const deployFinish = capture<(r: { err: unknown }) => void>(
      vi.mocked(PgCommand.deploy.onDidFinish)
    );
    vi.mocked(PgExplorer.onDidSwitchWorkspace).mockReturnValueOnce({
      dispose: vi.fn(),
    });

    const sub = PgFlow.init();

    requireFor("the build start listener PgFlow.init subscribed")(
      buildStart.cb
    )(null);
    requireFor("the build finish listener PgFlow.init subscribed")(
      buildFinish.cb
    )({
      err: new StoppedError("Stopped."),
    });
    expect(PgFlow.state.build).toBe(PgFlow.state.buildSettled);
    expect(PgFlow.state.stopped).toBe("build");

    requireFor("the deploy start listener PgFlow.init subscribed")(
      deployStart.cb
    )(null);
    requireFor("the deploy finish listener PgFlow.init subscribed")(
      deployFinish.cb
    )({
      err: new StoppedError("Stopped."),
    });
    expect(PgFlow.state.deploy).toBe(PgFlow.state.deployBeforeRun);
    expect(PgFlow.state.stopped).toBe("deploy");

    sub.dispose();
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
    requireFor("the deploy listener")(deployCallback)({
      err: new Error("deploy failed"),
    });
    expect(PgFlow.state.deploy).toBe("failed");
    expect(PgFlow.state.stage).toBe("deploy");

    // Test success case
    requireFor("the deploy listener")(deployCallback)({ ok: undefined });
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

    requireFor("the deploy start listener")(deployStartCallback)(null);
    expect(PgFlow.state.deploy).toBe("running");

    // A second click while loading flips `deployState` to "paused" and
    // resolves with `ok: undefined` -- not a real completion.
    PgGlobal.deployState = "paused";
    requireFor("the deploy finish listener")(deployFinishCallback)({
      ok: undefined,
    });
    expect(PgFlow.state.deploy).toBe("running");

    // Clicking again to resume flips it to "loading" and also resolves
    // immediately -- still not a real completion.
    PgGlobal.deployState = "loading";
    requireFor("the deploy finish listener")(deployFinishCallback)({
      ok: undefined,
    });
    expect(PgFlow.state.deploy).toBe("running");

    // The deploy command itself always settles back to "ready" before its
    // own real finish event fires, success or failure.
    PgGlobal.deployState = "ready";
    requireFor("the deploy finish listener")(deployFinishCallback)({
      ok: undefined,
    });
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

    requireFor("the build start listener")(buildStartCallback)(null);
    expect(PgFlow.state.build).toBe("running");

    // The build server was unreachable: the `build` command rejects and
    // `PgBuildOutput` never received a value for this run.
    // As `PgServer` throws it for a server that never replied
    requireFor("the build finish listener")(buildFinishCallback)({
      err: Object.assign(new Error("Server request failed (x): boom"), {
        answered: false,
      }),
    });
    expect(PgFlow.state.build).toBe("failed");
    expect(PgFlow.state.buildErrorCount).toBe(0);
    // Kept for Build's surface and its "Show details"
    expect(PgFlow.state.buildFailure).toEqual({
      kind: "no-answer",
      message: "Server request failed (x): boom",
    });

    sub.dispose();
  });

  it("names an empty program file the build never sent (Spec 09)", async () => {
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

    requireFor("the build start listener")(buildStartCallback)(null);
    expect(PgFlow.state.build).toBe("running");

    // As the `build` command throws it before any request
    requireFor("the build finish listener")(buildFinishCallback)({
      err: Object.assign(new Error("lib.rs is empty."), {
        emptyFile: "src/lib.rs",
      }),
    });
    expect(PgFlow.state.build).toBe("failed");
    expect(PgFlow.state.buildErrorCount).toBe(0);
    expect(PgFlow.state.buildFailure).toEqual({
      kind: "empty-source",
      file: "src/lib.rs",
      message: "lib.rs is empty.",
    });

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

    requireFor("the build start listener")(buildStartCallback)(null);
    // The real build output for this run already arrived and was handled.
    buildOutputModule.PgBuildOutput.latest = {
      stderr: "error: could not compile `hello`",
      failed: true,
      at: Date.now() + 1000,
    };

    requireFor("the build finish listener")(buildFinishCallback)({
      err: new Error("build command threw"),
    });
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
      reset: () =>
        requireFor("the workspace change listener")(workspaceChange)(),
      onChainArrived: () =>
        requireFor("the on-chain change listener")(onChainChange)(),
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

describe("a project with no program", () => {
  const noProgram = () =>
    PgFlow.reduce(INITIAL_FLOW_STATE, { type: "program", has: false });

  it("starts out with a program, so nothing hides before the explorer answers", () => {
    expect(INITIAL_FLOW_STATE.hasProgram).toBe(true);
    expect(stagesOf(INITIAL_FLOW_STATE)).toEqual(STAGES);
  });

  it("shows only Write", () => {
    expect(stagesOf(noProgram())).toEqual(["write"]);
  });

  it("goes back to Write when the program goes away", () => {
    const onBuild = PgFlow.reduce(INITIAL_FLOW_STATE, {
      type: "set-stage",
      stage: "build",
    });
    const s = PgFlow.reduce(onBuild, { type: "program", has: false });
    expect(s.stage).toBe("write");
    expect(s.hasProgram).toBe(false);
  });

  it("ignores a move to a hidden stage", () => {
    const s = PgFlow.reduce(noProgram(), {
      type: "set-stage",
      stage: "deploy",
    });
    expect(s.stage).toBe("write");
  });

  it("stays on Write when a build or a deploy starts elsewhere", () => {
    const built = PgFlow.reduce(noProgram(), { type: "build-start", at: 1 });
    expect(built.stage).toBe("write");
    expect(built.build).toBe("running");
    const deployed = PgFlow.reduce(noProgram(), {
      type: "deploy-start",
      from: "command",
    });
    expect(deployed.stage).toBe("write");
  });

  it("brings the stages back with a program", () => {
    const s = PgFlow.reduce(noProgram(), { type: "program", has: true });
    expect(stagesOf(s)).toEqual(STAGES);
  });

  it("keeps a hidden stage hidden when a build or a deploy finishes", () => {
    const finishes: FlowEvent[] = [
      { type: "build-finish", failed: true, errorCount: 1, ms: 1 },
      { type: "deploy-finish", ok: true, from: "command" },
      { type: "deploy-finish", ok: false, from: "command" },
    ];
    for (const ev of finishes) {
      expect(PgFlow.reduce(noProgram(), ev).stage).toBe("write");
    }
  });

  it("hands back the same state when the answer did not change", () => {
    const s = noProgram();
    expect(PgFlow.reduce(s, { type: "program", has: false })).toBe(s);
  });
});

describe("PgFlow.init, reading whether the project has a program", () => {
  type Explorer = {
    files: Record<string, { content?: string }>;
    isInitialized: boolean;
    getRelativePath: (path: string) => string;
  } & Pick<
    typeof import("../../../utils").PgExplorer,
    | "onDidSwitchWorkspace"
    | "onDidInit"
    | "onDidCreateItem"
    | "onDidDeleteItem"
    | "onDidRenameItem"
  >;
  let explorer: Explorer;
  let hasProgram: ReturnType<typeof vi.fn>;
  let sub: { dispose: () => void };
  const fired: Record<string, () => unknown> = {};
  const EVENTS = [
    "onDidSwitchWorkspace",
    "onDidInit",
    "onDidCreateItem",
    "onDidDeleteItem",
    "onDidRenameItem",
  ] as const;

  beforeEach(async () => {
    const utils = (await import("../../../utils")) as unknown as {
      PgExplorer: Explorer;
      PgFramework: { hasProgram: ReturnType<typeof vi.fn> };
      PgProgramInfo: typeof import("../../../utils").PgProgramInfo;
    };
    explorer = utils.PgExplorer;
    hasProgram = utils.PgFramework.hasProgram;
    vi.mocked(utils.PgProgramInfo.onDidChangeOnChain).mockReturnValue({
      dispose: vi.fn(),
    });
    EVENTS.forEach((name) => {
      vi.mocked(explorer[name]).mockImplementation(((cb: () => unknown) => {
        fired[name] = cb;
        return { dispose: vi.fn() };
      }) as never);
    });
    explorer.files = {
      "/ws/client/": {},
      "/ws/client/a.ts": { content: "" },
    };
    hasProgram.mockReturnValue(false);
    sub = PgFlow.init();
  });

  afterEach(() => {
    // Leave the shared store as the next test expects it
    explorer.isInitialized = true;
    explorer.getRelativePath = (path) => path.replace(/^\/ws\//, "");
    hasProgram.mockReturnValue(true);
    fired.onDidSwitchWorkspace();
    explorer.files = {};
    sub.dispose();
  });

  it("reads the open project's files after a workspace switch", () => {
    fired.onDidSwitchWorkspace();

    expect(hasProgram).toHaveBeenLastCalledWith(["client/", "client/a.ts"]);
    expect(PgFlow.state.hasProgram).toBe(false);
  });

  // `@types/mocha` declares the global `it` without `each`
  [
    "onDidInit",
    "onDidCreateItem",
    "onDidDeleteItem",
    "onDidRenameItem",
  ].forEach((name) => {
    it(`reads them again on ${name}, both ways`, () => {
      fired[name]();
      expect(PgFlow.state.hasProgram).toBe(false);

      hasProgram.mockReturnValue(true);
      fired[name]();
      expect(PgFlow.state.hasProgram).toBe(true);
    });
  });

  it("waits for the explorer before reading", () => {
    hasProgram.mockClear();
    explorer.isInitialized = false;

    fired.onDidInit();

    expect(hasProgram).not.toHaveBeenCalled();
    expect(PgFlow.state.hasProgram).toBe(true);
  });

  it("keeps its answer when the files cannot be read", () => {
    fired.onDidInit();
    explorer.getRelativePath = () => {
      throw new Error("Current workspace not found");
    };
    hasProgram.mockReturnValue(true);

    expect(() => fired.onDidDeleteItem()).not.toThrow();
    expect(PgFlow.state.hasProgram).toBe(false);
  });
});

describe("PgFlow, a deploy run outside the deploy command", () => {
  it("reads running, then done or failed, as the command's own would", () => {
    PgFlow.deployStarted();
    expect(PgFlow.state.deploy).toBe("running");
    PgFlow.deployFinished(true);
    expect(PgFlow.state.deploy).toBe("done");
    PgFlow.deployStarted();
    PgFlow.deployFinished(false);
    expect(PgFlow.state.deploy).toBe("failed");
  });

  it("routes the command's deploy to the Deploy stage, as before", () => {
    const s = PgFlow.reduce(INITIAL_FLOW_STATE, {
      type: "deploy-start",
      from: "command",
    });
    expect(s.stage).toBe("deploy");
  });

  it("leaves the stage where it is: a tutorial's editor stays on screen", () => {
    PgFlow.setStage("write");
    PgFlow.deployStarted();
    expect(PgFlow.state.stage).toBe("write");
    PgFlow.deployFinished(true);
    expect(PgFlow.state.stage).toBe("write");
  });
});

describe("what a rejected command tells the flow (HOO-2422)", () => {
  /** `PgFlow.init` with the two finish listeners captured */
  const listen = async () => {
    const { PgCommand, PgGlobal } = await import("../../../utils");
    PgGlobal.deployState = "ready";
    // `PgBuildOutput.latest` stays null: the case that sets it puts it back
    let build: Parameters<typeof PgCommand.build.onDidFinish>[0] | undefined;
    let deploy: Parameters<typeof PgCommand.deploy.onDidFinish>[0] | undefined;
    vi.mocked(PgCommand.build.onDidFinish).mockImplementationOnce((cb) => {
      build = cb;
      return { dispose: vi.fn() };
    });
    vi.mocked(PgCommand.deploy.onDidFinish).mockImplementationOnce((cb) => {
      deploy = cb;
      return { dispose: vi.fn() };
    });
    const sub = PgFlow.init();
    return {
      sub,
      build: requireFor("the build finish listener")(build),
      deploy: requireFor("the deploy finish listener")(deploy),
    };
  };
  const refusal = () =>
    Object.assign(new Error("Sign in with GitHub to build."), {
      answered: true,
      reason: "signed-out",
    });

  it("reads the route's sign-in refusal of a build", async () => {
    const { sub, build } = await listen();

    build({ err: refusal() });

    expect(PgFlow.state.buildFailure).toEqual({
      kind: "signed-out",
      message: "Sign in with GitHub to build.",
    });
    sub.dispose();
  });

  it("keeps any other answered failure as other", async () => {
    const { sub, build } = await listen();

    build({ err: Object.assign(new Error("boom"), { answered: true }) });

    expect(PgFlow.state.buildFailure).toEqual({
      kind: "other",
      message: "boom",
    });
    sub.dispose();
  });

  it("carries a refused deploy's sign-in to Build", async () => {
    const { sub, deploy } = await listen();

    deploy({ err: refusal() });

    expect(PgFlow.state.stage).toBe("build");
    expect(isSignInRefusal(PgFlow.state.buildFailure)).toBe(true);
    sub.dispose();
  });
});

describe("programSourceIn", () => {
  const source = programSourceIn("/proj/src/");
  const LIB = { content: "fn a() {}" };

  it("holds the text of what a build sends, and nothing else", () => {
    const base = source({ "/proj/src/lib.rs": LIB });

    // A generated workspace file, a client script, an empty file, a folder
    expect(
      source({
        "/proj/src/lib.rs": LIB,
        "/proj/.workspace/program-info.json": { content: "{}" },
        "/proj/client/client.ts": { content: "x" },
        "/proj/src/empty.rs": { content: "" },
        "/proj/src/folder/": {},
      })
    ).toBe(base);
    expect(
      source({ "/proj/src/lib.rs": LIB, "/proj/src/more.rs": { content: "x" } })
    ).not.toBe(base);
  });

  // A build's start writes it into the open file, autosaved after the baseline
  it.each([
    ['declare_id!("1111")', 'declare_id!("9f3kQ")'],
    ["declare_id('1111')", "declare_id('9f3kQ')"],
  ])("does not hear the program id in %s", (before, after) => {
    expect(source({ "/proj/src/lib.rs": { content: `a\n${before}\nb` } })).toBe(
      source({ "/proj/src/lib.rs": { content: `a\n${after}\nb` } })
    );
  });

  it("hears an edit beside the program id", () => {
    expect(
      source({ "/proj/src/lib.rs": { content: 'declare_id!("1")\na' } })
    ).not.toBe(
      source({ "/proj/src/lib.rs": { content: 'declare_id!("1")\nb' } })
    );
  });

  it("does not hear a rename", () => {
    expect(source({ "/proj/src/a.rs": { content: "x" } })).toBe(
      source({ "/proj/src/b.rs": { content: "x" } })
    );
  });

  // Joined naively, ["ab", "c"] and ["a", "bc"] would read as the same source
  it("keeps files apart", () => {
    expect(
      source({
        "/proj/src/1": { content: "ab" },
        "/proj/src/2": { content: "c" },
      })
    ).not.toBe(
      source({
        "/proj/src/1": { content: "a" },
        "/proj/src/2": { content: "bc" },
      })
    );
  });
});

describe("PgFlow source tracking", () => {
  const LIB = "/proj/src/lib.rs";
  let workspaces = 0;

  const wire = async () => {
    const utils = await import("../../../utils");
    const { PgCommand } = utils;
    const PgExplorer = utils.PgExplorer as unknown as {
      currentWorkspaceName: string;
      files: Record<string, { content?: string }>;
      onDidSaveFile: Mock;
      onDidCreateItem: Mock;
      onDidDeleteItem: Mock;
      onDidRenameItem: Mock;
      onDidReloadFiles: Mock;
      onDidSwitchWorkspace: Mock;
    };
    const output = await mockedBuildOutput();
    const box = <T>(mock: Mock) => {
      const b: { cb?: T } = {};
      mock.mockImplementationOnce((cb: T) => {
        b.cb = cb;
        return { dispose: vi.fn() };
      });
      return b;
    };
    const start = box<() => void>(vi.mocked(PgCommand.build.onDidStart));
    const report = box<
      (o: { failed: boolean; at: number; stderr: string }) => void
    >(output.PgBuildOutput.onDidChange);
    const finish = box<(r: { err: unknown }) => void>(
      vi.mocked(PgCommand.build.onDidFinish)
    );
    const save = box<() => void>(PgExplorer.onDidSaveFile);
    const swap = box<() => void>(PgExplorer.onDidSwitchWorkspace);
    const treeEvents = {
      create: box<() => void>(PgExplorer.onDidCreateItem),
      delete: box<() => void>(PgExplorer.onDidDeleteItem),
      rename: box<() => void>(PgExplorer.onDidRenameItem),
      reload: box<() => void>(PgExplorer.onDidReloadFiles),
    };

    // The baseline is static, and follows its workspace by name
    PgExplorer.currentWorkspaceName = `proj-${++workspaces}`;
    PgExplorer.files = { [LIB]: { content: "v1" } };
    const sub = PgFlow.init();
    const need = requireFor("a listener PgFlow.init subscribed");
    // Back to the initial state: `PgFlow` is one store across these tests
    need(swap.cb)();
    return {
      PgExplorer,
      sub,
      buildStarts: () => need(start.cb)(),
      buildReports: () =>
        need(report.cb)({ failed: false, at: Date.now(), stderr: "" }),
      buildFails: () =>
        need(report.cb)({ failed: true, at: Date.now(), stderr: "" }),
      olderReportReplays: () =>
        need(report.cb)({ failed: false, at: 0, stderr: "" }),
      edit: (content: string) => {
        PgExplorer.files[LIB].content = content;
        need(save.cb)();
      },
      stop: () => need(finish.cb)({ err: new StoppedError("Stopped.") }),
      unreached: () => need(finish.cb)({ err: new Error("Failed to fetch") }),
      fire: (event: keyof typeof treeEvents) => need(treeEvents[event].cb)(),
      switchWorkspace: () => need(swap.cb)(),
    };
  };

  it("hears an edit after a successful build, and its undo", async () => {
    const w = await wire();
    w.buildStarts();
    w.buildReports();
    expect(PgFlow.state.sourceChanged).toBe(false);

    w.edit("v2");
    expect(PgFlow.state.sourceChanged).toBe(true);

    w.edit("v1");
    expect(PgFlow.state.sourceChanged).toBe(false);
    w.sub.dispose();
  });

  it("says nothing before any build", async () => {
    const w = await wire();
    w.edit("v2");
    expect(PgFlow.state.sourceChanged).toBe(false);
    w.sub.dispose();
  });

  // The build was given the text as it stood when it started
  it("counts an edit made during the build", async () => {
    const w = await wire();
    w.buildStarts();
    w.edit("v2");
    w.buildReports();
    expect(PgFlow.state.sourceChanged).toBe(true);
    w.sub.dispose();
  });

  it("settles on a rebuild", async () => {
    const w = await wire();
    w.buildStarts();
    w.buildReports();
    w.edit("v2");

    w.buildStarts();
    expect(PgFlow.state.sourceChanged).toBe(true);
    w.buildReports();
    expect(PgFlow.state.sourceChanged).toBe(false);
    w.sub.dispose();
  });

  // The binary on hand is still the old one
  it.each([
    ["failed", (w: Awaited<ReturnType<typeof wire>>) => w.buildFails()],
    ["stopped", (w: Awaited<ReturnType<typeof wire>>) => w.stop()],
    ["unreached", (w: Awaited<ReturnType<typeof wire>>) => w.unreached()],
  ])("keeps the last success's baseline through a %s build", async (_, end) => {
    const w = await wire();
    w.buildStarts();
    w.buildReports();
    w.edit("v2");

    w.buildStarts();
    end(w);
    expect(PgFlow.state.sourceChanged).toBe(true);
    w.edit("v1");
    expect(PgFlow.state.sourceChanged).toBe(false);
    w.sub.dispose();
  });

  // A remount subscribes again, with the report and the state still on screen
  it("keeps the baseline through a remount of the layout", async () => {
    const first = await wire();
    first.buildStarts();
    first.buildReports();
    first.edit("v2");
    const { currentWorkspaceName, files } = first.PgExplorer;
    first.sub.dispose();

    const second = await wire();
    second.PgExplorer.currentWorkspaceName = currentWorkspaceName;
    second.PgExplorer.files = files;
    second.fire("reload");
    expect(PgFlow.state.sourceChanged).toBe(true);
    second.sub.dispose();
  });

  // Subscribing mid-build replays the last run's report, not this run's
  it("keeps the baseline when a remount replays an older report", async () => {
    const w = await wire();
    w.buildStarts();
    w.buildReports();
    w.edit("v2");

    w.buildStarts();
    w.olderReportReplays();
    w.stop();
    expect(PgFlow.state.sourceChanged).toBe(true);
    w.sub.dispose();
  });

  // A replayed older report must not adopt a run that never reported
  it("does not take an unreached run's text from a later report", async () => {
    const w = await wire();
    w.buildStarts();
    w.buildReports();
    w.edit("v2");
    w.buildStarts();
    w.unreached();
    w.buildReports();
    expect(PgFlow.state.sourceChanged).toBe(true);
    w.sub.dispose();
  });

  it.each<{
    what: string;
    event: "create" | "reload";
    files: Record<string, { content?: string }>;
  }>([
    {
      what: "creating a file",
      event: "create",
      files: {
        [LIB]: { content: "v1" },
        "/proj/src/new.rs": { content: "x" },
      },
    },
    {
      what: "another tab's edit",
      event: "reload",
      files: { [LIB]: { content: "theirs" } },
    },
  ])("hears $what", async ({ event, files }) => {
    const w = await wire();
    w.buildStarts();
    w.buildReports();
    w.PgExplorer.files = files;
    w.fire(event);
    expect(PgFlow.state.sourceChanged).toBe(true);
    w.sub.dispose();
  });

  it("hears a deleted file", async () => {
    const w = await wire();
    w.buildStarts();
    w.buildReports();
    w.PgExplorer.files = {};
    w.fire("delete");
    expect(PgFlow.state.sourceChanged).toBe(true);
    w.sub.dispose();
  });

  it("does not hear a rename through its event", async () => {
    const w = await wire();
    w.buildStarts();
    w.buildReports();
    w.PgExplorer.files = { "/proj/src/renamed.rs": { content: "v1" } };
    w.fire("rename");
    expect(PgFlow.state.sourceChanged).toBe(false);
    w.sub.dispose();
  });

  // Sync re-opens the workspace after a merge, which resets the flow
  it("keeps hearing the change through a re-open of the same project", async () => {
    const w = await wire();
    w.buildStarts();
    w.buildReports();
    w.PgExplorer.files[LIB].content = "merged";
    w.switchWorkspace();
    expect(PgFlow.state.sourceChanged).toBe(true);
    w.sub.dispose();
  });

  // A temporary project's build is kept under no name, which is also the name
  // of no project at all: deleting the last saved one must not read a source
  it("reads no source once no project is open after a temporary project's build", async () => {
    const w = await wire();
    const explorer = w.PgExplorer as unknown as {
      currentWorkspaceName: string | undefined;
      isTemporary: boolean;
      getCurrentSrcPath: Mock;
    };
    explorer.currentWorkspaceName = undefined;
    explorer.isTemporary = true;
    w.buildStarts();
    w.buildReports();

    explorer.isTemporary = false;
    explorer.getCurrentSrcPath.mockImplementation(() => {
      throw new Error("Current workspace not found");
    });
    try {
      expect(() => w.fire("delete")).not.toThrow();
      expect(PgFlow.state.sourceChanged).toBe(false);
    } finally {
      explorer.getCurrentSrcPath.mockImplementation(() => "/proj/src/");
      w.sub.dispose();
    }
  });

  it("forgets the baseline in another project", async () => {
    const w = await wire();
    w.buildStarts();
    w.buildReports();
    w.PgExplorer.currentWorkspaceName = "other";
    w.PgExplorer.files = { "/other/src/lib.rs": { content: "else" } };
    w.switchWorkspace();
    expect(PgFlow.state.sourceChanged).toBe(false);
    w.sub.dispose();
  });
});
