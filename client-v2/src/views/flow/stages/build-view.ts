import { humanize } from "./humanize";
import { parseBuildReport } from "./build-report";
import type { BuildDiagnostic } from "./build-report";

/** One line of source around a diagnostic, the faulty one marked */
export interface SourceLine {
  num: number;
  text: string;
  failing: boolean;
}

/** What the Build stage draws for one compiler error */
export interface DiagnosticView {
  code: string | null;
  /** The plain-language title from `humanize` */
  title: string;
  /** `humanize`'s explanation, then what rustc said, or empty */
  explanation: string;
  /** rustc's text after the carets, shown beside the faulty line */
  label: string | null;
  file: string | null;
  /** The real source around the fault; `null` shows `excerpt` instead */
  lines: SourceLine[] | null;
  /** rustc's own gutter excerpt */
  excerpt: string;
  /** What the card's Explain and Fix send to the assistant */
  prompts: AssistantPrompts;
}

/** A failure's two asks of the assistant (Spec 04, "Explain a build error") */
export interface AssistantPrompts {
  explain: string;
  fix: string;
}

/**
 * The text rustc prints after the last run of `^` on a diagnostic's marker
 * line, e.g. `` expected `u64`, found `&str` `` -- with the backticks
 * stripped, since this is rendered as plain text, not markdown.
 */
