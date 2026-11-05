/* eslint-disable layers/curry-order, max-params, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
/**
 * The editor's line states (`tutorial-workspace`, "The editor shows written,
 * landing, error and busy lines") as Monaco decorations. Pure: the
 * connected hook hands it the model's line count and text and applies what
 * it returns. The CSS classes (`pg-line-*`, `pg-arrive`, `pg-squiggle`) are in
 * `src/index.css`, since Monaco takes plain class names only.
 */

/** What marks the open file's lines */
export interface LineMarks {
  /** The lines the assistant wrote this beat, in the order they landed */
  written: number[];
  /** The written lines are arriving: each flashes green, 40 ms apart */
  arriving: boolean;
  /** Where an open question's block will go (the engine's `landingFor`) */
  landing: { lines: number[]; ghost: boolean } | null;
  /** The failed build's line in this file, and the token it named */
  error: { line: number; column: number | null; span: number | null } | null;
}

export const NO_MARKS: LineMarks = {
  written: [],
  arriving: false,
  landing: null,
  error: null,
};

/** The ghost line's words: drawn beside the code, never part of the file */
export const GHOST_TEXT = "Your answer lands here";

/** The arrival's stagger is drawn by one class per place, up to this many */
export const ARRIVE_STEPS = 40;

/** How long an arrival lasts for its last line: the classes come off then */
export const arrivalMs = (lines: number) =>
  1400 + Math.min(lines, ARRIVE_STEPS) * 40;

