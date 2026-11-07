/** What a program's own log line starts with, as the Solana runtime writes it */
export const PROGRAM_LOG = "Program log: ";

/** Whether a log line is one a program wrote with `msg!` */
export const isProgramLog = (line: string): boolean =>
  line.startsWith(PROGRAM_LOG);

/**
 * What the program said on a log line, without the runtime's
 * "Program log: " prefix; the line itself when it has none
 */
export const programLogText = (line: string): string =>
  isProgramLog(line) ? line.slice(PROGRAM_LOG.length) : line;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("shared/lib/program-log", () => {
    it("strips the runtime's prefix, and leaves any other line alone", () => {
      expect(programLogText("Program log: Hello, World!")).toBe(
        "Hello, World!"
      );
      expect(programLogText("Program X success")).toBe("Program X success");
      expect(isProgramLog("Program log: Instruction: Hello")).toBe(true);
    });
  });
}
