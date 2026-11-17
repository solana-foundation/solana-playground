import { createTracker } from "@/shared/lib/telemetry";

/** What a run executes: the project's test files, or its client scripts */
export type RunKind = "test" | "client";

/** How a run that ran its files ended: `failed` when any file failed */
export type RunOutcome = "passed" | "failed";

/**
 * Why a run could not run the user's code: `busy` when tests or a client
 * were already running, `other` for anything else (a missing file, a file
 * that is not a script, a test file without `describe`, a forbidden global,
 * an import that could not load)
 */
export type RunErrorReason = "busy" | "other";

type RunEvents = {
  /**
   * A `run` or `test` ended, typed in the terminal or started from the
   * explorer: `test` ran every file it was given, `run` ran its scripts until
   * one failed. `outcome` is `failed` when any file failed: a test file when
   * mocha reported a failure, a client script when it threw an error it did
   * not catch.
   */
  run_finished: { kind: RunKind; outcome: RunOutcome };
  /**
   * `run` or `test` threw instead of finishing, so no `run_finished` is sent
   * for it. `reason` is `busy` when the runtime refused because another run
   * was in progress, else `other`.
   */
  run_errored: { kind: RunKind; reason: RunErrorReason };
};

export const runTelemetry = createTracker<RunEvents>();
