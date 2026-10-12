import { parseBuildReport } from "./build-report";

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
    expect(parseBuildReport("Compiling hello\nFinished").diagnostics).toEqual(
      []
    );
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
