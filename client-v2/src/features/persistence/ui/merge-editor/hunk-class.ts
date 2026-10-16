import type { LineLook } from "./merge-file";

/**
 * The class Monaco puts on a hunk's lines, or on lines a side changed on its
 * own.
 *
 * The element's own classes cannot go on a decoration: Monaco cleans a
 * decoration's class name to letters, digits, `-` and `_`, which turns
 * `bg-error/12` into the solid `bg-error`. So each look has a plain name,
 * and `index.css` gives it `mergeHunkVariants`' classes with `@apply`;
 * the in-source tests of `hunk-class.ts` fail if the two stop matching.
 */
export const hunkLineClass = (look: LineLook) => `pg-merge-hunk-${look}`;

if (import.meta.vitest) {
  const { describe, it, expect, beforeAll } = import.meta.vitest;
  let readFileSync: typeof import("fs").readFileSync;
  let join: typeof import("path").join;
  let mergeHunkVariants: typeof import("@/shared/ui/merge").mergeHunkVariants;
  beforeAll(async () => {
    ({ readFileSync } = await import("fs"));
    ({ join } = await import("path"));
    ({ mergeHunkVariants } = await import("@/shared/ui/merge"));
  });
  const LOOKS: LineLook[] = ["conflict", "changed", "resolved", "dismissed"];

  /** `index.css`'s rule for a class: what it applies, as one string */
  const applied = (css: string, className: string) => {
    const rule = new RegExp(`\\.${className}\\s*\\{\\s*@apply\\s+([^;]+);`);
    return css.match(rule)?.[1].replace(/\s+/g, " ").trim();
  };

  describe("hunkLineClass", () => {
    // The editors' highlights are restated in CSS because Monaco will not take
    // the element's classes; restated, they can drift from a reinstalled
    // element without anything else noticing
    it("styles each look exactly as the merge element's mergeHunkVariants", () => {
      const css = readFileSync(
        join(__dirname, "../../../../index.css"),
        "utf8"
      );
      for (const look of LOOKS) {
        expect(applied(css, hunkLineClass(look))).toBe(
          mergeHunkVariants({ state: look })
        );
      }
    });

    it("is a name Monaco keeps as it is", () => {
      for (const look of LOOKS) {
        expect(hunkLineClass(look)).toMatch(/^[a-z0-9_-]+$/i);
      }
    });
  });
}
