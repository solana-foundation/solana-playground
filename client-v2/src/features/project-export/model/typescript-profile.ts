import { Endpoint } from "@/constants";
import type { TupleFiles } from "@/utils";

/**
 * The names the module that gives `pg` and `sleep` their local meaning takes
 * at the root, in order: `playground`, then `playground-shim`,
 * `playground-shim-2` and on, when the project holds that name already
 */
const shimStemAt = (n: number) => {
  if (n === 0) return "playground";
  return n === 1 ? "playground-shim" : `playground-shim-${n}`;
};

/** The extensions an extensionless import can resolve to */
const RESOLVED_EXTENSION_REGEX = /^\.(?:(?:d\.)?[cm]?[jt]sx?|json)$/;

/**
 * The root name the shim takes: the first one no file or folder of the project
 * holds, so `import ... from "../<name>"` reaches the shim and nothing else
 *
 * @param paths the project's paths
 * @returns the name, without `.ts`
 */
const shimStemFor = (paths: string[]) => {
  // Lowercase: a zip unpacked on macOS or Windows puts `Playground.ts` and
  // `playground.ts` in one file
  const lowerPaths = paths.map((path) => path.toLowerCase());
  const isTaken = (stem: string) =>
    lowerPaths.some(
      (path) =>
        path === stem ||
        path.startsWith(`${stem}/`) ||
        (path.startsWith(`${stem}.`) &&
          RESOLVED_EXTENSION_REGEX.test(path.slice(stem.length)))
    );
  let n = 0;
  while (isTaken(shimStemAt(n))) n++;
  return shimStemAt(n);
};

/** The variable that names the cluster `pg.connection` connects to */
export const RPC_URL_VARIABLE = "SOLANA_RPC_URL";

/** The variable that names the keypair file `pg.wallet` signs with */
export const KEYPAIR_VARIABLE = "SOLANA_KEYPAIR";

/** The keypair `pg.wallet` reads without `KEYPAIR_VARIABLE`: the Solana CLI's */
export const DEFAULT_KEYPAIR_PATH = "~/.config/solana/id.json";

/** The public endpoint of each cluster, the only kind an export writes */
const PUBLIC_ENDPOINTS: Record<string, string> = {
  devnet: Endpoint.DEVNET,
  testnet: Endpoint.TESTNET,
  "mainnet-beta": Endpoint.MAINNET_BETA,
};

/**
 * The endpoint an export writes as the cluster's fallback: the public one of
 * the cluster Playground is on, never the URL it uses. A platform or custom RPC
 * URL can carry an API key, and a zip gets shared. A local validator keeps its
 * URL; playnet runs only in the browser and an unknown cluster has no public
 * URL, so both fall back to devnet, Playground's default.
 *
 * @param cluster the cluster Playground is on, as `PgConnection.cluster` names
 * it; `null` before it is known
 * @param endpoint the URL Playground uses for it
 * @returns the URL to write
 */
export const toPublicEndpoint = (
  cluster: string | null | undefined,
  endpoint: string
) => {
  if (cluster === "localnet") return endpoint;
  return (cluster && PUBLIC_ENDPOINTS[cluster]) || Endpoint.DEVNET;
};

/** TypeScript and JavaScript, the files a project with no program runs */
const SCRIPT_REGEX = /\.[jt]sx?$/;

/** Where the scripts live in a project with no program */
const SCRIPT_FOLDER_REGEX = /^(client|tests)\//;

/** The client files `npm run client` prefers, in order */
const PREFERRED_CLIENTS = [
  "client/client.ts",
  "client/index.ts",
  "client/client.js",
  "client/index.js",
];

/**
 * Whether a script binds `name` at its top level, which an added import would
 * clash with: a declaration that starts a line (an inner scope's does not
 * serve the outer code), a destructuring that binds it (`{ sleep }`,
 * `{ a: sleep }`, not the key of `{ sleep: pause }`), or one import statement
 * naming it (the clause cannot cross a quote, so it stays inside that
 * statement)
 */
const hasDeclarationFor = (name: string) => (content: string) =>
  // eslint-disable-next-line security/detect-non-literal-regexp -- `name` is a `\w+` identifier: a Playground global or one `importedNameOf` read
  new RegExp(
    `^(export\\s+)?(const|let|var|function|class)\\s+${name}\\b`,
    "m"
  ).test(content) ||
  // eslint-disable-next-line security/detect-non-literal-regexp -- `name` is a `\w+` identifier: a Playground global or one `importedNameOf` read
  new RegExp(
    `^(export\\s+)?(const|let|var)\\s*[{[](?:[^}\\]=]*?[,:])?\\s*${name}\\b(?!\\s*:)[^}\\]=]*[}\\]]\\s*=`,
    "m"
  ).test(content) ||
  // eslint-disable-next-line security/detect-non-literal-regexp -- `name` is a `\w+` identifier: a Playground global or one `importedNameOf` read
  new RegExp(
    `^\\s*import\\s+[^;'"]*?\\b${name}\\b[^;'"]*?\\s+from\\s+["']`,
    "m"
  ).test(content);

/**
 * Whether a script uses the Playground global `name`: the bare name, not a
 * property (`a.pg`) or part of a longer one (`mypg`)
 */
