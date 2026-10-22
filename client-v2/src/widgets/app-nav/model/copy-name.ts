/**
 * The name a duplicate takes: "<name> copy", then "<name> copy 2", "copy 3"
 * and on, the first one no workspace has. No parentheses: a workspace name
 * is letters, digits, `_`, `-` and spaces (`isWorkspaceNameValid`).
 */
export const copyName = (name: string, taken: readonly string[]) => {
  const first = `${name} copy`;
  if (!taken.includes(first)) return first;

  for (let n = 2; ; n++) {
    const next = `${name} copy ${n}`;
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
    });
  });
}
