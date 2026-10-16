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
