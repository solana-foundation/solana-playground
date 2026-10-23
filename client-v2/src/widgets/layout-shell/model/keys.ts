/** The key that opens and closes the console drawer, as `PgKeybind` reads it */
export const CONSOLE_KEY = "Ctrl+J";

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

    it("keeps Ctrl elsewhere", () => {
      expect(keyLabel(CONSOLE_KEY, "Windows")).toBe("Ctrl+J");
    });
  });
}
