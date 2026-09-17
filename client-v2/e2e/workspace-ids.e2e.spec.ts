import { expect, test } from "./fixtures";
import { seedWorkspace } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * Workspaces carry a stable id now, and the config they live in was reshaped
 * from `{allNames, currentName}` to `{workspaces: [{id, name}], currentId}`.
 *
 * `PgWorkspace.migrate` is unit-tested directly; what those tests cannot reach
 * is the round trip through a real filesystem -- read, migrate, mutate, save,
 * reload, read again. A mistake there does not throw, it silently loses the
 * project list, so it has to be exercised in a browser.
 *
 * These reload immediately after creating a project on purpose. That used to
 * lose the workspace: file contents persist at once but the directory tree
 * behind them is written on a 500ms debounce, so a reload inside that window
 * came back to a config naming a workspace whose directory did not exist.
 * `_saveWorkspaces` now flushes, and these tests are what hold that.
 *
 * Note this starts from a clean profile, so it covers the new shape rather
 * than a legacy-to-new upgrade -- an existing user's upgrade is only
 * observable in a profile that predates the change.
 */

const switcher = (page: Page) => page.locator('[aria-haspopup="true"]').first();

const openMenu = async (page: Page) => {
  await switcher(page).click();
  const menu = page.getByLabel("Projects and lessons");
  await expect(menu).toBeVisible();
  return menu;
};

test("a project survives an immediate reload", async ({ page }) => {
  await seedWorkspace(page, "alpha");

  await page.reload();

  await expect(page.locator("#root-dir")).toBeVisible();
  await expect(switcher(page)).toContainText("alpha");
});

test("the project is still listed after a reload", async ({ page }) => {
  await seedWorkspace(page, "alpha");

  await page.reload();
  await expect(page.locator("#root-dir")).toBeVisible();

  const menu = await openMenu(page);
  await expect(menu.getByText("alpha", { exact: true })).toBeVisible();
});

test("its files are still there after a reload", async ({ page }) => {
  await seedWorkspace(page, "alpha");

  await page.reload();
  await expect(page.locator("#root-dir")).toBeVisible();

  // The config can survive while the directory behind it does not; an empty
  // tree is exactly what that failure looked like
  await expect(page.locator("#root-dir")).not.toBeEmpty();
});

test("reopening the project from the switcher still works", async ({
  page,
}) => {
  await seedWorkspace(page, "alpha");
  await page.reload();
  await expect(page.locator("#root-dir")).toBeVisible();

  const menu = await openMenu(page);
  await menu.getByText("alpha", { exact: true }).click();

  await expect(page.locator("#root-dir")).toBeVisible();
  await expect(switcher(page)).toContainText("alpha");
});
