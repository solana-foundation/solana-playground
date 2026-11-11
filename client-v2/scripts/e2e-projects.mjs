// Shared by `playwright.config.mts` and `e2e-report.mjs`, which rejects a known-skips prefix outside this list.
export const CHROMIUM = "chromium";
export const FIREFOX = "firefox";

/** Every project name `playwright.config.mts` can declare, each the name of its browser */
export const PROJECTS = [CHROMIUM, FIREFOX];
