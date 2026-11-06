import { isStopped } from "../stopped";

/**
 * A failure whose message is the whole line the terminal prints: Spec 13
 * puts no "Process error:" before an unknown command or a declined wallet
 * question. Unlike a `StoppedError` it is still a failure, so a button that
 * ran the command reports it as one.
 */
export class TerminalLineError extends Error {
  name = "TerminalLineError";
}

/**
 * The design system's terminal line variants a line takes: `error` for a
 * command refused or failed, `info` for a running command's progress
 */
export type LineTone = "error" | "info";

/** A `TerminalLineError` the terminal prints in one of those variants */
export class TonedLineError extends TerminalLineError {
  /**
   * @param tone how the terminal colours the line
   * @param message the line, plain: the assistant and button toasts read it
   */
  constructor(readonly tone: LineTone, message: string) {
    super(message);
  }
}

/** The codes behind `PgTerminal.error` and `PgTerminal.info` too */
const TONES: Record<LineTone, (text: string) => string> = {
  error: (text) => `\x1b[1;31m${text}\x1b[0m`,
  info: (text) => `\x1b[1;34m${text}\x1b[0m`,
};

/**
 * Colour a line for the terminal.
 *
 * @param tone its variant
 * @returns a function from the line to the line with its colour codes
 */
export const toneWith = (tone: LineTone) => TONES[tone];

/**
 * How the terminal colours the line a command that threw prints.
 *
 * @param error what the command threw
 * @returns a `TonedLineError`'s tone, else none (plain)
 */
export const lineTone = (error: unknown) =>
  error instanceof TonedLineError ? error.tone : undefined;

/** Whether a failure prints as its own line, with no prefix */
const isTerminalLine = (error: unknown): error is TerminalLineError =>
  error instanceof TerminalLineError;

/** An error that says it is its own line (`PgServerError.isPlain`) */
const isPlainRefusal = (error: unknown): error is Error =>
  error instanceof Error && (error as { isPlain?: unknown }).isPlain === true;

/**
 * The line the terminal prints for a command that threw.
 *
 * @param error what the command threw
 * @returns a stop's or a `TerminalLineError`'s message as is, anything else
 * after "Process error:"; plain, for `lineTone` to colour
 */
export const processErrorLine = (error: unknown) => {
  if (isStopped(error) || isTerminalLine(error)) return error.message;
  // A refusal the person can act on, such as signing in to build (HOO-2422)
  if (isPlainRefusal(error)) return error.message;
  const message = error instanceof Error ? error.message : undefined;
  return `Process error: ${message || error}`;
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("utils/terminal/line-error", () => {
    it("keeps a toned line's message plain, and reads its tone", () => {
      const offline = new TonedLineError("error", "You're offline.");
      expect(processErrorLine(offline)).toBe("You're offline.");
      expect(lineTone(offline)).toBe("error");
      expect(offline).toBeInstanceOf(TerminalLineError);
    });

    it("prints a refusal that is its own line without the prefix", () => {
      const refusal = Object.assign(
        new Error("Sign in with GitHub to build."),
        { isPlain: true }
      );
      expect(processErrorLine(refusal)).toBe("Sign in with GitHub to build.");
      expect(processErrorLine(new Error("boom"))).toBe("Process error: boom");
    });

    it("gives any other failure no tone", () => {
      expect(lineTone(new Error("boom"))).toBeUndefined();
      expect(
        lineTone(new TerminalLineError("`ls` is not a command."))
      ).toBeUndefined();
    });

    it("colours an error line red", () => {
      expect(toneWith("error")("Offline.")).toBe("\x1b[1;31mOffline.\x1b[0m");
    });

    it("colours an info line blue", () => {
      expect(toneWith("info")("Slow.")).toBe("\x1b[1;34mSlow.\x1b[0m");
    });

    it("prints a TerminalLineError as is", () => {
      expect(
        processErrorLine(new TerminalLineError("`ls` is not a command."))
      ).toBe("`ls` is not a command.");
    });

    it("prints any other error after Process error:", () => {
      expect(processErrorLine(new Error("boom"))).toBe("Process error: boom");
    });

    it("prints a thrown string after Process error:", () => {
      expect(processErrorLine("AccountNotFound")).toBe(
        "Process error: AccountNotFound"
      );
    });
  });
}
