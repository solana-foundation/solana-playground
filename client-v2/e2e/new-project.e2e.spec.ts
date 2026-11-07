import type { Page } from "@playwright/test";

import { requireFor } from "../src/test-utils/require-for";
import {
  currentProject,
  expect,
  home,
  LONG,
  newProjectPage,
  openGallery,
  PROGRAM,
  seedWorkspace,
  stubPrograms,
  test,
} from "./fixtures";
import { lineOf, linesOn } from "./telemetry";
import { DESK, PHONE } from "./viewports";

/** One of the two lists, by its name (its count follows the name) */
const list = (page: Page, name: "Tutorials" | "Programs") =>
  newProjectPage(page).getByRole("radio", { name: new RegExp(`^${name}`) });

test("client-v2-layout: New project from the navigation", async ({
  seededPage: page,
}) => {
  const lines = linesOn(page);
  await openGallery(page);
  await expect(newProjectPage(page)).toBeVisible();
  // A page in the content area, under its own bar, and the item marked
  // current: no dialog
  await expect(
    page.getByRole("dialog", { name: "What do you want to build?" })
  ).toHaveCount(0);
  await expect(
    page
      .locator('[data-slot="sidebar"]')
      .getByRole("button", { name: "New project" })
  ).toHaveAttribute("data-active", "true");
  await expect
    .poll(() => lineOf(lines, "catalog_shown"))
    .toContain("new-project");
});

test("client-v2-layout: Starting an Anchor project from New project", async ({
  seededPage: page,
}) => {
  await openGallery(page);
  await expect(newProjectPage(page)).toBeVisible();
  await expect(
    newProjectPage(page).getByRole("radio", { name: /Anchor/ })
  ).toHaveAttribute("aria-checked", "true");

  await newProjectPage(page).getByLabel("Project name").fill("from-scratch");
  await newProjectPage(page)
    .getByRole("button", { name: /^Start/ })
    .click();

  await expect(newProjectPage(page)).toBeHidden(LONG);
  await expect(currentProject(page)).toHaveText("from-scratch", LONG);
});

test("client-v2-layout: New project's controls line up", async ({
  seededPage: page,
}) => {
  await page.setViewportSize(DESK);
  await openGallery(page);
  await expect(newProjectPage(page)).toBeVisible();

  const boxes = await Promise.all(
    [
      newProjectPage(page).getByRole("radio", { name: /Anchor/ }),
      newProjectPage(page).getByLabel("Project name"),
      newProjectPage(page).getByRole("button", { name: /^Start/ }),
    ].map(async (l) =>
      requireFor("a control's bounding box")(await l.boundingBox())
    )
  );
  const heights = boxes.map((b) => Math.round(b.height));
  const middles = boxes.map((b) => Math.round(b.y + b.height / 2));
  expect(new Set(heights).size).toBe(1);
  // Framework is its own row; the name and Start share the one under it
  const [framework, name, start] = middles;
  expect(name).toBe(start);
  expect(framework).toBeLessThan(name);
});

test("client-v2-layout: Opening a program from New project", async ({
  page,
}) => {
  await stubPrograms(page);
  await seedWorkspace(page);
  await openGallery(page);

  await list(page, "Programs").click();
  await expect(list(page, "Programs")).toHaveText("Programs1");
  await newProjectPage(page)
    .getByRole("button", { name: `Open ${PROGRAM.name}` })
    .click();

  await expect(newProjectPage(page)).toBeHidden(LONG);
  await expect(page.locator("#root-dir")).toContainText("lib.rs", LONG);
});

test("client-v2-layout: Starting a project is measured", async ({
  seededPage: page,
}) => {
  const lines = linesOn(page);
  await openGallery(page);

  await list(page, "Programs").click();
  await list(page, "Tutorials").click();
  await newProjectPage(page)
    .getByRole("radio", { name: /Native/ })
    .click();
  await newProjectPage(page).getByLabel("Project name").fill("measured");
  await newProjectPage(page)
    .getByRole("button", { name: /^Start/ })
    .click();
  await expect(newProjectPage(page)).toBeHidden(LONG);

  const switched = lines.filter((l) =>
    l.startsWith("[telemetry:event] catalog_tab_switched ")
  );
  expect(switched).toHaveLength(2);
  expect(switched[0]).toContain("programs");
  expect(switched[1]).toContain("tutorials");
  await expect
    .poll(() => lineOf(lines, "new_project_started"))
    .toContain("Native");
});

test.describe("on a phone", () => {
  test.use({ viewport: PHONE });

  // `seededPage` makes its project through the desktop Home's tile, which a
  // phone does not draw; New project needs no project open
  test("client-v2-layout: New project on a phone is a page", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(home(page)).toBeVisible(LONG);
    const work = page.getByRole("region", { name: "Work" });
    await work.getByRole("button", { name: "Menu" }).click();
    await page
      .getByRole("region", { name: "Navigation" })
      .getByRole("button", { name: "New project" })
      .click();

    await expect(newProjectPage(page)).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Work" }).getByText("New project", {
        exact: true,
      })
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(PHONE.width);
    // Nothing inside the page runs off its side either, on either list
    const fits = () =>
      newProjectPage(page).evaluate((d) =>
        [d]
          .concat(Array.from(d.querySelectorAll("*")))
          .every(
            (el) => el.scrollWidth <= el.clientWidth + 1 || el.clientWidth === 0
          )
      );
    expect(await fits()).toBe(true);

    const cards = newProjectPage(page).locator('[data-slot="action-card"]');
    await expect(cards.first()).toBeVisible();
    // A tutorial's card keeps its one button, drawn as the corner square
    await expect(cards.first().locator("[data-card-corner]")).toBeVisible();
    await expect(
      cards.first().getByRole("button", { name: /^Open / })
    ).toBeVisible();

    await list(page, "Programs").click();
    await expect(cards.first()).toBeVisible();
    expect(await fits()).toBe(true);
  });
});

test("client-v2-layout: New project by link", async ({ page }) => {
  const lines = linesOn(page);
  await page.goto("/new");

  await expect(newProjectPage(page)).toBeVisible(LONG);
  // The link opens the page, then gives way to `/`, as `/tutorials` does
  await expect(page).toHaveURL(/\/$/);
  await expect
    .poll(() => lineOf(lines, "catalog_shown"))
    .toContain("via: link");

  // Home in the navigation is the way back
  await page
    .locator('[data-slot="sidebar"]')
    // Exact: the logo is "Go to Home", in the same sidebar
    .getByRole("button", { name: "Home", exact: true })
    .click();
  await expect(newProjectPage(page)).toBeHidden();
  await expect(home(page)).toBeVisible();
});
