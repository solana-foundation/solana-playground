import type {
  BuildFailedReason,
  BuildFramework,
} from "@/features/program-build";
import { buildTelemetry } from "@/features/program-build";
import { escapeRegExp } from "@/shared/lib/escape-reg-exp";

import {
  PgCommon,
  PgExplorer,
  PgGlobal,
  PgLanguage,
  PgPackage,
  PgProgramInfo,
  PgServer,
  PgSettings,
  PgTerminal,
  PgWeb3,
  TupleFiles,
} from "../../utils";
import { STOPPED, throwIfStopped } from "../../utils/stopped";
import { isMacroSymptomText } from "../../views/flow/stages/build-report";
import { PgBuildOutput } from "../../views/sidebar/assistant/bridge/build-output";
import { createCmd } from "../create";
import { emptySourceError, isEmptyProgram, PROGRAM_FILE } from "./empty-source";

export const build = createCmd({
  name: "build",
  description: "Build your program",
  needsConnection: true,
  stoppable: true,
  handle: async ({ signal }) => {
    // Spec 09: an empty program file is named and nothing is sent. The
    // refusal counts as a failed build, so Deploy does not go on with the
    // binary of the program that file used to hold.
    if (isEmptyProgram(PgExplorer.getFileContent(PROGRAM_FILE))) {
      PgProgramInfo.update({ lastBuildFailed: true });
      throw emptySourceError(PROGRAM_FILE);
    }

    PgGlobal.update({ buildLoading: true });
    PgTerminal.println(PgTerminal.info("Building..."));

    // `PgProgramInfo` follows the open project, so a reply for one built before a switch is not written into another
    const workspace = PgExplorer.currentWorkspaceId;
    // A temporary project has no name
    const workspaceName = PgExplorer.currentWorkspaceName ?? "your project";
    const isStillOpen = () => PgExplorer.currentWorkspaceId === workspace;
    // Writing the verdict into a project that is not open would bypass sync's dirty mark, so the user is told instead
    const sayDroppedUnlessOpen = () => {
      if (isStillOpen()) return;
      PgTerminal.println(
        PgTerminal.warning(
          `The result of building "${workspaceName}" was dropped because another project was opened. Build it again before you deploy it.`
        )
      );
    };

    try {
      const files = getBuildFiles();
      const framework = frameworkOf(files);
      buildTelemetry.track("build_started", { framework });
      const result = await buildProgram(files, signal).catch((e: unknown) => {
        // The aborted request fails; say it was stopped, not that it failed.
        // Only "Stopped.": the server may still finish, its reply is not kept.
        // A stop is no outcome, so it sends no event
        throwIfStopped(signal, STOPPED);
        buildTelemetry.track("build_failed", {
          framework,
          reason: reasonOf(e),
        });
        // Deploy's stale-build guard reads `lastBuildFailed`, so the previous binary is not shipped
        if (isStillOpen()) PgProgramInfo.update({ lastBuildFailed: true });
        sayDroppedUnlessOpen();
        throw e;
      });
      // A reply that lands after a stop is dropped: nothing of it is kept
      throwIfStopped(signal, STOPPED);
      sayDroppedUnlessOpen();
      // Server only returns `uuid` on the first build of a session, so we
      // can't use it as a success signal. Mirror the server's own check on
      // `stderr` so deploy can warn before reusing a stale binary.
      const failed = result.stderr.includes("error: could not compile");
      // The one outcome of this build: what follows keeps its result, and a
      // throw there is not the build's
      if (failed) {
        buildTelemetry.track("build_failed", { framework, reason: "compile" });
      } else {
        buildTelemetry.track("build_succeeded", {
          framework,
          has_idl: !!result.idl,
        });
      }
      if (isStillOpen()) {
        PgProgramInfo.update({
          uuid: result.uuid ?? undefined,
          lastBuildFailed: failed,
          // The stable server builds no IDL; a missing one keeps the IDL the browser holds
          ...(result.idl && { idl: result.idl }),
        });
      }
      // `improveOutput` is lossy by design; the assistant needs the raw text.
      // The workspace travels with it: one output is kept for the session, so
      // without it the next project inherits this report.
      if (isStillOpen()) {
        PgBuildOutput.set(
          result.stderr,
          PgExplorer.currentWorkspaceName ?? null
        );
      }
      PgTerminal.println(improveOutput(result.stderr));
    } finally {
      PgGlobal.update({ buildLoading: false });
    }
  },
});

