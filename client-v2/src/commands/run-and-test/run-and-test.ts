import type { RunKind } from "../../features/run";
import { runTelemetry } from "../../features/run";
import {
  PgCommon,
  PgExplorer,
  PgJsRuntimeImporter,
  PgLanguage,
  PgTerminal,
} from "../../utils";
import type { RunResult } from "../../utils/js-runtime";
import { isRunBusy } from "../../utils/js-runtime";
import { createArgs, createCmd } from "../create";

/**
 * Crate common arguments.
 *
 * @param parentPath path that is expected to be run inside of
 * @returns the common arguments
 */
const createCommonArgs = (parentPath: string) =>
  createArgs([
    {
      name: "paths",
      optional: true,
      multiple: true,
      values: (token) => {
        if (token.startsWith(PgExplorer.PATHS.ROOT_DIR_PATH)) {
          const path = token.endsWith("/")
            ? token
            : PgExplorer.getParentPathFromPath(token);
          const folder = PgExplorer.getFolderContent(path);
          return [
            ...folder.files
              .map((name) => PgCommon.joinPaths(path, name))
              .filter(PgLanguage.getIsPathJsLike),
            ...folder.folders
              .map((name) => PgCommon.joinPaths(path, name))
              .map(PgCommon.appendSlash),
          ];
        }

        return (
          PgExplorer.getAllFiles()
            .map(([path]) => path)
            .filter(PgLanguage.getIsPathJsLike)
            // Called on `PgExplorer`: the method reads `this`
            .map((path) => PgExplorer.getRelativePath(path))
            .filter((path) => path.startsWith(parentPath))
            .map((path) => path.replace(PgCommon.appendSlash(parentPath), ""))
        );
      },
    },
  ]);

export const run = createCmd({
  name: "run",
  description: "Run script(s)",
  needsConnection: true,
  args: createCommonArgs(PgExplorer.PATHS.CLIENT_DIRNAME),
  handle: (input) => processCommon({ paths: input.args.paths, isTest: false }),
});

export const test = createCmd({
  name: "test",
  description: "Run test(s)",
  needsConnection: true,
  args: createCommonArgs(PgExplorer.PATHS.TESTS_DIRNAME),
  handle: (input) => processCommon({ paths: input.args.paths, isTest: true }),
});

/** What `run` and `test` take, from the terminal or the explorer */
interface ProcessParams {
  /** File paths to run or test */
  paths: string[] | undefined;
  /** Whether to execute as test */
  isTest: boolean;
}

/**
 * Process `run` or `test` command, and count the run: `run_finished` with its
 * outcome when `runFiles` returns (`test` runs every file, `run` stops at the
 * first failing script), or `run_errored` when it throws before or instead of
 * finishing (the funnel's "Use" step, `client-v2-run`).
 *
 * @param params the paths and whether to execute as test
 * @throws what `runFiles` throws, after the run is counted
 */
const processCommon = async (params: ProcessParams): Promise<RunResult> => {
  const kind: RunKind = params.isTest ? "test" : "client";
  let result: RunResult;
  try {
    result = await runFiles(params);
  } catch (error) {
    runTelemetry.track("run_errored", {
      kind,
      reason: isRunBusy(error) ? "busy" : "other",
    });
    throw error;
  }
  runTelemetry.track("run_finished", {
    kind,
    outcome: result.ok ? "passed" : "failed",
  });
  return result;
};

/**
 * Run or test the given files, or the whole `client` or `tests` folder.
 *
 * @param params the paths and whether to execute as test
 * @returns how the run ended: the first failure, if any
 */
const runFiles = async (params: ProcessParams): Promise<RunResult> => {
  const { paths, isTest } = params;
  PgTerminal.println(
    PgTerminal.info(`Running ${isTest ? "tests" : "client"}...`)
  );

  const { PgJsRuntime } = await PgJsRuntimeImporter.import();

  let ended: RunResult = { ok: true };
  const folderPath = isTest
    ? PgExplorer.PATHS.TESTS_DIRNAME
    : PgExplorer.PATHS.CLIENT_DIRNAME;

  // Run the script only at the given path
  if (paths?.length) {
    // The path can be a file name that's expected to run inside the `client`
    // or `tests` directory based on the command that's running
    for (const path of paths) {
      const code =
        PgExplorer.getFileContent(path) ??
        PgExplorer.getFileContent(PgCommon.joinPaths(folderPath, path));
      if (!code) throw new Error(`File '${path}' doesn't exist`);

      const fileName = PgExplorer.getItemNameFromPath(path);
      if (!PgLanguage.getIsPathJsLike(fileName)) {
        throw new Error(`File '${fileName}' is not a script file`);
      }

      const result = await PgJsRuntime.execute({ fileName, code, isTest });
      if (!result.ok && !isTest) return result;
      if (!result.ok && ended.ok) ended = result;
    }

    return ended;
  }

  // Create default client/test if the folder is empty
  const folder = PgExplorer.getFolderContent(folderPath);
  if (!folder.files.length && !folder.folders.length) {
    let DEFAULT;
    if (isTest) {
      PgTerminal.println(PgTerminal.info("Creating default test..."));
      DEFAULT = DEFAULT_TEST;
    } else {
      PgTerminal.println(PgTerminal.info("Creating default client..."));
      DEFAULT = DEFAULT_CLIENT;
    }

    const [fileName, code] = DEFAULT;
    await PgExplorer.createItem(PgCommon.joinPaths(folderPath, fileName), code);
    return await PgJsRuntime.execute({ fileName, code, isTest });
  }

  // Run all files inside the folder. A script that fails ends `run`, since
  // the next one may need what it did; `test` runs every file, as it always
  // has, and reports the first failure
  for (const fileName of folder.files.filter(PgLanguage.getIsPathJsLike)) {
    const code = PgExplorer.getFileContent(
      PgCommon.joinPaths(folderPath, fileName)
    )!;
    const result = await PgJsRuntime.execute({ fileName, code, isTest });
    if (!result.ok && !isTest) return result;
    if (!result.ok && ended.ok) ended = result;
  }

  return ended;
};

/** Default client files*/
const DEFAULT_CLIENT = [
  "client.ts",
  `// Client
console.log("My address:", pg.wallet.publicKey.toString());
const balance = await pg.connection.getBalance(pg.wallet.publicKey);
console.log(\`My balance: \${balance / web3.LAMPORTS_PER_SOL} SOL\`);
`,
];

/** Default test files */
const DEFAULT_TEST = [
  "index.test.ts",
  `describe("Test", () => {
  it("Airdrop", async () => {
    // Fetch my balance
    const balance = await pg.connection.getBalance(pg.wallet.publicKey);
    console.log(\`My balance is \${balance} lamports\`);

    // Airdrop 1 SOL
    const airdropAmount = 1 * web3.LAMPORTS_PER_SOL;
    const txHash = await pg.connection.requestAirdrop(
      pg.wallet.publicKey,
      airdropAmount
    );

    // Confirm transaction
    await pg.connection.confirmTransaction(txHash);

    // Fetch new balance
    const newBalance = await pg.connection.getBalance(pg.wallet.publicKey);
    console.log(\`New balance is \${newBalance} lamports\`);

    // Assert balances
    assert(balance + airdropAmount === newBalance);
  });
});
`,
];
