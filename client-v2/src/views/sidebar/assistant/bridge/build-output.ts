import type { Disposable } from "../../../../utils";

/** Result of the most recent build, as the compiler reported it */
export interface BuildOutput {
  /** Raw `stderr` from the build server, before `improveOutput` touches it */
  stderr: string;
  /** Whether the compilation failed */
  failed: boolean;
  /** When the build finished */
  at: number;
  /**
   * The workspace that produced it, or `null` when there was none.
   *
   * One value is kept for the whole session, so without this a reader cannot
   * tell the current project's report from the one before it.
   */
  workspace: string | null;
}

/**
 * The compiler's own words, kept for the assistant.
 *
 * The client does not otherwise retain them: `build` prints
 * `improveOutput(stderr)` to the terminal and stores a `lastBuildFailed`
 * boolean on `PgProgramInfo`. Everything else — file paths, the error code, the
 * span markers — is discarded, and `PgTerminal` has no way to read it back.
 *
 * Explaining a real error needs the real text, so the build command hands the
 * raw output here. See `docs/decisions.md` -> D4.
 */
export class PgBuildOutput {
  /** The most recent build, or `null` if nothing has been built this session */
  static get latest(): BuildOutput | null {
    return PgBuildOutput._latest;
  }

  /**
   * Record the result of a build.
   *
   * @param stderr raw output from the build server
   * @param workspace the workspace that produced it. Passed in rather than
   * read here: reaching for `PgExplorer` would pull `indexedDB` into a module
   * several unit tests import.
   */
  static set(stderr: string, workspace: string | null) {
    PgBuildOutput._latest = {
      stderr,
      // Mirror the build command's own check rather than inventing a second one
      failed: stderr.includes("error: could not compile"),
      at: Date.now(),
      workspace,
    };
    for (const cb of PgBuildOutput._listeners) cb(PgBuildOutput._latest);
  }

  /**
   * @param cb runs on every build, and once immediately with the current value
   * @returns a disposable to clear the event
   */
  static onDidChange(cb: (output: BuildOutput | null) => void): Disposable {
    PgBuildOutput._listeners.add(cb);
    cb(PgBuildOutput._latest);
    return { dispose: () => PgBuildOutput._listeners.delete(cb) };
  }

  private static _latest: BuildOutput | null = null;
  private static readonly _listeners = new Set<
    (output: BuildOutput | null) => void
  >();
}

/**
 * Remove diagnostics that are on every build regardless of the user's code.
 *
 * `switchboard_solana` and `switchboard_v2` overflow the SBF stack limit in
 * their derived `Debug` impls, so every single build reports them. They are not
 * the user's fault and an assistant that explains them is worse than one that
 * stays quiet. `improveOutput` strips them for the terminal for the same reason.
 *
 * @param stderr raw build output
 * @returns the output without the known-irrelevant lines
 */
export const stripKnownNoise = (stderr: string) => {
  return (
    stderr
      .split("\n")
      .filter(
        (line) => !/^Error: Function .*Stack offset of \d+ exceeded/.test(line)
      )
      .join("\n")
      // The server compiles under a per-session directory, so every path it
      // reports is prefixed with that uuid. Left in, it sends the reader after
      // files that do not exist in the project. `improveOutput` strips it for
      // the terminal for the same reason.
      .replace(
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//g,
        ""
      )
      .trim()
  );
};
