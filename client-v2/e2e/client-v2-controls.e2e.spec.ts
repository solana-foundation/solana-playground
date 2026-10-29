import type { Page } from "@playwright/test";

import {
  expect,
  FAILED_BUILD_STDERR,
  json,
  LONG,
  seedWorkspace,
  test,
} from "./fixtures";

/**
 * The scenarios of `client-v2-controls`: the stepper, a radio group and a
 * select, by pointer and by keyboard.
 */

/**
 * The editor focuses itself when it opens the first file, at a moment that
 * varies with the machine; landing after a test put the focus on a control,
 * it takes it away (and a key meant for the control). Wait for it first.
 */
const editorTookFocus = (page: Page) =>
  expect(page.locator(".monaco-editor textarea.inputarea")).toBeFocused(LONG);

test.describe("client-v2-controls", () => {
  test("client-v2-controls: The stepper drives the stages", async ({
    seededPage: page,
  }) => {
    await editorTookFocus(page);
    await page.locator("#flow-stage-tab-build").click();
    await expect(page.locator("#flow-stage-tab-build")).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(page.locator("#flow-stage-panel-build")).toBeVisible();

    await page.locator("#flow-stage-tab-build").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#flow-stage-tab-deploy")).toBeFocused();
  });

  test("client-v2-controls: A failed build says so", async ({
    seededPage: page,
  }) => {
    // CI has no build server: the request is answered here, so the test
    // never leaves the browser
    await page.route("**/build", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          stderr: FAILED_BUILD_STDERR,
          uuid: null,
          idl: null,
        }),
      })
    );

    await page.locator("#flow-stage-tab-build").click();
    await page
      .locator("#flow-stage-panel-build")
      .getByRole("button", { name: /^Build$/ })
      .click();

    await expect(page.locator("#flow-stage-tab-build")).toHaveAttribute(
      "aria-label",
      /^Build: failed, \d+ errors?/
    );
  });

  test("client-v2-controls: Network by keyboard", async ({
    seededPage: page,
  }) => {
    await editorTookFocus(page);
    await page.locator("[data-settings-trigger]").first().click();
    const group = page.getByRole("radiogroup", { name: "Network" });
    await group.getByRole("radio", { checked: true }).focus();
    const before = await group
      .getByRole("radio", { checked: true })
      .textContent();

    await page.keyboard.press("ArrowRight");

    const after = group.getByRole("radio", { checked: true });
    await expect(after).not.toHaveText(before!);
    await expect(after).toBeFocused();
  });

  test("client-v2-controls: A setting select", async ({ seededPage: page }) => {
    await editorTookFocus(page);
    await page.locator("[data-settings-trigger]").first().click();
    const row = page
      .locator('[aria-label="Settings"]')
      .locator("span", { hasText: /^Theme$/ })
      .locator("xpath=../..");
    await row.getByRole("combobox").focus();
    await page.keyboard.press("ArrowDown");

    const light = page.getByRole("option", { name: "Light", exact: true });
    await expect(light).toBeVisible();
    // The options sit above the settings page, not under it
    const onTop = await light.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const hit = document.elementFromPoint(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2
      );
      return hit !== null && el.contains(hit);
    });
    expect(onTop).toBe(true);

    // Escape closes the options, and leaves the settings open
    await page.keyboard.press("Escape");
    await expect(light).toBeHidden();
    await expect(page.getByRole("region", { name: "Settings" })).toBeVisible();
    await row.getByRole("combobox").focus();
    await page.keyboard.press("ArrowDown");

    // The list opens on the chosen theme, Dark; Light is the next option
    await page.keyboard.press("ArrowDown");
    await expect(light).toBeFocused();
    await page.keyboard.press("Enter");
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.classList.contains("dark"))
      )
      .toBe(false);
  });

  test("client-v2-controls: The backend list by keyboard", async ({ page }) => {
    // The toggle only exists while a default backend is offered, and CI
    // configures none: answer the probe here
    await page.route("**/api/agent", (route) =>
      json(route, { configured: true })
    );
    await seedWorkspace(page);
    // The editor takes focus once the project opens; wait for that, or it
    // takes it back from the radio between the keys
    await expect(page.locator(".monaco-editor textarea").first()).toBeFocused(
      LONG
    );

    // Connect a model opens from the head's More, not on its own
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page
      .getByRole("menuitem", { name: /Connect a model…|Connection and key…/ })
      .click();

    const toggle = page.getByRole("button", { name: "Bring your own key" });
    await toggle.click();
    const group = page.getByRole("radiogroup", { name: "Backend" });
    const radios = group.getByRole("radio");
    const all = await radios.count();

    await group.getByRole("radio", { checked: true }).focus();
    // Radix checks the radio the arrow focused only while the key is still
    // down, and moves the focus on a timer: hold the key until the radio is
    // checked, as a hand would, rather than for a fixed time a slow runner
    // can outlast
    const arrowTo = async (index: number) => {
      await page.keyboard.down("ArrowDown");
      await expect(radios.nth(index)).toBeChecked();
      await page.keyboard.up("ArrowDown");
    };
    await arrowTo(1);
    await expect(radios.nth(1)).toBeFocused();
    await arrowTo(2);

    await expect(
      page.getByRole("button", { name: "Hide other backends" })
    ).toHaveAttribute("aria-expanded", "true");
    await expect(radios).toHaveCount(all);
    await expect(radios.nth(2)).toBeChecked();
    await expect(radios.nth(2)).toBeFocused();
  });
});
