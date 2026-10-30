import type { Page } from "@playwright/test";

import {
  currentProject,
  expect,
  LONG,
  projectMenu,
  projectRow,
  seedWorkspace,
  startAnotherProject,
  test,
} from "./fixtures";
import { lineOf, linesOn } from "./telemetry";

/**
 * The navigation's project list (HOO-2069), one test per scenario of the
 * `client-v2-layout` requirement "The navigation lists the projects".
 * "A rename reaches the account" lives in `account-sync.e2e.spec.ts`, beside
 * the account stubs it needs.
 */

/** Two projects, "alpha" then "beta"; beta is open */
const twoProjects = async (page: Page) => {
  await seedWorkspace(page, "alpha");
  await startAnotherProject(page, "beta");
};

const projectNames = (page: Page) =>
  page
    .getByRole("group", { name: "Projects" })
    .locator('[data-sidebar="menu-button"]')
    .allInnerTexts();

test("client-v2-layout: Pinning a project", async ({ page }) => {
  test.setTimeout(120_000);
  await twoProjects(page);
  await expect.poll(() => projectNames(page)).toEqual(["alpha", "beta"]);

  const menu = await projectMenu(page, "beta");
  await menu.getByRole("menuitem", { name: "Pin" }).click();
  await page.reload();

  await expect.poll(() => projectNames(page), LONG).toEqual(["beta", "alpha"]);
  await expect(
    page.getByRole("group", { name: "Projects" }).getByTitle("Pinned")
  ).toHaveCount(1);
  await expect(
    (await projectMenu(page, "beta")).getByRole("menuitem", { name: "Unpin" })
  ).toBeVisible();
});

test("client-v2-layout: Renaming in place", async ({ page }) => {
  test.setTimeout(120_000);
  await twoProjects(page);
  // Pinned first, so the rename is seen to keep the pin
  await (await projectMenu(page, "alpha"))
    .getByRole("menuitem", { name: "Pin" })
    .click();

  const menu = await projectMenu(page, "alpha");
  await menu.getByRole("menuitem", { name: "Rename alpha" }).click();
  const field = page.getByRole("textbox", { name: "Rename alpha" });
  await expect(field).toBeFocused();

  // A taken name keeps the field open, marked
  await field.fill("beta");
  await field.press("Enter");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  // Monaco keeps alert regions of its own; the field's is in the navigation
  await expect(
    page.locator('[data-slot="sidebar"]').getByRole("alert")
  ).toHaveText("A project named beta already exists.");

  await field.fill("gamma");
  await field.press("Enter");
  await expect(projectRow(page, "gamma")).toBeVisible(LONG);
  await expect(projectRow(page, "alpha")).toHaveCount(0);
  // The open project was not the one renamed
  await expect(currentProject(page)).toHaveText("beta");
  // The pin is kept by id, through the rename and a reload
  await page.reload();
  await expect.poll(() => projectNames(page), LONG).toEqual(["gamma", "beta"]);
  await expect(
    page.getByRole("group", { name: "Projects" }).getByTitle("Pinned")
  ).toHaveCount(1);
});

test("renames the open project in place", async ({ page }) => {
  test.setTimeout(120_000);
  await twoProjects(page);

  const menu = await projectMenu(page, "beta");
  await menu.getByRole("menuitem", { name: "Rename beta" }).click();
  const field = page.getByRole("textbox", { name: "Rename beta" });
  await field.fill("delta");
  await field.press("Enter");

  await expect(currentProject(page)).toHaveText("delta", LONG);
  await expect(projectRow(page, "beta")).toHaveCount(0);
  await expect(page.locator("#root-dir").getByText("lib.rs")).toBeVisible();
});

test("the list is on a phone's menu page", async ({ page }) => {
  test.setTimeout(120_000);
  await twoProjects(page);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(projectRow(page, "alpha")).toBeVisible();
  await projectRow(page, "alpha").click();

  await expect(currentProject(page)).toHaveText("alpha", LONG);
});

