import type { Page } from "@playwright/test";

import { expect, LONG, test } from "./fixtures";

/**
 * The scenarios of `mainnet-deploy-warning`: the Deploy stage warns about
 * the browser-held Playground wallet on mainnet, and only there.
 */

/**
 * Reloads on the endpoint picked in Settings, by its option name. Mainnet's
 * requests are refused, so CI never reaches it: the cluster is read from the
 * endpoint's URL, not from an answer.
 */
const reloadOn = async (page: Page, option: string) => {
  await page.route("https://api.mainnet-beta.solana.com/**", (route) =>
    route.abort("connectionrefused")
  );
  await page.evaluate((picked) => {
    const settings = JSON.parse(localStorage.getItem("settings") ?? "{}");
    settings.connection = settings.connection ?? {};
    settings.connection.endpoint = { option: picked };
    localStorage.setItem("settings", JSON.stringify(settings));
  }, option);
  await page.reload();
  await expect(page.locator("#root-dir")).toBeVisible(LONG);
};

const openDeploy = async (page: Page) => {
  await page.locator("#flow-stage-tab-deploy").click();
  const panel = page.locator("#flow-stage-panel-deploy");
  await expect(panel).toBeVisible();
  return panel;
};

test("mainnet-deploy-warning: Deploy stage on mainnet shows the warning", async ({
  seededPage: page,
}) => {
  await reloadOn(page, "mainnet-beta");
  const panel = await openDeploy(page);

  const warning = panel.getByRole("alert", { name: "Mainnet deploy warning" });
  await expect(warning).toBeVisible(LONG);
  await expect(warning).toContainText("Playground wallet");
  await expect(warning).toContainText("your own machine");
});

test("mainnet-deploy-warning: Deploy stage on devnet shows no warning", async ({
  seededPage: page,
}) => {
  const panel = await openDeploy(page);

  // The stage names its cluster once the endpoint is read; only then is
  // the warning's absence an answer
  await expect(
    panel.getByRole("button", { name: "Deploy to devnet" })
  ).toBeVisible(LONG);
  await expect(
    panel.getByRole("alert", { name: "Mainnet deploy warning" })
  ).toHaveCount(0);
});
