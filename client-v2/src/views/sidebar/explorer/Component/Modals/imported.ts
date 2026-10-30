/**
 * What an import dialog closes with once a project is imported or opened.
 * The settings page, which opens these dialogs, closes on it so the opened
 * project shows; a dialog dismissed without importing closes with `null`.
 */
export const IMPORTED = "imported";

/** Whether an import dialog's answer says a project was imported or opened */
export const isImported = (answer: unknown) => answer === IMPORTED;
