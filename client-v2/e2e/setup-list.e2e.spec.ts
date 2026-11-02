import type { BrowserContext, Page } from "@playwright/test";

import {
  expect,
  json,
  LONG,
  seedWorkspace,
  stubSignedIn,
  test,
} from "./fixtures";
import { lineOf, linesOn } from "./telemetry";

/**
 * The navigation's Get set up checklist. Every test stubs `/api/agent` with
 * no default backend, so the assistant step waits on Connect a model and
 * nothing depends on the dev server's own backend.
 */

const setupList = (page: Page) => page.locator('[data-slot="setup-list"]');
const title = (page: Page) =>
  setupList(page).getByRole("button", { name: /^Get set up/ });
const step = (page: Page, name: string) =>
  setupList(page).getByRole("button", { name, exact: true });
const doneStep = (page: Page, name: string) =>
  setupList(page)
    .locator('[data-slot="setup-list-item"][data-status="done"]')
    .filter({ hasText: name });

/** On the context, so a second tab gets them too */
const stubNoDefaultBackend = (context: BrowserContext) =>
  context.route("**/api/agent", (route) =>
    route.request().method() === "GET"
      ? json(route, { configured: false, model: null })
      : route.abort()
  );

/** Through the step itself: the Playground wallet's setup, then Continue */
const connectWallet = async (page: Page) => {
  await step(page, "Connect a wallet").click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(doneStep(page, "Connect a wallet")).toContainText(
    /\w{4}…\w{4}/,
    LONG
  );
};

test.beforeEach(async ({ context }) => {
  await stubNoDefaultBackend(context);
});

test("client-v2-layout: Counting the steps", async ({ page }) => {
  await seedWorkspace(page);
  await expect(title(page)).toHaveText("Get set up· 1 of 4", LONG);
  await connectWallet(page);

  // A user who comes back with the wallet still connected
  await page.reload();
  await expect(title(page)).toHaveText("Get set up· 2 of 4", LONG);
  await expect(doneStep(page, "Choose a network")).toContainText("devnet");
  await expect(doneStep(page, "Connect a wallet")).toContainText(/\w{4}…\w{4}/);
  await expect(step(page, "Sign in with GitHub")).toBeVisible();
  await expect(step(page, "Connect the assistant")).toBeVisible();
});

test("client-v2-layout: The default network counts", async ({ page }) => {
  await seedWorkspace(page);
  await expect(title(page)).toHaveText("Get set up· 1 of 4", LONG);
  await expect(doneStep(page, "Choose a network")).toContainText("devnet");
  await expect(step(page, "Choose a network")).toHaveCount(0);
});

test("client-v2-layout: The fold survives a reload", async ({ page }) => {
  await seedWorkspace(page);
  await expect(title(page)).toHaveAttribute("aria-expanded", "true", LONG);
  await title(page).click();
  await expect(step(page, "Connect a wallet")).toHaveCount(0);

  await page.reload();
  await expect(title(page)).toHaveAttribute("aria-expanded", "false", LONG);
  await expect(step(page, "Connect a wallet")).toHaveCount(0);
});

test("client-v2-layout: A step opens its action", async ({ page }) => {
  const lines = linesOn(page);
  await seedWorkspace(page);
  await step(page, "Connect the assistant").click();
  await expect(
    page.getByRole("dialog", { name: "Connect a model" })
  ).toBeVisible();
  await expect
    .poll(() => lineOf(lines, "assistant_connect_opened"))
    .toContain("{via: setup}");
});

test("client-v2-layout: The checklist on a phone's menu page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await seedWorkspace(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(title(page)).toHaveText("Get set up· 1 of 4");
  // Folded to its one line on a phone, as the prototype keeps it
  await expect(title(page)).toHaveAttribute("aria-expanded", "false");
  await title(page).click();
  await expect(step(page, "Connect a wallet")).toBeInViewport();

  // Unfolded by the user, it stays so
  await page.reload();
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(title(page)).toHaveAttribute("aria-expanded", "true", LONG);
});

test("client-v2-layout: Dismissing the checklist", async ({ page }) => {
  await seedWorkspace(page);
  await expect(title(page)).toBeVisible(LONG);

  await setupList(page)
    .getByRole("button", { name: "Dismiss the checklist" })
    .click();
  await expect(setupList(page)).toHaveCount(0);

  await page.reload();
  await expect(page.locator("#root-dir")).toBeVisible(LONG);
  await expect(setupList(page)).toHaveCount(0);
});

test("client-v2-layout: Finishing the checklist", async ({ page, context }) => {
  await stubSignedIn(context);
  await seedWorkspace(page);
  await expect(title(page)).toHaveText("Get set up· 2 of 4", LONG);

  await connectWallet(page);
  await expect(title(page)).toHaveText("Get set up· 3 of 4");

  // The last step: a key-based model, which connects without a request
  await step(page, "Connect the assistant").click();
  await page.getByRole("radio", { name: "Anthropic" }).click();
  await page.locator("#assistant-api-key").fill("sk-ant-fake-key");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(setupList(page)).toHaveCount(0);

  // A new tab has no model connected: the connection is per tab
  const second = await context.newPage();
  await second.goto("/");
  await expect(second.locator("#root-dir")).toBeVisible(LONG);
  await expect(
    second.getByRole("button", { name: "Connect a model" })
  ).toBeVisible(LONG);
  await expect(setupList(second)).toHaveCount(0);
});
