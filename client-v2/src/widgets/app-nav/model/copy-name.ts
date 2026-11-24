/**
 * The name a duplicate takes: "<name> copy", then "<name> copy 2", "copy 3"
 * and on, the first one no workspace has. No parentheses: a workspace name
 * is letters, numbers, `_`, `-` and spaces (`isWorkspaceNameValid`), and
 * does not start with a space.
 *
 * The source's own name may break that rule: the GitHub and gist importers
 * skip validation and name a project `github-owner/repo/path` or
 * `gist-owner/id@rev`. Each run of rejected characters becomes one `-`, so
 * the copy is a name `createWorkspace` accepts.
 */
export const copyName = (name: string, taken: readonly string[]) => {
  const stem = name.replace(/[^\w\s-]+/g, "-").trimStart();
  const first = `${stem} copy`;
  if (!taken.includes(first)) return first;

  for (let n = 2; ; n++) {
    const next = `${stem} copy ${n}`;
    if (!taken.includes(next)) return next;
  }
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("widgets/app-nav/model/copy-name", () => {
    describe("copyName", () => {
      it("names the first copy", () => {
        expect(copyName("alpha", ["alpha"])).toBe("alpha copy");
      });

      it("numbers the next free copy", () => {
        expect(copyName("alpha", ["alpha", "alpha copy"])).toBe("alpha copy 2");
        expect(copyName("alpha", ["alpha", "alpha copy", "alpha copy 2"])).toBe(
          "alpha copy 3"
        );
      });

      it("turns what a workspace name rejects into dashes", () => {
        // Imported names skip validation (`github.ts`, gist `import.ts`)
        expect(copyName("github-owner/repo/path", [])).toBe(
          "github-owner-repo-path copy"
        );
        expect(copyName("gist-owner/abc123@def", [])).toBe(
          "gist-owner-abc123-def copy"
        );
        expect(copyName("a//b", ["a-b copy"])).toBe("a-b copy 2");
      });
    });
  });
}
