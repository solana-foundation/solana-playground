/* eslint-disable layers/curry-order, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  execute: vi.fn<() => Promise<void>>(),
  latest: null as null | {
    stderr: string;
    failed: boolean;
    at: number;
    workspace: string | null;
  },
  workspace: "Hello Anchor" as string | undefined,
  idl: null as null | { instructions: { name: string }[] },
  source: undefined as string | undefined,
}));

vi.mock("@/utils", () => ({
  PgCommand: { build: { execute: h.execute } },
  PgExplorer: {
    get currentWorkspaceName() {
      return h.workspace;
    },
    convertToFullPath: (path: string) => `/ws/${path}`,
    getFileContent: (path: string) =>
      path === "/ws/src/lib.rs" ? h.source : undefined,
  },
  PgProgramInfo: {
    get idl() {
      return h.idl;
    },
  },
}));

// The real `stripKnownNoise`: `parseBuildReport` reads it too
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

let runBuild: typeof import("./build").runBuild;
/** The build server's real log of Hello Anchor's planned failure */
let PLANNED: string;
beforeAll(async () => {
  runBuild = (await import("./build")).runBuild;
  PLANNED = (await import("../build-logs.fixture")).PLANNED;
});

const FAILS_WITH = "could not find `__client_accounts_hello`";

/** The build command as the server answers it: the output lands, then it returns */
const answers = (stderr: string, failed: boolean) =>
  h.execute.mockImplementation(async () => {
    h.latest = { stderr, failed, at: Date.now(), workspace: "Hello Anchor" };
  });

const run = (failsWith?: string) => {
  const stages: unknown[] = [];
  const result = runBuild("build", { beatId: "s1.build", failsWith }, (s) =>
    stages.push(s)
  );
  return { stages, result };
};

beforeEach(() => {
  h.execute.mockReset();
  h.latest = null;
  h.workspace = "Hello Anchor";
  h.idl = null;
  h.source = undefined;
});

describe("features/tutorial-conversation/model/runners/build", () => {
  it("reports one Building stage and the IDL's instructions on a pass", async () => {
    answers("    Finished release [optimized] target(s) in 3.92s", false);
    h.idl = { instructions: [{ name: "hello" }] };
    const { stages, result } = run();
    expect(await result).toMatchObject({
      act: "build",
      ok: true,
      instructions: ["hello"],
    });
    expect(stages).toEqual([{ label: "Building", index: 1, count: 1 }]);
  });

  it("reads the learner's program for the instructions when the build returned no IDL", async () => {
    answers("    Finished release [optimized] target(s) in 3.92s", false);
    h.source =
      "#[program]\nmod p {\n    pub fn hi(_ctx: Context<Hello>) -> Result<()> { Ok(()) }\n}\n";
    expect(await run().result).toMatchObject({ instructions: ["hi"] });
    // No source either: none, so a goal naming one fails as `noInstruction`
    h.source = undefined;
    expect(await run().result).toMatchObject({ instructions: [] });
  });

  it("shows the error holding the step's line, not the first cause at line 9", async () => {
    answers(PLANNED, true);
    const r = await run(FAILS_WITH).result;
    expect(r).toMatchObject({
      act: "build",
      ok: false,
      reason: "compiler",
      error: { code: "E0432", file: "src/lib.rs", line: 5, column: 1 },
    });
    expect(r.ok === false && "log" in r && r.log).not.toMatch(/Stack offset/);
  });

  it.each([
    ["Chrome", "Failed to fetch"],
    ["Firefox", "NetworkError when attempting to fetch resource."],
    ["Safari", "Load failed"],
  ])(
    "calls a server that never answered unreachable, as %s says it",
    async (_browser, said) => {
      h.execute.mockRejectedValue(
        new Error(`Server request failed (https://api.solpg.io/build): ${said}`)
      );
      expect(await run().result).toMatchObject({
        ok: false,
        reason: "unreachable",
        error: null,
      });
    }
  );

  it("shows a server's refusal as a log with no line, not as unreachable", async () => {
    h.execute.mockRejectedValue(
      new Error(
        "Server request failed (https://api.solpg.io/build): Invalid path"
      )
    );
    expect(await run().result).toMatchObject({
      ok: false,
      reason: "compiler",
      error: null,
      log: "Server request failed (https://api.solpg.io/build): Invalid path",
    });
  });

  it("returns signed_out, not compiler, when the server asks for sign-in", async () => {
    h.execute.mockRejectedValue(
      Object.assign(new Error("Sign in with GitHub to build."), {
        reason: "signed-out",
      })
    );
    expect(await run().result).toMatchObject({
      ok: false,
      reason: "signed_out",
      error: null,
      log: "Sign in with GitHub to build.",
    });
  });

  it("never reads an output from before the press or from another workspace", async () => {
    h.latest = {
      stderr: PLANNED,
      failed: true,
      at: 1,
      workspace: "Hello Anchor",
    };
    h.execute.mockResolvedValue(undefined);
    expect(await run().result).toMatchObject({ reason: "unreachable" });

    h.execute.mockImplementation(async () => {
      h.latest = {
        stderr: PLANNED,
        failed: true,
        at: Date.now(),
        workspace: "Other",
      };
    });
    expect(await run().result).toMatchObject({ reason: "unreachable" });
  });
});
