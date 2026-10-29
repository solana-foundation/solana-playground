import {
  expect,
  home,
  homeRegion,
  LONG,
  seedWorkspace,
  test,
} from "./fixtures";
import type { Page } from "@playwright/test";

/** The navigation's Home, which brings Home back over an open project */
const navHome = (page: Page) =>
  page.locator('[data-slot="sidebar"]').getByRole("button", { name: "Home" });

/**
 * Answers every build with success and counts them: the example's build is
 * the only one any of these flows may start on its own
 */
const countBuilds = async (page: Page) => {
  const builds: string[] = [];
  await page.route("**/build", (route) => {
    builds.push(route.request().url());
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ stderr: "", uuid: "e2e-build", idl: null }),
    });
  });
  return builds;
};

test.describe("on a desktop window", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("client-v2-first-run: First visit on desktop", async ({ page }) => {
    await page.goto("/");
    await expect(home(page)).toBeVisible();

    const example = homeRegion(page).getByRole("region", {
      name: "Try an example",
    });
    await expect(example).toContainText(
      "This program saves a number in an account and writes it to the logs."
    );
    await expect(example.getByRole("button", { name: "Run it" })).toBeVisible();
    await expect(
      homeRegion(page).getByRole("region", {
        name: "Pick up where you left off",
      })
    ).toHaveCount(0);
  });

  test("client-v2-first-run: First press", async ({ page }) => {
    const builds = await countBuilds(page);
    await page.goto("/");
    await homeRegion(page).getByRole("button", { name: "Run it" }).click();

    await expect(home(page)).toBeHidden(LONG);
    await expect(
      page.getByRole("heading", { level: 2, name: "anchor-example" })
    ).toBeVisible(LONG);
    await expect(
      page.getByRole("button", { name: "Continue to Deploy" })
    ).toBeVisible(LONG);
    expect(builds).toHaveLength(1);

    // A reload keeps the example and starts no second build
    await page.reload();
    await expect(page.locator("#root-dir")).toBeVisible(LONG);
    await expect(
      page.getByRole("heading", { level: 2, name: "anchor-example" })
    ).toBeVisible();
    expect(builds).toHaveLength(1);
  });

  test("client-v2-first-run: Return visit on desktop", async ({ page }) => {
    const builds = await countBuilds(page);
    await seedWorkspace(page, "counter");
    await navHome(page).click();
    await expect(home(page)).toBeVisible();

    const recent = homeRegion(page).getByRole("region", {
      name: "Pick up where you left off",
    });
    await expect(recent.getByRole("button")).toHaveCount(1);
    await expect(
      recent.getByRole("button", { name: "Open counter" })
    ).toBeVisible();
    await expect(
      homeRegion(page).getByRole("region", { name: "Try an example" })
    ).toHaveCount(0);

    await recent.getByRole("button", { name: "Open counter" }).click();
    await expect(home(page)).toBeHidden();
    expect(builds).toHaveLength(0);
  });

  test("client-v2-first-run: Past a minute", async ({ page }) => {
    await page.clock.install();
    // A build that never answers, so the stage stays on "Building..."
    await page.route("**/build", () => undefined);
    await page.goto("/");
    await homeRegion(page).getByRole("button", { name: "Run it" }).click();
    await expect(
      page.getByRole("heading", { name: "Building..." })
    ).toBeVisible(LONG);

    await page.clock.runFor(61_000);
    await expect(
      page.getByText("First builds take longer. This one is running.")
    ).toBeVisible();
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("client-v2-first-run: Phone, first visit", async ({ page }) => {
    await page.goto("/");
    await expect(home(page)).toBeVisible();

    const starts = homeRegion(page)
      .getByRole("navigation", { name: "Quick start" })
      .getByRole("button");
    await expect(starts).toHaveCount(3);
    await expect(starts.first()).toContainText("Try an example");
    await expect(starts.nth(1)).toContainText("New Anchor project");
    await expect(starts.nth(2)).toContainText("Beginner tutorial");
  });
});

test.describe("when the account check fails", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("client-v2-first-run: Session read failed", async ({ page }) => {
    let failing = true;
    await page.route("**/api/auth/get-session", (route) =>
      failing
        ? route.fulfill({ status: 502, body: "bad gateway" })
        : route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({ user: null }),
          })
    );
    await page.goto("/");
    await expect(home(page)).toBeVisible();
    await expect(
      homeRegion(page).getByRole("region", { name: "Try an example" })
    ).toHaveCount(0);

    // The check answers on its next re-read, two seconds on
    failing = false;
    await expect(
      homeRegion(page).getByRole("region", { name: "Try an example" })
    ).toBeVisible(LONG);
  });

  test("client-v2-first-run: Sign-in not configured", async ({ page }) => {
    await page.route("**/api/auth/get-session", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Authentication is not configured" }),
      })
    );
    await page.goto("/");
    await expect(
      homeRegion(page).getByRole("region", { name: "Try an example" })
    ).toBeVisible(LONG);
  });
});
