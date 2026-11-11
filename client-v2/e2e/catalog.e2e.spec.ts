import type { Page } from "@playwright/test";

import {
  currentProject,
  expect,
  home,
  LONG,
  projectRow,
  stubPrograms,
  test,
} from "./fixtures";
import { lineOf, linesOn, linesRead } from "./telemetry";
import { openPhoneMenu, PHONE } from "./viewports";

/**
 * The navigation's item of this name, not Home's tile of the same words, nor
 * the empty project list's Open tutorials
 */
const navItem = (page: Page, name: string) =>
  page
    .locator('[data-slot="sidebar"]')
    .getByRole("button", { name, exact: true });

const search = (page: Page, label: "tutorials" | "programs") =>
  page.getByRole("searchbox", { name: `Search ${label}` });

/** The tab the editor shows, by its text */
const shownTab = (page: Page) =>
  page.locator('#tabs [role="tab"][aria-selected="true"]');

test("client-v2-layout: Finding a tutorial by search", async ({
  seededPage: page,
}) => {
  await navItem(page, "Tutorials").click();
  // The start lists Hello Anchor, Lumberjack and Zero Copy
  await search(page, "tutorials").fill("energy");

  await expect(
    page.getByRole("button", { name: "Open Lumberjack" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open Hello Anchor" })
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Open Lumberjack" }).click();
  await expect(page).toHaveURL(/\/tutorials\/lumberjack/, LONG);
  await expect(search(page, "tutorials")).toBeHidden();
  // An unstarted conversation tutorial opens on its intro
  await expect(page.getByRole("button", { name: /Start step 1/ })).toBeVisible(
    LONG
  );
});

test("client-v2-layout: A program opens as a project", async ({ page }) => {
  await stubPrograms(page);
  // From Home, with no project: what the editor shows can only be the import
  await page.goto("/");
  await expect(home(page)).toBeVisible(LONG);
  await navItem(page, "Programs").click();

  await page.getByRole("button", { name: "Open e2e-counter" }).click();

  await expect(search(page, "programs")).toBeHidden(LONG);
  await expect(page.locator(".monaco-editor .view-lines")).toContainText(
    "entrypoint!(process_instruction)",
    LONG
  );
  await expect(currentProject(page)).toContainText("e2e/counter");
});

test("client-v2-layout: Back to the open project", async ({
  seededPage: page,
}) => {
  // Not the file a fresh open lands on, so a remount would show
  await page.getByRole("button", { name: "client", exact: true }).click();
  await page.getByRole("button", { name: "client.ts" }).click();
  await expect(shownTab(page)).toContainText("client.ts");
  const before = await shownTab(page).textContent();
  await navItem(page, "Tutorials").click();
  await expect(search(page, "tutorials")).toBeVisible();

  await projectRow(page, "e2e-project").click();

  await expect(search(page, "tutorials")).toBeHidden();
  await expect(shownTab(page)).toHaveText(before ?? "");
  await expect(page.locator("#root-dir")).toBeVisible();
});

test("Home from a page over the work shows Home, and the project comes back after", async ({
  seededPage: page,
}) => {
  await navItem(page, "Tutorials").click();
  await expect(search(page, "tutorials")).toBeVisible();

  await navItem(page, "Home").click();
  await expect(search(page, "tutorials")).toBeHidden();
  await expect(home(page)).toBeVisible();

  await projectRow(page, "e2e-project").click();
  await expect(home(page)).toBeHidden();
  await expect(page.locator("#root-dir")).toBeVisible();
});

test("client-v2-layout: The pages by link", async ({ page }) => {
  await stubPrograms(page);
  const lines = linesOn(page);
  await page.goto("/programs");

  await expect(search(page, "programs")).toBeVisible(LONG);
  await expect(
    page.getByRole("button", { name: "Open e2e-counter" })
  ).toBeVisible();
  // The page keeps its own URL while it shows
  await expect(page).toHaveURL(/\/programs\/?$/);
  await expect(home(page)).toBeHidden();
  await expect
    .poll(() => lineOf(lines, "catalog_shown"))
    .toContain("via: link");
});

test("Back from a page's link returns to the lesson under it", async ({
  seededPage: page,
}) => {
  // A tutorial with no definition, so it stays on its About page: one with a
  // definition creates its workspace and moves on to its first page
  await page.goto("/tutorials/hello-seahorse");
  await expect(
    page.getByRole("button", { name: "Start", exact: true })
  ).toBeVisible(LONG);
  await page.goto("/tutorials");
  await expect(search(page, "tutorials")).toBeVisible(LONG);
  await expect(page).toHaveURL(/\/tutorials\/?$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/tutorials\/hello-seahorse/);
  await expect(search(page, "tutorials")).toBeHidden();
});

// The explorer switches to the open project on every route's init; that
// switch must not close a page a link opened
test("a link opens its page over an open project too", async ({
  seededPage: page,
}) => {
  await page.goto("/tutorials");

  await expect(search(page, "tutorials")).toBeVisible(LONG);
  await expect(page.locator("#root-dir")).toBeAttached(LONG);
  // Past the explorer's init
  await page.waitForTimeout(3000);
  await expect(search(page, "tutorials")).toBeVisible();
});

test("client-v2-layout: Searching tutorials", async ({ seededPage: page }) => {
  const lines = linesOn(page);
  await navItem(page, "Tutorials").click();
  await search(page, "tutorials").pressSequentially("zzz");

  await expect(
    page.getByText("No tutorials match “zzz”", { exact: true })
  ).toBeVisible();
  await expect
    .poll(() => lineOf(lines, "catalog_searched"))
    .toContain("empty: true");
  expect(lineOf(lines, "catalog_searched")).toContain("page: tutorials");
  // Past another rest: still the one search
  await page.waitForTimeout(800);
  await linesRead(lines);
  expect(
    lines.filter((l) => l.startsWith("[telemetry:event] catalog_searched "))
  ).toHaveLength(1);
});

test.describe("on a phone", () => {
  test.use({ viewport: PHONE });

  test("client-v2-layout: The pages on a phone", async ({ page }) => {
    await page.goto("/");
    await expect(home(page)).toBeVisible(LONG);
    const work = page.getByRole("region", { name: "Work" });

    await openPhoneMenu(page);
    await page
      .getByRole("region", { name: "Navigation" })
      // Exact: with no project the list offers Open tutorials too
      .getByRole("button", { name: "Tutorials", exact: true })
      .click();

    // The page's own heading names it, so the bar keeps only the menu
    await expect(
      work.getByRole("heading", { level: 1, name: "Tutorials" })
    ).toBeVisible();
    await expect(work.getByTestId("phone-bar")).not.toContainText("Tutorials");
    await expect(
      work.getByRole("button", { name: "Search tutorials" })
    ).toBeInViewport();
    const cards = work.locator('[data-slot="action-card"]');
    await expect(cards.first()).toBeVisible();
    // Both boxes in one frame: the pager may still be scrolling to the work
    // page, and two separate reads would see the cards at different places
    // Not `evaluateAll`: over these cards it crashes Playwright 1.65's Firefox 159 content process
    const [first, second] = await work.evaluate((root) =>
      Array.from(root.querySelectorAll('[data-slot="action-card"]'))
        .slice(0, 2)
        .map((el) => {
          const { x, y, height } = el.getBoundingClientRect();
          return { x, y, height };
        })
    );
    // One column: the second card sits under the first, not beside it
    expect(second.y).toBeGreaterThan(first.y + first.height - 1);
    expect(Math.round(second.x)).toBe(Math.round(first.x));

    // The tutorial card is one button over the whole card, on a phone too
    await work.getByRole("button", { name: "Open Hello Anchor" }).click();
    await expect(page).toHaveURL(/\/tutorials\/hello-anchor/, LONG);
  });

  test("client-v2-tutorials: Searching on a phone", async ({ page }) => {
    await page.goto("/tutorials");
    const heading = page.getByRole("heading", {
      level: 1,
      name: "Tutorials",
    });
    await expect(heading).toBeVisible(LONG);

    await page.getByRole("button", { name: "Search tutorials" }).click();
    await expect(search(page, "tutorials")).toBeFocused();
    await expect(heading).toBeHidden();
    await search(page, "tutorials").pressSequentially("lumber");
    const cards = page.locator('[data-slot="action-card"]');
    await expect(cards).toHaveCount(1);

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(heading).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Search tutorials" })
    ).toBeVisible();
    await expect(cards).toHaveCount(3);
  });
});
