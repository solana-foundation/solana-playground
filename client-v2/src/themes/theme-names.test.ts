import { describe, expect, it } from "vitest";

import { THEME_NAMES } from "../utils/theme/saved-theme";
import { dark } from "./dark/dark";
import { light } from "./light/light";

describe("theme names", () => {
  // A saved name outside `THEME_NAMES` falls back to Dark without a word, so
  // a theme renamed here and not there would drop its users silently
  it("are the names the saved-theme fallback accepts", () => {
    expect([dark.name, light.name]).toEqual(THEME_NAMES);
  });

  it("make Dark the default", () => {
    expect(dark.isDefault).toBe(true);
    expect(light.isDefault).toBe(false);
  });
});
