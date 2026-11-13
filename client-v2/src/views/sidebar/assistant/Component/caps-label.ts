const UPPER = /[A-Z]/;
const UPPER_OR_DIGIT = /[A-Z0-9]/;
const LABEL_CHAR = /[A-Z0-9 _-]/;

/**
 * Where the all-caps label at `start` ends, `IDENTIFIER:` or
 * `ACCOUNT TYPES RETURNED (by entity.kind):`, as
 * `[A-Z][A-Z0-9 _-]*[A-Z0-9](?: \([^)\n]*\))?:` read it; undefined for none.
 * `closeFrom` finds the first `)` at or after an index.
 */
const labelEndWith =
  (closeFrom: (index: number) => number) => (line: string, start: number) => {
    if (!UPPER.test(line[start] ?? "")) return undefined;
    let run = start + 1;
    while (run < line.length && LABEL_CHAR.test(line[run])) run++;
    // `:` and `(` are outside the run's characters, so only its end can close the label
    if (
      line[run] === ":" &&
      run - 1 > start &&
      UPPER_OR_DIGIT.test(line[run - 1])
    )
      return run + 1;
    if (
      line[run] === "(" &&
      line[run - 1] === " " &&
      run - 2 > start &&
      UPPER_OR_DIGIT.test(line[run - 2])
    ) {
      const close = closeFrom(run + 1);
      if (close !== -1 && line[close + 1] === ":") return close + 2;
    }
    return undefined;
  };

/**
 * One `\n`-free piece of a description with its labels in bold. A label may
 * start the piece or follow a `\r`, U+2028 or U+2029, where a multiline `^`
 * also matches; one label's `(...)` may run past such a break.
 */
const emphasisePieceLabels = (piece: string) => {
  let closeAt = -1;
  let closeChecked = -1;
  const closeFrom = (index: number) => {
    // Starts only move forward, so the last `)` found serves until passed
    if (closeChecked === -1 || (closeAt !== -1 && closeAt < index)) {
      closeAt = piece.indexOf(")", index);
      closeChecked = index;
    }
    return closeAt;
  };
  const labelEnd = labelEndWith(closeFrom);
  const starts = [0];
  for (let i = 0; i < piece.length; i++) {
    if (/[\r\u2028\u2029]/.test(piece[i])) starts.push(i + 1);
  }
  let out = "";
  let copied = 0;
  for (const start of starts) {
    if (start < copied) continue;
    const end = labelEnd(piece, start);
    if (end === undefined) continue;
    out += `${piece.slice(copied, start)}**${piece.slice(start, end)}**`;
    copied = end;
  }
  return out + piece.slice(copied);
};

/**
 * Tool descriptions are Markdown by convention; servers that write `LABEL:`
 * headings get them in bold, as
 * `/^([A-Z][A-Z0-9 _-]*[A-Z0-9](?: \([^)\n]*\))?:)/gm` would find them. A
 * scan, since the regex backtracks quadratically on a long line a server sends
 */
export const emphasiseLabels = (description: string) =>
  description.split("\n").map(emphasisePieceLabels).join("\n");
if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("views/sidebar/assistant/Component/caps-label", () => {
    it.each([
      ["IDENTIFIER: x", "**IDENTIFIER:** x"],
      [
        "ACCOUNT TYPES RETURNED (by entity.kind): x",
        "**ACCOUNT TYPES RETURNED (by entity.kind):** x",
      ],
      ["Intro\nNEXT STEP: y", "Intro\n**NEXT STEP:** y"],
      ["a\rLABEL: y", "a\r**LABEL:** y"],
      ["A: x", "A: x"],
      ["AB (x) y", "AB (x) y"],
      ["AB- : x", "AB- : x"],
      ["see NOTE: x", "see NOTE: x"],
      ["1A: x", "1A: x"],
      ["AB(x): y", "AB(x): y"],
    ])("emphasises the labels of %j", (description, expected) => {
      expect(emphasiseLabels(description)).toBe(expected);
    });

    it(
      "scans a long line of unclosed labels after carriage returns in linear time",
      { timeout: 1000 },
      () => {
        const description = "AA (\r".repeat(300_000);
        expect(emphasiseLabels(description)).toBe(description);
      }
    );
  });
}
