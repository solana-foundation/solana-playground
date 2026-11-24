import { Emoji } from "../../constants";
import { PgTerminal } from "../terminal";
import type { OutputLevel } from "./protocol";

/** The colour each `console` level prints in */
const COLOUR: Record<
  Exclude<OutputLevel, "mocha">,
  (text: string) => string
> = {
  log: (text) => text,
  info: PgTerminal.info,
  warn: PgTerminal.warning,
  error: PgTerminal.error,
};

/**
 * What the terminal prints for a line of the sandbox's output, or
 * `undefined` for none: project code's `console` is indented under the file
 * name, and mocha's report keeps only its indented lines, coloured, without
 * the stack traces of the transpiled code.
 *
 * @param level how the line was printed
 * @returns a function of the line's text
 */
export const formatOutputFor =
  (level: OutputLevel) =>
  (text: string): string | undefined => {
    if (level !== "mocha") return "    " + COLOUR[level](text);
    if (!text.startsWith("  ")) return undefined;
    return (
      text
        .replace(Emoji.CHECKMARK_BUTTON, PgTerminal.success(Emoji.CHECKMARK))
        // Make '1) testname' red
        .replace(/\s+\d\)\s\w*$/, PgTerminal.error)
        .replace(/\d+\spassing/, PgTerminal.success)
        .replace(/\d+\sfailing/, PgTerminal.error)
        // TODO: show where the error happened in the user's code
        .replace(/\s+at.*$/gm, "")
    );
  };

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("utils/js-runtime/output", () => {
    it("indents project code's console lines", () => {
      expect(formatOutputFor("log")("hello")).toBe("    hello");
    });

    it("keeps mocha's indented lines and colours the counts", () => {
      expect(formatOutputFor("mocha")("  1 passing (2ms)")).toBe(
        `  ${PgTerminal.success("1 passing")} (2ms)`
      );
      expect(formatOutputFor("mocha")("  1 failing")).toBe(
        `  ${PgTerminal.error("1 failing")}`
      );
      expect(formatOutputFor("mocha")("")).toBeUndefined();
    });

    it("drops the stack trace of a failing test", () => {
      expect(
        formatOutputFor("mocha")("  Error: boom\n      at eval (x.js:1:1)")
      ).toBe("  Error: boom");
    });
  });
}
