import type { Page } from "@playwright/test";

import { expect, json, LONG, test } from "./fixtures";

/**
 * The scenarios of `client-v2-command-stop`: stopping a build from the
 * console strip and with Ctrl+C. The deploy's scenarios need a cluster that
 * takes transactions and are manual.
 */

/** How long a toast takes to mount, so its absence means something */
const TOAST_RENDER_MS = 1000;

/**
 * Holds every build request until `answer` is called (or forever), the way
 * a slow build server does
 */
const holdBuilds = async (page: Page) => {
  let answer = () => {};
  const answered = new Promise<void>((res) => (answer = res));
  await page.route("**/build", async (route) => {
    await answered;
    await json(route, { stderr: "", uuid: null, idl: null });
  });
  return { answer };
};

const startBuild = async (page: Page) => {
  await page.locator("#flow-stage-tab-build").click();
  await page.getByRole("button", { name: "Build", exact: true }).click();
};

const terminalText = (page: Page) => page.locator(".xterm-rows").first();

const openConsole = async (page: Page) => {
  const drawer = page.getByRole("button", { name: "Terminal", exact: true });
  if ((await drawer.getAttribute("aria-expanded")) !== "true") {
    await drawer.click();
  }
};

test.describe("client-v2-command-stop", () => {
  test("client-v2-command-stop: Stop shows while a build runs", async ({
    seededPage: page,
  }) => {
    await holdBuilds(page);
    await openConsole(page);
    await startBuild(page);

    await expect(
      page.getByRole("button", { name: "Stop build" })
    ).toBeVisible();
    // Spec 13 (TRM-28): Clear is off beside Stop on a desktop
    await expect(page.getByRole("button", { name: "Clear" })).toBeDisabled();
  });

  test("client-v2-command-stop: Stop leaves when the run ends", async ({
    seededPage: page,
  }) => {
    const { answer } = await holdBuilds(page);
    await startBuild(page);
    const stop = page.getByRole("button", { name: "Stop build" });
    await expect(stop).toBeVisible();

    answer();

    await expect(
      page.getByRole("heading", { name: "Build succeeded" })
    ).toBeVisible(LONG);
    await expect(stop).toHaveCount(0);
  });

  test("client-v2-command-stop: Stop during a build", async ({
    seededPage: page,
  }) => {
    await holdBuilds(page);
    await openConsole(page);
    await startBuild(page);

    await page.getByRole("button", { name: "Stop build" }).click();

    await expect(terminalText(page)).toContainText("Stopped.");
    await expect(terminalText(page)).not.toContainText("Process error");
    // The prompt is back
    await expect(terminalText(page)).toHaveText(/\$\s*$/);
    await expect(
      page.getByText("Build stopped", { exact: true })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop build" })).toHaveCount(
      0
    );
    // No result: neither a success nor a failure on the stage
    await expect(
      page.getByRole("heading", { name: /^Build (succeeded|failed)/ })
    ).toHaveCount(0);
    await page.waitForTimeout(TOAST_RENDER_MS);
    expect(await page.locator("[data-sonner-toast]").count()).toBe(0);
  });

  test("client-v2-command-stop: Ctrl+C during a build", async ({
    seededPage: page,
  }) => {
    await holdBuilds(page);
    await openConsole(page);
    await expect(terminalText(page)).toHaveText(/\$\s*$/);
    await startBuild(page);
    await expect(
      page.getByRole("button", { name: "Stop build" })
    ).toBeVisible();

    const input = page.getByLabel("Terminal input").first();
    await input.focus();
    await page.keyboard.press("Control+C");

    await expect(terminalText(page)).toContainText(/\^C\s*Stopped\./);
    // The prompt is back
    await expect(terminalText(page)).toHaveText(/\$\s*$/);
  });

  test("client-v2-command-stop: ⌘. during a build", async ({
    seededPage: page,
  }) => {
    await holdBuilds(page);
    await openConsole(page);
    await expect(terminalText(page)).toHaveText(/\$\s*$/);
    await startBuild(page);
    await expect(
      page.getByRole("button", { name: "Stop build" })
    ).toBeVisible();

    await page.getByLabel("Terminal input").first().focus();
    await page.keyboard.press("Meta+Period");

    await expect(terminalText(page)).toContainText(/\^C\s*Stopped\./);
    await expect(terminalText(page)).toHaveText(/\$\s*$/);
  });
});