const isGlobalUsedFor = (name: string) => (content: string) =>
  // eslint-disable-next-line security/detect-non-literal-regexp -- `name` is a `\w+` identifier: a Playground global or one `importedNameOf` read
  new RegExp(`(^|[^\\w$.])${name}\\b`, "m").test(content);

/**
 * The import of `pg` and `sleep` a script needs, from the shim at the project
 * root
 *
 * @param shimStem the shim's name at the root, without `.ts`
 * @param path the script's path, from the project root
 * @param content the script
 * @returns the import line, or empty when the script uses neither
 */
const shimImportFor = (shimStem: string) => (path: string, content: string) => {
  const names = [
    isGlobalUsedFor("pg")(content) && !hasDeclarationFor("pg")(content) && "pg",
    isGlobalUsedFor("sleep")(content) &&
      !hasDeclarationFor("sleep")(content) &&
      "sleep",
  ].filter((name): name is string => !!name);
  if (!names.length) return "";

  const depth = path.split("/").length - 1;
  const from = "../".repeat(depth) + shimStem;
  return `import { ${names.join(", ")} } from "${from}";\n`;
};

/** The name an `import ... from` line written by `addImports` binds */
const importedNameOf = (line: string) =>
  /^import\s+(?:\*\s+as\s+(\w+)|\{\s*(\w+)\s*\}|(\w+))\s+from\s/
    .exec(line)
    ?.slice(1)
    .find(Boolean);

/**
 * Drop the import lines `addImports` added for a name the script already
 * binds itself: it adds `web3` on any `web3.`, even when the script imports
 * it, and two imports of one name do not compile. `addImports` puts its lines
 * at the top, so a line goes when the name is bound again further down.
 */
const withoutImportsOfBound = (converted: string) => {
  const lines = converted.split("\n");
  return lines
    .filter((line, i) => {
      const name = importedNameOf(line);
      return !name || !hasDeclarationFor(name)(lines.slice(i + 1).join("\n"));
    })
    .join("\n");
};

/**
 * Make a script run under Node: import the Playground's global packages,
 * and `pg` and `sleep` from the shim
 */
const convertScriptWith =
  (importGlobals: (content: string) => string) =>
  (shimStem: string) =>
  (path: string, content: string) => {
    const converted = withoutImportsOfBound(importGlobals(content));
    return shimImportFor(shimStem)(path, converted) + converted;
  };

/** The client file `npm run client` runs, or `undefined` with no client */
const clientEntry = (paths: string[]) => {
  const clients = paths
    .filter((path) => path.startsWith("client/") && SCRIPT_REGEX.test(path))
    .sort();
  const preferred = PREFERRED_CLIENTS.find((path) => clients.includes(path));
  if (preferred) return preferred;
  const topLevel = clients.find((path) => path.split("/").length === 2);
  return topLevel ?? clients[0];
};

/** A path every shell reads as one word and leaves as it is, quoted or not */
const isShellSafe = (path: string) => /^[\w./ +,=@-]+$/.test(path);

/**
 * Runs the client named in `package.json`'s `config.client` with no shell
 * between: npm hands it over as `npm_package_config_client`, so a `$`, a quote
 * or a `%` in the path reaches Node as it is on sh and Windows cmd alike
 */
const CLIENT_FROM_CONFIG = `node --import tsx -e "import(require('node:url').pathToFileURL(require('node:path').resolve(process.env.npm_package_config_client)).href)"`;

/** An npm package name from a project name */
const toPackageName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "") || "playground-project";

/**
 * Packages the Playground bundles for the browser that Node has built in: the
 * npm package of the same name is a browser polyfill, never what Node code
 * means by it
 */
const NODE_BUILTINS = ["assert", "buffer"];

/** Dev dependencies the profile's scripts need, besides what the code imports */
const DEV_DEPENDENCIES = {
  "@types/node": "^22.9.0",
  tsx: "^4.19.2",
  typescript: "^5.6.3",
};

/** Dev dependencies `npm test` needs */
const TEST_DEV_DEPENDENCIES = {
  "@types/mocha": "^10.0.9",
  mocha: "^10.8.2",
};

/** Sorted by name, for a stable diff */
const sorted = (deps: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(deps).sort(([a], [b]) => a.localeCompare(b))
  );

/** `playground.ts`: what `pg` and `sleep` meant in the browser, for Node */
const shim = (
  endpoint: string
) => `// Written by Solana Playground's export: what \`pg\` and \`sleep\` meant in
// the browser, for Node. See README.md.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import {
  Connection,
  Keypair,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

/** The cluster: \`${RPC_URL_VARIABLE}\`, else the public endpoint of the one Playground was on */
const RPC_URL = process.env.${RPC_URL_VARIABLE} || ${JSON.stringify(endpoint)};

/** The keypair \`pg.wallet\` signs with: \`${KEYPAIR_VARIABLE}\`, else the Solana CLI's */
const KEYPAIR_PATH = (
  process.env.${KEYPAIR_VARIABLE} || ${JSON.stringify(DEFAULT_KEYPAIR_PATH)}
).replace(/^~(?=$|\\/)/, homedir());

const readKeypair = () => {
  let text: string;
  try {
    text = readFileSync(KEYPAIR_PATH, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        \`No keypair at \${KEYPAIR_PATH}. Create one with \\\`solana-keygen new\\\`, or point ${KEYPAIR_VARIABLE} at one.\`,
        { cause }
      );
    }
    throw new Error(\`Could not read the keypair at \${KEYPAIR_PATH}.\`, { cause });
  }
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(text)));
  } catch (cause) {
    throw new Error(
      \`\${KEYPAIR_PATH} is not a Solana keypair file: a JSON array of 64 numbers.\`,
      { cause }
    );
  }
};

type AnyTransaction = Transaction | VersionedTransaction;

const sign = <T extends AnyTransaction>(tx: T, keypair: Keypair) => {
  if (tx instanceof VersionedTransaction) tx.sign([keypair]);
  else tx.partialSign(keypair);
  return tx;
};

const createWallet = (keypair: Keypair) => ({
  publicKey: keypair.publicKey,
  keypair,
  signTransaction: async <T extends AnyTransaction>(tx: T) => sign(tx, keypair),
  signAllTransactions: async <T extends AnyTransaction>(txs: T[]) =>
    txs.map((tx) => sign(tx, keypair)),
});

let wallet: ReturnType<typeof createWallet> | undefined;

export const pg = {
  connection: new Connection(RPC_URL, "confirmed"),
  /** Read the first time code uses it, so a client that never signs needs no keypair */
  get wallet() {
    wallet ??= createWallet(readKeypair());
    return wallet;
  },
};

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
`;

