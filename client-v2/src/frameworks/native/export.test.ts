// A file of its own, with the boot-time global and the wasm packages stubbed
// as `../round-trip.test.ts` does: the exporter imports the `utils` barrel.
//
// The exported project's guide is `export.md`: `yarn test` and `yarn client`
// must run against the local validator it starts, with the program it deploys
// (HOO-2748).
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";

import {
  PgCommon,
  PgExplorer,
  PgLanguage,
  PgProgramInfo,
  PgWeb3,
  TupleFiles,
} from "../../utils";
import { convertFromPlayground } from "./export";

vi.hoisted(() => {
  vi.stubGlobal("GLOBAL_SETTINGS", { default: {} });
  vi.stubGlobal("PACKAGES", {
    global: {
      assert: { default: "assert" },
      "@solana/web3.js": { as: "web3" },
    },
    importable: [],
  });
  vi.stubGlobal("CRATES", { importable: [] });
});

vi.mock("../../utils/package", () => ({ PgPackage: {} }));

const LIB = [
  "src/lib.rs",
  "use solana_program::entrypoint;\n\nentrypoint!(process_instruction);\n",
] as const;

const CLIENT = [
  "client/client.ts",
  "const balance = await pg.connection.getBalance(pg.wallet.publicKey);\nconsole.log(balance / web3.LAMPORTS_PER_SOL);\n",
] as const;

const TEST = [
  "tests/native.test.ts",
  'describe("Test", () => {\n  it("greet", async () => {\n    await pg.connection.getAccountInfo(pg.PROGRAM_ID);\n  });\n});\n',
] as const;

