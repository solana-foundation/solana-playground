import { expect, test } from "@playwright/test";

/**
 * A link straight to a lesson page, on a profile that has never started the
 * lesson. The route sets the sidebar to Explorer for a page, and its own
 * sidebar listener used to read that as "the user left a lesson that is not
 * started" and navigate home. React 17 delivered the event before the
 * tutorial state existed, so the listener skipped it; React 18+ batches the
 * update and delivers it after.
 */
test("a lesson page opened by link stays on that page", async ({ page }) => {
  await page.goto("/tutorials/hello-anchor/1");

  await expect(page.locator("pre").first()).toBeVisible();
  await expect(page).toHaveURL(/\/tutorials\/hello-anchor\/1$/);

  // Still there once the debounced sidebar events have all landed
  await page.waitForTimeout(3000);
  await expect(page).toHaveURL(/\/tutorials\/hello-anchor\/1$/);
});
