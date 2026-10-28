/**
 * The build's refusal of an empty program file (Spec 09: "lib.rs is empty"
 * and no request is sent), shared by the `build` command that throws it and
 * the flow that names it on the Build stage. A leaf with no imports, so the
 * flow's tests, which stand the utils barrel in with a mock, still load it.
 */

/** The program file every Rust project builds from */
export const PROGRAM_FILE = "src/lib.rs";

/**
 * Whether `content` is a program file with nothing in it. `undefined` is no
 * file at all: a Python project has no `lib.rs`, and builds as before.
 */
export const isEmptyProgram = (content: string | undefined) =>
  content !== undefined && content.trim() === "";

/** What to do about an empty program file, said by the terminal and the stage */
export const EMPTY_SOURCE_HINT =
  "Write a program, or ask the assistant for one.";

/** `src/lib.rs` as a person names it: `lib.rs` */
export const fileLabel = (file: string) => file.split("/").pop() ?? file;

/** The error the `build` command throws instead of sending `file` */
export const emptySourceError = (file: string) =>
  Object.assign(
    new Error(`${fileLabel(file)} is empty. ${EMPTY_SOURCE_HINT}`),
    {
      emptyFile: file,
    }
  );

/**
 * The file a rejected build refused to send, or `null` for any other
 * failure. By shape, since a command's error reaches the flow through the
 * command manager unwrapped but untyped.
 */
export const emptyFileOf = (err: unknown): string | null => {
  const file = (err as { emptyFile?: unknown } | null | undefined)?.emptyFile;
  return typeof file === "string" ? file : null;
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("commands/build/empty-source", () => {
    it.each([
      ["an empty file", "", true],
      ["whitespace and newlines", "  \n\t\n", true],
      ["a program", "use anchor_lang::prelude::*;", false],
      ["no file at all", undefined, false],
    ])("calls %s empty: %s", (_, content, empty) => {
      expect(isEmptyProgram(content)).toBe(empty);
    });

    it("names the file in words and carries its path", () => {
      const err = emptySourceError(PROGRAM_FILE);
      expect(err.message).toBe(
        "lib.rs is empty. Write a program, or ask the assistant for one."
      );
      expect(emptyFileOf(err)).toBe("src/lib.rs");
    });

    it.each([
      ["an ordinary error", new Error("boom")],
      ["a string", "boom"],
      ["nothing", undefined],
      ["a non-string path", { emptyFile: 1 }],
    ])("finds no empty file in %s", (_, err) => {
      expect(emptyFileOf(err)).toBeNull();
    });
  });
}
