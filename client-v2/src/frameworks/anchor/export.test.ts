// A file of its own, with the boot-time global and the wasm packages stubbed
// as `../round-trip.test.ts` does: the exporter imports the `utils` barrel.
//
// The exported project's guide is `export.md`: `anchor test` and
// `anchor run client` must run on what the tutorial's last step leaves
// (HOO-2749).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PgCommon, PgLanguage, TupleFiles } from "../../utils";
import { convertFromPlayground as convertSeahorse } from "../seahorse/export";
import { convertFromPlayground } from "./export";

vi.hoisted(() => {
  vi.stubGlobal("GLOBAL_SETTINGS", { default: {} });
  vi.stubGlobal("PACKAGES", {
    // The globals that `addImports` reads, among them `assert`, which the
    // placeholder test must not call
    global: {
      assert: { default: "assert" },
      "@coral-xyz/anchor": { as: "anchor" },
    },
    importable: [],
  });
  vi.stubGlobal("CRATES", { importable: [] });
});

vi.mock("../../utils/package", () => ({ PgPackage: {} }));

const LIB = [
  "src/lib.rs",
  "use anchor_lang::prelude::*;\n\n#[program]\nmod hello_anchor {\n    use super::*;\n}\n",
] as const;

const CLIENT = [
  "client/client.ts",
  'const txHash = await pg.program.methods.hello("Anchor").rpc();\nconsole.log(txHash);\n',
] as const;

const TEST = [
  "tests/anchor.test.ts",
  'describe("hello_anchor", () => {\n  it("runs", async () => {\n    await pg.program.methods.hello("Anchor").rpc();\n  });\n});\n',
] as const;

/** The placeholder test as `anchor test` finds it */
const PLACEHOLDER = `import * as anchor from "@anchor-lang/core";
import { expect } from "chai";
import type { HelloAnchor } from "../target/types/hello_anchor";

describe("hello_anchor", () => {
  // Configure the client to use the local cluster
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.HelloAnchor as anchor.Program<HelloAnchor>;
  
  it("is deployed", async () => {
    const info = await program.provider.connection.getAccountInfo(
      program.programId
    );
    expect(
      info,
      \`program \${program.programId} is not deployed on \${program.provider.connection.rpcEndpoint}; run anchor deploy\`
    ).to.not.equal(null);
    expect(info?.executable).to.equal(true);
  });
});
`;

const exported = async (...files: (readonly [string, string])[]) => {
  const result = await convertFromPlayground(
    files.map(([p, c]) => [p, c]),
    undefined
  );
  return new Map(result as TupleFiles);
};

