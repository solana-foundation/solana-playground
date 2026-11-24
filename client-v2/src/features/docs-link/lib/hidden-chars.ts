/**
 * Characters that change how code reads without changing what runs: the
 * Unicode direction controls ("Trojan Source", CVE-2021-42574) and every
 * default-ignorable character, which draws nothing (zero-width spaces,
 * Hangul fillers, variation selectors, tag characters). A link is anyone's to write, so the question
 * before its first Run shows each one as a marker instead of rendering it.
 * Written as escapes, so this file holds none of them itself.
 */
const HIDDEN = /[\p{Default_Ignorable_Code_Point}\p{Bidi_Control}]/gu;

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

/**
 * The code's lines, cut where JavaScript ends a line: a lone CR and the
 * Unicode line and paragraph separators too, not only LF. Cut at LF alone, a
 * call after a lone CR would show inside the comment before it, yet run.
 *
 * @param code the file's text
 * @returns its lines, as the script runtime reads them
 */
export const linesOf = (code: string) => code.split(/\r\n|[\n\r\u2028\u2029]/);

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

    it("cuts lines wherever JavaScript does", () => {
      expect(linesOf("a\r\nb\rc\nd\u2028e\u2029f")).toEqual([
        "a",
        "b",
        "c",
        "d",
        "e",
        "f",
      ]);
    });

    it("marks blank-drawing letters and characters past U+FFFF", () => {
      // A Hangul filler is a legal identifier that draws nothing; a tag
      // character sits outside the Basic Multilingual Plane
      expect(partsOf("a\u3164b")).toEqual([
        { text: "a" },
        { hidden: "U+3164" },
        { text: "b" },
      ]);
      expect(partsOf("x\u{E0041}")).toEqual([
        { text: "x" },
        { hidden: "U+E0041" },
      ]);
      expect(countHidden("\uFE0F\u115F")).toBe(2);
    });

    it("counts every hidden character, bidi and zero-width alike", () => {
      expect(countHidden("\u2066x\u2069 \u200B\uFEFF")).toBe(4);
      expect(countHidden("plain")).toBe(0);
    });
  });
}
