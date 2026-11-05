import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { TRANSPARENT } from "@/shared/lib/css-color";

import { BRAND, brandHex } from "./voxel-tokens";

const resolveColor = vi.hoisted(() => vi.fn());
vi.mock("@/shared/lib/css-color", async (actual) => {
  const real = await actual<typeof import("@/shared/lib/css-color")>();
  return { resolveColor, TRANSPARENT: real.TRANSPARENT };
});

const TOKENS = readFileSync(
  path.join(__dirname, "../../../../app/styles/playground-tokens.css"),
  "utf8"
);

describe("voxel brand tokens", () => {
  it.each(Object.values(BRAND))("%s is declared in the tokens", (value) => {
    const name = value.slice("var(".length, -1);
    expect(TOKENS).toContain(`${name}:`);
  });

  it("returns the resolved hex", () => {
    resolveColor.mockReturnValueOnce("resolved");
    expect(brandHex(BRAND.purple)).toBe("resolved");
  });

  it("throws when the token does not resolve", () => {
    resolveColor.mockReturnValueOnce(TRANSPARENT);
    expect(() => brandHex(BRAND.paper)).toThrow(
      "var(--brand-paper) did not resolve"
    );
  });
});
