import { expect, test } from "./fixtures";

/**
 * Collapsing the Flow left panel to a rail and back.
 *
 * The rail's "+" is the one worth a browser: it expands the panel and then
 * waits for the explorer tree to mount before creating, and that hand-off has
 * no unit-testable seam.
 */

const OPEN_PX = 232; // 14.5rem
const RAIL_PX = 52; // 3.25rem

const panel = (page: import("@playwright/test").Page) =>
  page.locator(`[data-slot="sidebar-container"]`);

test("cmd+b toggles the left panel", async ({ seededPage: page }) => {
  await expect(panel(page)).toHaveJSProperty("offsetWidth", OPEN_PX);

  await page.keyboard.press("Meta+b");
  await expect(panel(page)).toHaveJSProperty("offsetWidth", RAIL_PX);

  await page.keyboard.press("Meta+b");
  await expect(panel(page)).toHaveJSProperty("offsetWidth", OPEN_PX);
});

test("the chevron toggles the panel and the hint survives collapse", async ({
  seededPage: page,
}) => {
  const collapse = page.getByRole("button", { name: "Collapse project panel" });
  const expand = page.getByRole("button", { name: "Expand project panel" });

  await collapse.click();
  await expect(panel(page)).toHaveJSProperty("offsetWidth", RAIL_PX);
  // Collapsed, this hint is the only affordance saying how to get the panel
  // back, so losing it is a real regression rather than a cosmetic one.
  await expect(expand).toContainText("⌘B");

  await expand.click();
  await expect(panel(page)).toHaveJSProperty("offsetWidth", OPEN_PX);
  await expect(collapse).toContainText("⌘B");
});

test("the rail's + expands the panel and opens the new-file input", async ({
  seededPage: page,
}) => {
  // The editor takes focus when it opens the workspace's first file
  // (`Monaco.tsx`, on a model switch). On a laptop that has happened long
  // before this test clicks anything; on a slow runner it can land after the
  // new-file input has focused itself, and the input loses focus to the
  // editor. The claim here is about the rail's "+", not about who wins that
  // race, so wait for the editor to be up and focused before starting. The
  // textarea is Monaco's own node, so a class is the handle it offers.
  const editor = page.locator(".monaco-editor textarea.inputarea");
  await expect(editor).toBeVisible();
  await expect(editor).toBeFocused();

  await page.keyboard.press("Meta+b");
  await expect(panel(page)).toHaveJSProperty("offsetWidth", RAIL_PX);

  // Only the rail's "+" exists while collapsed; the footer button is unmounted.
  await page.getByRole("button", { name: "New file" }).click();

  await expect(panel(page)).toHaveJSProperty("offsetWidth", OPEN_PX);
  const input = page.locator("#root-dir input");
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
});
