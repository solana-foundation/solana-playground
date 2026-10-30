import {
  expect,
  home,
  homeRegion,
  LONG,
  projectMenu,
  projectRow,
  startProject,
  test,
} from "./fixtures";
import type { Page } from "@playwright/test";
import { lineOf, linesOn } from "./telemetry";

test.describe("on a desktop window", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("client-v2-layout: An empty install", async ({ page }) => {
    await page.goto("/");
    await expect(home(page)).toBeVisible();

    const region = homeRegion(page);
    await expect(
      region.getByRole("button", { name: "Ask the assistant" })
    ).toBeVisible();
    await expect(
      region.getByRole("button", { name: /^New project/ })
    ).toBeVisible();
    await expect(
      region.getByRole("button", { name: "Follow a tutorial" })
    ).toBeVisible();
    await expect(
      region.getByRole("button", { name: "Open a program" })
    ).toBeVisible();
    await expect(region.getByRole("button", { name: /^Open / })).toHaveCount(5);
    // The tutorial cards: every "Open ..." button but the "Open a program" tile
    await expect(
      region.getByRole("button", { name: /^Open (?!a program)/ })
    ).toHaveCount(4);

    await expect(page.locator("[data-gallery-modal]")).toHaveCount(0);
    await expect(page.locator(".monaco-editor")).toHaveCount(0);
  });

  test("client-v2-layout: New project from Home", async ({ page }) => {
    await page.goto("/");
    await startProject(page, "home-new");

    await expect(page.locator("#root-dir")).toBeVisible();
    // The project switcher names the new project
    await expect(
      page.getByRole("button", { name: "home-new", exact: true })
    ).toBeVisible();
    // A file of it is open: a tab, and its text in the editor
    await expect(
      page.locator('#tabs [data-slot="editor-tab"][id^="/"]').first()
    ).toBeVisible();
    await expect(page.locator(".monaco-editor").first()).toBeVisible();
    await expect(
      page.locator(".monaco-editor .view-lines").first()
    ).not.toBeEmpty();
  });

  test("client-v2-layout: A tutorial from Home", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await expect(home(page)).toBeVisible();

    await homeRegion(page)
      .getByRole("button", { name: /^Open (?!a program)/ })
      .first()
      .click();

    await expect(page).toHaveURL(/\/tutorials\//);
    // Opening only routes there; the About screen's Start is what a tutorial
    // that was never started shows (see lesson-path.e2e.spec.ts)
    await expect(
      page.getByRole("button", { name: "Start", exact: true })
    ).toBeVisible();
    await expect(home(page)).toBeHidden();

    await page.getByRole("button", { name: "Start", exact: true }).click();
    // The lesson panel's Steps | Files switch is a Segmented: its items are
    // radios (5.19)
    await expect(page.getByRole("radio", { name: "Steps" })).toBeVisible();
  });

  test("client-v2-layout: Tiles that open a page", async ({ page }) => {
    const lines = linesOn(page);
    await page.goto("/");
    await expect(home(page)).toBeVisible();

    await homeRegion(page)
      .getByRole("button", { name: "Open a program" })
      .click();

    await expect(
      page.getByRole("searchbox", { name: "Search programs" })
    ).toBeVisible();
    await expect(home(page)).toBeHidden();
    await expect(page.locator("[data-gallery-modal]")).toHaveCount(0);
    await expect
      .poll(() => lineOf(lines, "catalog_shown"))
      .toContain("via: home");
  });

  test("client-v2-layout: The composer on Home", async ({ page }) => {
    await page.goto("/");
    await expect(home(page)).toBeVisible();

    await homeRegion(page)
      .getByRole("button", { name: "Ask the assistant" })
      .click();

    await expect(page.getByRole("dialog", { name: "Assistant" })).toBeVisible();
  });

  test("client-v2-layout: Opening a tile", async ({ page }) => {
    const lines = linesOn(page);
    await page.goto("/");
    await expect(home(page)).toBeVisible();

    await homeRegion(page)
      .getByRole("button", { name: "Follow a tutorial" })
      .click();

    await expect
      .poll(() => lineOf(lines, "home_tile_opened"))
      .toContain("tile: tutorials");
  });
});

/** The navigation's Home item, apart from Home's own region of that name */
const navHome = (page: Page) =>
  page.locator('[data-slot="sidebar"]').getByRole("button", { name: "Home" });

/** Focus the editor without a click, which would move its cursor */
const focusEditor = (page: Page) =>
  page.locator(".monaco-editor textarea.inputarea").focus();

