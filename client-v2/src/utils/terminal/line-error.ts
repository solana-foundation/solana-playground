import { isStopped, StoppedError } from "../stopped";

/**
 * A failure whose message is the whole line the terminal prints: Spec 13
 * puts no "Process error:" before an unknown command or a declined wallet
 * question. Unlike a `StoppedError` it is still a failure, so a button that
 * ran the command reports it as one, and the line prints as `error`.
 */
export class TerminalLineError extends Error {
  name = "TerminalLineError";
}

/**
 * The design system's terminal line variants a line takes (Spec 13): `error`
 * for a command refused or failed, `warning` for a notice, `info` for a running
 * command's progress. A done line calls `PgTerminal.success`, and no line a
 * command throws is done.
 */
export type LineTone = "error" | "warning" | "info";

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

/** The codes behind `PgTerminal.error`, `.warning` and `.info` */
const TONES: Record<LineTone, (text: string) => string> = {
  error: (text) => `\x1b[1;31m${text}\x1b[0m`,
  warning: (text) => `\x1b[1;33m${text}\x1b[0m`,
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
 * How the terminal colours the line a command that threw prints. A stop is a
 * notice, since the person asked for it and nothing failed; a `TonedLineError`
 * says its own; anything else was refused or failed.
 *
 * @param error what the command threw
 * @returns the line's variant
 */
export const lineTone = (error: unknown): LineTone => {
  if (error instanceof TonedLineError) return error.tone;
  return isStopped(error) ? "warning" : "error";
};

/** Whether a failure prints as its own line, with no prefix */
const isTerminalLine = (error: unknown): error is TerminalLineError =>
  error instanceof TerminalLineError;

/**
 * The line the terminal prints for a command that threw.
 *
 * @param error what the command threw
 * @returns a stop's or a `TerminalLineError`'s message as is, anything else
 * after "Process error:"; plain, for `lineTone` to colour
 */
export const processErrorLine = (error: unknown) => {
  if (isStopped(error) || isTerminalLine(error)) return error.message;
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

    it("reads a stop as a warning", () => {
      expect(lineTone(new StoppedError("Stopped."))).toBe("warning");
    });

    it("reads a line that is its own failure as an error", () => {
      expect(lineTone(new TerminalLineError("`ls` is not a command."))).toBe(
        "error"
      );
    });

    it("reads any other failure as an error", () => {
      expect(lineTone(new Error("boom"))).toBe("error");
      expect(lineTone("AccountNotFound")).toBe("error");
    });

    it.each([
      ["error", "\x1b[1;31mLine\x1b[0m"],
      ["warning", "\x1b[1;33mLine\x1b[0m"],
      ["info", "\x1b[1;34mLine\x1b[0m"],
    ] as const)("colours a line %s", (tone, coloured) => {
      expect(toneWith(tone)("Line")).toBe(coloured);
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
