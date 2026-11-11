// The exported Anchor workspace's manifests; mocks the utils barrel and the
// dependency helpers, which reach the network.
import { describe, expect, it, vi } from "vitest";

import { getIdlBuildFeature } from "./idl-build-feature";

vi.mock("../../utils", () => ({
  PgCommon: {
    joinPaths: (...paths: string[]) => paths.join("/"),
    toKebabFromSnake: (name: string) => name.replaceAll("_", "-"),
    toSnakeCase: (name: string) => name,
    toPascalFromSnake: (name: string) => name,
  },
  PgExplorer: {
    PATHS: {
      SRC_DIRNAME: "src",
      CLIENT_DIRNAME: "client",
      TESTS_DIRNAME: "tests",
    },
    currentWorkspaceName: "spl_program",
  },
  PgProgramInfo: { pk: undefined, kp: undefined },
}));
vi.mock("../common", () => ({
  addAfter: (content: string) => content,
  addImports: (content: string) => content,
  IMPORT_STATEMENT_REGEX: /import/,
  getRustDependencies: async () => "[dependencies]",
  getJSDependencies: async () => '"dependencies": {}',
  fetchServerCargoLock: async () => SERVER_LOCK,
}));

const SERVER_LOCK = 'version = 4\n\n[[package]]\nname = "solpg"\n';

const { convertFromPlayground } = await import("./export");

describe("frameworks/anchor/export", () => {
  it("writes the idl-build feature and resolver 2 into the manifests", async () => {
    const files: [string, string][] = [
      [
        "src/lib.rs",
        "use anchor_spl::token::Token;\n#[program]\npub mod spl_program {}",
      ],
    ];

    const exported = new Map(await convertFromPlayground(files));

    const feature = getIdlBuildFeature(files);
    expect(feature).toContain('"anchor-spl/idl-build"');
    expect(exported.get("programs/spl-program/Cargo.toml")).toContain(feature);
    expect(exported.get("Cargo.toml")).toMatch(/^resolver = "2"$/m);
  });

  // Without it, `anchor idl build` resolves newer transitive crates than the server, which fail to compile
  it("ships the build server's lock beside the workspace manifest", async () => {
    const exported = new Map(
      await convertFromPlayground([
        ["src/lib.rs", "#[program]\npub mod spl_program {}"],
      ])
    );

    expect(exported.get("Cargo.lock")).toBe(SERVER_LOCK);
  });
});
