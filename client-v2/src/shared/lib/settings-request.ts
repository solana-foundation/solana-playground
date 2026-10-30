/** Marks the controls that open the settings. Tests find the triggers by it. */
export const SETTINGS_TRIGGER_ATTR = "data-settings-trigger";

/** Which control the settings page puts focus on when it opens */
export type SettingsFocus = "page" | "network";

/** What opened the settings: the cluster row, the rail's dot, the account menu or ⌘, */
export type SettingsEntry = "cluster" | "rail" | "menu" | "key";

/**
 * What closed the settings: "Back to app", Escape, ⌘, or a project imported
 * from the page, which shows the project it opened
 */
export type SettingsExit = "back" | "escape" | "key" | "import";

/**
 * A request to open (or, while open, close) the settings. `returnTo` is the
 * control focus goes back to on close, when it is not the one focused at the
 * request: a menu item unmounts with its menu, so the menu names its trigger.
 */
export type SettingsRequest = {
  from: SettingsEntry;
  focus: SettingsFocus;
  returnTo?: HTMLElement | null;
};