/** `README.md`: how to install and run what the export wrote */
const readme = (opts: {
  name: string;
  endpoint: string;
  client: string | undefined;
  hasTests: boolean;
  shimPath: string;
  ownScripts: string[];
  isPackageKept: boolean;
}) => {
  const isOwn = (script: string) => opts.ownScripts.includes(script);
  const run = [
    opts.client &&
      (isOwn("client")
        ? "- `npm run client` runs the `client` script in `package.json`."
        : `- \`npm run client\` runs \`${opts.client}\`.`) +
        " Run another client file with `npx tsx client/<file>`.",
    opts.hasTests &&
      (isOwn("test")
        ? "- `npm test` runs the `test` script in `package.json`."
        : "- `npm test` runs every test under `tests/` with mocha."),
  ].filter(Boolean);

  return `# ${opts.name}

Exported from Solana Playground. Needs Node.js 20.6 or later.

\`\`\`sh
npm install
${[opts.client && "npm run client", opts.hasTests && "npm test"]
  .filter(Boolean)
  .join("\n")}
\`\`\`

${run.join("\n")}
${
  opts.isPackageKept
    ? `
\`package.json\` is the project's own, kept as it is because it is not a JSON
object the export can complete. Add \`tsx\`, \`@solana/web3.js\` and the
scripts above to it before running them.
`
    : ""
}
## Cluster and wallet

In Playground, \`pg.connection\` and \`pg.wallet\` came from the browser. Here
\`${opts.shimPath}\` provides them:

- \`pg.connection\` connects to \`${RPC_URL_VARIABLE}\`, or to \`${
    opts.endpoint
  }\`,
  the public endpoint of the cluster Playground was on when you exported.
  Set it to use your own RPC.
- \`pg.wallet\` signs with the keypair file in \`${KEYPAIR_VARIABLE}\`, or
  \`${DEFAULT_KEYPAIR_PATH}\`. Create one with \`solana-keygen new\`. Your
  Playground wallet is not in this export.

\`\`\`sh
${RPC_URL_VARIABLE}=http://127.0.0.1:8899 ${KEYPAIR_VARIABLE}=./id.json npm run client
\`\`\`

\`pg.wallets\`, \`pg.program\`, \`pg.PROGRAM_ID\` and \`pg.wallet.signMessage\`
exist only in Playground.
`;
};

/** The fields of `package.json` that declare a package */
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

/** The fields of `package.json` the profile fills in, each an object */
const OBJECT_FIELDS = ["engines", "scripts", "config", ...DEPENDENCY_FIELDS];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && !!value && !Array.isArray(value);

/** `own` with the entries of `add` it does not have, after its own */
const withMissing = (
  own: Record<string, unknown>,
  add: Record<string, unknown>
) =>
  Object.assign(
    {},
    own,
    Object.fromEntries(
      Object.entries(add).filter(([key]) => !Object.hasOwn(own, key))
    )
  );

/**
 * A project's own `package.json`, completed with what the profile's would
 * hold: every field, script, config entry (but `config.client`, below) and
 * package it already has is
 * kept as it is, and only the missing ones are added, so `npm install` and
 * `npm run client` work with the converted code. `type` is set only when
 * absent: the project chose its module system. `config.client` comes only
 * with the `client` script it serves, and replaces the project's own then,
 * since that script reads it.
 *
 * @param ours the one the profile would write
 * @param own the project's `package.json`
 * @returns the file to write, the scripts it held already, and whether it was
 * kept as it is: when it is not JSON, not an object, or holds a field the
 * profile fills in (`OBJECT_FIELDS`) that is not an object
 */
