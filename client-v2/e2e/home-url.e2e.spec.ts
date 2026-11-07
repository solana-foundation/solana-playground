import type { Page } from "@playwright/test";
import { deflateRaw } from "pako";

import {
  currentProject,
  expect,
  home,
  homeRegion,
  LONG,
  projectMenu,
  stubPrograms,
  test,
} from "./fixtures";
import { DESK } from "./viewports";

/**
 * The URL follows what the page shows: Home, a page and the work each have
 * their own, and Back and Forward move between them: Home after a tutorial
 * is on `/home`, not the tutorial's route (HOO-2689).
 */

test.use({ viewport: DESK });

/** The navigation's item of this name, not Home's tile of the same words */
const navItem = (page: Page, name: string) =>
  page
    .locator('[data-slot="sidebar"]')
    .getByRole("button", { name, exact: true });

const LESSON = /\/tutorials\/hello-anchor\/1$/;

/** Opens Hello Anchor from an empty install's Home, and waits for its code */
const openLesson = async (page: Page) => {
  await page.goto("/");
  await expect(home(page)).toBeVisible(LONG);
  await homeRegion(page)
    .getByRole("button", { name: "Open Hello Anchor" })
    .click();
  await expect(page).toHaveURL(LESSON, LONG);
  await expect(page.locator(".monaco-editor .view-lines")).toBeVisible(LONG);
};

test("client-v2-layout: Home after a tutorial has Home's address", async ({
  page,
}) => {
  test.setTimeout(120_000);
  // An empty install's Home shows on `/` by itself, and stays there
  await page.goto("/");
  await expect(home(page)).toBeVisible(LONG);
  await expect(page).toHaveURL(/\/$/);
  await openLesson(page);

  await navItem(page, "Home").click();
  await expect(home(page)).toBeVisible();
  await expect(page).toHaveURL(/\/home$/);

  await page.goBack();
  await expect(page).toHaveURL(LESSON);
  await expect(home(page)).toBeHidden();
  await expect(page.locator(".monaco-editor .view-lines")).toBeVisible(LONG);

  await page.goForward();
  await expect(page).toHaveURL(/\/home$/);
  await expect(home(page)).toBeVisible();

  // A page over Home has its own URL, and Back closes it onto Home
  await navItem(page, "Tutorials").click();
  await expect(page).toHaveURL(/\/tutorials\/?$/);
  await expect(
    page.getByRole("searchbox", { name: "Search tutorials" })
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/home$/);
  await expect(
    page.getByRole("searchbox", { name: "Search tutorials" })
  ).toBeHidden();
  await expect(home(page)).toBeVisible();
});

test("client-v2-layout: Home's address survives a reload", async ({ page }) => {
  test.setTimeout(120_000);
  await openLesson(page);
  await navItem(page, "Home").click();
  await expect(page).toHaveURL(/\/home$/);

  await page.reload();
  await expect(home(page)).toBeVisible(LONG);
  // Still there once the explorer's init has landed
  await page.waitForTimeout(2000);
  await expect(page).toHaveURL(/\/home$/);

  // `/` goes on to what was open last
  await page.goto("/");
  await expect(page).toHaveURL(LESSON, LONG);
});

test("Deleting the last project from a tutorial's page throws nothing", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openLesson(page);

  // A tutorial's frame collapses the navigation, and with it the list
  await page.getByRole("button", { name: "Expand navigation" }).click();
  const menu = await projectMenu(page, "Hello Anchor");
  await menu.getByRole("menuitem", { name: "Delete Hello Anchor" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete project" })
    .click();

  await expect(home(page)).toBeVisible(LONG);
  // The lesson's route goes to `/` by itself, and Home shows there
  await expect(page).toHaveURL(/\/$/);
  // Past the route's and the explorer's own events
  await page.waitForTimeout(2000);
  expect(errors).toEqual([]);
});

test("client-v2-layout: Home over a docs link keeps the link", async ({
  page,
}) => {
  const code = Buffer.from(
    deflateRaw(Buffer.from('console.log("kept")', "utf8"))
  ).toString("base64url");
  await page.goto(`/open#v=1&name=kept.ts&code=${code}`);
  const editor = page.locator(".monaco-editor .view-lines");
  await expect(editor).toContainText("kept", LONG);

  // Another route would init the explorer again and drop the unsaved copy
  await navItem(page, "Home").click();
  await expect(home(page)).toBeVisible();
  await expect(page).toHaveURL(/\/open#/);
  await navItem(page, "Home").click();
  await expect(home(page)).toBeHidden();
  await expect(editor).toContainText("kept");
});

test("client-v2-layout: A project picked over a page opens", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await stubPrograms(page);
  await openLesson(page);
  // A second project, a plain one, then back to the lesson
  await navItem(page, "Programs").click();
  await page.getByRole("button", { name: "Open e2e-counter" }).click();
  await expect(currentProject(page)).toContainText("e2e/counter", LONG);
  await navItem(page, "Hello Anchor").click();
  await expect(page).toHaveURL(LESSON, LONG);

  await navItem(page, "Programs").click();
  await expect(page).toHaveURL(/\/programs\/?$/);
  await navItem(page, "github-e2e/counter/").click();
  await expect(page).toHaveURL(/\/$/, LONG);
  await expect(currentProject(page)).toContainText("e2e/counter");
  await expect(page.locator(".monaco-editor .view-lines")).toContainText(
    "entrypoint!(process_instruction)",
    LONG
  );
});
