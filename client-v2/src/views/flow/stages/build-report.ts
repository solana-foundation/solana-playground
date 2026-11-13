import { LINE_BREAK } from "@/shared/lib/line-break";

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

/**
 * What marks an error as the echo of another: inside `#[program]`, Anchor's
 * macro cannot find the accounts or bumps a missing type would have made,
 * e.g. `could not find \`__client_accounts_hello\``. The cause is reported
 * separately, so these are never the error to show.
 */
const MACRO_SYMPTOMS: readonly (string | RegExp)[] = [
  "__client_accounts",
  "__cpi_client_accounts",
  /`\S*Bumps`/,
];

/** Whether an error's text is a macro symptom (`MACRO_SYMPTOMS`) */
export const isMacroSymptomText = (text: string) =>
  MACRO_SYMPTOMS.some((pat) =>
    typeof pat === "string" ? text.includes(pat) : pat.test(text)
  );

/** Whether a diagnostic is a macro symptom rather than a cause */
export const isMacroSymptom = (d: BuildDiagnostic) =>
  isMacroSymptomText(`${d.title}\n${d.excerpt}`);

/**
 * The diagnostic to show for a failed build: the one holding `mark` (a
 * tutorial step's `failsWith`) when given and found, else the first that is
 * not a macro symptom, else the first. Hello Anchor's planned E0412 at line 9
 * comes after an E0432 symptom at line 5 (HOO-2355's spike, 2 Nov 2026).
 */
export const pickDiagnostic = (
  diagnostics: readonly BuildDiagnostic[],
  // eslint-disable-next-line layers/curry-order -- tutorial flow v2 predates this rule; cleanup tracked from SF#94
  mark?: string
): BuildDiagnostic | null => {
  const marked = mark
    ? diagnostics.find(
        (d) => d.title.includes(mark) || d.excerpt.includes(mark)
      )
    : undefined;
  return (
    marked ??
    diagnostics.find((d) => !isMacroSymptom(d)) ??
    diagnostics[0] ??
    // eslint-disable-next-line unicorn/no-null -- tutorial flow v2 predates this rule; cleanup tracked from SF#94
    null
  );
};

// eslint-disable-next-line security/detect-unsafe-regex -- linear: `[`, `E` and `]` delimit the optional code
const HEADER = /^error(?:\[(E\d+)\])?: (.+)$/;
// A top-level warning/note/help block. rustc emits these for lints and
// linker notes that follow an error; they are not part of that error, so a
// line like this must end the current diagnostic rather than feed its
// excerpt. (Indented `= note: ...` lines under an error are unaffected -
// they do not match `^`.)
// eslint-disable-next-line security/detect-unsafe-regex -- linear: `[^\]]` stops at the bracket that closes it
const OTHER_HEADER = /^(?:warning|note|help)(?:\[[^\]]+\])?: .+$/;
const LOCATION_ARROW = /^\s*--> /;
const LOCATION_TAIL = /:(\d+):(\d+)$/;

/** The length of the `./` or `../` at `start` of `path`, 0 for neither */
const dotPrefixAt = (path: string, start: number) => {
  if (path.startsWith("./", start)) return 2;
  if (path.startsWith("../", start)) return 3;
  return 0;
};

/**
 * What `/^\s*--> (?:\.\.?\/)*(.+?):(\d+):(\d+)\s*$/` would match, read in
 * parts, since the regex backtracks quadratically on a long line
 */
const locationOf = (line: string) => {
  const arrow = LOCATION_ARROW.exec(line);
  if (!arrow) return undefined;
  const text = line.slice(arrow[0].length).trimEnd();
  const tail = LOCATION_TAIL.exec(text);
  if (!tail) return undefined;
  const full = text.slice(0, tail.index);
  // Leading `./` and `../` go, as long as a path is left
  let start = 0;
  for (;;) {
    const step = dotPrefixAt(full, start);
    if (step === 0 || start + step >= full.length) break;
    start += step;
  }
  const file = full.slice(start);
  if (file === "" || LINE_BREAK.test(file)) return undefined;
  return { file, line: Number(tail[1]), col: Number(tail[2]) };
};
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
    const loc = locationOf(line);
    if (loc && current.file === null) {
      current.file = loc.file;
      current.line = loc.line;
      current.col = loc.col;
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
    it.each([
      [" --> src/lib.rs:5:1", { file: "src/lib.rs", line: 5, col: 1 }],
      ["--> ../../src/a.rs:1:2  ", { file: "src/a.rs", line: 1, col: 2 }],
      // A prefix stays when nothing else is left of the path
      ["--> ./:1:2", { file: "./", line: 1, col: 2 }],
      ["--> a:1:2:3", { file: "a:1", line: 2, col: 3 }],
      ["--> :1:2", undefined],
      ["--> a\rb:1:2", undefined],
    ])("reads the location of %j", (line, expected) => {
      expect(locationOf(line)).toEqual(expected);
    });

    it("parses a long line of ../ without a location in linear time", () => {
      expect(locationOf(`--> ${"../".repeat(120_000)}x`)).toBeUndefined();
    }, 1000);

    it("picks the cause past Anchor's macro symptom, or the marked one", () => {
      const { diagnostics } =
        parseBuildReport(`error[E0432]: unresolved import \`crate\`
 --> src/lib.rs:5:1
  |
5 | #[program]
  | ^^^^^^^^^^ could not find \`__client_accounts_hello\` in the crate root

error[E0412]: cannot find type \`Hello\` in this scope
 --> src/lib.rs:9:32

error[E0308]: mismatched types
 --> src/lib.rs:12:5`);
      expect(pickDiagnostic(diagnostics)).toMatchObject({
        code: "E0412",
        line: 9,
      });
      expect(pickDiagnostic(diagnostics, "mismatched")).toMatchObject({
        code: "E0308",
      });
      expect(pickDiagnostic(diagnostics.slice(0, 1))).toMatchObject({
        code: "E0432",
      });
      expect(pickDiagnostic([])).toBeNull();
    });

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
