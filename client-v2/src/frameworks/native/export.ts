import { PgCommon, PgExplorer, PgProgramInfo, TupleFiles } from "../../utils";
import {
  addAfterImports,
  addImports,
  fetchServerCargoLock,
  getJSDependencies,
  getRustDependencies,
  wrapTopLevelAwait,
} from "../common";

/**
 * {@link Framework.importFromPlayground}
 */
export const convertFromPlayground = async (files: TupleFiles) => {
  const PROGRAM_PATH = "program";
  const packageName = PgCommon.toKebabFromTitle(
    PgExplorer.currentWorkspaceName ?? "solpg"
  );
  // `cargo build-sbf` names the program's files after the lib name, the
  // package name in snake case, and keeps a keypair that is already there
  const keypairPath = PgCommon.joinPaths(
    PROGRAM_PATH,
    "target",
    "deploy",
    `${packageName.replaceAll("-", "_")}-keypair.json`
  );

  const frameworkFiles: TupleFiles = [];
  for (let [path, content] of files) {
    // src -> program/src
    if (path.startsWith(PgExplorer.PATHS.SRC_DIRNAME)) {
      path = PgCommon.joinPaths(PROGRAM_PATH, path);
    }

    // client -> client
    else if (path.startsWith(PgExplorer.PATHS.CLIENT_DIRNAME)) {
      // Top-level `await` doesn't compile with the exported `tsconfig.json`
      // (CommonJS) and Playground runs client code inside an async function
      // anyway
      content = convertJSWith(keypairPath)(wrapTopLevelAwait)(content);
    }

    // tests/**/*.test.ts -> tests/**/*.test.ts
    else if (path.startsWith(PgExplorer.PATHS.TESTS_DIRNAME)) {
      // Mocha runs each test's own async function, so its body stays as is
      content = convertJSWith(keypairPath)(keepBody)(content);
    }

    // Don't include other files
    else continue;

    frameworkFiles.push([path, content]);
  }

  // Add the files that don't exist in Playground
  frameworkFiles.push(
    // Program Cargo.toml
    [
      PgCommon.joinPaths(PROGRAM_PATH, "Cargo.toml"),
      `[package]
name = "${packageName}"
version = "0.1.0"
description = "Native Solana Program"
edition = "2021"

[lib]
crate-type = ["cdylib", "lib"]

[features]
no-entrypoint = []

${await getRustDependencies(files)}
`,
    ],

    // The program is its own workspace root, so cargo reads the lock beside its manifest
    [
      PgCommon.joinPaths(PROGRAM_PATH, "Cargo.lock"),
      await fetchServerCargoLock(),
    ],

    // .gitignore
    [
      ".gitignore",
      `.DS_Store
target
node_modules
test-ledger
`,
    ],

    // .prettierignore
    [
      ".prettierignore",
      `.DS_Store
target
test-ledger
`,
    ],

    // package.json
    [
      "package.json",
      `{
  "scripts": {
    "lint:fix": "prettier */*.js \\"*/**/*{.js,.ts}\\" -w",
    "lint": "prettier */*.js \\"*/**/*{.js,.ts}\\" --check",
    "client": "yarn run ts-node client/*.ts",
    "test": "yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts"
  },
${await getJSDependencies(frameworkFiles)}
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

  // Playground's program keypair, if it has one, so that the local program
  // gets its id. A custom program id is not carried over: a first deploy to
  // the local validator needs that id's keypair.
  if (PgProgramInfo.kp) {
    frameworkFiles.push([
      keypairPath,
      JSON.stringify(Array.from(PgProgramInfo.kp.secretKey)),
    ]);
  }

  return frameworkFiles;
};

/** Leave the code as it is */
const keepBody = (content: string) => content;

/**
 * Try to make the JS/TS file work in a local `node` environment by making the
 * necessary conversions.
 *
 * @param keypairPath path of the program keypair, from the project root
 * @returns a function from a transform of the code once its imports are in,
 * then from JS/TS code, to the converted content
 */
const convertJSWith =
  (keypairPath: string) =>
  (transformBody: (content: string) => string) =>
  (content: string) => {
    // Handle imports
    content = addImports(content);
    if (!content.includes("@solana/web3.js")) {
      content = `import * as web3 from "@solana/web3.js";\n` + content;
    }
    content =
      `import * as fs from "fs";\nimport * as os from "os";\nimport * as path from "path";\n` +
      content;

    content = transformBody(content);

    // Define Playground globals for the local validator the guide starts, with
    // the program `cargo build-sbf` builds and the Solana CLI's wallet, which
    // the validator funds
    content = addAfterImports(
      content,
      `// Manually initialize variables that are automatically defined in Playground
const readKeypair = (keypairPath: string) =>
  web3.Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf8")))
  );
const PROGRAM_ID = readKeypair("${keypairPath}").publicKey;
const connection = new web3.Connection("http://127.0.0.1:8899", "confirmed");
const wallet = {
  keypair: readKeypair(path.join(os.homedir(), ".config", "solana", "id.json")),
};
`
    );

    // Handle pg namespace
    content = content
      .replaceAll("pg.PROGRAM_ID", "PROGRAM_ID")
      .replaceAll("pg.connection", "connection")
      .replaceAll("pg.wallet.keypair", "wallet.keypair")
      .replaceAll("pg.wallet.publicKey", "wallet.keypair.publicKey");

    return content;
  };
