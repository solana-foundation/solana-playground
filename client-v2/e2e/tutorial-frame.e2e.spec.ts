import type { Page } from "@playwright/test";

import { LONG, expect, test } from "./fixtures";
import { lineOf, linesOn } from "./telemetry";

/** The chat column, the navigation's column and the scrim over the chat */
const chat = (page: Page) =>
  page.getByRole("complementary", { name: "Tutorial chat" });
const navColumn = (page: Page) =>
  page.locator('[data-slot="sidebar-container"]');
const scrim = (page: Page) => page.getByTestId("tutorial-nav-scrim");

/** Hello Anchor has a definition: Start opens it in the frame */
const startHelloAnchor = async (page: Page) => {
  // No default backend, whatever the dev server is configured with
  await page.route("**/api/agent", (route) =>
    route.fulfill({ json: { configured: false, model: null } })
  );
  await page.goto("/tutorials/hello-anchor");
  await page.getByRole("button", { name: "Start", exact: true }).click(LONG);
  await expect(chat(page)).toBeVisible(LONG);
};

/** No horizontal scroll on the page */
const noHorizontalScroll = (page: Page) =>
  expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth
      )
    )
    .toBe(true);

test.describe("tutorial-workspace", () => {
  test.setTimeout(120_000);

  for (const [width, expected] of [
    [1440, 421],
    [1280, 400],
    [1152, 360],
  ] as const) {
    test(
      width === 1440
        ? "tutorial-workspace: Widths at 1440"
        : `the chat column's width at ${width}`,
      async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await startHelloAnchor(page);
        // The rail, then the chat, then the workspace, whatever was saved
        await expect(navColumn(page)).toHaveJSProperty("offsetWidth", 52);
        await expect(chat(page)).toHaveJSProperty("offsetWidth", expected);
        const chatBox = await chat(page).boundingBox();
        expect(chatBox?.x).toBe(52);
        await noHorizontalScroll(page);
        // No assistant panel and no files column beside the chat
        await expect(
          page.getByRole("button", { name: "Collapse assistant" })
        ).toHaveCount(0);
        await expect(
          chat(page).getByRole("heading", { name: "Hello Anchor", exact: true })
        ).toBeVisible();
      }
    );
  }

  test("tutorial-workspace: Opening the menu in a tutorial", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await startHelloAnchor(page);
    const more = chat(page).getByRole("button", { name: "More" });
    await more.focus();

    await page.keyboard.press("ControlOrMeta+b");
    await expect(scrim(page)).toBeVisible();
    // Over the chat: the chat keeps its place and its width
    await expect(chat(page)).toHaveJSProperty("offsetWidth", 421);
    expect((await chat(page).boundingBox())?.x).toBe(52);

    await page.keyboard.press("Escape");
    await expect(scrim(page)).toHaveCount(0);
    await expect(navColumn(page)).toHaveJSProperty("offsetWidth", 52);
    await expect(more).toBeFocused();
  });

  test("tutorial-workspace: Pinning the menu", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const lines = linesOn(page);
    await startHelloAnchor(page);
    await page.getByRole("button", { name: "Expand navigation" }).click();
    await page.getByRole("button", { name: "Keep open" }).click();
    await expect
      .poll(() => lineOf(lines, "tutorial_frame_menu_opened"))
      .toContain("via: button");
    await expect
      .poll(() => lineOf(lines, "tutorial_frame_menu_pinned"))
      .toContain("pinned: true");
  });

  test("the scrim closes the menu, and the pin docks it beside the chat", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await startHelloAnchor(page);
    await page.getByRole("button", { name: "Expand navigation" }).click();
    await expect(scrim(page)).toBeVisible();
    await scrim(page).click({ position: { x: 1000, y: 400 } });
    await expect(scrim(page)).toHaveCount(0);

    await page.getByRole("button", { name: "Expand navigation" }).click();
    await page.getByRole("button", { name: "Keep open" }).click();
    await expect(scrim(page)).toHaveCount(0);
    await expect(navColumn(page)).toHaveJSProperty("offsetWidth", 232);
    // Docked, the chat moves over beside it
    // The column's gap widens over 200 ms
    await expect
      .poll(async () => (await chat(page).boundingBox())?.x)
      .toBe(232);
    await expect(
      page.getByRole("button", { name: "Fold while I learn" })
    ).toBeVisible();
  });

  test("the chat's edge resizes it, and a double click hands it back", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await startHelloAnchor(page);
    const handle = page.getByRole("separator", {
      name: "Resize the chat column",
    });
    await handle.focus();
    await page.keyboard.press("End");
    await expect(handle).toHaveAttribute("aria-valuenow", "560");
    await handle.dblclick();
    await expect(handle).toHaveAttribute("aria-valuenow", "421");
  });

  test("leaving the tutorial gives the navigation back as it was saved", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await startHelloAnchor(page);
    await expect(navColumn(page)).toHaveJSProperty("offsetWidth", 52);
    await chat(page).getByRole("button", { name: "Tutorials" }).click();
    // The Tutorials page covers the work, and the saved, open navigation is back
    await expect(navColumn(page)).toHaveJSProperty("offsetWidth", 232);
  });
});
