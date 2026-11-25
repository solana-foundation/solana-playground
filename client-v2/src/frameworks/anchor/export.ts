import { PgCommon, PgExplorer, TupleFiles } from "../../utils";
import {
  addAfter,
  addAfterImports,
  addImports,
  fetchCrateVersion,
  fetchServerCargoLock,
  getJSDependencies,
  getRustDependencies,
  hasOwnBinding,
  readExportedProject,
  wrapTopLevelAwait,
} from "../common";
import { getIdlBuildFeature } from "./idl-build-feature";

/**
 * The package of Anchor's TypeScript client since 1.0; the export installs it at the build server's `anchor-lang`
 * version. The Playground runs the 0.29 client, `@coral-xyz/anchor`, which cannot read an IDL Anchor 1.x writes (HOO-2964).
 */
const ANCHOR_CLIENT = "@anchor-lang/core";

/**
 * {@link Framework.importFromPlayground}
 */
export const convertFromPlayground = async (
  files: TupleFiles,
  name: string | undefined
) => {
  const project = await readExportedProject(name);
  // The `anchor-lang` the build server compiles with: the CLI, the crate and the TypeScript client share a version.
  // Without it the export would install a client that does not match the program, the failure HOO-2964 fixed
  const anchorVersion = await fetchCrateVersion("anchor-lang");
  if (!anchorVersion) {
    throw new Error("The build server's anchor-lang version is unknown");
  }
  // Program manifest's lib name must match the `#[program]` module name and
  // Anchor.toml programs definition
  const libContent = files.find(([path]) => path.endsWith("lib.rs"))?.[1];
  if (!libContent) throw new Error("lib.rs not found");

  const programName =
    // eslint-disable-next-line security/detect-unsafe-regex -- linear: each \s+ is followed by a class it cannot match
    /(pub\s+)?mod\s+(\w+)/m.exec(libContent)?.[2] ??
    PgCommon.toSnakeCase(project.name ?? "program");
  const packageName = PgCommon.toKebabFromSnake(programName);
  const programPath = PgCommon.joinPaths("programs", packageName);

  const frameworkFiles: TupleFiles = [];
  for (let [path, content] of files) {
    // src -> programs/<program-name>/src
    if (path.startsWith(PgExplorer.PATHS.SRC_DIRNAME)) {
      path = PgCommon.joinPaths(programPath, path);
    }

    // client -> client
    else if (path.startsWith(PgExplorer.PATHS.CLIENT_DIRNAME)) {
      content = convertJS(content, programName);
    }

    // tests/**/*.test.ts -> tests/**/*.ts
    else if (path.startsWith(PgExplorer.PATHS.TESTS_DIRNAME)) {
      path = path.replace(".test.ts", ".ts");
      content = convertJS(content, programName, { isTest: true });
    }

    // Don't include other files
    else continue;

    frameworkFiles.push([path, content]);
  }

  // `anchor test` runs mocha on `tests/**/*.ts`, and mocha exits with an error
  // when no file matches, which is the case for a project that has no tests
  // (a `tests/README.md` alone leaves it with no file too)
  if (
    !frameworkFiles.some(
      ([path]) =>
        path.startsWith(PgExplorer.PATHS.TESTS_DIRNAME) && path.endsWith(".ts")
    )
  ) {
    frameworkFiles.push([
      PgCommon.joinPaths(PgExplorer.PATHS.TESTS_DIRNAME, `${packageName}.ts`),
      convertJS(
        `import * as anchor from "${ANCHOR_CLIENT}";
import { expect } from "chai";

describe("${programName}", () => {
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
`,
        programName,
        { isTest: true }
      ),
    ]);
  }

  // Add the files that don't exist in Playground
  frameworkFiles.push(
    // App
    ["app", ""],

    // Migrations
    [
      PgCommon.joinPaths("migrations", "deploy.ts"),
      `// Migrations are an early feature. Currently, they're nothing more than this
// single deploy script that's invoked from the CLI, injecting a provider
// configured from the workspace's Anchor.toml.

const anchor = require("${ANCHOR_CLIENT}");

module.exports = async function (provider) {
  // Configure client to use the provider.
  anchor.setProvider(provider);

  // Add your deploy script here.
};
`,
    ],

    // Program Cargo.toml
    [
      PgCommon.joinPaths(programPath, "Cargo.toml"),
      `[package]
name = "${packageName}"
version = "0.1.0"
description = "Created with Anchor"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]
name = "${programName}"

[features]
no-entrypoint = []
no-idl = []
no-log-ix-name = []
cpi = ["no-entrypoint"]
default = []
${getIdlBuildFeature(frameworkFiles)}

${await getRustDependencies(frameworkFiles)}
`,
    ],

    // Program Xargo.toml
    [
      PgCommon.joinPaths(programPath, "Xargo.toml"),
      `[target.bpfel-unknown-unknown.dependencies.std]
features = []
`,
    ],

    // .gitignore
    [
      ".gitignore",
      `.anchor
.DS_Store
target
**/*.rs.bk
node_modules
test-ledger
.surfpool
.yarn
`,
    ],

    // .prettierignore
    [
      ".prettierignore",
      `.anchor
.DS_Store
target
node_modules
dist
build
test-ledger
`,
    ],

    // Anchor.toml
    [
      "Anchor.toml",
      `[toolchain]
anchor_version = "${anchorVersion}"
package_manager = "yarn"

[features]
resolution = true
skip-lint = false

${
  project.pk
    ? `[programs.localnet]
${programName} = "${project.pk.toBase58()}"`
    : ""
}

[provider]
cluster = "Localnet"
wallet = "~/.config/solana/id.json"

[scripts]
test = "yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts"
client = "yarn run ts-node client/*.ts"
`,
    ],

    // Workspace Cargo.toml
    [
      "Cargo.toml",
      `[workspace]
members = [
    "programs/*"
]
resolver = "2"

[profile.release]
overflow-checks = true
lto = "fat"
codegen-units = 1
[profile.release.build-override]
opt-level = 3
incremental = false
codegen-units = 1
`,
    ],

    ["Cargo.lock", await fetchServerCargoLock()],

    // package.json
    [
      "package.json",
      `{
  "scripts": {
    "lint:fix": "prettier */*.js \\"*/**/*{.js,.ts}\\" -w",
    "lint": "prettier */*.js \\"*/**/*{.js,.ts}\\" --check"
  },
${await getJSDependencies({ [ANCHOR_CLIENT]: anchorVersion }, frameworkFiles)}
}
`,
    ],

    // tsconfig.json
    [
      "tsconfig.json",
      `{
  "compilerOptions": {
    "types": ["mocha", "chai", "node"],
    "typeRoots": ["./node_modules/@types"],
    "lib": ["es2015"],
    "module": "commonjs",
    "target": "es6",
    "esModuleInterop": true
  }
}
`,
    ]
  );

  // Create program keypair if it exists
  if (project.kp) {
    frameworkFiles.push([
      PgCommon.joinPaths("target", "deploy", `${programName}-keypair.json`),
      JSON.stringify(Array.from(project.kp.secretKey)),
    ]);
  }

  return frameworkFiles;
};

