// `@types/mocha` also declares a global `it`, without `each`
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";
import { RunBusyError } from "@/utils/js-runtime";

const runtime = vi.hoisted(() => ({ execute: vi.fn() }));
const files = vi.hoisted(
  () =>
    new Map<string, string>([
      ["/client/a.ts", "a"],
      ["/client/b.ts", "b"],
    ])
);

vi.mock("../../utils", () => ({
  PgCommon: {
    appendSlash: (path: string) => (path.endsWith("/") ? path : `${path}/`),
    joinPaths: (...parts: string[]) =>
      `/${parts.join("/")}`.replace(/\/+/g, "/"),
  },
  PgExplorer: {
    PATHS: { CLIENT_DIRNAME: "client", TESTS_DIRNAME: "tests" },
    getFolderContent: () => ({ files: ["a.ts", "b.ts"], folders: [] }),
    getFileContent: (path: string) => files.get(path),
    getItemNameFromPath: (path: string) => path.split("/").at(-1),
    getAllFiles: () => [["/hello/client/client.ts", ""]],
    // A static that reads `this`, as the real one does
    getRequiredCurrentWorkspacePath: () => "/hello/",
    getRelativePath(
      this: { getRequiredCurrentWorkspacePath(): string },
      path: string
    ) {
      return path.replace(this.getRequiredCurrentWorkspacePath(), "");
    },
    getParentPathFromPath: (path: string) => path,
    createItem: vi.fn(),
  },
  PgJsRuntimeImporter: {
    import: async () => ({ PgJsRuntime: runtime }),
  },
  PgLanguage: { getIsPathJsLike: (path: string) => /\.(ts|js)$/.test(path) },
  PgTerminal: { println: vi.fn(), info: (text: string) => text },
}));

import { run, test } from "./run-and-test";

const execute = (...paths: string[]) =>
  run.handle?.({ args: { paths: paths.length ? paths : undefined } } as never);

let sent: ReturnType<typeof memoryProvider>;

beforeEach(() => {
  runtime.execute.mockReset();
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
});

afterEach(() => resetTelemetry());

const executeTests = (...paths: string[]) =>
  test.handle?.({ args: { paths: paths.length ? paths : undefined } } as never);

describe("test", () => {
  it("runs every test file, and reports the first that fails", async () => {
    runtime.execute
      .mockResolvedValueOnce({ ok: false, error: "boom" })
      .mockResolvedValueOnce({ ok: true });
    expect(await executeTests()).toEqual({ ok: false, error: "boom" });
    expect(runtime.execute).toHaveBeenCalledTimes(2);
  });
});

describe("run", () => {
  it("runs every client file and ends well when each does", async () => {
    runtime.execute.mockResolvedValue({ ok: true });
    expect(await execute()).toEqual({ ok: true });
    expect(runtime.execute).toHaveBeenCalledTimes(2);
  });

  it("stops at the first file that fails, and reports it", async () => {
    runtime.execute.mockResolvedValueOnce({ ok: false, error: "boom" });
    expect(await execute()).toEqual({ ok: false, error: "boom" });
    expect(runtime.execute).toHaveBeenCalledTimes(1);
  });

  it("reports the failure of a file named on the command", async () => {
    runtime.execute.mockResolvedValueOnce({ ok: false, error: "boom" });
    expect(await execute("a.ts", "b.ts")).toEqual({
      ok: false,
      error: "boom",
    });
    expect(runtime.execute).toHaveBeenCalledTimes(1);
  });
});

describe("run telemetry", () => {
  it.each([
    {
      kind: "test",
      outcome: "passed",
      start: executeTests,
      results: [{ ok: true }, { ok: true }],
    },
    {
      kind: "test",
      outcome: "failed",
      start: executeTests,
      results: [{ ok: false, error: "1 failing" }, { ok: true }],
    },
    {
      kind: "client",
      outcome: "passed",
      start: execute,
      results: [{ ok: true }, { ok: true }],
    },
    {
      kind: "client",
      outcome: "failed",
      start: execute,
      results: [{ ok: false, error: "boom" }],
    },
  ])(
    "sends run_finished once with kind $kind and outcome $outcome, and no scope",
    async ({ kind, outcome, start, results }) => {
      for (const result of results) {
        runtime.execute.mockResolvedValueOnce(result);
      }

      await start();

      expect(sent.events).toEqual([
        { name: "run_finished", params: { kind, outcome } },
      ]);
    }
  );

  it.each([
    ["test", executeTests],
    ["client", execute],
  ] as const)(
    "sends run_errored with kind %s and reason busy when another run is in progress",
    async (kind, start) => {
      runtime.execute.mockRejectedValueOnce(
        new RunBusyError("Please wait for tests to finish.")
      );

      await expect(start()).rejects.toThrow("Please wait");

      expect(sent.events).toEqual([
        { name: "run_errored", params: { kind, reason: "busy" } },
      ]);
    }
  );

  it.each([
    {
      kind: "test",
      when: "a file does not exist",
      start: () => executeTests("missing.ts"),
    },
    {
      kind: "client",
      when: "a file does not exist",
      start: () => execute("missing.ts"),
    },
    {
      kind: "client",
      when: "the runtime refuses the code",
      start: () => {
        runtime.execute.mockRejectedValueOnce(
          new Error("'window' is not allowed")
        );
        return execute();
      },
    },
  ])(
    "sends run_errored with kind $kind and reason other when $when",
    async ({ kind, start }) => {
      await expect(start()).rejects.toThrow();

      expect(sent.events).toEqual([
        { name: "run_errored", params: { kind, reason: "other" } },
      ]);
    }
  );

  it("carries no file name, code or message in any event", async () => {
    runtime.execute.mockResolvedValueOnce({
      ok: false,
      error: "expected 9yQN... to equal 7xKX...",
    });

    await execute("a.ts");

    const text = JSON.stringify(sent.events);
    expect(text).not.toContain("a.ts");
    expect(text).not.toContain("9yQN");
  });
});

describe("run's paths", () => {
  it("accepts a client file named without its folder", () => {
    const [paths] = run.args ?? [];
    const values = paths?.values;
    expect(typeof values).toBe("function");
    expect(
      (values as (token: string, tokens: string[]) => string[])("client.ts", [])
    ).toEqual(["client.ts"]);
  });
});
