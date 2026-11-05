/** The key that opens and closes the console drawer, as `PgKeybind` reads it */
export const CONSOLE_KEY = "Ctrl+J";

/** The key that opens and closes the files column, as `PgKeybind` reads it */
export const FILES_KEY = "Ctrl+E";

/**
 * A shell key as the user presses it on `os` (`PgCommon.getOS()`):
 * `PgKeybind` reads Meta as Ctrl, so a Mac shows ⌘ where the binding says Ctrl.
 */
export const keyLabel = (key: string, os: string | undefined) =>
  os === "MacOS" ? key.replace(/^Ctrl\+/, "⌘") : key;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("widgets/layout-shell/model/keys", () => {
    it("shows Ctrl as ⌘ on a Mac", () => {
      expect(keyLabel(CONSOLE_KEY, "MacOS")).toBe("⌘J");
    });

    it("shows the files key as ⌘E on a Mac and Ctrl+E elsewhere", () => {
      expect(keyLabel(FILES_KEY, "MacOS")).toBe("⌘E");
      expect(keyLabel(FILES_KEY, "Linux")).toBe("Ctrl+E");
    });

    it("keeps Ctrl elsewhere", () => {
      expect(keyLabel(CONSOLE_KEY, "Windows")).toBe("Ctrl+J");
    });
  });
}
