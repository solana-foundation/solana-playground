import { afterEach, describe, expect, it } from "vitest";

import {
  isThemeName,
  removedThemeMessage,
  removedThemeNotice,
  resolveSavedTheme,
} from "./saved-theme";

describe("resolveSavedTheme", () => {
  it.each([
    [null, "Dark", null],
    ["Dark", "Dark", null],
    ["Light", "Light", null],
    ["Solana V2", "Dark", null],
    ["Playground", "Dark", "Playground"],
    ["Dracula", "Dark", "Dracula"],
    ["Solana", "Dark", "Solana"],
    ["Monokai", "Dark", null],
    ["", "Dark", null],
  ])("saved %j -> %s, notice %j", (saved, name, removed) => {
    const expected = removed === null ? { name } : { name, removed };
    expect(resolveSavedTheme(saved)).toEqual(expected);
  });
});

describe("isThemeName", () => {
  it("accepts only the two themes", () => {
    expect(isThemeName("Dark")).toBe(true);
    expect(isThemeName("Light")).toBe(true);
    expect(isThemeName("dark")).toBe(false);
    expect(isThemeName("Solana V2")).toBe(false);
  });
});

describe("removedThemeNotice", () => {
  afterEach(() => {
    removedThemeNotice.take();
  });

  it("hands the held name out once", () => {
    removedThemeNotice.hold("Dracula");

    expect(removedThemeNotice.take()).toBe("Dracula");
    expect(removedThemeNotice.take()).toBeNull();
  });

  it("holds nothing on a visit with nothing removed", () => {
    expect(removedThemeNotice.take()).toBeNull();
  });
});

describe("removedThemeMessage", () => {
  it("names the theme and where Light is", () => {
    expect(removedThemeMessage("Dracula")).toBe(
      "The Dracula theme was removed. Playground now uses Dark; Light is in Settings."
    );
  });
});
