/** Words a person types out of shell habit; Spec 13 answers them in one line */
const SHELL_HABITS = ["ls", "cd", "cat", "npm", "yarn", "cargo"];

/** How far a typo may be from a command and still get a suggestion (Spec 13) */
const MAX_EDITS = 2;

/**
 * Edits between two words: insert, delete, replace, or swap two neighbours
 * (optimal string alignment), so `biuld` is one edit from `build`.
 */
const editDistance = (a: string, b: string) => {
  const d = Array.from({ length: a.length + 1 }, (_row, i) =>
    Array.from({ length: b.length + 1 }, (_cell, j) => (i === 0 ? j : i))
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );
      const swapped =
        i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1];
      if (swapped) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
};

/** What the terminal says to a command it does not know */
export type UnknownCommand =
  | { kind: "suggestion"; line: string; suggestion: string }
  | { kind: "shell" | "none"; line: string };

/**
 * The line for an unknown command (Spec 13, "Unknown commands").
 *
 * @param names every command's name, in `help`'s order, which breaks a tie
 * @returns a function taking the word the person typed, which gives the line, and the command it suggests when one is close
 */
export const unknownCommandIn =
  (names: readonly string[]) =>
  (typed: string): UnknownCommand => {
    // Matched in lower case, shown as typed
    const word = typed.toLowerCase();
    if (SHELL_HABITS.includes(word)) {
      return {
        kind: "shell",
        line: "This terminal runs Playground commands, not a system shell. Type `help` to see them.",
      };
    }

    let best: { name: string; edits: number } | undefined;
    for (const name of names) {
      const edits = editDistance(word, name);
      if (edits <= MAX_EDITS && (!best || edits < best.edits)) {
        best = { name, edits };
      }
    }
    if (best) {
      return {
        kind: "suggestion",
        line: `\`${typed}\` is not a command. Did you mean \`${best.name}\`?`,
        suggestion: best.name,
      };
    }

    return {
      kind: "none",
      line: `\`${typed}\` is not a command. Type \`help\` to see commands.`,
    };
  };

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("features/unknown-command/model/unknown-command", () => {
    const NAMES = ["build", "deploy", "run", "test", "help", "clear"];

    it("suggests build for biuld, a swap", () => {
      expect(unknownCommandIn(NAMES)("biuld")).toEqual({
        kind: "suggestion",
        line: "`biuld` is not a command. Did you mean `build`?",
        suggestion: "build",
      });
    });

    it("suggests a command two edits away", () => {
      expect(unknownCommandIn(NAMES)("dploi")).toMatchObject({
        suggestion: "deploy",
      });
    });

    it("takes the earlier command on a tie", () => {
      // `tun` is one edit from both
      expect(unknownCommandIn(["run", "tut"])("tun")).toMatchObject({
        suggestion: "run",
      });
    });

    it("prefers the closer command over the earlier one", () => {
      expect(unknownCommandIn(["run", "test"])("tesr")).toMatchObject({
        suggestion: "test",
      });
    });

    it("answers a shell habit with the shell line", () => {
      expect(unknownCommandIn(NAMES)("ls")).toEqual({
        kind: "shell",
        line: "This terminal runs Playground commands, not a system shell. Type `help` to see them.",
      });
    });

    it("matches in any case and shows the word as typed", () => {
      expect(unknownCommandIn(NAMES)("BUILD")).toMatchObject({
        line: "`BUILD` is not a command. Did you mean `build`?",
      });
      expect(unknownCommandIn(NAMES)("Ls")).toMatchObject({ kind: "shell" });
    });

    it("points to help when nothing is close", () => {
      expect(unknownCommandIn(NAMES)("xyzzy")).toEqual({
        kind: "none",
        line: "`xyzzy` is not a command. Type `help` to see commands.",
      });
    });
  });
}
