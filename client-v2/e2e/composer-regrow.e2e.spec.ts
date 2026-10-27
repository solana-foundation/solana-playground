import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * The composer's input after the assistant is folded and opened again. Flow
 * mounts the assistant only while it is open, and it mounts at the folded
 * width, so an input that measured itself only then stayed as tall as its
 * placeholder wrapped one character per line (200 px, its cap).
 */

const input = (page: Page) =>
  page.getByRole("textbox", { name: "Message the assistant" });
const heightOf = (page: Page) =>
  input(page).evaluate((el) => el.getBoundingClientRect().height);

test.use({ viewport: { width: 1280, height: 800 } });

test("the composer's input is one line after the assistant is reopened by key", async ({
  seededPage: page,
}) => {
  await expect(input(page)).toBeVisible();
  await expect.poll(() => heightOf(page)).toBeLessThan(60);

  await page.keyboard.press("ControlOrMeta+r");
  await expect(
    page.getByRole("button", { name: "Expand assistant" })
  ).toBeVisible();
  await page.keyboard.press("ControlOrMeta+r");

  await expect(input(page)).toBeVisible();
  await expect.poll(() => heightOf(page)).toBeLessThan(60);
});

test("the composer's input is one line after the assistant is reopened by its button", async ({
  seededPage: page,
}) => {
  await expect(input(page)).toBeVisible();

  await page.getByRole("button", { name: "Collapse assistant" }).click();
  await page.getByRole("button", { name: "Expand assistant" }).click();

  await expect(input(page)).toBeVisible();
  await expect.poll(() => heightOf(page)).toBeLessThan(60);
});
