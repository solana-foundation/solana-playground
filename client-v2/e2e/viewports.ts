import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * The window sizes the suite draws in, one per class of `use-viewport`;
 * `viewports.e2e.spec.ts` holds each on its side of `LAYOUT_BREAKPOINTS`. A
 * test about a width of its own, such as the line itself, spells it out.
 */
export const PHONE = { width: 390, height: 844 };
export const TABLET = { width: 834, height: 1112 };
export const DESK = { width: 1280, height: 800 };
export const WIDE_DESK = { width: 1440, height: 900 };
/**
 * The suite's default (`playwright.config.mts`): the narrowest common window
 * whose code area, beside the open navigation and assistant, is wide enough
 * (1100 px) to dock the project tree
 */
export const DOCK_DESK = { width: 1920, height: 1080 };

/** A page of the phone's pager, by its section's label */
type PhonePage = "Navigation" | "Work" | "Preview";

// Playwright 1.65 waits out `inert` instead of scrolling the pager to a target, so a phone test waits for the page to settle
export const waitForPhonePage = (page: Page, name: PhonePage) =>
  expect(page.getByRole("region", { name })).toBeInViewport({ ratio: 1 });

/** Taps Menu on a settled Work, and waits for the menu page to settle */
export const openPhoneMenu = async (page: Page) => {
  await waitForPhonePage(page, "Work");
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await waitForPhonePage(page, "Navigation");
};

/** Taps "Preview the build" on a settled Work, and waits for the preview to settle */
export const openPhonePreview = async (page: Page) => {
  await waitForPhonePage(page, "Work");
  await page.getByRole("button", { name: "Preview the build" }).click();
  await waitForPhonePage(page, "Preview");
};