/** A Monaco range, by line and 1-based column */
export interface Range {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

/** The subset of Monaco's `IModelDeltaDecoration` these marks use */
export interface Decoration {
  range: Range;
  options: {
    isWholeLine?: boolean;
    className?: string;
    inlineClassName?: string;
    linesDecorationsClassName?: string;
    after?: { content: string; inlineClassName: string };
  };
}

export interface LinePlan {
  decorations: Decoration[];
  /**
   * The ghost past the file's end: a view zone after this line, which takes
   * no place in the model
   */
  zoneAfter: number | null;
}

const line = (n: number, startColumn = 1, endColumn = 1): Range => ({
  startLineNumber: n,
  startColumn,
  endLineNumber: n,
  endColumn,
});

const whole = (n: number, className: string): Decoration => ({
  range: line(n),
  options: { isWholeLine: true, className },
});

/**
 * The underline's place: the token the compiler named, or the line's code
 * from its first letter to its last.
 */
const errorRange = (
  error: NonNullable<LineMarks["error"]>,
  text: string
): Range | null => {
  const lead = text.match(/^\s*/)?.[0].length ?? 0;
  const from = error.column ? error.column - 1 : lead;
  const to =
    error.span !== null && error.span > 0
      ? from + error.span
      : text.trimEnd().length;
  if (to <= from) return null;
  return line(error.line, from + 1, to + 1);
};

/**
 * Every decoration for `marks` in a model of `lineCount` lines. A mark past
 * the end draws nothing, except the landing's ghost, which becomes a view
 * zone after the last line.
 */
export const decorationsFor = (
  marks: LineMarks,
  lineCount: number,
  lineText: (n: number) => string
): LinePlan => {
  const inFile = (n: number) => n >= 1 && n <= lineCount;
  const decorations: Decoration[] = [];
  let zoneAfter: number | null = null;

  if (marks.landing) {
    for (const n of marks.landing.lines.filter(inFile)) {
      decorations.push(whole(n, "pg-line-landing"));
    }
    if (marks.landing.ghost) {
      const at = marks.landing.lines[0];
      if (at !== undefined && inFile(at) && lineText(at).trim() === "") {
        decorations.push({
          range: line(at),
          options: {
            after: { content: GHOST_TEXT, inlineClassName: "pg-landing-ghost" },
          },
        });
      } else if (at !== undefined && at > lineCount) {
        zoneAfter = lineCount;
      }
    }
  }

  marks.written.filter(inFile).forEach((n, k) => {
    const arrive = marks.arriving
      ? ` pg-arrive pg-arrive-${Math.min(k, ARRIVE_STEPS - 1)}`
      : "";
    decorations.push(whole(n, `pg-line-written${arrive}`));
  });

  if (marks.error && inFile(marks.error.line)) {
    decorations.push(whole(marks.error.line, "pg-line-error"));
    const range = errorRange(marks.error, lineText(marks.error.line));
    if (range) {
      decorations.push({ range, options: { inlineClassName: "pg-squiggle" } });
    }
  }

  return { decorations, zoneAfter };
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("widgets/tutorial-workspace/model/lines", () => {
    const CODE = [
      "use anchor_lang::prelude::*;",
      "",
      "    let x = foo();",
      "fn main() {}",
    ];
    const text = (n: number) => CODE[n - 1] ?? "";
    const plan = (marks: Partial<LineMarks>) =>
      decorationsFor(
        {
          written: marks.written ?? [],
          arriving: marks.arriving ?? false,
          landing: marks.landing ?? null,
          error: marks.error ?? null,
        },
        CODE.length,
        text
      );
    const classes = (p: LinePlan) =>
      p.decorations.map((d) => [
        d.range.startLineNumber,
        d.options.className ??
          d.options.inlineClassName ??
          d.options.after?.content,
      ]);

    it("draws nothing with no marks", () => {
      expect(plan({})).toEqual({ decorations: [], zoneAfter: null });
    });

    it("gives written lines a quiet border, at rest when not arriving", () => {
      expect(classes(plan({ written: [1, 3] }))).toEqual([
        [1, "pg-line-written"],
        [3, "pg-line-written"],
      ]);
    });

    it("staggers arriving lines by their place in the block", () => {
      expect(classes(plan({ written: [3, 4], arriving: true }))).toEqual([
        [3, "pg-line-written pg-arrive pg-arrive-0"],
        [4, "pg-line-written pg-arrive pg-arrive-1"],
      ]);
      const many = Array.from({ length: 4 }, (_, i) => i + 1);
      const last = plan({ written: many, arriving: true }).decorations.at(-1);
      expect(last?.options.className).toContain("pg-arrive-3");
      expect(arrivalMs(2)).toBe(1480);
    });

    it("puts the ghost on an empty landing line, beside the code and not in it", () => {
      const p = plan({ landing: { lines: [2], ghost: true } });
      expect(classes(p)).toEqual([
        [2, "pg-line-landing"],
        [2, GHOST_TEXT],
      ]);
      // Injected text, never an edit: no decoration carries the text as a range
      expect(p.decorations[1].range).toEqual(line(2));
      expect(p.zoneAfter).toBeNull();
    });

    it("draws a ghost past the end as a view zone after the last line", () => {
      const p = plan({ landing: { lines: [7], ghost: true } });
      expect(p.decorations).toEqual([]);
      expect(p.zoneAfter).toBe(CODE.length);
    });

    it("tints the lines a landing replaces, with no ghost", () => {
      expect(
        classes(plan({ landing: { lines: [3, 4], ghost: false } }))
      ).toEqual([
        [3, "pg-line-landing"],
        [4, "pg-line-landing"],
      ]);
    });

    it("underlines the token a failed build named", () => {
      const p = plan({ error: { line: 3, column: 13, span: 3 } });
      expect(classes(p)).toEqual([
        [3, "pg-line-error"],
        [3, "pg-squiggle"],
      ]);
      expect(p.decorations[1].range).toEqual(line(3, 13, 16));
    });

    it("underlines the line's code from its first letter with no column", () => {
      const p = plan({ error: { line: 3, column: null, span: null } });
      expect(p.decorations[1].range).toEqual(line(3, 5, 19));
    });

    it("drops marks past the end of the file", () => {
      expect(
        plan({ written: [9], error: { line: 9, column: null, span: null } })
          .decorations
      ).toEqual([]);
    });
  });
}