/** Seahorse's compiler refused the Python sources */
class SeahorseCompileError extends Error {
  constructor() {
    super("Seahorse compile failed");
    this.name = "SeahorseCompileError";
  }
}

/**
 * What the build's sources are written with, for its events: Python is
 * Seahorse, a Rust file naming an `anchor_lang::` path is Anchor, any other
 * Rust Native.
 * By the file name and content, not `PgLanguage` or `PgFramework`: the
 * command's tests stand the utils barrel in with a mock.
 *
 * @param files the files the build sends
 * @returns the framework
 */
export const frameworkOf = (files: TupleFiles): BuildFramework => {
  if (files.some(([path]) => path.endsWith(".py"))) return "seahorse";
  const isAnchorSource = ([path, content]: [string, string]) =>
    path.endsWith(".rs") && /\banchor_lang::/.test(content);
  if (files.some(isAnchorSource)) return "anchor";
  return "native";
};

/**
 * Why a build did not succeed, for `build_failed`. A server error is read by
 * shape (`answered`), as `buildFailureOf` in `views/flow/state/stage.ts`
 * reads it.
 *
 * @param err what the build threw
 * @returns the reason
 */
const reasonOf = (err: unknown): BuildFailedReason => {
  if (err instanceof SeahorseCompileError) return "compile";
  return (err as { answered?: unknown } | null)?.answered === false
    ? "network"
    : "server";
};

/**
 * Compile the current project.
 *
 * @param buildFiles the files `getBuildFiles` gathered
 * @param signal aborts the request to the build server
 * @returns the build response
 */
const buildProgram = async (buildFiles: TupleFiles, signal: AbortSignal) => {
  const pythonFiles = buildFiles.filter(
    ([path]) => PgLanguage.getFromPath(path)?.name === "Python"
  );
  if (pythonFiles.length > 0) return await buildPython(pythonFiles, signal);
  return await buildRust(buildFiles, signal);
};

/**
 * Get the files necessary for the build process.
 *
 * @returns the necessary data for the build request
 */
