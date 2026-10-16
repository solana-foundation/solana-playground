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
import { describeConsoleStatus } from "./status";

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
      text: "building...",
      tone: "idle",
    });
  });

  it("shows deploying while a deploy runs, after a build succeeded", () => {
    expect(
      describeConsoleStatus(state({ build: "done", deploy: "running" }))
    ).toEqual({ text: "deploying...", tone: "idle" });
  });

  it("shows the last build's time and result once it finishes", () => {
    expect(
      describeConsoleStatus(state({ build: "done", buildMs: 3400 }))
    ).toEqual({ text: "last build \u00b7 3.4s \u00b7 ok", tone: "success" });
  });

  it("falls back to no time when buildMs is unknown", () => {
    expect(
      describeConsoleStatus(state({ build: "done", buildMs: null }))
    ).toEqual({ text: "last build \u00b7 ok", tone: "success" });
  });

  it("shows the first diagnostic code on a failed build", () => {
    buildOutput.PgBuildOutput.latest = {
      stderr: "error[E0308]: mismatched types\n --> src/lib.rs:11:22",
    };
    expect(describeConsoleStatus(state({ build: "failed" }))).toEqual({
      text: "build failed \u00b7 E0308",
      tone: "error",
    });
  });

  it("falls back to a bare 'build failed' without a diagnostic code", () => {
    buildOutput.PgBuildOutput.latest = { stderr: "error: could not compile" };
    expect(describeConsoleStatus(state({ build: "failed" }))).toEqual({
      text: "build failed",
      tone: "error",
    });
  });

  it("falls back to 'build failed' with no build output yet", () => {
    expect(describeConsoleStatus(state({ build: "failed" }))).toEqual({
      text: "build failed",
      tone: "error",
    });
  });

  it("prefers a deploy result over a stale build result", () => {
    expect(
      describeConsoleStatus(
        state({ build: "done", buildMs: 1000, deploy: "done" })
      )
    ).toEqual({ text: "deploy ok", tone: "success" });

    expect(
      describeConsoleStatus(
        state({ build: "done", buildMs: 1000, deploy: "failed" })
      )
    ).toEqual({ text: "deploy failed", tone: "error" });
  });
});
