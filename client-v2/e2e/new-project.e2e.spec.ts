import type { Page } from "@playwright/test";

import {
  LONG,
  PROGRAM,
  currentProject,
  expect,
  home,
  openGallery,
  seedWorkspace,
  stubPrograms,
  test,
} from "./fixtures";
import { lineOf, linesOn } from "./telemetry";

/** The New project dialog, by its title */
const dialog = (page: Page) =>
  page.getByRole("dialog", { name: "What do you want to build?" });

/** One of the two lists, by its name (its count follows the name) */
const list = (page: Page, name: "Tutorials" | "Programs") =>
  dialog(page).getByRole("radio", { name: new RegExp(`^${name}`) });

test("client-v2-layout: Starting an Anchor project from New project", async ({
  seededPage: page,
}) => {
  await openGallery(page);
  await expect(dialog(page)).toBeVisible();
  await expect(
    dialog(page).getByRole("radio", { name: /Anchor/ })
  ).toHaveAttribute("aria-checked", "true");

  await dialog(page).getByLabel("Project name").fill("from-scratch");
  await dialog(page)
    .getByRole("button", { name: /^Start/ })
    .click();

  await expect(dialog(page)).toBeHidden(LONG);
  await expect(currentProject(page)).toHaveText("from-scratch", LONG);
});

test("client-v2-layout: New project's controls line up and its list shows it scrolls", async ({
  seededPage: page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openGallery(page);
  await expect(dialog(page)).toBeVisible();

  const boxes = await Promise.all(
    [
      dialog(page).getByRole("radio", { name: /Anchor/ }),
      dialog(page).getByLabel("Project name"),
      dialog(page).getByRole("button", { name: /^Start/ }),
    ].map((l) => l.boundingBox())
  );
  const heights = boxes.map((b) => Math.round(b!.height));
  const middles = boxes.map((b) => Math.round(b!.y + b!.height / 2));
  expect(new Set(heights).size).toBe(1);
  expect(new Set(middles).size).toBe(1);

  // The list runs past the dialog's foot: a fade there says there is more
  const body = dialog(page).locator('[data-slot="modal-body"]');
  expect(await body.evaluate((b) => b.scrollHeight > b.clientHeight)).toBe(
    true
  );
  const fade = dialog(page).locator("[data-scroll-fade]");
  await expect(fade).toBeVisible();
  const [fadeBox, bodyBox] = await Promise.all([
    fade.boundingBox(),
    body.boundingBox(),
  ]);
  expect(
    Math.abs(fadeBox!.y + fadeBox!.height - (bodyBox!.y + bodyBox!.height))
  ).toBeLessThan(40);

  // At the end of the list the fade covers none of the last card
  await body.evaluate((b) => b.scrollTo(0, b.scrollHeight));
  const last = dialog(page).locator('[data-slot="action-card"]').last();
  const [lastBox, endFadeBox] = await Promise.all([
    last.locator('[data-slot="action-card-content"]').boundingBox(),
    fade.boundingBox(),
  ]);
  expect(endFadeBox!.y).toBeGreaterThanOrEqual(
    lastBox!.y + lastBox!.height - 1
  );
  await last.getByRole("button", { name: /^Open / }).click({ trial: true });
});

test("client-v2-layout: Opening a program from New project", async ({
  page,
}) => {
  await stubPrograms(page);
  await seedWorkspace(page);
  await openGallery(page);

  await list(page, "Programs").click();
  await expect(list(page, "Programs")).toHaveText("Programs1");
  await dialog(page)
    .getByRole("button", { name: `Open ${PROGRAM.name}` })
    .click();

  await expect(dialog(page)).toBeHidden(LONG);
  await expect(page.locator("#root-dir")).toContainText("lib.rs", LONG);
});

test("client-v2-layout: Starting a project is measured", async ({
  seededPage: page,
}) => {
  const lines = linesOn(page);
  await openGallery(page);

  await list(page, "Programs").click();
  await list(page, "Tutorials").click();
  await dialog(page)
    .getByRole("radio", { name: /Native/ })
    .click();
  await dialog(page).getByLabel("Project name").fill("measured");
  await dialog(page)
    .getByRole("button", { name: /^Start/ })
    .click();
  await expect(dialog(page)).toBeHidden(LONG);

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
  test.use({ viewport: { width: 390, height: 844 } });

  // `seededPage` makes its project through the desktop Home's row, which a
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

    await expect(dialog(page)).toBeVisible();
    const box = await dialog(page).boundingBox();
    expect(box).toEqual({ x: 0, y: 0, width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(390);
    // Nothing inside the page runs off its side either, on either list
    const fits = () =>
      dialog(page).evaluate((d) =>
        [d]
          .concat(Array.from(d.querySelectorAll("*")))
          .every(
            (el) => el.scrollWidth <= el.clientWidth + 1 || el.clientWidth === 0
          )
      );
    expect(await fits()).toBe(true);

    const cards = dialog(page).locator('[data-slot="action-card"]');
    await expect(cards.first()).toBeVisible();
    // A tutorial's card keeps its one button, drawn as the chevron: the
    // corner square is a wide screen's
    await expect(cards.first().locator("[data-card-chevron]")).toBeVisible();
    await expect(cards.first().locator("[data-card-corner]")).toBeHidden();
    await expect(
      cards.first().getByRole("button", { name: /^Open / })
    ).toBeVisible();

    await list(page, "Programs").click();
    await expect(cards.first()).toBeVisible();
    expect(await fits()).toBe(true);
  });
});
