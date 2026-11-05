import { expect, filesToggle, leaveEditor, test } from "./fixtures";

/**
 * Hiding the files column and bringing it back. The column leaves the layout
 * while hidden (design.md, "Frame chrome (5.25)"); the editor head's Files and
 * ⌘E are the two ways back.
 */

const OPEN_PX = 240; // the prototype's files column at 1440

const panel = (page: import("@playwright/test").Page) =>
  page.locator("#files[data-panel]");

test("cmd+e toggles the files column", async ({ seededPage: page }) => {
  await expect(panel(page)).toHaveJSProperty("offsetWidth", OPEN_PX);
  await leaveEditor(page);

  await page.keyboard.press("Meta+e");
  await expect(panel(page)).toHaveCount(0);

  await page.keyboard.press("Meta+e");
  await expect(panel(page)).toHaveJSProperty("offsetWidth", OPEN_PX);
});

test("the editor head's Files hides and shows the column", async ({
  seededPage: page,
}) => {
  const files = filesToggle(page);

  await files.click();
  await expect(panel(page)).toHaveCount(0);
  await expect(files).toHaveAttribute("aria-pressed", "false");

  await files.click();
  await expect(panel(page)).toHaveJSProperty("offsetWidth", OPEN_PX);
  await expect(files).toHaveAttribute("aria-pressed", "true");
});