/** The Playground globals as the exported client and tests define them */
const GLOBALS = `// Manually initialize variables that are automatically defined in Playground
const readKeypair = (keypairPath: string) =>
  web3.Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf8")))
  );
const PROGRAM_ID = readKeypair("program/target/deploy/solpg-keypair.json").publicKey;
const connection = new web3.Connection("http://127.0.0.1:8899", "confirmed");
const wallet = {
  keypair: readKeypair(path.join(os.homedir(), ".config", "solana", "id.json")),
};
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
    vi.spyOn(PgCommon, "fetchJSON").mockResolvedValue({});
    // The crates' features and the build server's lock, which the exports fetch
    vi.spyOn(PgCommon, "fetchText").mockImplementation(async (path) =>
      path.endsWith("features.json") ? "{}" : "# server lock\n"
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it("points the client at the local validator, the deployed program and the CLI wallet", async () => {
    const files = await exported(LIB, CLIENT);

    const client = files.get("client/client.ts") ?? "";
    expect(client).toContain(GLOBALS);
    expect(client).toContain(
      'import * as fs from "fs";\nimport * as os from "os";\nimport * as path from "path";\n'
    );
    expect(client).toContain(
      "const balance = await connection.getBalance(wallet.keypair.publicKey);"
    );
  });

  it("wraps the await of a client in an async function after the globals", async () => {
    const files = await exported(LIB, CLIENT);

    const client = files.get("client/client.ts") ?? "";
    expect(client).toContain(
      `${GLOBALS}\n\n(async () => {\nconst balance = await connection.getBalance(wallet.keypair.publicKey);\nconsole.log(balance / web3.LAMPORTS_PER_SOL);\n})().catch((err) => {\n  console.error(err);\n  process.exitCode = 1;\n});\n`
    );
  });

  it("adds web3 to a client that does not use it, for the globals", async () => {
    const files = await exported(LIB, [
      "client/client.ts",
      "console.log(1);\n",
    ]);

    const client = files.get("client/client.ts") ?? "";
    expect(client).toContain('import * as web3 from "@solana/web3.js";');
    expect(client).not.toContain("(async");
  });

  it("adds the web3 namespace to a client that imports web3 by name", async () => {
    const files = await exported(LIB, [
      "client/client.ts",
      'import { PublicKey } from "@solana/web3.js";\n\nconsole.log(PublicKey.default);\n',
    ]);

    const client = files.get("client/client.ts") ?? "";
    expect(client).toContain('import * as web3 from "@solana/web3.js";');
  });

  it.each([
    'import*as web3 from "@solana/web3.js";',
    "import * as web3 from '@solana/web3.js'",
    'import web3 from "@solana/web3.js";',
  ])(
    "keeps one web3 binding for a client that imports it as %s",
    async (line) => {
      const files = await exported(LIB, [
        "client/client.ts",
        `${line}\n\nconst { PublicKey } = web3;\nconsole.log(PublicKey.default);\n`,
      ]);

      const client = files.get("client/client.ts") ?? "";
      expect(client.match(/\bweb3\s+from\b/g)).toHaveLength(1);
    }
  );

  it("names the added fs, os and path imports apart from the client's own", async () => {
    const files = await exported(LIB, [
      "client/client.ts",
      'const path = "example";\nconst _os = 1;\nconsole.log(path, _os);\n',
    ]);

    const client = files.get("client/client.ts") ?? "";
    expect(client).toContain('import * as _path from "path";');
    expect(client).toContain('import * as os from "os";');
    expect(client).toContain('import * as fs from "fs";');
    expect(client).toContain('readKeypair(_path.join(os.homedir(), ".config"');
    expect(client).not.toContain('import * as path from "path";');
  });

  it("defines the globals after the imports when the code below says import", async () => {
    const files = await exported(LIB, [
      "client/client.ts",
      'const balance = await pg.connection.getBalance(pg.wallet.publicKey);\n// then import the token program: "spl-token"\nconsole.log(balance);\n',
    ]);

    const client = files.get("client/client.ts") ?? "";
    expect(client).toContain(`${GLOBALS}\n\n(async () => {\n`);
  });

  it("ships Playground's program keypair where the client reads it, in snake case", async () => {
    const kp = PgWeb3.Keypair.generate();
    // `kp` gets its getter when `PgProgramInfo` initializes, which this test
    // does not do
    Object.defineProperty(PgProgramInfo, "kp", {
      get: () => kp,
      configurable: true,
    });
    onTestFinished(() => {
      Reflect.deleteProperty(PgProgramInfo, "kp");
    });
    vi.spyOn(PgExplorer, "currentWorkspaceName", "get").mockReturnValue(
      "Hello World"
    );
    const files = await exported(LIB, CLIENT);

    expect(files.get("program/Cargo.toml")).toContain('name = "hello-world"');
    const keypairPath = "program/target/deploy/hello_world-keypair.json";
    expect(files.get("client/client.ts")).toContain(
      `const PROGRAM_ID = readKeypair("${keypairPath}").publicKey;`
    );
    const secretKey = JSON.parse(files.get(keypairPath) ?? "[]");
    expect(
      PgWeb3.Keypair.fromSecretKey(Uint8Array.from(secretKey)).publicKey
    ).toEqual(kp.publicKey);
  });

  describe("a project other than the open one", () => {
    /** The open project, Hello World, with a program keypair of its own */
    const openWithKeypair = () => {
      const open = PgWeb3.Keypair.generate();
      Object.defineProperty(PgProgramInfo, "kp", {
        get: () => open,
        configurable: true,
      });
      onTestFinished(() => {
        Reflect.deleteProperty(PgProgramInfo, "kp");
      });
      vi.spyOn(PgExplorer, "currentWorkspaceName", "get").mockReturnValue(
        "Hello World"
      );
      return open;
    };

    const exportedAs = async (name: string) =>
      new Map(
        (await convertFromPlayground(
          [LIB, CLIENT].map(([p, c]) => [p, c]),
          name
        )) as TupleFiles
      );

    it("ships that project's saved keypair and name, not the open one's", async () => {
      const open = openWithKeypair();
      const saved = PgWeb3.Keypair.generate();
      const read = vi
        .spyOn(PgExplorer.fs, "readToJSON")
        .mockResolvedValue({ kp: Array.from(saved.secretKey) });

      const files = await exportedAs("Other Project");

      expect(read).toHaveBeenCalledWith(
        "/Other Project/.workspace/program-info.json"
      );
      expect(files.get("program/Cargo.toml")).toContain(
        'name = "other-project"'
      );
      const secretKey = JSON.parse(
        files.get("program/target/deploy/other_project-keypair.json") ?? "[]"
      );
      const shipped = PgWeb3.Keypair.fromSecretKey(Uint8Array.from(secretKey));
      expect(shipped.publicKey).toEqual(saved.publicKey);
      expect(shipped.publicKey).not.toEqual(open.publicKey);
    });

    it("ships no keypair for a project with no program info", async () => {
      openWithKeypair();
      vi.spyOn(PgExplorer.fs, "readToJSON").mockRejectedValue(
        new Error("not found")
      );

      const files = await exportedAs("Other Project");

      expect(
        Array.from(files.keys()).filter((path) =>
          path.endsWith("-keypair.json")
        )
      ).toEqual([]);
    });
  });

  it("ships no program keypair when Playground has none", async () => {
    const files = await exported(LIB, CLIENT);

    expect(
      Array.from(files.keys()).filter((path) => path.endsWith("-keypair.json"))
    ).toEqual([]);
  });

  it("defines the globals in a test and leaves its await alone", async () => {
    const files = await exported(LIB, TEST);

    const test = files.get("tests/native.test.ts") ?? "";
    expect(test).toContain(GLOBALS);
    expect(test).toContain("await connection.getAccountInfo(PROGRAM_ID);");
    expect(test).not.toContain("(async () => {");
  });

  it("types Node's globals, which the client's console needs", async () => {
    const files = await exported(LIB, CLIENT);

    const manifest = JSON.parse(files.get("package.json") ?? "{}");
    expect(manifest.devDependencies["@types/node"]).toBeDefined();
    const tsconfig = JSON.parse(files.get("tsconfig.json") ?? "{}");
    expect(tsconfig.compilerOptions.types).toContain("node");
  });
});
