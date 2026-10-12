import { describe, expect, it } from "vitest";

import PALETTE from "./palette";

describe("palette", () => {
  it("writes on a primary fill with the design system's on-primary colour", () => {
    // `--text-primary` is near-black in Light: about 3:1 on the purple fill
    expect(PALETTE.components?.button?.overrides?.primary?.color).toBe(
      "var(--primary-foreground)"
    );
  });
});
