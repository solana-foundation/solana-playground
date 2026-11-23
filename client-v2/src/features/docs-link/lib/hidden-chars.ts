/**
 * Characters that change how code reads without changing what runs: the
 * Unicode direction controls ("Trojan Source", CVE-2021-42574) and the
 * characters that draw nothing. A link is anyone's to write, so the question
 * before its first Run shows each one as a marker instead of rendering it.
 * Written as escapes, so this file holds none of them itself.
 */
const HIDDEN =
  /[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/** A piece of a line: text as written, or one hidden character */
export type LinePart = { text: string } | { hidden: string };

/** @returns the character's code point, as `U+202E` */
export const codePointOf = (char: string) =>
  `U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;

/**
 * @param line one line of code
 * @returns the line cut around its hidden characters, in order
 */
export const partsOf = (line: string): LinePart[] => {
  const parts: LinePart[] = [];
  let last = 0;
  for (const match of line.matchAll(HIDDEN)) {
    const at = match.index ?? last;
    if (at > last) parts.push({ text: line.slice(last, at) });
    parts.push({ hidden: codePointOf(match[0]) });
    last = at + match[0].length;
  }
  if (last < line.length || !parts.length) {
    parts.push({ text: line.slice(last) });
  }
  return parts;
};

/** @returns how many hidden characters the code holds */
export const countHidden = (code: string) => code.match(HIDDEN)?.length ?? 0;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("features/docs-link/lib/hidden-chars", () => {
    it("cuts a line around a direction override", () => {
      expect(partsOf("a\u202Eb")).toEqual([
        { text: "a" },
        { hidden: "U+202E" },
        { text: "b" },
      ]);
    });

    it("keeps a plain line whole, an empty one included", () => {
      expect(partsOf("const a = 1;")).toEqual([{ text: "const a = 1;" }]);
      expect(partsOf("")).toEqual([{ text: "" }]);
    });

    it("counts every hidden character, bidi and zero-width alike", () => {
      expect(countHidden("\u2066x\u2069 \u200B\uFEFF")).toBe(4);
      expect(countHidden("plain")).toBe(0);
    });
  });
}
