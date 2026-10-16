import { expect } from "@playwright/test";
import { test } from "./fixtures";

test("client-v2-elements: An unknown page is an alert", async ({
  seededPage: page,
}) => {
  // With no workspace the "What do you want to build?" dialog opens over the
  // page and hides the alert from the accessibility tree
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

test("client-v2-elements: A settings group folds", async ({
  seededPage: page,
}) => {
  await page.locator("[data-settings-trigger]").first().click();
  // Pin the first open group by its name: once it folds it no longer matches
  // `expanded: true`, and the locator would move on to the next group
  const settings = page.getByLabel("Settings");
  const open = settings.getByRole("button", { expanded: true }).first();
  const name = ((await open.textContent()) ?? "").trim();
  expect(name).not.toBe("");
  const heading = settings.getByRole("button", { name, exact: true });
  await heading.click();
  await expect(heading).toHaveAttribute("aria-expanded", "false");
  await heading.click();
  await expect(heading).toHaveAttribute("aria-expanded", "true");
});
