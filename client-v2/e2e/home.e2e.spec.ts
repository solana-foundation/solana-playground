import { expect, home, homeRegion, startProject, test } from "./fixtures";
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
    // Opening only routes there; the About screen's START is what a tutorial
    // that was never started shows (see lesson-path.e2e.spec.ts)
    await expect(
      page.getByRole("button", { name: "START", exact: true })
    ).toBeVisible();
    await expect(home(page)).toBeHidden();

    await page.getByRole("button", { name: "START", exact: true }).click();
    // The lesson panel's Steps | Files switch is a Segmented: its items are
    // radios (5.19)
    await expect(page.getByRole("radio", { name: "Steps" })).toBeVisible();
  });

  test("client-v2-layout: Tiles that open the gallery", async ({ page }) => {
    await page.goto("/");
    await expect(home(page)).toBeVisible();

    await homeRegion(page)
      .getByRole("button", { name: "Open a program" })
      .click();

    await expect(page.locator("[data-gallery-modal]")).toBeVisible();
    await expect(page.locator("#gallery-tab-programs")).toHaveAttribute(
      "aria-selected",
      "true"
    );
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
});
