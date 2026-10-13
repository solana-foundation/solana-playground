import { readFileSync } from "fs";
import { join } from "path";

import { mergeHunkVariants } from "@/shared/ui/merge";
import { hunkLineClass } from "./hunk-class";
import type { LineLook } from "./merge-file";

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
    const css = readFileSync(join(__dirname, "../../../../index.css"), "utf8");
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
