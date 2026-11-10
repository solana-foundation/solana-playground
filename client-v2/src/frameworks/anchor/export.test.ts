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
const PLACEHOLDER = `import * as anchor from "@coral-xyz/anchor";
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
  const result = await convertFromPlayground(files.map(([p, c]) => [p, c]));
  return new Map(result as TupleFiles);
};

describe("convertFromPlayground", () => {
  beforeEach(() => {
    // Set at boot by `globals/`, which this test does not load
    PgLanguage.all = [];
    vi.spyOn(PgCommon, "fetchJSON").mockResolvedValue({});
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
    vi.spyOn(PgCommon, "fetchText").mockResolvedValue("");
    const result = await convertSeahorse([
      ["src/foo.py", "from seahorse.prelude import *\n"],
    ]);

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

  it("leaves a client without await as it is", async () => {
    const files = await exported(LIB, [
      "client/client.ts",
      "console.log(1);\n",
    ]);

    expect(files.get("client/client.ts")).not.toContain("(async");
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
});
