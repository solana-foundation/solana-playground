import { describe, expect, it } from "vitest";

import { createMountOpen } from "./mount-open";

const FILE = { path: "/src/lib.rs" };

describe("createMountOpen", () => {
  it("counts only the first open as the mount's", () => {
    const isMountOpen = createMountOpen();
    expect(isMountOpen(FILE)).toBe(true);
    expect(isMountOpen(FILE)).toBe(false);
    expect(isMountOpen(FILE)).toBe(false);
  });

  it("keeps the mount's open for the first file when the replay has none", () => {
    const isMountOpen = createMountOpen();
    expect(isMountOpen(null)).toBe(false);
    expect(isMountOpen(FILE)).toBe(true);
    expect(isMountOpen(FILE)).toBe(false);
  });
});
