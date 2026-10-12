/** The themes the product offers: the design system's dark and light */
export const THEME_NAMES = ["Dark", "Light"] as const;

/** The name of a theme the product offers */
export type ThemeName = typeof THEME_NAMES[number];

/** Whether a saved name is one of the themes the product offers */
export const isThemeName = (name: string): name is ThemeName =>
  (THEME_NAMES as readonly string[]).includes(name);

/**
 * Themes a user could pick before the token bridge, and so are told about.
 * "Solana V2" is missing on purpose: it was the default, written to storage
 * on every first load, so nobody chose it and Dark replaces it silently.
 */
const REMOVED_THEMES = ["Playground", "Dracula", "Solana"] as const;

/** The name of a theme a user could pick before the token bridge */
export type RemovedTheme = typeof REMOVED_THEMES[number];

/** Whether a saved name is a removed theme the user is told about */
const isRemovedTheme = (name: string): name is RemovedTheme =>
  (REMOVED_THEMES as readonly string[]).includes(name);

/** The theme to apply, and, only on Dark, the removed one to tell about */
export type SavedTheme =
  | { name: ThemeName }
  | { name: "Dark"; removed: RemovedTheme };

/**
 * Decide the theme from the name saved in storage. Anything that is not one
 * of the two themes lands on Dark; only a theme the user picked from our
 * list is reported, so a hand-edited value or another app's key on localhost
 * passes silently.
 */
export const resolveSavedTheme = (saved: string | null): SavedTheme => {
  if (saved !== null && isThemeName(saved)) return { name: saved };
  if (saved !== null && isRemovedTheme(saved)) {
    return { name: "Dark", removed: saved };
  }
  return { name: "Dark" };
};

/** The notice for a user whose saved theme was removed */
export const removedThemeMessage = (name: RemovedTheme) =>
  `The ${name} theme was removed. Playground now uses Dark; Light is in Settings.`;

/** The removed theme waiting to be told about, or `null` */
let held: RemovedTheme | null = null;

/**
 * The removed theme, kept in memory until the UI can show it. A toast sent
 * before `Toast` mounts is lost, and storage already says Dark, so this is
 * the only place the name survives until then.
 */
export const removedThemeNotice = {
  hold(name: RemovedTheme) {
    held = name;
  },
  take(): RemovedTheme | null {
    const name = held;
    held = null;
    return name;
  },
};
