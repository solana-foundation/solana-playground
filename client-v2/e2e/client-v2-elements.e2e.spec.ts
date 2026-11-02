import { expect } from "@playwright/test";
import { FAILED_BUILD_STDERR, LONG, test } from "./fixtures";

test("client-v2-elements: An unknown page is an alert", async ({
  seededPage: page,
}) => {
  // The unknown page is the alert, not the project the fixture made
  await page.goto("/no-such-page");
  await expect(page.getByRole("alert")).toContainText("URL path not found");
});

test("client-v2-elements: A skill is switched by its name", async ({
  seededPage: page,
}) => {
  // Sources and tools opens from the assistant head's More menu
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: /Sources and tools/ }).click();

  // The first skill that can be switched off; a bundled skill is locked on
  const first = page
    .locator(
      '[role="checkbox"][id^="skill-"][aria-checked="true"]:not([disabled])'
    )
    .first();
  await expect(first).toBeVisible();
  // Pinned by id, so the locator keeps the same box once it is unchecked
  const box = page.locator(`[id="${await first.getAttribute("id")}"]`);
  // The checkbox is named by the visible name beside it
  const name = page.locator(
    `[id="${await box.getAttribute("aria-labelledby")}"]`
  );
  const text = ((await name.textContent()) ?? "").trim();
  expect(text).not.toBe("");
  await expect(box).toHaveAccessibleName(text);

  await name.click();
  await expect(box).not.toBeChecked();
  await name.click();
  await expect(box).toBeChecked();
});

test("client-v2-elements: The compiler output folds", async ({
  seededPage: page,
}) => {
  // CI has no build server: the request is answered here
  await page.route("**/build", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        stderr: FAILED_BUILD_STDERR,
        uuid: null,
        idl: null,
      }),
    })
  );
  await page.locator("#flow-stage-tab-build").click();
  const panel = page.locator("#flow-stage-panel-build");
  await panel.getByRole("button", { name: /^Build$/ }).click();

  const toggle = panel.getByRole("button", { name: /compiler output/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false", LONG);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  // The compiler's own words, the summary line the diagnostics leave out
  const output = panel.locator("pre", { hasText: "could not compile" });
  await expect(output).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(output).toBeHidden();
});