const getBuildFiles = () => {
  let programPkStr = PgProgramInfo.getPkStr();
  if (!programPkStr) {
    const kp = PgWeb3.Keypair.generate();
    PgProgramInfo.update({ kp });
    programPkStr = kp.publicKey.toBase58();
  }

  /**
   * Update the `declare_id!` macro in Rust source content with the current
   * program's public key.
   *
   * @param content - The Rust source file content as a string
   * @returns An object containing:
   * - `content` - The updated source content with the new program ID injected
   * - `updated` - A boolean indicating whether the ID was updated
   */
  const updateIdRust = (content: string) => {
    let updated = false;
    let insideBlockComment = false;
    // eslint-disable-next-line security/detect-unsafe-regex -- linear: `::` ends each `\w+` repetition and `\w` matches no `:`
    const rustDeclareIdRegex = /^(([\w]+::)*)declare_id!\("(\w*)"\)/;
    const newContent = content
      .split("\n")
      .map((line) => {
        // Track block comment opening
        if (line.includes("/*")) insideBlockComment = true;

        // If inside block comment, skip line entirely
        if (insideBlockComment) {
          // Track block comment closing
          if (line.includes("*/")) insideBlockComment = false;
          return line;
        }

        // Skip single-line comments
        if (line.trimStart().startsWith("//")) return line;

        return line.replace(rustDeclareIdRegex, (match) => {
          const res = rustDeclareIdRegex.exec(match);
          if (!res) return match;
          updated = true;

          // `res[1]` could be `solana_program::` or `undefined`
          return (res[1] ?? "") + `declare_id!("${programPkStr}")`;
        });
      })
      .join("\n");

    return { content: newContent, updated };
  };

  const updateIdPython = (content: string) => {
    let updated = false;

    const pythonDeclareIdRegex = /^declare_id\(("|')(\w*)("|')\)/gm;
    const newContent = content.replace(pythonDeclareIdRegex, (match) => {
      const res = pythonDeclareIdRegex.exec(match);
      if (!res) return match;
      updated = true;
      return `declare_id('${programPkStr}')`;
    });

    return { content: newContent, updated };
  };

  const getUpdatedProgramIdContent = (path: string) => {
    const content = files[path].content;
    if (content) {
      switch (PgLanguage.getFromPath(path)?.name) {
        case "Rust":
          return updateIdRust(content);
        case "Python":
          return updateIdPython(content);
      }
    }

    return { content, updated: false };
  };

  const files = PgExplorer.files;
  const buildFiles: TupleFiles = [];
  let alreadyUpdatedId = false;

  // Prioritize files where we are likely to find a rust `declare_id!`
  const prioritizedFileNames = ["lib.rs", "id.rs"];
  const prioritizedFilePaths = Object.keys(files).reduce((acc, path) => {
    if (prioritizedFileNames.some((n) => path.endsWith(n))) acc.unshift(path);
    else acc.push(path);

    return acc;
  }, [] as string[]);
  for (const path of prioritizedFilePaths) {
    if (!path.startsWith(PgExplorer.getCurrentSrcPath())) continue;

    let content = files[path].content;
    if (!alreadyUpdatedId) {
      const updateIdResult = getUpdatedProgramIdContent(path);
      content = updateIdResult.content;
      alreadyUpdatedId = updateIdResult.updated;
    }
    if (!content) continue;

    // Remove the workspace from path because build only needs /src
    const buildPath = PgCommon.joinPaths(
      PgExplorer.PATHS.ROOT_DIR_PATH,
      PgExplorer.getRelativePath(path)
    );
    buildFiles.push([buildPath, content]);
  }

  return buildFiles;
};

/**
 * Convert Python files into Rust with seahorse-compile-wasm and run `_buildRust`.
 *
 * @param pythonFiles Python files in `src/`
 * @param signal aborts the request to the build server
 * @returns the build response
 */
const buildPython = async (pythonFiles: TupleFiles, signal: AbortSignal) => {
  const { compileSeahorse } = await PgPackage.import("seahorse-compile");

  const rustFiles = pythonFiles.flatMap(([path, content]) => {
    const seahorseProgramName =
      PgExplorer.getItemNameFromPath(path).split(".py")[0];
    const compiledContent = compileSeahorse(content, seahorseProgramName);

    if (compiledContent.length === 0) {
      throw new SeahorseCompileError();
    }

    // Seahorse compile outputs a flattened array like [filepath, content, filepath, content]
    const files: TupleFiles = [];
    for (let i = 0; i < compiledContent.length; i += 2) {
      const filePath = compiledContent[i];
      let fileContent = compiledContent[i + 1];
      // The build server detects #[program] to determine if Anchor
      // Seahorse (without rustfmt) outputs # [program]
      fileContent = fileContent.replace("# [program]", "#[program]");
      files.push([filePath, fileContent]);
    }

    return files;
  });

  return await buildRust(rustFiles, signal);
};

/**
 * Build Rust files and return the output.
 *
 * @param files Rust files from `src/`
 * @param signal aborts the request to the build server
 * @returns the build response
 */
const buildRust = async (files: TupleFiles, signal: AbortSignal) => {
  if (!files.length) throw new Error("Couldn't find any Rust files.");

  return await PgServer.build(
    {
      files,
      uuid: PgProgramInfo.uuid,
      flags: PgSettings.build.flags,
    },
    { signal }
  );
};

/**
 * Improve build output that is returned from the build request.
 *
 * @param output build output(stderr)
 * @returns the improved output
 */
const improveOutput = (output: string) => {
  output = output
    // Blocking "waiting for file lock on package cache"
    .replaceAll("Blocking waiting for file lock on package cache\n", "")

    // Remove full paths
    .replace(/(\S*\/)src/gm, (match, head) => match.replace(head, ""))
    .replace(/\s\(\/home.+?(?=\s)/gm, "")
    .replace(/(\/home\/\w+)\//gm, (match, home) => match.replace(home, "~"))

    // Remove compiling output
    .replace(/\s*Compiling\ssolpg.*/, "")

    // Replace `solpg` name with the current workspace name
    .replaceAll("solpg", PgExplorer.currentWorkspaceName ?? "solpg")

    // Remove stack size error
    .replace(/^\s*Error:\sFunction.*\n/gm, "")

    // Remove nightly macro backtrace
    .replaceAll(
      "(in Nightly builds, run with -Z macro-backtrace for more info)",
      ""
    )

    // Remove `Some errors have detailed explanations: E0412, E0432, E0433.`
    .replace(/Some\serrors\shave\sdetailed\sexplanations:.*/, "");

  // Remove uuid from folders
  const uuid = PgProgramInfo.uuid;
  if (uuid) {
    // eslint-disable-next-line security/detect-non-literal-regexp -- the server's uuid is escaped
    const folder = new RegExp(`${escapeRegExp(uuid)}\\/?`, "gm");
    output = output.replace(folder, "");
  }

  // Remove `rustc` error line
  let startIndex = output.indexOf("For more");
  if (startIndex !== -1) {
    const endIndex = output.indexOf("\n", startIndex);
    output = output.substring(0, startIndex) + output.substring(endIndex + 1);
  }

  // Remove whitespace before `rustc` finished text
  startIndex = output.indexOf("Finished release");
  if (startIndex !== -1) {
    const whiteSpaceStartIndex = startIndex - 7; // 7 is the most amount of whitespace
    const fromTime = output.substring(output.indexOf(" in", startIndex));
    // First newline only, by index: js/incomplete-sanitization reads replace("\n", ...) as a missed global replace
    const newlineIndex = fromTime.indexOf("\n");
    output =
      output.substring(0, whiteSpaceStartIndex) + // Until whitespace start
      output.substring(whiteSpaceStartIndex, startIndex).replaceAll(" ", "") +
      PgTerminal.success("Build successful. ") +
      "Completed" +
      (newlineIndex === -1
        ? fromTime
        : fromTime.slice(0, newlineIndex) + "." + fromTime.slice(newlineIndex));
  }

  output = output.substring(0, output.length - 1);

  // Improve errors
  if (PgSettings.build.improveErrors) {
    const MAX_ERROR_AMOUNT = 3;

    const errorIndices = PgCommon.matchAll(output, /error[:[]/)
      .map((match) => match.index)
      .filter(PgCommon.isNonNullish);
    if (errorIndices.length) {
      const errors = errorIndices
        .map((errorIndex, i) => output.slice(errorIndex, errorIndices[i + 1]))
        .filter((err) => !err.includes("could not compile"));

      // Hide common useless errors i.e. some errors such as:
      // ```
      //   error[E0432]: unresolved import `crate`
      //   --> src/lib.rs:7:1
      //   |
      // 7 | #[program]
      //   | ^^^^^^^^^^ could not find `__client_accounts_initialize` in the crate root
      // ```
      //
      // Macro errors like the above are not the cause of the error, they are a
      // symptom of another error.
      const hiddenErrors = errors.filter(isMacroSymptomText);

      // Prioritize the most common errors, order matters
      const prioritizedErrors: string[] = [];
      for (const error of errors) {
        if (hiddenErrors.includes(error)) continue;
        if (error.includes("cannot find")) prioritizedErrors.unshift(error);
      }
      prioritizedErrors.reverse();

      const remainingErrors = errors.filter(
        (err) => !prioritizedErrors.includes(err) && !hiddenErrors.includes(err)
      );
      const displayErrors = prioritizedErrors.concat(remainingErrors);

      // Output should be overridden only in the case of display errors length
      // being non-zero
      if (displayErrors.length) {
        output = displayErrors.reduce(
          (acc, cur, i) => (i < MAX_ERROR_AMOUNT ? acc + cur : acc),
          ""
        );

        if (displayErrors.length > MAX_ERROR_AMOUNT) {
          output += [
            "Note: This is a shorter version of the error logs to make it easier to debug.",
            `Currently ${PgTerminal.bold(
              MAX_ERROR_AMOUNT.toString()
            )} errors are displayed but there are ${PgTerminal.bold(
              displayErrors.length.toString()
            )} errors.`,
            'Disable "Improve build errors" setting to see the full error output.',
          ].join(" ");
        }
      }
    }
  }

  return output;
};
