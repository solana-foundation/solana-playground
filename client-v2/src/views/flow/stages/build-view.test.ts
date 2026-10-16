import {
  diagnosticView,
  errorMeta,
  failedView,
  extractLabel,
  sourceLines,
  warningCount,
} from "./build-view";
import type { BuildDiagnostic } from "./build-report";

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
    expect(view.explanation).toMatch(/Rustc says: expected u32, found &str\.$/);
  });

  it("asks the assistant about the error and its place", () => {
    expect(diagnosticView(diagnosticAt("src/lib.rs", 5), FILE).prompt).toBe(
      "Explain this build error and propose a fix: " +
        "E0308 mismatched types at src/lib.rs:5"
    );
  });
});

describe("diagnosticView without a location", () => {
  it("asks about the error alone", () => {
    expect(diagnosticView(diagnosticAt(null, null), null).prompt).toBe(
      "Explain this build error and propose a fix: E0308 mismatched types"
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
    expect(view.diagnostics[0].title).toBe("Unparsed compiler error");
    expect(view.diagnostics[0].prompt).toBe(
      "Explain this build failure and propose a fix:\nboom"
    );
  });

  it("claims no count when neither side has one", () => {
    expect(failedView("boom", 0, readNothing).errorCount).toBeNull();
  });
});

describe("errorMeta", () => {
  it("names the count, time and host", () => {
    expect(errorMeta(2, 2900, "api.solpg.io")).toBe(
      "2 errors · 2.9s · api.solpg.io"
    );
  });

  it("leaves out a count it does not know", () => {
    expect(errorMeta(null, 2900, "h")).toBe("2.9s \u00b7 h");
  });

  it("leaves out a time it does not know", () => {
    expect(errorMeta(1, null, "h")).toBe("1 error · h");
  });
});

describe("warningCount", () => {
  it("counts top-level warnings only", () => {
    expect(warningCount("warning: a\n  = warning: b\nwarning: c")).toBe(2);
  });
});
