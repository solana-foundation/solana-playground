/**
 * Fence labels that hold a command to run, a picture or something to read,
 * never the content of a project file: a reply made only of these proposes no
 * edit. Every other label counts as a file's language, `json` and `diff`
 * included, since a project holds both.
 */
const NOT_A_FILE = new Set([
  "bash",
  "sh",
  "shell",
  "zsh",
  "console",
  "terminal",
  "powershell",
  "ps1",
  "cmd",
  "bat",
  "text",
  "txt",
  "plaintext",
  "plain",
  "output",
  "log",
  "mermaid",
]);

/**
 * A fence line, inside a list item or a blockquote too: its marks (``` or
 * ~~~), then its info string's first word
 */
const FENCE = /^[ \t>]*(`{3,}|~{3,})[ \t]*([^\s`]*)/;

/** A first line that is a comment naming a file: `// src/lib.rs`, `# Cargo.toml` */
const NAMES_A_FILE = /^\s*(?:\/\/|#|--|\/\*)\s*[\w./-]+\.\w+\s*(?:\*\/)?\s*$/;

/**
 * Whether a reply proposes a code change, which is what "Make this change"
 * turns into a patch: it opens a fenced block whose label is not one of
 * `NOT_A_FILE`, or an unlabelled block whose first line names the file. An
 * explanation, inline code, a command, a diagram or any other unlabelled
 * block (an address, an output) has nothing to apply.
 *
 * Reads opening fences, so a block still streaming counts from its first line.
 */
export const isChangeProposal = (text: string): boolean => {
  const lines = text.split("\n");
  // The marks of the fence that opened the block we are in; none outside one
  let open: { char: string; length: number } | undefined;
  for (const [index, line] of lines.entries()) {
    const fence = FENCE.exec(line);
    if (!fence) continue;
    const [, marks, lang] = fence;
    if (open) {
      // Only a bare fence of the same kind, at least as long, closes it
      if (!lang && marks[0] === open.char && marks.length >= open.length) {
        open = undefined;
      }
      continue;
    }
    open = { char: marks[0], length: marks.length };
    const proposes = lang
      ? !NOT_A_FILE.has(lang.toLowerCase())
      : NAMES_A_FILE.test(lines[index + 1] ?? "");
    if (proposes) return true;
  }
  return false;
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  /** A fenced block of `body`, labelled `lang` */
  const fence = (lang: string, body: string) =>
    "```" + lang + "\n" + body + "\n```";

  describe("widgets/assistant/model/is-change-proposal", () => {
    it("counts a block in a project file's language", () => {
      for (const lang of ["rust", "rs", "ts", "js", "toml", "json", "diff"]) {
        expect(
          isChangeProposal(`Change it to:\n\n${fence(lang, "let x = 1;")}\n`)
        ).toBe(true);
      }
    });

    it("does not count an explanation", () => {
      expect(
        isChangeProposal(
          "This account holds 2.5 SOL and is owned by the System Program."
        )
      ).toBe(false);
    });

    it("does not count inline code", () => {
      expect(
        isChangeProposal("Call `initialize` with the `counter` account.")
      ).toBe(false);
    });

    it("does not count a command, an output or a diagram", () => {
      for (const lang of NOT_A_FILE) {
        expect(isChangeProposal(`Run:\n\n${fence(lang, "build")}\n`)).toBe(
          false
        );
      }
      expect(isChangeProposal(fence("BASH", "build"))).toBe(false);
    });

    it("does not count an unlabelled block", () => {
      expect(isChangeProposal(`The address:\n\n${fence("", "9xQe…")}\n`)).toBe(
        false
      );
    });

    it("counts an unlabelled block whose first line names its file", () => {
      expect(isChangeProposal(fence("", "// src/lib.rs\nfn a() {}"))).toBe(
        true
      );
      expect(isChangeProposal(fence("", "# Cargo.toml\n[dependencies]"))).toBe(
        true
      );
      expect(isChangeProposal(fence("", "// a note\nfn a() {}"))).toBe(false);
    });

    it("never reads a closing fence as an unlabelled block", () => {
      expect(
        isChangeProposal("```bash\nbuild\n```\n# src/lib.rs is where it lives")
      ).toBe(false);
      expect(
        isChangeProposal("```text\nout\n```\n```rust\nfn a() {}\n```")
      ).toBe(true);
    });

    it("keeps a block open past a shorter or different fence inside it", () => {
      expect(isChangeProposal("````text\n```rust\nfn a() {}\n```\n````")).toBe(
        false
      );
      expect(isChangeProposal("~~~text\n```rust\n~~~")).toBe(false);
    });

    it("counts one code block among command blocks", () => {
      expect(
        isChangeProposal(
          `${fence("bash", "build")}\n\nthen\n\n${fence("rust", "let x = 1;")}`
        )
      ).toBe(true);
    });

    it("counts a tilde fence, a fence in a list item and one in a quote", () => {
      expect(isChangeProposal("~~~rust\nfn a() {}\n~~~")).toBe(true);
      expect(
        isChangeProposal("1. Edit:\n\n    ```rust\n    fn a() {}\n    ```")
      ).toBe(true);
      expect(isChangeProposal("> ```rust\n> fn a() {}\n> ```")).toBe(true);
    });

    it("counts a block still streaming from its first line", () => {
      expect(isChangeProposal("Change it to:\n\n```rust\nfn ma")).toBe(true);
    });

    it("reads the language before any fence attributes, in any case", () => {
      expect(isChangeProposal("```rust title=lib.rs\nfn a() {}\n```")).toBe(
        true
      );
      expect(isChangeProposal("```Rust\nfn a() {}\n```")).toBe(true);
    });
  });
}
