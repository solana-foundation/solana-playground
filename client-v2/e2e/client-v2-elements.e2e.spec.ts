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

  // The first skill row; its visible name is the checkbox's accessible name
  const row = page
    .locator("label", { has: page.getByRole("checkbox") })
    .first();
  await expect(row).toBeVisible();
  const name = ((await row.textContent()) ?? "").trim();
  expect(name).not.toBe("");
  const box = page.getByRole("checkbox", { name, exact: true });
  await expect(box).toBeVisible();

  const color = () => row.evaluate((el) => getComputedStyle(el).color);

  await expect(box).toBeChecked();
  const checkedColor = await color();
  await page.getByText(name, { exact: true }).click();
  await expect(box).not.toBeChecked();
  // The label brightens when its box is checked
  await expect.poll(color).not.toBe(checkedColor);
  await page.getByText(name, { exact: true }).click();
  await expect(box).toBeChecked();
  await expect.poll(color).toBe(checkedColor);
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
