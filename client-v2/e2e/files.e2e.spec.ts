import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { LONG, projectMenu, test } from "./fixtures";

/** Closes every editor tab by its own close button */
const closeEveryTab = async (page: Page) => {
  const close = page.locator("#tabs").getByRole("button", { name: /^Close / });
  await expect(close.first()).toBeVisible(LONG);
  for (let open = await close.count(); open > 0; open--) {
    await close.first().click();
    await expect(close).toHaveCount(open - 1);
  }
};

test("client-v2-files: Closing the last tab", async ({ seededPage: page }) => {
  await closeEveryTab(page);

  await expect(
    page.getByRole("heading", { name: "No file open" })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Show files" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Resources" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Tutorials" })).toHaveCount(0);
});

test("client-v2-files: Show files with the column folded", async ({
  seededPage: page,
}) => {
  await closeEveryTab(page);
  await page.getByRole("button", { name: "Hide files" }).click();
  await expect(page.locator("#root-dir")).toBeHidden();

  await page.getByRole("button", { name: "Show files" }).click();

  await expect(page.locator("#root-dir")).toBeVisible();
});

/** Creates a file from the Files column's foot, in `src` or under a path in it */
const newFile = async (page: Page, name: string) => {
  await page.getByRole("button", { name: "New file" }).click();
  const field = page.locator("#root-dir input");
  await expect(field).toBeFocused();
  await page.keyboard.type(name);
  await page.keyboard.press("Enter");
  await expect(field).toHaveCount(0, LONG);
};

test("client-v2-files: The menu of a middle tab", async ({
  seededPage: page,
}) => {
  await newFile(page, "one.rs");
  await newFile(page, "two.rs");
  const tabs = page.locator('#tabs [data-slot="editor-tab"][id^="/"]');
  await expect(tabs).toHaveCount(3, LONG);

  await tabs.nth(1).click({ button: "right" });

  await expect(page.getByRole("menuitem")).toHaveText([
    /^Close\s*Alt\+W$/,
    "Close others",
    "Close to the right",
    "Close all",
  ]);
});

test("client-v2-files: A signed-out scratch project", async ({
  seededPage: page,
}) => {
  const menu = await projectMenu(page, "e2e-project");
  await menu.getByRole("menuitem", { name: "Delete e2e-project" }).click();

  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Delete e2e-project?" })
  ).toBeVisible();
  await expect(
    dialog.getByText(
      "Its files and its program keypair are deleted from this browser."
    )
  ).toBeVisible();
  await expect(dialog.getByText(/your account/)).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
});

test("client-v2-files: A folder with two files", async ({
  seededPage: page,
}) => {
  await newFile(page, "utils/math.rs");
  await newFile(page, "utils/io.rs");

  await page
    .locator("#root-dir [data-path]")
    .filter({ hasText: /^utils$/ })
    .first()
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: /Delete/ }).click();

  await expect(
    page
      .getByRole("dialog")
      .getByRole("heading", { name: "Delete utils and the 2 files in it?" })
  ).toBeVisible();
});