export const extractLabel = (excerpt: string): string | null => {
  const match = excerpt.match(/\^+\s*(.+)$/m);
  return match ? match[1].replace(/`/g, "") : null;
};

/**
 * The real source lines surrounding a diagnostic (`line - 1` through
 * `line + 1`), from the file's `content`. `null` when the file or line is
 * missing, or the file could not be read -- callers fall back to rustc's own
 * gutter excerpt in that case.
 */
export const sourceLines = (
  d: BuildDiagnostic,
  content: string | null
): SourceLine[] | null => {
  if (!d.file || !d.line || !content) return null;

  const all = content.split("\n");
  if (d.line > all.length) return null;
  const lines: SourceLine[] = [];
  for (let n = d.line - 1; n <= d.line + 1; n++) {
    if (n < 1 || n > all.length) continue;
    lines.push({ num: n, text: all[n - 1], failing: n === d.line });
  }
  return lines;
};

/** A diagnostic as the Build stage shows it, given its file's `content` */
export const diagnosticView = (
  d: BuildDiagnostic,
  content: string | null
): DiagnosticView => {
  const label = extractLabel(d.excerpt);
  const humanized = humanize(d.code, d.title, label);
  const explanation = [
    humanized.explanation,
    label ? `Rustc says: ${label}.` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return {
    code: d.code,
    title: humanized.title,
    explanation,
    label,
    file: d.file,
    lines: sourceLines(d, content),
    excerpt: d.excerpt,
    prompts: askAbout(
      [d.code, d.title, d.file && `at ${d.file}${d.line ? `:${d.line}` : ""}`]
        .filter(Boolean)
        .join(" "),
      "error",
      " "
    ),
  };
};

/**
 * Explain and Fix for one failure, `subject` quoted after the ask: after a
 * space for a one-line diagnostic, on a line of its own for the compiler's
 * whole output
 */
const askAbout = (
  subject: string,
  what: "error" | "failure",
  gap: " " | "\n"
): AssistantPrompts => ({
  explain: `Explain this build ${what} in plain words:${gap}${subject}`,
  fix: `Fix this build ${what}:${gap}${subject}`,
});

/**
 * The card for a failure the parser could not split into diagnostics: it
 * sends the compiler's whole output to the assistant.
 */
const unparsedView = (stderr: string): DiagnosticView => ({
  code: null,
  title: "The compiler stopped",
  // Spec 08 BUILD-02's message
  explanation:
    "The compiler stopped with an error we can't read line by line. The compiler output is below.",
  label: null,
  file: null,
  lines: null,
  excerpt: "",
  prompts: askAbout(stderr, "failure", "\n"),
});

/** What the failed Build surface draws */
export interface FailedView {
  /** One card per error, in rustc's order; never empty */
  diagnostics: DiagnosticView[];
  /** How many errors to name, `null` when nothing counted any */
  errorCount: number | null;
  /** The compiler's output, for the toggle under the errors */
  raw: string;
}

/**
 * A failed build as the stage shows it. `stepperCount` is `countErrors`'
 * figure, the stepper badge's: rustc output the parser cannot split still
 * leaves the badge with a count, so the surface names that count rather than
 * "0 errors" beside output that says otherwise; when neither counted any, it
 * names none.
 */
export const failedView = (
  stderr: string,
  stepperCount: number,
  readFile: (path: string) => string | null
): FailedView => {
  const report = parseBuildReport(stderr);
  const parsed = report.diagnostics.map((d) =>
    diagnosticView(d, d.file ? readFile(d.file) : null)
  );
  return {
    diagnostics: parsed.length ? parsed : [unparsedView(stderr)],
    errorCount: parsed.length || stepperCount || null,
    raw: report.raw,
  };
};

/** `flow.buildMs` as Spec 09 writes it, `2.9 s`, or `null` while unknown */
export const msLabel = (ms: number | null) =>
  ms === null ? null : `${(ms / 1000).toFixed(1)} s`;

/** A failed build's figures: `2 errors · 2.9 s · api.solpg.io` */
export const errorMeta = (n: number | null, ms: number | null, host: string) =>
  [n && `${n} error${n === 1 ? "" : "s"}`, msLabel(ms), host]
    .filter(Boolean)
    .join(" · ");

/**
 * Top-level `warning:` blocks only -- an indented `= note:`/`= help:` line
 * under an error does not start at the beginning of the line, so `^warning:`
 * does not match it.
 */
export const warningCount = (raw: string) =>
  (raw.match(/^warning:/gm) ?? []).length;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("views/flow/stages/build-view", () => {
    const EXCERPT = [
      '5 |     let x: u32 = "no";',
      "  |            ---   ^^^^ expected `u32`, found `&str`",
    ].join("\n");

    const diagnosticAt = (
      file: string | null,
      line: number | null
    ): BuildDiagnostic => ({
      code: "E0308",
      title: "mismatched types",
      file,
      line,
      col: 9,
      excerpt: EXCERPT,
    });

    const FILE = ["a", "b", "c", "d", '    let x: u32 = "no";', "f"].join("\n");

    describe("sourceLines", () => {
      it("reads the lines around the fault and marks it", () => {
        expect(sourceLines(diagnosticAt("src/lib.rs", 5), FILE)).toEqual([
          { num: 4, text: "d", failing: false },
          { num: 5, text: '    let x: u32 = "no";', failing: true },
          { num: 6, text: "f", failing: false },
        ]);
      });

      it("has nothing past the end of the file", () => {
        expect(sourceLines(diagnosticAt("src/lib.rs", 99), FILE)).toBeNull();
      });

      it("starts at the file's first line", () => {
        expect(sourceLines(diagnosticAt("src/lib.rs", 1), FILE)).toEqual([
          { num: 1, text: "a", failing: true },
          { num: 2, text: "b", failing: false },
        ]);
      });

      it("ends at the file's last line", () => {
        expect(sourceLines(diagnosticAt("src/lib.rs", 6), FILE)).toEqual([
          { num: 5, text: '    let x: u32 = "no";', failing: false },
          { num: 6, text: "f", failing: true },
        ]);
      });

      it("has nothing without a location", () => {
        expect(sourceLines(diagnosticAt(null, null), FILE)).toBeNull();
      });
    });

    describe("extractLabel", () => {
      it("takes rustc's label without backticks", () => {
        expect(extractLabel(EXCERPT)).toBe("expected u32, found &str");
      });

      it("has none without a marker line", () => {
        expect(extractLabel("5 | let x = 1;")).toBeNull();
      });
    });

    describe("diagnosticView", () => {
      it("falls back to the excerpt when the file cannot be read", () => {
        const view = diagnosticView(diagnosticAt("src/lib.rs", 5), null);
        expect(view.lines).toBeNull();
        expect(view.excerpt).toBe(EXCERPT);
      });

      it("carries the label, the lines and the place", () => {
        const view = diagnosticView(diagnosticAt("src/lib.rs", 5), FILE);
        expect(view.label).toBe("expected u32, found &str");
        expect(view.lines).toHaveLength(3);
        expect(view.file).toBe("src/lib.rs");
        expect(view.code).toBe("E0308");
      });

      it("ends its explanation with what rustc says", () => {
        const view = diagnosticView(diagnosticAt("src/lib.rs", 5), FILE);
        expect(view.explanation).toMatch(
          /Rustc says: expected u32, found &str\.$/
        );
      });

      it("asks the assistant about the error and its place", () => {
        const { prompts } = diagnosticView(diagnosticAt("src/lib.rs", 5), FILE);
        expect(prompts.explain).toBe(
          "Explain this build error in plain words: " +
            "E0308 mismatched types at src/lib.rs:5"
        );
        expect(prompts.fix).toBe(
          "Fix this build error: E0308 mismatched types at src/lib.rs:5"
        );
      });
    });

    describe("diagnosticView without a location", () => {
      it("asks about the error alone", () => {
        expect(
          diagnosticView(diagnosticAt(null, null), null).prompts.explain
        ).toBe(
          "Explain this build error in plain words: E0308 mismatched types"
        );
      });
    });

    const PARSED = [
      "error[E0308]: mismatched types",
      " --> src/lib.rs:5:9",
      "  |",
      EXCERPT,
      "",
      "error: could not compile `p` (lib) due to 1 previous error",
    ].join("\n");

    describe("failedView", () => {
      const readNothing = () => null;

      it("draws one card per parsed error and counts them", () => {
        const view = failedView(PARSED, 7, readNothing);
        expect(view.diagnostics).toHaveLength(1);
        expect(view.errorCount).toBe(1);
      });

      it("reads each error's file for its lines", () => {
        const view = failedView(PARSED, 1, (path) =>
          path === "src/lib.rs" ? FILE : null
        );
        expect(view.diagnostics[0].lines).toHaveLength(3);
      });

      /** The stepper's badge counted errors the parser could not split */
      it("keeps the stepper's count when nothing could be parsed", () => {
        const view = failedView("boom", 2, readNothing);
        expect(view.errorCount).toBe(2);
        expect(view.diagnostics).toHaveLength(1);
        // Spec 08 BUILD-02, in words a learner reads
        expect(view.diagnostics[0].title).toBe("The compiler stopped");
        expect(view.diagnostics[0].explanation).toBe(
          "The compiler stopped with an error we can't read line by line. " +
            "The compiler output is below."
        );
        expect(view.diagnostics[0].prompts).toEqual({
          explain: "Explain this build failure in plain words:\nboom",
          fix: "Fix this build failure:\nboom",
        });
      });

      it("claims no count when neither side has one", () => {
        expect(failedView("boom", 0, readNothing).errorCount).toBeNull();
      });
    });

    describe("errorMeta", () => {
      it("names the count, time and host", () => {
        expect(errorMeta(2, 2900, "api.solpg.io")).toBe(
          "2 errors · 2.9 s · api.solpg.io"
        );
      });

      it("leaves out a count it does not know", () => {
        expect(errorMeta(null, 2900, "h")).toBe("2.9 s \u00b7 h");
      });

      it("leaves out a time it does not know", () => {
        expect(errorMeta(1, null, "h")).toBe("1 error · h");
      });
    });

    describe("msLabel", () => {
      it("puts a space before the unit, as Spec 09 writes it", () => {
        expect(msLabel(41200)).toBe("41.2 s");
      });
    });

    describe("warningCount", () => {
      it("counts top-level warnings only", () => {
        expect(warningCount("warning: a\n  = warning: b\nwarning: c")).toBe(2);
      });
    });
  });
}
