import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * The panel comes back usable after a reload, without being asked twice.
 *
 * The connection is in memory only, so every reload starts with nothing
 * connected. For a backend that needs a key of its own there is no way around
 * asking again, but the default backend needs none -- and making the user
 * click the same button on every single reload, before the assistant could be
 * used at all, was the whole of the difference.
 *
 * Only reachable on a deployment that actually serves a default backend, which
 * is what the probe in `Connect` decides; the test asserts nothing when it is
 * not configured, rather than failing on an environment it was never about.
 */

const LONG = { timeout: 60_000 };

type AssistantWindow = Window & {
  __pgAssistant?: { isConnected: boolean; items: unknown[] };
};

const isConnected = (page: Page) =>
  page.evaluate(
    () => !!(window as AssistantWindow).__pgAssistant?.isConnected
  );

const hasDefaultBackend = (page: Page) =>
  page.evaluate(async () => {
    const r = await fetch("/api/agent").catch(() => null);
    if (!r?.ok) return false;
    return !!(await r.json()).configured;
  });

/** The picker's connect button reads "Start" for the keyless default */
const start = (page: Page) =>
  page.getByRole("button", { name: "Start", exact: true });

test("the default backend reconnects itself after a reload", async ({
  page,
}) => {
  test.setTimeout(240_000);

  await page.goto("/");
  test.skip(!(await hasDefaultBackend(page)), "no default backend configured");

  const gallery = page.locator("[data-gallery-modal]");
  await expect(gallery).toBeVisible(LONG);
  await gallery.getByLabel("Project name").fill("alpha");
  await gallery.getByRole("button", { name: /^Start/ }).click();
  await expect(gallery).toBeHidden(LONG);

  // A first visit still asks: choosing a backend is how the panel introduces
  // what it can reach, and nothing has been chosen yet
  await expect(start(page)).toBeVisible(LONG);
  await start(page).click();
  await expect.poll(() => isConnected(page), LONG).toBe(true);

  await page.reload();

  await expect.poll(() => isConnected(page), LONG).toBe(true);
  await expect(start(page)).toBeHidden(LONG);
});

test("disconnecting is not undone by the next reload", async ({ page }) => {
  test.setTimeout(240_000);

  await page.goto("/");
  test.skip(!(await hasDefaultBackend(page)), "no default backend configured");

  const gallery = page.locator("[data-gallery-modal]");
  await expect(gallery).toBeVisible(LONG);
  await gallery.getByLabel("Project name").fill("beta");
  await gallery.getByRole("button", { name: /^Start/ }).click();
  await expect(gallery).toBeHidden(LONG);

  await expect(start(page)).toBeVisible(LONG);
  await start(page).click();
  await expect.poll(() => isConnected(page), LONG).toBe(true);

  // Disconnecting says "stop using this backend", and a reload that quietly
  // reconnected would be the app overruling that
  await page.evaluate(() =>
    (
      window as Window & { __pgAssistant?: { disconnect: () => void } }
    ).__pgAssistant!.disconnect()
  );
  await page.reload();

  await expect(start(page)).toBeVisible(LONG);
  expect(await isConnected(page)).toBe(false);
});
