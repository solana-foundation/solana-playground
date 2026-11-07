// `@types/mocha` also declares a global `it`, without `each`
import { beforeEach, describe, expect, it, vi } from "vitest";

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

beforeEach(() => {
  runtime.execute.mockReset();
});

const executeTests = () =>
  test.handle?.({ args: { paths: undefined } } as never);

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