const firstLine = (page: Page) =>
  page.locator(".monaco-editor .view-line").first();

test.describe("from an open project", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("client-v2-layout: Home from an open project and back", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await startProject(page, "alpha");
    await expect(firstLine(page)).not.toBeEmpty(LONG);
    await focusEditor(page);
    await page.keyboard.press("ControlOrMeta+Home");
    await page.keyboard.type("// kept ");
    await expect(firstLine(page)).toContainText("// kept");
    const url = page.url();
    // The console open too: Home takes its node off the page, which its
    // terminal must not try to fit
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && m.text().includes("logger:global")) {
        errors.push(m.text());
      }
    });
    await page.locator(".monaco-editor textarea.inputarea").blur();
    await page.keyboard.press("ControlOrMeta+j");
    await expect(page.locator(".xterm").first()).toBeVisible();

    await navHome(page).click();
    await expect(home(page)).toBeVisible();
    expect(page.url()).toBe(url);
    await expect(page.locator("[data-gallery-modal]")).toHaveCount(0);

    // Past the terminal's resize throttle (200 ms)
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);

    await projectRow(page, "alpha").click();
    await expect(home(page)).toBeHidden();
    await expect(firstLine(page)).toContainText("// kept");
    // The cursor is where the typing left it
    await focusEditor(page);
    await page.keyboard.type("+");
    await expect(firstLine(page)).toContainText("// kept +");
    // And the history is the editor's own: undo takes the typing back
    await page.keyboard.press("ControlOrMeta+z");
    await page.keyboard.press("ControlOrMeta+z");
    await expect(firstLine(page)).not.toContainText("// kept");
  });

  test("client-v2-layout: Home after the last project is deleted", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await startProject(page, "alpha");
    await expect(page.locator("#root-dir")).toBeVisible(LONG);

    const menu = await projectMenu(page, "alpha");
    await menu.getByRole("menuitem", { name: "Delete alpha" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete project" })
      .click();

    await expect(home(page)).toBeVisible(LONG);
    await expect(page.locator("[data-gallery-modal]")).toHaveCount(0);
    await expect(page.locator(".monaco-editor")).toHaveCount(0);

    await startProject(page, "beta");
    await expect(
      page.locator(".monaco-editor .view-lines").first()
    ).not.toBeEmpty(LONG);
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("client-v2-layout: Home on a phone", async ({ page }) => {
    await page.goto("/");
    await expect(home(page)).toBeVisible();

    const bar = page
      .getByRole("region", { name: "Work" })
      .getByTestId("phone-bar");
    await expect(bar).toContainText("Home");

    const region = homeRegion(page);
    await expect(
      region.getByRole("button", { name: /New Anchor project/ })
    ).toBeVisible();
    await expect(
      region.getByRole("button", { name: /Beginner tutorial/ })
    ).toBeVisible();
    await expect(region.getByRole("button", { name: "Browse" })).toBeVisible();
    await expect(
      region.getByRole("button", { name: "Ask the assistant" })
    ).toBeVisible();

    await region.getByRole("button", { name: /New Anchor project/ }).click();

    await expect(page.getByTestId("phone-pager")).toBeVisible();
    // The Anchor starter's default file, open in the code view's editor
    await expect(
      page.getByRole("button", { name: "Files, lib.rs open" })
    ).toBeVisible();
    await expect(page.locator(".monaco-editor").first()).toBeVisible();
    await expect(home(page)).toBeHidden();
  });

  test("client-v2-layout: Home from an open project on a phone", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await homeRegion(page)
      .getByRole("button", { name: /New Anchor project/ })
      .click();
    await expect(firstLine(page)).not.toBeEmpty(LONG);
    await focusEditor(page);
    await page.keyboard.press("ControlOrMeta+Home");
    await page.keyboard.type("// kept ");

    const work = page.getByRole("region", { name: "Work" });
    await work.getByRole("button", { name: "Menu" }).click();
    await page
      .getByRole("region", { name: "Navigation" })
      .getByRole("button", { name: "Home", exact: true })
      .click();
    // The menu gives way to Home on the work page
    await expect(home(page)).toBeInViewport();
    await expect(work.getByTestId("phone-bar")).toContainText("Home");

    await homeRegion(page)
      .getByRole("button", { name: /^Continue / })
      .click();
    await expect(home(page)).toBeHidden();
    await expect(firstLine(page)).toContainText("// kept");
  });
});
