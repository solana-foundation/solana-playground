// Only a type import: pulling in the real "../state/stage" module (even
// just for its `INITIAL_FLOW_STATE` constant) drags in `../../../utils`
// and, through it, generated globals (`GLOBAL_SETTINGS`) that only exist
// once the app has actually booted -- outside that, in a plain unit test,
// the import throws. `stage.test.ts` sidesteps the same problem by mocking
// "../../../utils" wholesale; this file avoids the runtime import instead
// and inlines the couple of default field values it needs.
import type { FlowState } from "../state/stage";

interface MockBuildOutput {
  PgBuildOutput: { latest: { stderr: string } | null };
}

vi.mock("../../sidebar/assistant/bridge/build-output", () => ({
  PgBuildOutput: { latest: null },
  // A plain passthrough rather than a mock: nothing asserts on its calls.
  stripKnownNoise: (s: string) => s,
}));

import * as buildOutputModule from "../../sidebar/assistant/bridge/build-output";
import { describeConsoleStatus, runToStop } from "./status";

// The mocked module, typed as what the factory above returns
const buildOutput = buildOutputModule as unknown as MockBuildOutput;

const DEFAULT_STATE: FlowState = {
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
  hasProgram: true,
};

const state = (overrides: Partial<FlowState>): FlowState => ({
  ...DEFAULT_STATE,
  ...overrides,
});

describe("describeConsoleStatus", () => {
  beforeEach(() => {
    buildOutput.PgBuildOutput.latest = null;
  });

  it("is blank before the first build", () => {
    expect(describeConsoleStatus(state({}))).toEqual({
      text: "",
      tone: "idle",
    });
  });

  it("shows building while a build runs", () => {
    expect(describeConsoleStatus(state({ build: "running" }))).toEqual({
      text: "Building…",
      tone: "running",
    });
  });

  // Spec 13: the strip counts the run's seconds
  it("adds the seconds a run has taken", () => {
    expect(describeConsoleStatus(state({ build: "running" }), 12_400)).toEqual({
      text: "Building… \u00b7 12 s",
      tone: "running",
    });
    expect(
      describeConsoleStatus(state({ build: "done", deploy: "running" }), 4_000)
    ).toEqual({ text: "Deploying… \u00b7 4 s", tone: "running" });
  });

  it("counts no seconds once the run is over", () => {
    expect(
      describeConsoleStatus(state({ build: "done", buildMs: 3400 }), 9_000)
    ).toEqual({ text: "Built in 3.4 s", tone: "success" });
  });

  it("shows deploying while a deploy runs, after a build succeeded", () => {
    expect(
      describeConsoleStatus(state({ build: "done", deploy: "running" }))
    ).toEqual({ text: "Deploying…", tone: "running" });
  });

  it("shows the last build's time and result once it finishes", () => {
    expect(
      describeConsoleStatus(state({ build: "done", buildMs: 3400 }))
    ).toEqual({ text: "Built in 3.4 s", tone: "success" });
  });

  it("falls back to no time when buildMs is unknown", () => {
    expect(
      describeConsoleStatus(state({ build: "done", buildMs: null }))
    ).toEqual({ text: "Built", tone: "success" });
  });

  it("shows the first diagnostic code on a failed build", () => {
    buildOutput.PgBuildOutput.latest = {
      stderr: "error[E0308]: mismatched types\n --> src/lib.rs:11:22",
    };
    expect(describeConsoleStatus(state({ build: "failed" }))).toEqual({
      text: "Build failed \u00b7 E0308",
      tone: "error",
    });
  });

  it("falls back to a bare 'Build failed' without a diagnostic code", () => {
    buildOutput.PgBuildOutput.latest = { stderr: "error: could not compile" };
    expect(describeConsoleStatus(state({ build: "failed" }))).toEqual({
      text: "Build failed",
      tone: "error",
    });
  });

  it("falls back to 'Build failed' with no build output yet", () => {
    expect(describeConsoleStatus(state({ build: "failed" }))).toEqual({
      text: "Build failed",
      tone: "error",
    });
  });

  it("prefers a deploy result over a stale build result", () => {
    expect(
      describeConsoleStatus(
        state({ build: "done", buildMs: 1000, deploy: "done" })
      )
    ).toEqual({ text: "Deployed", tone: "success" });

    expect(
      describeConsoleStatus(
        state({ build: "done", buildMs: 1000, deploy: "failed" })
      )
    ).toEqual({ text: "Deploy failed", tone: "error" });
  });
});

describe("a stopped run", () => {
  it("reads Build stopped, not the result before it", () => {
    expect(
      describeConsoleStatus(
        state({ build: "done", buildSettled: "done", stopped: "build" })
      )
    ).toEqual({ text: "Build stopped", tone: "idle" });
  });

  it("reads Deploy stopped, not the build under it", () => {
    expect(
      describeConsoleStatus(
        state({ build: "done", deploy: "active", stopped: "deploy" })
      )
    ).toEqual({ text: "Deploy stopped", tone: "idle" });
  });
});

describe("runToStop", () => {
  it("is nothing while nothing runs", () => {
    expect(runToStop(state({ build: "done", deploy: "done" }))).toBeNull();
  });

  it("is the build while one runs", () => {
    expect(runToStop(state({ build: "running" }))).toBe("build");
  });

  it("is the deploy while one runs", () => {
    expect(runToStop(state({ build: "done", deploy: "running" }))).toBe(
      "deploy"
    );
  });
});
