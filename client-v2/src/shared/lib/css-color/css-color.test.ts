import { beforeEach, describe, expect, it, vi } from "vitest";

import { isTransparent, resolveColor, toHex, TRANSPARENT } from "./css-color";

const warn = vi.hoisted(() => vi.fn());
vi.mock("../logger", () => ({ createLogger: () => ({ warn }) }));

describe("toHex", () => {
  it.each([
    ["rgb(16, 16, 17)", "#101011"],
    ["rgb(16 16 17)", "#101011"],
    ["rgba(0, 0, 0, 0)", "#00000000"],
    ["rgba(153, 69, 255, 0.5)", "#9945ff80"],
    ["rgb(153 69 255 / 50%)", "#9945ff80"],
    ["color(srgb 0.6 0.270588 1)", "#9945ff"],
    ["color(srgb 0.6 0.270588 1 / 0.39)", "#9945ff63"],
    ["color(srgb 1 1e-06 0)", "#ff0000"],
    ["color(srgb -0.01 0 1.02)", "#0000ff"],
  ])("%s -> %s", (computed, hex) => {
    expect(toHex(computed)).toBe(hex);
  });

  it.each(["", "var(--x)", "oklch(0.7 0.1 200)", "not a colour"])(
    "returns null for %j",
    (computed) => {
      expect(toHex(computed)).toBeNull();
    }
  );
});

describe("isTransparent", () => {
  it("knows the computed transparent black", () => {
    expect(isTransparent("rgba(0, 0, 0, 0)")).toBe(true);
    expect(isTransparent("rgb(0, 0, 0)")).toBe(false);
  });
});

describe("resolveColor", () => {
  /**
   * A browser's `getComputedStyle` for `color`: a token it knows resolves,
   * anything else is invalid at computed-value time and inherits from the
   * parent -- which is how a misspelt token looked like a real colour.
   */
  const KNOWN: Record<string, string> = {
    "var(--primary)": "rgb(138, 63, 245)",
  };
  const inherited = (el: Element | null): string =>
    (el as HTMLElement | null)?.style.color || "rgb(255, 255, 255)";

  beforeEach(() => {
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (el) =>
        ({
          color:
            KNOWN[(el as HTMLElement).style.color] ??
            inherited(el.parentElement),
        } as CSSStyleDeclaration)
    );
  });

  it("resolves a token the page defines", () => {
    expect(resolveColor("var(--primary)")).toBe("#8a3ff5");
  });

  it("falls back to transparent for a token the page does not define", () => {
    expect(resolveColor("var(--no-such-token)")).toBe(TRANSPARENT);
  });

  it("warns once per unresolved value, however often it is resolved", () => {
    warn.mockClear();
    resolveColor("var(--twice-missing)");
    resolveColor("var(--twice-missing)");
    resolveColor("var(--also-missing)");

    expect(warn).toHaveBeenCalledTimes(2);
  });
});
