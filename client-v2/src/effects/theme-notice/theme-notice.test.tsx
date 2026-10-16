import { beforeEach, describe, expect, it, vi } from "vitest";

// The utils barrel reads generated globals that exist only in the built app,
// so it is replaced with the members the effect touches
const takeRemovedThemeNotice = vi.fn<() => string | null>();
const setToast = vi.fn();
vi.mock("../../utils", () => ({
  PgTheme: { takeRemovedThemeNotice: () => takeRemovedThemeNotice() },
  PgView: { setToast: (...args: unknown[]) => setToast(...args) },
  removedThemeMessage: (name: string) => `The ${name} theme was removed.`,
}));

import { themeNotice } from "./theme-notice";

describe("themeNotice", () => {
  beforeEach(() => {
    takeRemovedThemeNotice.mockReset();
    setToast.mockReset();
  });

  it("keeps the notice up until the user closes it", () => {
    // It shows once ever, and on a visit with no project the gallery covers
    // it: a toast that closes by itself could vanish unseen
    takeRemovedThemeNotice.mockReturnValue("Dracula");

    themeNotice();

    expect(setToast).toHaveBeenCalledTimes(1);
    expect(setToast.mock.calls[0][1]).toEqual({
      options: { autoClose: false },
    });
  });

  it("shows nothing when no theme was removed", () => {
    takeRemovedThemeNotice.mockReturnValue(null);

    themeNotice();

    expect(setToast).not.toHaveBeenCalled();
  });
});
