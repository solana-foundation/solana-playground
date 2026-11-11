// The exported `Cargo.toml` dependencies; mocks the utils barrel the export
// reads the crate versions and features through.
import { describe, expect, it, vi } from "vitest";

const SERVED: Record<string, unknown> = {
  "/crates/versions.json": { "anchor-lang": "1.1.2", arrayref: "0.3.9" },
  "/crates/features.json": { "anchor-lang": ["event-cpi", "init-if-needed"] },
};

vi.mock("../utils", () => ({
  PgCommon: {
    fetchJSON: async (path: string) => SERVED[path],
    fetchText: async (path: string) => JSON.stringify(SERVED[path]),
    toKebabFromSnake: (name: string) => name.replaceAll("_", "-"),
  },
}));
vi.mock("./SelectProgram", () => ({ SelectProgram: () => undefined }));
vi.stubGlobal("CRATES", {
  importable: ["anchor_lang", "arrayref", "unknown_crate"],
});

const { getImportedNames, getRustDependencies, wrapTopLevelAwait } =
  await import("./common");

describe("frameworks/common", () => {
  it("pins the crate versions and features the server builds with", async () => {
    const files: [string, string][] = [
      [
        "src/lib.rs",
        "use anchor_lang::prelude::*;\nuse arrayref::array_ref;\nuse unknown_crate::x;",
      ],
    ];

    expect(await getRustDependencies(files)).toBe(
      [
        "[dependencies]",
        'anchor-lang = { version = "=1.1.2", features = ["event-cpi", "init-if-needed"] }',
        'arrayref = "=0.3.9"',
        'unknown-crate = "*"',
      ].join("\n")
    );
  });

  it("names the features file when it is not a map of feature lists", async () => {
    const served = SERVED["/crates/features.json"];
    SERVED["/crates/features.json"] = { "anchor-lang": "event-cpi" };
    try {
      await expect(
        getRustDependencies([["src/lib.rs", "use anchor_lang::x;"]])
      ).rejects.toThrow("/crates/features.json");
    } finally {
      SERVED["/crates/features.json"] = served;
    }
  });
});

describe("getImportedNames", () => {
  it.each([
    ['import*as web3 from "@solana/web3.js";', ["web3"]],
    ["import web3 from '@solana/web3.js'", ["web3"]],
    ['import{BN}from"bn.js";', ["BN"]],
    ['import { a as b, type C } from "x";', ["b"]],
    ['import type { D } from "x";', ["D"]],
    ['import "dotenv/config";\nimport web3 from "@solana/web3.js";', ["web3"]],
    [
      'import{BN}from"bn.js";import*as web3 from"@solana/web3.js";',
      ["BN", "web3"],
    ],
    ['\uFEFFimport * as web3 from "@solana/web3.js";', ["web3"]],
    ['const a = 1;\n\u00A0import web3 from "@solana/web3.js";', ["web3"]],
  ])("reads the names %s binds", (content, names) => {
    expect(getImportedNames(content)).toEqual(new Set(names));
  });

  it.each([
    ['// import BN from "bn.js";\nconst amount = new BN(1);\n'],
    ['/* import BN from "bn.js"; */\nconst amount = new BN(1);\n'],
    ['/*\nimport BN from "bn.js";\n*/\nconst amount = new BN(1);\n'],
    ["const doc = \"import BN from 'bn.js'\";\n"],
    ["const doc = \"a; import BN from 'bn.js'\";\n"],
    ["const doc = `\nimport BN from 'bn.js'`;\n"],
  ])("reads no name from an import in a comment or a string: %s", (content) => {
    expect(getImportedNames(content).size).toBe(0);
  });

  it("reads no name from code that only mentions import", () => {
    expect(
      getImportedNames(
        'const important = await import("x");\n// import from "y"\n'
      ).size
    ).toBe(0);
  });
});

describe("wrapTopLevelAwait", () => {
  /** The function the export wraps a client's body in */
  const wrapped = (body: string) =>
    `(async () => {\n${body}\n})().catch((err) => {\n  console.error(err);\n  process.exitCode = 1;\n});\n`;

  it("keeps an import after another statement outside the wrapper", () => {
    const client =
      'console.log("start");\nimport { PublicKey } from "@solana/web3.js";\nconst main = async () => {\n  await Promise.resolve(PublicKey.default);\n};\n';

    expect(wrapTopLevelAwait(client)).toBe(
      'import { PublicKey } from "@solana/web3.js";\n\n' +
        wrapped(
          'console.log("start");\n\nconst main = async () => {\n  await Promise.resolve(PublicKey.default);\n};'
        )
    );
  });

  it("keeps the leading imports first and a later one after them", () => {
    const client =
      'import * as web3 from "@solana/web3.js";\nconsole.log(1);\nimport{BN}from"bn.js";\nawait web3.Connection;\n';

    const result = wrapTopLevelAwait(client);
    expect(result.indexOf('import{BN}from"bn.js";')).toBeLessThan(
      result.indexOf("(async")
    );
    expect(
      result.indexOf('import * as web3 from "@solana/web3.js";')
    ).toBeLessThan(result.indexOf('import{BN}from"bn.js";'));
    expect(result).toContain(
      wrapped("console.log(1);\n\nawait web3.Connection;")
    );
  });

  it.each([
    ['console.log("start");\nimport ("bn.js");\nawait Promise.resolve();\n'],
    ['import ("bn.js");\nawait Promise.resolve();\n'],
    [
      'console.log(1);\nimport /* lazy */ ("bn.js");\nawait Promise.resolve();\n',
    ],
  ])("leaves a dynamic import with a space inside: %s", (client) => {
    expect(wrapTopLevelAwait(client)).toBe("\n\n" + wrapped(client.trim()));
  });

  it("leaves an import in a comment, a string or a template literal inside", () => {
    const client =
      '// import x from "x";\nconst a = "import y from \'y\'";\nconst b = `\nimport z from "z";\n`;\nawait a;\n';

    expect(wrapTopLevelAwait(client)).toBe("\n\n" + wrapped(client.trim()));
  });
});