test("client-v2-layout: Duplicating a project", async ({ page }) => {
  test.setTimeout(120_000);
  await twoProjects(page);

  const menu = await projectMenu(page, "alpha");
  await menu.getByRole("menuitem", { name: "Duplicate" }).click();

  // The copy opens; that it leaves out alpha's `.workspace/program-info.json`
  // is checked by the tests in `workspace-files.ts`, against the explorer's store
  await expect(currentProject(page)).toHaveText("alpha copy", LONG);
  await expect(page.locator("#root-dir").getByText("lib.rs")).toBeVisible();
  await expect
    .poll(() => projectNames(page))
    .toEqual(["alpha", "beta", "alpha copy"]);
});

test("client-v2-layout: Export with a failed conversion", async ({ page }) => {
  test.setTimeout(120_000);
  await seedWorkspace(page, "alpha");

  // Without its program the framework cannot be told, so converting fails
  await page
    .locator("#root-dir")
    .getByText("lib.rs", { exact: true })
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: /delete/i }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^delete$/i })
    .click();
  await expect(page.locator("#root-dir").getByText("lib.rs")).toHaveCount(0);

  const download = page.waitForEvent("download", LONG);
  const menu = await projectMenu(page, "alpha");
  await menu.getByRole("menuitem", { name: "Export as zip" }).click();
  await page.getByRole("button", { name: /convert and export/i }).click();

  await expect(
    page.getByText("Could not convert the layout; exported it as is.")
  ).toBeVisible();
  expect((await download).suggestedFilename()).toBe("alpha.zip");
});

test("client-v2-layout: Deleting from the list", async ({ page }) => {
  test.setTimeout(120_000);
  await twoProjects(page);

  const menu = await projectMenu(page, "alpha");
  await menu.getByRole("menuitem", { name: "Delete alpha" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete project" })
    .click();

  await expect(projectRow(page, "alpha")).toHaveCount(0, LONG);
  await expect(currentProject(page)).toHaveText("beta");
});

test("client-v2-layout: Letter keys in a project's menu", async ({ page }) => {
  test.setTimeout(120_000);
  await twoProjects(page);

  await projectMenu(page, "alpha");
  // Capital, as the item's hint shows it
  await page.keyboard.press("Shift+D");

  await expect(currentProject(page)).toHaveText("alpha copy", LONG);
});

test("client-v2-layout: The rail has no project list", async ({
  seededPage: page,
}) => {
  await expect(projectRow(page, "e2e-project")).toBeVisible();

  await page.keyboard.press("ControlOrMeta+b");
  await expect(
    page.getByRole("button", { name: "Expand navigation" })
  ).toBeVisible();
  await expect(page.getByRole("group", { name: "Projects" })).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+b");
  await expect(projectRow(page, "e2e-project")).toBeVisible();
});

test("client-v2-layout: A lesson's menu", async ({ seededPage: page }) => {
  test.setTimeout(120_000);
  await page
    .locator('[data-slot="sidebar"]')
    .getByRole("button", { name: "Tutorials" })
    .click();
  await page.getByRole("button", { name: "Open Hello Anchor" }).click();
  await expect(page).toHaveURL(/\/tutorials\/hello-anchor/, LONG);
  // A lesson is a workspace only once it is started
  await page.getByRole("button", { name: "Start", exact: true }).click();

  // A started lesson is a row among the projects, as the prototype lists it
  const projects = page.getByRole("group", { name: "Projects" });
  await expect(projects.getByText("Hello Anchor")).toBeVisible(LONG);
  await expect(page.getByRole("group", { name: "Lessons" })).toHaveCount(0);
  const menu = await projectMenu(page, "Hello Anchor");

  for (const item of ["Open", "Pin", "Export as zip", "Delete Hello Anchor"]) {
    await expect(menu.getByRole("menuitem", { name: item })).toBeVisible();
  }
  await expect(menu.getByRole("menuitem", { name: /rename/i })).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: /duplicate/i })).toHaveCount(
    0
  );
});

test("client-v2-layout: Pinning by key", async ({ seededPage: page }) => {
  const lines = linesOn(page);

  await projectMenu(page, "e2e-project");
  await page.keyboard.press("p");

  await expect
    .poll(() => lineOf(lines, "nav_project_action"))
    .toContain("action: pin");
  expect(lineOf(lines, "nav_project_action")).toContain("via: key");
});