/** `const anchor = require(...)` of an Anchor client, the 0.x packages or 1.x's, at the start of a line */
const ANCHOR_REQUIRE =
  /^(?:const|let|var)\s+anchor\s*=\s*require\((["'])(?:@coral-xyz\/anchor|@project-serum\/anchor|@anchor-lang\/core)\1\);?/;

/**
 * Try to make the JS/TS file work in a local `node` environment by making the
 * necessary conversions.
 *
 * @param content JS/TS code
 * @param programName  snake case program name
 * @param opts options
 * - `isTest`: whether the given file is a test file
 * @returns the converted content
 */
const convertJS = (
  content: string,
  programName: string,
  opts?: { isTest?: boolean }
) => {
  // A top-level require of an Anchor client becomes an import, so the program set up below, which goes after the
  // imports, follows it. A trailing line comment goes with it
  content = content
    .split("\n")
    .map((line) => {
      const required = ANCHOR_REQUIRE.exec(line);
      const rest = required ? line.slice(required[0].length).trim() : "";
      return required && (rest === "" || rest.startsWith("//"))
        ? `import * as anchor from "${ANCHOR_CLIENT}";`
        : line;
    })
    .join("\n");

  // Handle imports
  content = addImports(content);
  // Every converted file uses `anchor` (the program set up below). A file that only mentions the word, as
  // `describe("hello_anchor")` does, still needs the import
  if (!hasOwnBinding("anchor", content)) {
    content = `import * as anchor from "${ANCHOR_CLIENT}";\n` + content;
  }
  // The 0.x clients, imported by `addImports` for the `anchor` global or by the file itself: neither reads an IDL
  // Anchor 1.x writes, and two clients in one project would not share their types
  content = content.replace(
    /(["'])(?:@coral-xyz|@project-serum)\/anchor\1/g,
    (_, quote: string) => quote + ANCHOR_CLIENT + quote
  );
  // The 1.x client types `accounts` without the accounts it resolves itself (the system program, PDAs), which the
  // 0.29 client took. `accountsPartial` takes them all, as the test `anchor init` 1.1.2 writes calls it. Only a call
  // in a statement that builds an instruction through `.methods` is Anchor's. A statement starts after a `;` or,
  // in code without semicolons, after a blank line
  content = content.replace(/\.accounts\(/g, (call, offset: number) =>
    /\.methods\s*\./.test(
      content.slice(
        Math.max(
          content.lastIndexOf(";", offset) + 1,
          content.lastIndexOf("\n\n", offset)
        ),
        offset
      )
    )
      ? ".accountsPartial("
      : call
  );

  // Top-level `await` doesn't compile with the exported `tsconfig.json`
  // (CommonJS) and Playground runs client code inside an async function anyway
  if (!opts?.isTest) content = wrapTopLevelAwait(content);

  // Add program
  const pascalCaseProgramName = PgCommon.toPascalFromSnake(programName);
  content = addAfterImports(
    content,
    `import type { ${pascalCaseProgramName} } from "../target/types/${programName}";`
  );

  content = opts?.isTest
    ? addAfter(
        content,
        /describe\(.*/,
        `  // Configure the client to use the local cluster
  anchor.setProvider(anchor.AnchorProvider.env());\n
  const program = anchor.workspace.${pascalCaseProgramName} as anchor.Program<${pascalCaseProgramName}>;
  `,
        { firstOccurance: true }
      )
    : addAfterImports(
        content,
        `\n// Configure the client to use the local cluster
anchor.setProvider(anchor.AnchorProvider.env());\n
const program = anchor.workspace.${pascalCaseProgramName} as anchor.Program<${pascalCaseProgramName}>;
`
      );

  // Handle pg namespace
  content = content
    .replaceAll("pg.program", "program")
    .replaceAll("pg.PROGRAM_ID", "program.programId")
    .replaceAll("pg.connection", "program.provider.connection")
    .replaceAll("pg.wallet.publicKey", "program.provider.publicKey")
    .replaceAll("pg.wallet.keypair", "program.provider.wallet.payer");

  return content;
};
