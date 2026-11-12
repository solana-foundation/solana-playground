import {
  expect,
  filesDropdown,
  filesToggle,
  leaveEditor,
  test,
} from "./fixtures";

/**
 * Undocking the files column and docking it again. The column leaves the
 * layout while undocked (design.md, "Frame chrome (5.25)"); the editor
 * head's Files and ⌘E undock it and then open the tree as a dropdown, whose
 * «Dock beside the editor» brings the column back. The suite's window is wide
 * enough to dock (`playwright.config`).
 */

const OPEN_PX = 240; // the prototype's files column at 1440

const panel = (page: import("@playwright/test").Page) =>
  page.locator("#files[data-panel]");
const dock = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: "Dock beside the editor" }).click();

test("cmd+e undocks the files column, then opens the dropdown", async ({
  seededPage: page,
}) => {
  await expect(panel(page)).toHaveJSProperty("offsetWidth", OPEN_PX);
  await leaveEditor(page);

  await page.keyboard.press("Meta+e");
  await expect(panel(page)).toHaveCount(0);

  await page.keyboard.press("Meta+e");
  await expect(filesDropdown(page).locator("#root-dir")).toBeVisible();
  await expect(panel(page)).toHaveCount(0);

  await dock(page);
  await expect(panel(page)).toHaveJSProperty("offsetWidth", OPEN_PX);
});

test("the editor head's Files undocks the column, then opens the dropdown", async ({
  seededPage: page,
}) => {
  const files = filesToggle(page);

  await files.click();
  await expect(panel(page)).toHaveCount(0);
  await expect(files).toHaveAttribute("aria-pressed", "false");

  await files.click();
  await expect(filesDropdown(page).locator("#root-dir")).toBeVisible();
  await expect(files).toHaveAttribute("aria-pressed", "true");

  await dock(page);
  await expect(panel(page)).toHaveJSProperty("offsetWidth", OPEN_PX);
  await expect(files).toHaveAttribute("aria-pressed", "true");
  await expect(filesDropdown(page)).toHaveCount(0);
});
