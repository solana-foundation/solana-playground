// Kept apart from `js-runtime.ts`, which loads lazily with mocha and the
// TypeScript compiler, so a command can tell a refused run without loading them.

/**
 * `PgJsRuntime.execute` refused because tests or a client script were
 * already running. Its message names the run in progress.
 */
export class RunBusyError extends Error {
  name = "RunBusyError";
}

/**
 * Whether a run was refused because another run was in progress.
 *
 * @param error what a run threw
 * @returns `true` for a `RunBusyError`, by class or by its `name` when two
 * copies of this module exist
 */
export const isRunBusy = (error: unknown): error is RunBusyError =>
  error instanceof RunBusyError ||
  (error instanceof Error && error.name === "RunBusyError");