describe("convertFromPlayground", () => {
  beforeEach(() => {
    // Set at boot by `globals/`, which this test does not load
    PgLanguage.all = [];
    // The build server's crate versions, which the export pins Anchor to
    vi.spyOn(PgCommon, "fetchJSON").mockImplementation(async (path) =>
      path === "/crates/versions.json" ? { "anchor-lang": "1.1.2" } : {}
    );
    // The crates' features and the build server's lock, which the exports fetch
    vi.spyOn(PgCommon, "fetchText").mockImplementation(async (path) =>
      path.endsWith("features.json") ? "{}" : "# server lock\n"
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it("adds a placeholder test to a project that has none", async () => {
    const files = await exported(LIB, CLIENT);

    expect(files.get("tests/hello-anchor.ts")).toBe(PLACEHOLDER);
  });

  it("adds the placeholder test to a project with only a tests README", async () => {
    const files = await exported(LIB, ["tests/README.md", "# Tests\n"]);

    expect(files.get("tests/hello-anchor.ts")).toBe(PLACEHOLDER);
  });

  it("adds the placeholder test to a Seahorse project that has none", async () => {
    vi.spyOn(PgCommon, "fetchText").mockImplementation(async (path) =>
      path.endsWith("features.json") ? "{}" : ""
    );
    const result = await convertSeahorse(
      [["src/foo.py", "from seahorse.prelude import *\n"]],
      undefined
    );

    const test = new Map(result as TupleFiles).get("tests/foo.ts");
    expect(test).toContain('describe("foo", () => {');
    expect(test).toContain('import type { Foo } from "../target/types/foo";');
  });

  it("keeps the tests a project has", async () => {
    const files = await exported(LIB, CLIENT, TEST);

    expect(files.has("tests/anchor.ts")).toBe(true);
    expect(files.has("tests/hello-anchor.ts")).toBe(false);
  });

  it("wraps the await of a client in an async function", async () => {
    const files = await exported(LIB, CLIENT);

    const client = files.get("client/client.ts") ?? "";
    expect(client).toContain(
      "const program = anchor.workspace.HelloAnchor as anchor.Program<HelloAnchor>;"
    );
    expect(client).toContain(
      '(async () => {\nconst txHash = await program.methods.hello("Anchor").rpc();\nconsole.log(txHash);\n})().catch((err) => {\n  console.error(err);\n  process.exitCode = 1;\n});'
    );
    expect(client.indexOf("const program")).toBeLessThan(
      client.indexOf("(async")
    );
  });

  it("starts the wrapper after the imports, not at a comment that says import", async () => {
    const files = await exported(LIB, [
      "client/client.ts",
      `import { BN } from "bn.js";

// We don't import the IDL here
const name = "Anchor";
await pg.program.methods.hello(name).rpc();
`,
    ]);

    const client = files.get("client/client.ts") ?? "";
    expect(client).toContain(
      '\n\n(async () => {\n// We don\'t import the IDL here\nconst name = "Anchor";\nawait program.methods.hello(name).rpc();\n})()'
    );
    expect(client.indexOf('import { BN } from "bn.js";')).toBeLessThan(
      client.indexOf("const program")
    );
  });

  it.each([
    ['import{BN} from "bn.js";'],
    ['import*as bn from "bn.js";'],
    ['import"dotenv/config";'],
  ])("keeps the compact import %s outside the wrapper", async (statement) => {
    const files = await exported(LIB, [
      "client/client.ts",
      `${statement}\nawait pg.program.methods.hello("Anchor").rpc();\n`,
    ]);

    const client = files.get("client/client.ts") ?? "";
    expect(client.indexOf(statement)).toBeGreaterThanOrEqual(0);
    expect(client.indexOf(statement)).toBeLessThan(
      client.indexOf("(async () => {")
    );
  });

  it("leaves a client without await as it is", async () => {
    const files = await exported(LIB, [
      "client/client.ts",
      "console.log(1);\n",
    ]);

    expect(files.get("client/client.ts")).not.toContain("(async");
  });

  it("leaves a client with a top-level export unwrapped", async () => {
    const files = await exported(LIB, [
      "client/client.ts",
      'export const name = "Anchor";\nawait pg.program.methods.hello(name).rpc();\n',
    ]);

    expect(files.get("client/client.ts")).not.toContain("(async");
  });

  it("leaves a client that starts with export{} unwrapped", async () => {
    const files = await exported(LIB, [
      "client/client.ts",
      'export{};\nawait pg.program.methods.hello("Anchor").rpc();\n',
    ]);

    expect(files.get("client/client.ts")).not.toContain("(async");
  });

  it("keeps a comment on the last import's line beside the import", async () => {
    const files = await exported(LIB, [
      "client/client.ts",
      'import { BN } from "bn.js"; // big numbers\nconsole.log(BN);\n',
    ]);

    const client = files.get("client/client.ts") ?? "";
    expect(client).toContain('import { BN } from "bn.js"; // big numbers\n');
    expect(client).toContain(
      "anchor.Program<HelloAnchor>;\n\nconsole.log(BN);"
    );
  });

  it("keeps the code that follows the last import on the same line", async () => {
    const files = await exported(LIB, [
      "client/client.ts",
      'import { BN } from "bn.js";console.log(BN);\n',
    ]);

    expect(files.get("client/client.ts")).toContain(
      "anchor.Program<HelloAnchor>;\n\nconsole.log(BN);"
    );
  });

  it("adds no blank line after imports that end in CRLF", async () => {
    const files = await exported(LIB, [
      "client/client.ts",
      'import { BN } from "bn.js";\r\nconsole.log(BN);\r\n',
    ]);

    expect(files.get("client/client.ts")).toContain(
      "anchor.Program<HelloAnchor>;\n\nconsole.log(BN);"
    );
  });

  it("leaves the await of a test alone", async () => {
    const files = await exported(LIB, TEST);

    expect(files.get("tests/anchor.ts")).not.toContain("(async () => {");
  });

  it("lists ts-node, which anchor run client needs, as a dev dependency", async () => {
    const files = await exported(LIB, CLIENT);

    const manifest = JSON.parse(files.get("package.json") ?? "{}");
    expect(manifest.devDependencies["ts-node"]).toBeDefined();
    expect(manifest.devDependencies["ts-mocha"]).toBeDefined();
  });

  it("gives the client the Node types for process and console", async () => {
    const files = await exported(LIB, CLIENT);

    const tsconfig = JSON.parse(files.get("tsconfig.json") ?? "{}");
    expect(tsconfig.compilerOptions.types).toContain("node");
  });

  // HOO-2964: the Playground runs the 0.29 client, the build server Anchor 1.1.2
  describe("on the Anchor version the build server runs", () => {
    beforeEach(() => {
      vi.spyOn(PgLanguage, "getIsPathJsLike").mockImplementation((path) =>
        /\.(js|ts)$/.test(path)
      );
      vi.spyOn(PgCommon, "fetchJSON").mockImplementation(async (path) =>
        path === "/crates/versions.json"
          ? { "anchor-lang": "1.1.2" }
          : { "@coral-xyz/anchor": "0.29.0", "@solana/web3.js": "1.98.4" }
      );
    });

    it("installs the TypeScript client of the program's Anchor version", async () => {
      const files = await exported(LIB, CLIENT, TEST);

      const { dependencies } = JSON.parse(files.get("package.json") ?? "{}");
      expect(dependencies["@anchor-lang/core"]).toBe("1.1.2");
      expect(dependencies).not.toHaveProperty("@coral-xyz/anchor");
    });

    it("installs that client for a client that imports the 0.29 one itself", async () => {
      const files = await exported(LIB, [
        "client/client.ts",
        'import { BN } from "@coral-xyz/anchor";\nconsole.log(new BN(1));\n',
      ]);

      const { dependencies } = JSON.parse(files.get("package.json") ?? "{}");
      expect(dependencies["@anchor-lang/core"]).toBe("1.1.2");
      expect(dependencies).not.toHaveProperty("@coral-xyz/anchor");
      expect(files.get("client/client.ts")).toContain(
        'import { BN } from "@anchor-lang/core";'
      );
    });

    it("imports that client in the tests, the client and the migration", async () => {
      const files = await exported(LIB, CLIENT, TEST);

      for (const path of [
        "tests/anchor.ts",
        "client/client.ts",
        "migrations/deploy.ts",
      ]) {
        expect(files.get(path), path).toContain('"@anchor-lang/core"');
        expect(files.get(path), path).not.toContain("@coral-xyz/anchor");
      }
    });

    it("passes the accounts the 1.x client resolves itself through accountsPartial", async () => {
      const files = await exported(LIB, [
        "tests/anchor.test.ts",
        'describe("t", () => {\n  it("runs", async () => {\n    await pg.program.methods.hello().accounts({ systemProgram: web3.SystemProgram.programId }).rpc();\n  });\n});\n',
      ]);

      expect(files.get("tests/anchor.ts")).toContain(
        ".hello().accountsPartial({ systemProgram"
      );
    });

    it("keeps an accounts call outside an Anchor methods chain", async () => {
      const files = await exported(LIB, [
        "client/client.ts",
        "await pg.program.methods.hello().accounts({}).rpc()\n\nconst helper = { accounts() { return [] } }\nconsole.log(helper.accounts())\n",
      ]);

      const client = files.get("client/client.ts");
      expect(client).toContain(".hello().accountsPartial({})");
      expect(client).toContain("helper.accounts()");
    });

    it("pins the Anchor CLI in Anchor.toml, with the settings Anchor 1.x reads", async () => {
      const files = await exported(LIB, CLIENT);

      const toml = files.get("Anchor.toml") ?? "";
      expect(toml).toMatch(
        /^\[toolchain\]\nanchor_version = "1\.1\.2"\npackage_manager = "yarn"$/m
      );
      expect(toml).toMatch(/^\[features\]\nresolution = true$/m);
      expect(toml).not.toContain("seeds");
    });

    it("refuses to export when the build server's Anchor version is unknown", async () => {
      vi.spyOn(PgCommon, "fetchJSON").mockResolvedValue({});

      await expect(exported(LIB, CLIENT)).rejects.toThrow(
        "anchor-lang version is unknown"
      );
    });

    it.each([
      ['import * as anchor from "@coral-xyz/anchor";'],
      ["const anchor = require('@coral-xyz/anchor');"],
      ['const anchor = require("@coral-xyz/anchor"); // the client'],
      ['const anchor = require("@anchor-lang/core");'],
    ])("keeps one anchor binding for a client that has %s", async (line) => {
      const files = await exported(LIB, [
        "client/client.ts",
        `${line}\nconsole.log(anchor.web3);\n`,
      ]);

      const client = files.get("client/client.ts") ?? "";
      expect(
        client.match(/\banchor = require\(|import \* as anchor\b/g)
      ).toHaveLength(1);
      expect(client).toContain("@anchor-lang/core");
      expect(client).not.toContain("@coral-xyz/anchor");
      // The program is set up after the binding it reads
      expect(
        client.search(/import \* as anchor\b|anchor = require/)
      ).toBeLessThan(client.indexOf("anchor.setProvider"));
    });

    it("moves a client off the @project-serum/anchor client too", async () => {
      const files = await exported(LIB, [
        "client/client.ts",
        'import * as anchor from "@project-serum/anchor";\nconsole.log(anchor.web3);\n',
      ]);

      expect(files.get("client/client.ts")).toContain(
        'import * as anchor from "@anchor-lang/core";'
      );
      expect(files.get("client/client.ts")).not.toContain("@project-serum");
      expect(files.get("package.json")).not.toContain("@project-serum");
    });
  });
});
