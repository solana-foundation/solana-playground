import type { Locator, Page } from "@playwright/test";

import {
  expect,
  home,
  LONG,
  newProjectPage,
  projectRow,
  stubPrograms,
  test,
} from "./fixtures";
import { DESK } from "./viewports";

/**
 * New project, Tutorials and Programs are history entries of their own:
 * each keeps its path while it shows, Back closes it onto what it showed
 * over, Forward opens it again, and a reload stays on it (HOO-2719).
 */

test.use({ viewport: DESK });

/** The navigation's item of this name, not Home's tile of the same words */
const navItem = (page: Page, name: string) =>
  page
    .locator('[data-slot="sidebar"]')
    .getByRole("button", { name, exact: true });

const PAGES: Array<{
  item: string;
  path: RegExp;
  shown: (page: Page) => Locator;
}> = [
  { item: "New project", path: /\/new\/?$/, shown: newProjectPage },
  {
    item: "Tutorials",
    path: /\/tutorials\/?$/,
    shown: (page) => page.getByRole("searchbox", { name: "Search tutorials" }),
  },
  {
    item: "Programs",
    path: /\/programs\/?$/,
    shown: (page) => page.getByRole("searchbox", { name: "Search programs" }),
  },
];

test("client-v2-layout: Back from a page", async ({ seededPage: page }) => {
  await stubPrograms(page);
  await expect(page).toHaveURL(/\/$/);
  const editor = page.locator(".monaco-editor .view-lines");

  for (const { item, path, shown } of PAGES) {
    await navItem(page, item).click();
    await expect(shown(page)).toBeVisible();
    await expect(page).toHaveURL(path);

    // Back closes the page onto the project it showed over
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(shown(page)).toBeHidden();
    await expect(editor).toBeVisible();

    await page.goForward();
    await expect(page).toHaveURL(path);
    await expect(shown(page)).toBeVisible();

    // Home in the navigation closes it: the path leaves the page's
    await navItem(page, "Home").click();
    await expect(shown(page)).toBeHidden();
    await expect(home(page)).toBeVisible();
    await expect(page).toHaveURL(/\/home$/);
    // Back to the work for the next page
    await projectRow(page, "e2e-project").click();
    await expect(home(page)).toBeHidden();
  }
});

test("client-v2-layout: A page survives a reload", async ({
  seededPage: page,
}) => {
  test.setTimeout(120_000);
  await stubPrograms(page);
  for (const { item, path, shown } of PAGES) {
    await navItem(page, item).click();
    await expect(page).toHaveURL(path);

    await page.reload();
    await expect(shown(page)).toBeVisible(LONG);
    // Still there once the explorer's init has landed
    await page.waitForTimeout(2000);
    await expect(page).toHaveURL(path);
    await expect(shown(page)).toBeVisible();
  }
});

test("client-v2-layout: A page over Home goes back to Home", async ({
  page,
}) => {
  await page.goto("/");
  await expect(home(page)).toBeVisible(LONG);

  await navItem(page, "Tutorials").click();
  await expect(page).toHaveURL(/\/tutorials\/?$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(home(page)).toBeVisible();

  // A reload on a page's path with no project open shows the page over Home
  await page.goto("/programs");
  await expect(
    page.getByRole("searchbox", { name: "Search programs" })
  ).toBeVisible(LONG);
  await navItem(page, "Home").click();
  await expect(home(page)).toBeVisible();
  await expect(page).toHaveURL(/\/home$/);
});

test("client-v2-layout: A page over a lesson goes back to it", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await stubPrograms(page);
  await page.goto("/tutorials/hello-anchor");
  const start = page
    .getByRole("complementary", { name: "Tutorial chat" })
    .getByRole("button", { name: "Start step 1" });
  await expect(start).toBeVisible(LONG);

  await navItem(page, "Programs").click();
  await expect(page).toHaveURL(/\/programs\/?$/);

  // The lesson's route draws its page again
  // The lesson's route carries its page number once the frame opens it
  await page.goBack();
  await expect(page).toHaveURL(/\/tutorials\/hello-anchor(\/1)?\/?$/);
  await expect(
    page.getByRole("searchbox", { name: "Search programs" })
  ).toBeHidden();
  await expect(start).toBeVisible(LONG);
});
