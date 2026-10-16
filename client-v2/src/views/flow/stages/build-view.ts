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
  /** What "Fix with assistant" sends */
  prompt: string;
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
    prompt: [
      "Explain this build error and propose a fix:",
      d.code,
      d.title,
      d.file && `at ${d.file}${d.line ? `:${d.line}` : ""}`,
    ]
      .filter(Boolean)
      .join(" "),
  };
};

/**
 * The card for a failure the parser could not split into diagnostics: it
 * sends the compiler's whole output to the assistant.
 */
const unparsedView = (stderr: string): DiagnosticView => ({
  code: null,
  title: "Unparsed compiler error",
  explanation:
    "The compiler reported an error without a parseable diagnostic; see raw output.",
  label: null,
  file: null,
  lines: null,
  excerpt: "",
  prompt: "Explain this build failure and propose a fix:\n" + stderr,
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

/** `flow.buildMs` as a plain `2.9s`, or `null` while it is unknown */
export const msLabel = (ms: number | null) =>
  ms === null ? null : `${(ms / 1000).toFixed(1)}s`;

/** A failed build's figures: `2 errors · 2.9s · api.solpg.io` */
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
