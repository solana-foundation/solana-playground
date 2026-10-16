/**
 * Put the theme's mode on `<html>`. The `dark` class switches every token in
 * `app/styles/playground-tokens.css`; `colorScheme` matches the native UI
 * (scrollbars, form controls) to it.
 *
 * Runs before the theme-change event, so whatever reacts to the event
 * (Monaco, xterm) reads the new values.
 */
export const applyThemeMode = (
  mode: "dark" | "light",
  root: HTMLElement = document.documentElement
) => {
  root.classList.toggle("dark", mode === "dark");
  root.style.colorScheme = mode;
};

if (import.meta.vitest) {
  const { describe, it, expect, afterEach } = import.meta.vitest;

  describe("applyThemeMode", () => {
    afterEach(() => {
      document.documentElement.className = "";
      document.documentElement.style.colorScheme = "";
    });

    it("puts the dark class and colour scheme on <html>", () => {
      applyThemeMode("dark");

      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(document.documentElement.style.colorScheme).toBe("dark");
    });

    it("takes the dark class off for light", () => {
      applyThemeMode("dark");
      applyThemeMode("light");

      expect(document.documentElement.classList.contains("dark")).toBe(false);
      expect(document.documentElement.style.colorScheme).toBe("light");
    });

    it("leaves other classes on <html> alone", () => {
      document.documentElement.classList.add("keep-me");
      applyThemeMode("dark");
      applyThemeMode("light");

      expect(document.documentElement.classList.contains("keep-me")).toBe(true);
    });
  });
}
