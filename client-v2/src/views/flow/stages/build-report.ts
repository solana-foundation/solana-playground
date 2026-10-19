import { stripKnownNoise } from "../../sidebar/assistant/bridge/build-output";

/** One rustc diagnostic, parsed out of the compiler's own text */
export interface BuildDiagnostic {
  /** e.g. `E0308`, or `null` for a diagnostic without an error code */
  code: string | null;
  /** The one-line summary rustc prints after `error[...]:` */
  title: string;
  /**
   * Workspace path (`src/lib.rs`), or `null` if the diagnostic has no
   * location. rustc's own path is relative to the build server's working
   * directory, which sits beside `src`, so leading `./` and `../` segments
   * are dropped.
   */
  file: string | null;
  line: number | null;
  col: number | null;
  /** The `-->` line's source excerpt, with the `|` gutter kept for context */
  excerpt: string;
}

/** The result of parsing one build's `stderr` */
export interface BuildReport {
  diagnostics: BuildDiagnostic[];
  /** `stderr`, after `stripKnownNoise`, for the "show raw output" toggle */
  raw: string;
}

const HEADER = /^error(?:\[(E\d+)\])?: (.+)$/;
// A top-level warning/note/help block. rustc emits these for lints and
// linker notes that follow an error; they are not part of that error, so a
// line like this must end the current diagnostic rather than feed its
// excerpt. (Indented `= note: ...` lines under an error are unaffected -
// they do not match `^`.)
const OTHER_HEADER = /^(?:warning|note|help)(?:\[[^\]]+\])?: .+$/;
const LOCATION = /^\s*--> (?:\.\.?\/)*(.+?):(\d+):(\d+)\s*$/;
// rustc's own summary lines ("could not compile ...", "aborting due to ...
// previous error(s)") are not diagnostics of their own.
const SUMMARY = /^(could not compile|aborting due to)/;

/** Split rustc's stderr into one entry per `error` block. */
export const parseBuildReport = (stderr: string): BuildReport => {
  const raw = stripKnownNoise(stderr);
  const lines = raw.split("\n");
  const diagnostics: BuildDiagnostic[] = [];
  let current: BuildDiagnostic | null = null;
  let excerpt: string[] = [];

  const flush = () => {
    if (!current) return;
    current.excerpt = excerpt.join("\n").trim();
    diagnostics.push(current);
    current = null;
    excerpt = [];
  };

  for (const line of lines) {
    const head = line.match(HEADER);
    if (head) {
      flush();
      // The summary line is not a diagnostic
      if (SUMMARY.test(head[2])) continue;
      current = {
        code: head[1] ?? null,
        title: head[2],
        file: null,
        line: null,
        col: null,
        excerpt: "",
      };
      continue;
    }
    if (OTHER_HEADER.test(line)) {
      // A warning/note/help block that follows an error is not part of it
      flush();
      continue;
    }
    if (!current) continue;
    const loc = line.match(LOCATION);
    if (loc && current.file === null) {
      current.file = loc[1];
      current.line = Number(loc[2]);
      current.col = Number(loc[3]);
      continue;
    }
    if (/^\s*\d+ \|/.test(line) || /^\s*\|/.test(line)) excerpt.push(line);
  }
  flush();

  return { diagnostics, raw };
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("views/flow/stages/build-report", () => {
    const STDERR = `Compiling hello v0.1.0
error[E0308]: mismatched types
  --> src/lib.rs:12:18
   |
12 |         let x: u64 = "1";
   |                ---   ^^^ expected \`u64\`, found \`&str\`
   |                |
   |                expected due to this

error: could not compile \`hello\` due to previous error`;

    describe("parseBuildReport", () => {
      it("extracts code, title, location and excerpt", () => {
        const r = parseBuildReport(STDERR);
        expect(r.diagnostics).toHaveLength(1);
        const d = r.diagnostics[0];
        expect(d.code).toBe("E0308");
        expect(d.title).toBe("mismatched types");
        expect(d.file).toBe("src/lib.rs");
        expect(d.line).toBe(12);
        expect(d.col).toBe(18);
        expect(d.excerpt).toContain('let x: u64 = "1";');
      });

      it("reports a workspace path when the build server prefixes ../", () => {
        // The build server compiles from a directory beside `src`, so rustc
        // names the file `../src/lib.rs`
        const stderr = STDERR.replace("--> src/lib.rs", "--> ../src/lib.rs");
        expect(parseBuildReport(stderr).diagnostics[0].file).toBe("src/lib.rs");
      });

      it("drops a leading ./ the same way", () => {
        const stderr = STDERR.replace("--> src/lib.rs", "--> ./src/lib.rs");
        expect(parseBuildReport(stderr).diagnostics[0].file).toBe("src/lib.rs");
      });

      it("returns no diagnostics for a clean build", () => {
        expect(
          parseBuildReport("Compiling hello\nFinished").diagnostics
        ).toEqual([]);
      });

      it("keeps two errors as two diagnostics, in order", () => {
        const stderr = `error[E0308]: mismatched types
  --> src/lib.rs:12:18
   |
12 |         let x: u64 = "1";
   |                ---   ^^^ expected \`u64\`, found \`&str\`

error[E0425]: cannot find value \`y\` in this scope
  --> src/lib.rs:20:5
   |
20 |     y
   |     ^ not found in this scope

error: aborting due to 2 previous errors`;
        const r = parseBuildReport(stderr);
        expect(r.diagnostics).toHaveLength(2);
        expect(r.diagnostics[0].code).toBe("E0308");
        expect(r.diagnostics[1].code).toBe("E0425");
      });

      it("does not turn the summary lines into diagnostics", () => {
        const stderr = `error[E0308]: mismatched types
  --> src/lib.rs:12:18
   |
12 |         let x: u64 = "1";
   |                ---   ^^^ expected \`u64\`, found \`&str\`

error: aborting due to previous error

error: could not compile \`hello\` due to previous error`;
        expect(parseBuildReport(stderr).diagnostics).toHaveLength(1);
      });

      it("does not bleed a trailing warning's excerpt into the error", () => {
        const stderr = `error[E0308]: mismatched types
  --> src/lib.rs:12:18
   |
12 |         let x: u64 = "1";
   |                ---   ^^^ expected \`u64\`, found \`&str\`

warning: unused variable: \`y\`
  --> src/lib.rs:20:9
   |
20 |     let y = 5;
   |         ^ help: if this is intentional, prefix it with an underscore

error: aborting due to previous error`;
        const r = parseBuildReport(stderr);
        expect(r.diagnostics).toHaveLength(1);
        expect(r.diagnostics[0].excerpt).not.toContain("let y = 5;");
      });

      it("preserves the title when there is no location", () => {
        const stderr = `error: linking with \`cc\` failed: exit status: 1
  = note: some linker note here

error: aborting due to previous error`;
        const r = parseBuildReport(stderr);
        expect(r.diagnostics).toHaveLength(1);
        const d = r.diagnostics[0];
        expect(d.title).toBe("linking with `cc` failed: exit status: 1");
        expect(d.file).toBeNull();
        expect(d.line).toBeNull();
        expect(d.col).toBeNull();
      });

      it("strips the server's per-session uuid prefix from the path", () => {
        const stderr = `error[E0308]: mismatched types
  --> a1b2c3d4-e5f6-7890-abcd-ef1234567890/src/lib.rs:12:18
   |
12 |         let x: u64 = "1";
   |                ---   ^^^ expected \`u64\`, found \`&str\`

error: aborting due to previous error`;
        expect(parseBuildReport(stderr).diagnostics[0].file).toBe("src/lib.rs");
      });
    });
  });
}
