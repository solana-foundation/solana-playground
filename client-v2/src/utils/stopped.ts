/**
 * A run the person stopped (Ctrl+C or the console strip's Stop). Not a
 * failure: the terminal prints its message as is, without "Process error",
 * no button toasts it, and the flow returns to where it was before the run.
 * Its message says what was stopped and what was left behind.
 */
export class StoppedError extends Error {
  name = "StoppedError";
}

/** The words every stopped run's line starts with (Spec 13's copy) */
export const STOPPED = "Stopped.";

/** Whether a run ended because the person stopped it */
export const isStopped = (error: unknown): error is StoppedError =>
  error instanceof StoppedError;

/**
 * End the run here if it was stopped.
 *
 * @param signal the run's stop signal
 * @param message what was stopped and what was left behind
 * @throws {StoppedError} when the signal is aborted
 */
export const throwIfStopped = (signal: AbortSignal, message: string) => {
  if (signal.aborted) throw new StoppedError(message);
};