const completePackageJsonWith =
  (ours: Record<string, unknown>) => (own: string) => {
    const kept = { text: own, ownScripts: [], isKept: true };
    let parsed: unknown;
    try {
      parsed = JSON.parse(own);
    } catch {
      // Not JSON: the project's file is never destroyed, and the README
      // says it was kept (`isPackageKept`)
      return kept;
    }
    if (!isRecord(parsed)) return kept;
    const pkg = parsed;
    const field = (name: string) => {
      const value = pkg[name];
      return isRecord(value) ? value : {};
    };
    if (
      OBJECT_FIELDS.some(
        (name) => Object.hasOwn(pkg, name) && !isRecord(pkg[name])
      )
    ) {
      return kept;
    }

    const oursField = (name: string) => {
      const value = ours[name];
      return isRecord(value) ? value : {};
    };
    const declared = new Set(
      DEPENDENCY_FIELDS.flatMap((name) => Object.keys(field(name)))
    );
    const ownScripts = Object.keys(field("scripts"));
    const merged: Record<string, unknown> = { ...pkg };
    if (!Object.hasOwn(pkg, "type")) merged.type = ours.type;
    for (const name of ["engines", "scripts"]) {
      merged[name] = withMissing(field(name), oursField(name));
    }
    if (Object.hasOwn(ours, "config") && !ownScripts.includes("client")) {
      merged.config = Object.assign({}, field("config"), oursField("config"));
    }
    for (const name of ["dependencies", "devDependencies"]) {
      const missing = Object.fromEntries(
        Object.entries(oursField(name)).filter(([dep]) => !declared.has(dep))
      );
      if (Object.hasOwn(pkg, name) || Object.keys(missing).length) {
        merged[name] = withMissing(field(name), missing);
      }
    }
    return {
      text: JSON.stringify(merged, undefined, 2) + "\n",
      ownScripts,
      isKept: false,
    };
  };

/**
 * Turn a project with no program into a Node project: every file kept at its
 * path, the scripts importing what Playground provided as globals, and
 * `package.json`, `tsconfig.json`, `README.md`, `.gitignore` and the shim,
 * `playground.ts`, added at the root. A file the project holds there already
 * is kept, except `package.json`, which is completed
 * (`completePackageJsonWith`); a project that holds `playground` gets the shim
 * under the next free name (`shimStemFor`).
 *
 * @param fetchDependencies the packages the given files use, with versions
 * (`fetchJSDependencyMap`)
 * @param importGlobals the script with imports added for the Playground's
 * global packages (`addImports`); both are passed in because
 * `frameworks/common` imports the `utils` barrel, whose settings need the
 * app's build-time globals, and this module stays testable without them
 * @param endpoint the cluster `pg.connection` falls back to
 * @param name the project's name
 * @param files the project's files, Playground layout
 * @returns the files to zip, and the README to show after: the project's own
 * when it has one at the root, which the profile keeps
 */
export const toNodeProjectWith =
  (fetchDependencies: (files: TupleFiles) => Promise<Record<string, string>>) =>
  (importGlobals: (content: string) => string) =>
  (endpoint: string) =>
  (name: string) =>
  async (files: TupleFiles): Promise<{ files: TupleFiles; readme: string }> => {
    const paths = files.map(([path]) => path);
    const shimStem = shimStemFor(paths);
    const shimPath = `${shimStem}.ts`;
    const convertScript = convertScriptWith(importGlobals)(shimStem);
    const converted: TupleFiles = files.map(([path, content]) =>
      SCRIPT_FOLDER_REGEX.test(path) && SCRIPT_REGEX.test(path)
        ? [path, convertScript(path, content)]
        : [path, content]
    );

    const client = clientEntry(paths);
    const hasTests = paths.some(
      (path) => path.startsWith("tests/") && SCRIPT_REGEX.test(path)
    );

    const shimFile: [string, string] = [shimPath, shim(endpoint)];
    const dependencies = await fetchDependencies([...converted, shimFile]);
    for (const builtin of NODE_BUILTINS) delete dependencies[builtin];
    const devDependencies: Record<string, string> = {
      ...DEV_DEPENDENCIES,
      ...(hasTests ? TEST_DEV_DEPENDENCIES : {}),
      ...(dependencies["bn.js"] ? { "@types/bn.js": "^5.1.6" } : {}),
    };
    for (const used of Object.keys(dependencies)) delete devDependencies[used];

    const scripts: Record<string, string> = {};
    const isClientShellSafe = client === undefined || isShellSafe(client);
    if (client) {
      const quoted = client.includes(" ") ? `"${client}"` : client;
      scripts.client = isClientShellSafe ? `tsx ${quoted}` : CLIENT_FROM_CONFIG;
    }
    if (hasTests) {
      scripts.test =
        'mocha --node-option import=tsx --timeout 1000000 "tests/**/*.{ts,js,tsx,jsx}"';
    }

    const packageJson = {
      name: toPackageName(name),
      private: true,
      type: "module",
      engines: { node: ">=20.6" },
      ...(isClientShellSafe ? {} : { config: { client } }),
      scripts,
      dependencies: sorted(dependencies),
      devDependencies: sorted(devDependencies),
    };

    const tsconfig = {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        esModuleInterop: true,
        resolveJsonModule: true,
        skipLibCheck: true,
        noEmit: true,
        types: hasTests ? ["node", "mocha"] : ["node"],
      },
    };

    const ownPackage = files.find(([path]) => path === "package.json")?.[1];
    const {
      text: packageText,
      ownScripts,
      isKept: isPackageKept,
    } = ownPackage === undefined
      ? {
          text: JSON.stringify(packageJson, undefined, 2) + "\n",
          ownScripts: [],
          isKept: false,
        }
      : completePackageJsonWith(packageJson)(ownPackage);

    const added: TupleFiles = [
      ["package.json", packageText],
      ["tsconfig.json", JSON.stringify(tsconfig, undefined, 2) + "\n"],
      [
        "README.md",
        readme({
          name,
          endpoint,
          client,
          hasTests,
          shimPath,
          ownScripts,
          isPackageKept,
        }),
      ],
      [".gitignore", "node_modules\n"],
      shimFile,
    ];
    const taken = new Set(paths);
    const all: TupleFiles = [
      ...converted.map(([path, content]): [string, string] =>
        path === "package.json" ? [path, packageText] : [path, content]
      ),
      ...added.filter(([path]) => !taken.has(path)),
    ];
    return {
      files: all,
      readme: all.find(([path]) => path === "README.md")?.[1] ?? "",
    };
  };

