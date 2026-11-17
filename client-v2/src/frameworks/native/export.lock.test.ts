// The exported native program's files; mocks the utils barrel and the
// dependency helpers, which reach the network.
import { describe, expect, it, vi } from "vitest";

vi.mock("../../utils", () => ({
  PgCommon: {
    joinPaths: (...paths: string[]) => paths.join("/"),
    toKebabFromTitle: (name: string) => name,
  },
  PgConnection: {},
  PgExplorer: {
    PATHS: {
      SRC_DIRNAME: "src",
      CLIENT_DIRNAME: "client",
      TESTS_DIRNAME: "tests",
    },
    currentWorkspaceName: "native",
  },
  PgProgramInfo: { pk: undefined },
}));
vi.mock("../common", () => ({
  addAfter: (content: string) => content,
  addImports: (content: string) => content,
  addAfterImports: (content: string) => content,
  wrapTopLevelAwait: (content: string) => content,
  IMPORT_STATEMENT_REGEX: /import/,
  getRustDependencies: async () => "[dependencies]",
  getJSDependencies: async () => '"dependencies": {}',
  fetchServerCargoLock: async () => SERVER_LOCK,
  readExportedProject: async (name: string | undefined) => ({
    name,
    kp: undefined,
    pk: undefined,
  }),
}));

const SERVER_LOCK = 'version = 4\n\n[[package]]\nname = "solpg"\n';

const { convertFromPlayground } = await import("./export");

describe("frameworks/native/export", () => {
  it("ships the build server's lock beside the program manifest", async () => {
    const exported = new Map(
      await convertFromPlayground(
        [["src/lib.rs", "entrypoint!(process);"]],
        undefined
      )
    );

    expect(exported.get("program/Cargo.lock")).toBe(SERVER_LOCK);
  });
});
