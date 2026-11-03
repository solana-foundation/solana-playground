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

/** Whether a failure prints as its own line, with no prefix */
const isTerminalLine = (error: unknown): error is TerminalLineError =>
  error instanceof TerminalLineError;

/**
 * The line the terminal prints for a command that threw.
 *
 * @param error what the command threw
 * @returns a stop's or a `TerminalLineError`'s message as is, anything else
 * after "Process error:"
 */
export const processErrorLine = (error: unknown) => {
  if (isStopped(error) || isTerminalLine(error)) return error.message;
  const message = error instanceof Error ? error.message : undefined;
  return `Process error: ${message || error}`;
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("utils/terminal/line-error", () => {
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