if (import.meta.vitest) {
  const { describe, it, expect, beforeAll } = import.meta.vitest;

  describe("features/project-export/model/typescript-profile", () => {
    let ts: typeof import("typescript");
    beforeAll(async () => {
      ts = await import("typescript");
    });

    /** Every package the files import, at version 1.0.0 */
    const importedPackages = async (files: TupleFiles) => {
      const names = new Set<string>();
      for (const [, content] of files) {
        for (const match of content.matchAll(/from "([^".][^"]*)"/g)) {
          if (!match[1].startsWith("node:")) names.add(match[1]);
        }
      }
      return Object.fromEntries(Array.from(names, (name) => [name, "1.0.0"]));
    };

    /** `addImports` for two of the globals, as it writes them */
    const importGlobals = (content: string) =>
      [
        content.includes("web3.") &&
          'import * as web3 from "@solana/web3.js";\n',
        content.includes("BN(") && 'import BN from "bn.js";\n',
        content.includes("assert.") && 'import assert from "assert";\n',
      ]
        .filter(Boolean)
        .join("") + content;

    const profileAs = toNodeProjectWith(importedPackages)(importGlobals)(
      Endpoint.DEVNET
    );

    const profileOf = profileAs("My Project");

    const exportAs = (name: string) => async (files: TupleFiles) =>
      (await profileAs(name)(files)).files;

    const exportOf = exportAs("My Project");

    const fileOf = (files: TupleFiles, path: string) =>
      files.find(([p]) => p === path)?.[1] ?? "";

    const packageOf = (files: TupleFiles) =>
      JSON.parse(fileOf(files, "package.json"));

    const CLIENT = `console.log(pg.wallet.publicKey.toString());
console.log(await pg.connection.getSlot());
`;
    const TEST = `describe("basic", () => {
  it("adds", () => {
    assert.equal(1 + 1, 2);
  });
});
`;

    it("keeps every file and adds the five the profile writes", async () => {
      const files = await exportOf([
        ["client/client.ts", CLIENT],
        ["tests/basic.test.ts", TEST],
        ["client/data.json", "{}"],
      ]);
      expect(files.map(([path]) => path)).toEqual([
        "client/client.ts",
        "tests/basic.test.ts",
        "client/data.json",
        "package.json",
        "tsconfig.json",
        "README.md",
        ".gitignore",
        "playground.ts",
      ]);
      expect(fileOf(files, "client/data.json")).toBe("{}");
    });

    it("keeps the project's own README", async () => {
      const files = await exportOf([
        ["client/client.ts", CLIENT],
        ["README.md", "# Mine"],
      ]);
      expect(files.filter(([path]) => path === "README.md")).toEqual([
        ["README.md", "# Mine"],
      ]);
    });

    it("imports pg from the shim at the right depth", async () => {
      const files = await exportOf([
        ["client/client.ts", CLIENT],
        [
          "client/lib/rpc.ts",
          "export const slot = () => pg.connection.getSlot();",
        ],
      ]);
      expect(fileOf(files, "client/client.ts")).toMatch(
        /^import \{ pg \} from "\.\.\/playground";\n/
      );
      expect(fileOf(files, "client/lib/rpc.ts")).toMatch(
        /^import \{ pg \} from "\.\.\/\.\.\/playground";\n/
      );
    });

    it("imports sleep with pg, and the global packages", async () => {
      const files = await exportOf([
        [
          "client/client.ts",
          "await sleep(10);\nconst kp = web3.Keypair.generate();\nnew BN(1);\nconsole.log(pg.connection);",
        ],
      ]);
      const client = fileOf(files, "client/client.ts");
      expect(client).toContain('import { pg, sleep } from "../playground";');
      expect(client).toContain('import * as web3 from "@solana/web3.js";');
      expect(client).toContain('import BN from "bn.js";');
    });

    it("adds no import a script declares itself, or does not use", async () => {
      const files = await exportOf([
        [
          "client/own.ts",
          "const pg = { connection: 1 };\nconsole.log(pg.connection);",
        ],
        ["client/none.ts", "console.log(1);"],
        ["client/longer.ts", "console.log(mypg.connection, a.sleep(1));"],
      ]);
      expect(fileOf(files, "client/own.ts")).not.toContain("playground");
      expect(fileOf(files, "client/none.ts")).toBe("console.log(1);");
      expect(fileOf(files, "client/longer.ts")).not.toContain("playground");
    });

    it("adds no second import of a global the client already imports", async () => {
      const client =
        'import * as web3 from "@solana/web3.js";\nconsole.log(web3.Keypair.generate());';
      // `importGlobals` adds web3 on `web3.` alone, as `addImports` does
      const files = await exportOf([["client/client.ts", client]]);
      expect(fileOf(files, "client/client.ts")).toBe(client);
    });

    it("adds no sleep import a script destructures itself", async () => {
      const files = await exportOf([
        ["client/own.ts", "const { sleep } = helpers;\nawait sleep(1);"],
      ]);
      expect(fileOf(files, "client/own.ts")).not.toContain("playground");
    });

    it("quotes a client path with a space in the client script", async () => {
      const pkg = packageOf(await exportOf([["client/my client.ts", CLIENT]]));
      expect(pkg.scripts.client).toBe('tsx "client/my client.ts"');
    });

    it("keeps the import a global needs when only an inner scope binds its name", async () => {
      const files = await exportOf([
        [
          "client/inner.ts",
          "assert.equal(1, 1);\nfunction check() { const assert = {}; }",
        ],
      ]);
      expect(fileOf(files, "client/inner.ts")).toContain(
        'import assert from "assert";'
      );
    });

    it("imports sleep when a destructuring only renames a sleep key", async () => {
      const files = await exportOf([
        [
          "client/renamed.ts",
          "const { sleep: pause } = helpers;\nawait sleep(1);",
        ],
      ]);
      expect(fileOf(files, "client/renamed.ts")).toContain("sleep } from");
    });

    it("runs a client whose path a shell would change through Node, not the shell", async () => {
      const pkg = packageOf(await exportOf([["client/my$file.ts", CLIENT]]));
      expect(pkg.config).toEqual({ client: "client/my$file.ts" });
      expect(pkg.scripts.client).not.toContain("my$file");
    });

    it("leaves files outside client and tests as they are", async () => {
      const files = await exportOf([
        ["client/client.ts", CLIENT],
        ["notes/x.ts", "console.log(pg.connection);"],
      ]);
      expect(fileOf(files, "notes/x.ts")).toBe("console.log(pg.connection);");
    });

    it("writes an ES module package that runs the client and the tests", async () => {
      const pkg = packageOf(
        await exportOf([
          ["client/client.ts", CLIENT],
          ["tests/basic.test.ts", TEST],
        ])
      );
      expect(pkg.name).toBe("my-project");
      expect(pkg.type).toBe("module");
      expect(pkg.scripts).toEqual({
        client: "tsx client/client.ts",
        test: 'mocha --node-option import=tsx --timeout 1000000 "tests/**/*.{ts,js,tsx,jsx}"',
      });
      // `assert` is Node's own
      expect(pkg.dependencies).toEqual({ "@solana/web3.js": "1.0.0" });
      expect(Object.keys(pkg.devDependencies)).toEqual([
        "@types/mocha",
        "@types/node",
        "mocha",
        "tsx",
        "typescript",
      ]);
    });

    it("writes no script with nothing to run", async () => {
      const onlyTests = packageOf(await exportOf([["tests/a.test.ts", TEST]]));
      expect(Object.keys(onlyTests.scripts)).toEqual(["test"]);
      const onlyClient = packageOf(await exportOf([["client/a.ts", CLIENT]]));
      expect(Object.keys(onlyClient.scripts)).toEqual(["client"]);
      expect(onlyClient.devDependencies.mocha).toBeUndefined();
    });

    it.each([
      [
        ["client/b.ts", "client/index.ts", "client/client.ts"],
        "client/client.ts",
      ],
      [["client/b.ts", "client/index.ts"], "client/index.ts"],
      [["client/z/deep.ts", "client/b.ts", "client/a.ts"], "client/a.ts"],
      [["client/z/deep.ts", "client/notes.md"], "client/z/deep.ts"],
    ])("runs the client file %j picks", async (paths, entry) => {
      const pkg = packageOf(
        await exportOf(paths.map((path) => [path, "console.log(1);"]))
      );
      expect(pkg.scripts.client).toBe(`tsx ${entry}`);
    });

    it("types bn.js when the code uses it", async () => {
      const pkg = packageOf(await exportOf([["client/a.ts", "new BN(1);"]]));
      expect(pkg.devDependencies["@types/bn.js"]).toBeDefined();
    });

    it("falls back to the exported cluster and the CLI keypair", async () => {
      const shimText = fileOf(
        await exportOf([["client/a.ts", CLIENT]]),
        "playground.ts"
      );
      expect(shimText).toContain(
        `process.env.SOLANA_RPC_URL || "${Endpoint.DEVNET}"`
      );
      expect(shimText).toContain(
        `process.env.SOLANA_KEYPAIR || "${DEFAULT_KEYPAIR_PATH}"`
      );
      // Read in the getter only: a client that only uses the connection
      // needs no file
      expect(shimText.match(/readKeypair\(\)/g)).toHaveLength(1);
      expect(shimText.indexOf("readKeypair()")).toBeGreaterThan(
        shimText.indexOf("get wallet()")
      );
    });

    it("names both variables and their defaults in the README", async () => {
      const text = fileOf(
        await exportOf([["client/a.ts", CLIENT]]),
        "README.md"
      );
      expect(text).toContain("SOLANA_RPC_URL");
      expect(text).toContain(Endpoint.DEVNET);
      expect(text).toContain("SOLANA_KEYPAIR");
      expect(text).toContain(DEFAULT_KEYPAIR_PATH);
    });

    it("escapes an endpoint it writes into code", async () => {
      const shimText = fileOf(
        (
          await toNodeProjectWith(importedPackages)(importGlobals)(
            'https://rpc.example/?k="1"'
          )("x")([["client/a.ts", CLIENT]])
        ).files,
        "playground.ts"
      );
      expect(shimText).toContain('"https://rpc.example/?k=\\"1\\""');
    });

    it("imports pg into a script with no semicolons", async () => {
      const files = await exportOf([
        [
          "client/client.ts",
          'import { Buffer } from "buffer"\nconsole.log(pg.wallet.publicKey)\nconst b = Buffer.from([1])\nArray.from(b)\n',
        ],
      ]);
      expect(fileOf(files, "client/client.ts")).toMatch(
        /^import \{ pg \} from "\.\.\/playground";\n/
      );
    });

    it("imports pg a script destructures, and sleep it passes on", async () => {
      const files = await exportOf([
        [
          "client/client.ts",
          "const { connection } = pg;\nsetTimeout(() => {}, 1);\n[1].forEach(sleep);",
        ],
      ]);
      expect(fileOf(files, "client/client.ts")).toContain(
        'import { pg, sleep } from "../playground";'
      );
    });

    it("adds no import a script brings in itself", async () => {
      const files = await exportOf([
        [
          "client/client.ts",
          'import { pg } from "./my-pg";\nconsole.log(pg.connection);',
        ],
      ]);
      expect(fileOf(files, "client/client.ts")).not.toContain("playground");
    });

    it("writes a shim TypeScript parses", async () => {
      const shimText = fileOf(
        await exportOf([["client/a.ts", CLIENT]]),
        "playground.ts"
      );
      const { diagnostics } = ts.transpileModule(shimText, {
        reportDiagnostics: true,
        compilerOptions: { module: ts.ModuleKind.ESNext },
      });
      expect(diagnostics?.map((d) => d.messageText)).toEqual([]);
      expect(shimText).toContain(
        "Create one with \\`solana-keygen new\\`, or point SOLANA_KEYPAIR at one."
      );
      expect(shimText).toContain('.code === "ENOENT"');
    });

    it("returns the README it shows: the project's own when it has one", async () => {
      expect(
        (
          await profileOf([
            ["client/a.ts", CLIENT],
            ["README.md", "# Mine"],
          ])
        ).readme
      ).toBe("# Mine");
      expect((await profileOf([["client/a.ts", CLIENT]])).readme).toContain(
        "npm install"
      );
    });

    it.each([
      {
        cluster: "devnet",
        endpoint: "https://devnet.helius-rpc.com/?api-key=secret",
        expected: Endpoint.DEVNET,
      },
      {
        cluster: "mainnet-beta",
        endpoint: "https://rpc.example/key",
        expected: Endpoint.MAINNET_BETA,
      },
      {
        cluster: "testnet",
        endpoint: "https://my-testnet.example",
        expected: Endpoint.TESTNET,
      },
      {
        cluster: "localnet",
        endpoint: "http://localhost:8900",
        expected: "http://localhost:8900",
      },
      {
        cluster: "playnet",
        // eslint-disable-next-line @microsoft/sdl/no-insecure-url -- Endpoint.PLAYNET's placeholder, matched by name and never requested
        endpoint: "http://playnet",
        expected: Endpoint.DEVNET,
      },
      {
        // eslint-disable-next-line unicorn/no-null -- `PgConnection.cluster` is null until it is known
        cluster: null,
        endpoint: "https://unknown.example",
        expected: Endpoint.DEVNET,
      },
    ])(
      "writes $cluster's public endpoint for $endpoint",
      ({ cluster, endpoint, expected }) => {
        expect(toPublicEndpoint(cluster, endpoint)).toBe(expected);
      }
    );

    describe("a project with its own root files", () => {
      const OWN_PACKAGE = JSON.stringify({
        name: "mine",
        version: "2.0.0",
        scripts: { start: "node index.js" },
        dependencies: { "@solana/web3.js": "^1.90.0", lodash: "^4.0.0" },
      });

      it("keeps its package.json and adds what the client and tests need", async () => {
        const files = await exportOf([
          ["client/client.ts", CLIENT],
          ["tests/basic.test.ts", TEST],
          ["package.json", OWN_PACKAGE],
        ]);
        expect(files.filter(([path]) => path === "package.json")).toHaveLength(
          1
        );
        const pkg = packageOf(files);
        expect(pkg.name).toBe("mine");
        expect(pkg.version).toBe("2.0.0");
        expect(pkg.type).toBe("module");
        expect(pkg.scripts).toEqual({
          start: "node index.js",
          client: "tsx client/client.ts",
          test: 'mocha --node-option import=tsx --timeout 1000000 "tests/**/*.{ts,js,tsx,jsx}"',
        });
        // Its own versions win; what it lacks is added
        expect(pkg.dependencies).toEqual({
          "@solana/web3.js": "^1.90.0",
          lodash: "^4.0.0",
        });
        expect(Object.keys(pkg.devDependencies)).toEqual([
          "@types/mocha",
          "@types/node",
          "mocha",
          "tsx",
          "typescript",
        ]);
      });

      it("keeps its own scripts, module type and dev dependencies", async () => {
        const own = JSON.stringify({
          type: "commonjs",
          scripts: { client: "ts-node client/main.ts" },
          devDependencies: { tsx: "^3.0.0", "@solana/web3.js": "^1.0.0" },
        });
        const pkg = packageOf(
          await exportOf([
            ["client/client.ts", CLIENT],
            ["package.json", own],
          ])
        );
        expect(pkg.type).toBe("commonjs");
        expect(pkg.scripts.client).toBe("ts-node client/main.ts");
        expect(pkg.devDependencies.tsx).toBe("^3.0.0");
        // Already a dev dependency: not added again as a dependency
        expect(pkg.dependencies ?? {}).not.toHaveProperty("@solana/web3.js");
      });

      it("names the client it runs through config when the path needs it", async () => {
        const pkg = packageOf(
          await exportOf([
            ["client/my$file.ts", CLIENT],
            ["package.json", JSON.stringify({ config: { port: 1 } })],
          ])
        );
        expect(pkg.config).toEqual({ port: 1, client: "client/my$file.ts" });
      });

      it.each(["{ not json", "[]", "null", '{ "scripts": "x" }'])(
        "keeps the package.json %s as it is, and says so in the README",
        async (own) => {
          const files = await exportOf([
            ["client/client.ts", CLIENT],
            ["package.json", own],
          ]);
          expect(fileOf(files, "package.json")).toBe(own);
          const text = fileOf(files, "README.md");
          expect(text).toContain("kept as it is");
          expect(text).toContain("runs `client/client.ts`");
        }
      );

      it("names its own test script in the README", async () => {
        const files = await exportOf([
          ["tests/a.test.ts", TEST],
          ["package.json", JSON.stringify({ scripts: { test: "vitest" } })],
        ]);
        expect(packageOf(files).scripts.test).toBe("vitest");
        expect(fileOf(files, "README.md")).toContain(
          "`test` script in `package.json`"
        );
      });

      it("counts a peer dependency as declared", async () => {
        const pkg = packageOf(
          await exportOf([
            ["client/client.ts", CLIENT],
            [
              "package.json",
              JSON.stringify({ peerDependencies: { "@solana/web3.js": "*" } }),
            ],
          ])
        );
        expect(pkg.dependencies).toBeUndefined();
      });

      it("writes its client path over its own config.client", async () => {
        const pkg = packageOf(
          await exportOf([
            ["client/my$file.ts", CLIENT],
            ["package.json", JSON.stringify({ config: { client: "old.ts" } })],
          ])
        );
        expect(pkg.config.client).toBe("client/my$file.ts");
      });

      it("keeps its playground.ts and imports pg from a shim beside it", async () => {
        const own = "export const greeting = 'hi';\n";
        const files = await exportOf([
          ["client/client.ts", CLIENT],
          ["playground.ts", own],
        ]);
        expect(fileOf(files, "playground.ts")).toBe(own);
        expect(fileOf(files, "playground-shim.ts")).toContain(
          "export const pg"
        );
        expect(fileOf(files, "client/client.ts")).toMatch(
          /^import \{ pg \} from "\.\.\/playground-shim";\n/
        );
        expect(fileOf(files, "README.md")).toContain("`playground-shim.ts`");
        expect(fileOf(files, "README.md")).not.toContain("`playground.ts`");
      });

      it.each([
        ["playground/index.ts"],
        ["playground.d.ts"],
        ["Playground.ts"],
        ["playground.json"],
      ])("takes playground-shim when %s holds the name", async (taken) => {
        const files = await exportOf([
          ["client/client.ts", CLIENT],
          [taken, ""],
        ]);
        expect(fileOf(files, "client/client.ts")).toContain(
          'from "../playground-shim"'
        );
      });

      it.each([
        ["playground.config.ts"],
        ["playground.txt"],
        ["client/playground.ts"],
      ])("keeps the shim at playground.ts beside %s", async (other) => {
        const files = await exportOf([
          ["client/client.ts", CLIENT],
          [other, ""],
        ]);
        expect(fileOf(files, "playground.ts")).toContain("export const pg");
      });

      it("takes the next free shim name, whatever extension holds a name", async () => {
        const files = await exportOf([
          ["client/client.ts", CLIENT],
          ["playground.js", ""],
          ["playground-shim/index.ts", ""],
        ]);
        expect(fileOf(files, "client/client.ts")).toContain(
          'from "../playground-shim-2"'
        );
        expect(fileOf(files, "playground-shim-2.ts")).toContain(
          "export const pg"
        );
      });

      it("handles both, and the shim's web3 is a dependency", async () => {
        const files = await exportOf([
          ["client/client.ts", "console.log(pg.connection);"],
          ["playground.ts", "export {};\n"],
          ["package.json", JSON.stringify({ name: "both" })],
        ]);
        const pkg = packageOf(files);
        expect(pkg.scripts.client).toBe("tsx client/client.ts");
        expect(pkg.dependencies).toEqual({ "@solana/web3.js": "1.0.0" });
        expect(fileOf(files, "client/client.ts")).toContain(
          'from "../playground-shim"'
        );
      });

      it("says in the README when the client script is the project's own", async () => {
        const files = await exportOf([
          ["client/client.ts", CLIENT],
          [
            "package.json",
            JSON.stringify({ scripts: { client: "node dist/main.js" } }),
          ],
        ]);
        const text = fileOf(files, "README.md");
        expect(text).not.toContain("runs `client/client.ts`");
        expect(text).toContain("`client` script in `package.json`");
      });
    });

    it("gives an unusable name a package name", async () => {
      expect(packageOf(await exportAs("***")([["client/a.ts", ""]])).name).toBe(
        "playground-project"
      );
    });
  });
}
