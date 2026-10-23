// Installed from design-system/src/lib/utils.ts by `yarn ds-add utils`, which
// overwrites the module, so its tests live here rather than in-source.
import { describe, expect, it } from "vitest";

import { cn } from "./utils";

describe("cn", () => {
  it.each(["display", "title", "body", "control", "caption", "code"])(
    "keeps the type-scale size text-%s next to a text colour",
    (size) => {
      expect(cn(`text-${size} text-foreground`)).toBe(
        `text-${size} text-foreground`
      );
      expect(cn(`text-${size} text-muted-foreground`)).toBe(
        `text-${size} text-muted-foreground`
      );
    }
  );

  it("lets a later size replace a type-scale size", () => {
    expect(cn("text-control text-sm")).toBe("text-sm");
    expect(cn("text-sm text-caption")).toBe("text-caption");
  });

  it.each(["read", "label", "headline", "act"])(
    "keeps the weight font-%s next to a font family",
    (weight) => {
      expect(cn(`font-${weight} font-mono`)).toBe(`font-${weight} font-mono`);
    }
  );

  it("lets a later weight replace a theme weight", () => {
    expect(cn("font-act font-medium")).toBe("font-medium");
    expect(cn("font-medium font-read")).toBe("font-read");
  });

  it("still merges the stock classes", () => {
    expect(cn("p-2 p-4")).toBe("p-4");
    expect(cn("text-red-500 text-blue-500")).toBe("text-blue-500");
    expect(cn("px-2", false && "px-4", undefined, "py-1")).toBe("px-2 py-1");
  });
});
