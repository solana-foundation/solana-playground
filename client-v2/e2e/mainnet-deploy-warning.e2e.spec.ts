import type { Page } from "@playwright/test";

import {
  consoleTrigger,
  expect,
  json,
  LONG,
  runInTerminal,
  test,
} from "./fixtures";

/**
 * The scenarios of `mainnet-deploy-warning`: in the beta a program is not
 * deployed to mainnet from Playground (HOO-2728); the Deploy stage says so and
 * points to deploying from the user's own machine.
 */

const BLOCKED = "Deploys to mainnet are not available in the beta.";

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

/**
 * Builds the project as a user does, the build server's answer stubbed (CI
 * has none): the Deploy pill reads Go to Build until there is a build
 */
const build = async (page: Page) => {
  await page.route("**/build", (route) =>
    json(route, { stderr: "", uuid: null, idl: null })
  );
  await page.locator("#flow-stage-tab-build").click();
  const panel = page.locator("#flow-stage-panel-build");
  await panel.getByRole("button", { name: /^Build$/ }).click();
  await expect(
    panel.getByRole("heading", { name: "Build succeeded" })
  ).toBeVisible(LONG);
};

const openDeploy = async (page: Page) => {
  await page.locator("#flow-stage-tab-deploy").click();
  const panel = page.locator("#flow-stage-panel-deploy");
  await expect(panel).toBeVisible();
  return panel;
};

test("mainnet-deploy-warning: Deploy stage on mainnet", async ({
  seededPage: page,
}) => {
  await reloadOn(page, "mainnet-beta");
  await build(page);
  const panel = await openDeploy(page);

  await expect(panel.getByText(BLOCKED)).toBeVisible(LONG);
  await expect(
    panel.getByRole("button", { name: "Deploy to mainnet" })
  ).toHaveCount(0);
  await panel.getByRole("button", { name: "Deploy from your machine" }).click();
  const guide = page.getByRole("dialog", { name: "Deploy from your machine" });
  await expect(guide).toBeVisible();
  await expect(
    guide
      .getByRole("radiogroup", { name: "Cluster" })
      .getByRole("radio", { name: "Mainnet" })
  ).toBeChecked();
});

test("mainnet-deploy-warning: Terminal deploy on mainnet", async ({
  seededPage: page,
}) => {
  await reloadOn(page, "mainnet-beta");
  const drawer = consoleTrigger(page);
  if ((await drawer.getAttribute("aria-expanded")) !== "true") {
    await drawer.click();
  }
  await runInTerminal(page, "deploy");

  // Refused before the wallet question and before "Deploying..."
  const terminal = page.locator(".xterm-rows").first();
  await expect(terminal).toContainText(BLOCKED, LONG);
  await expect(terminal).not.toContainText("Deploying...");
  await expect(terminal).not.toContainText("Connect the Playground wallet?");
});

test("mainnet-deploy-warning: Deploy stage on devnet", async ({
  seededPage: page,
}) => {
  await build(page);
  const panel = await openDeploy(page);

  // The stage names its cluster once the endpoint is read; only then is
  // the line's absence an answer
  await expect(
    panel.getByRole("button", { name: "Deploy to devnet" })
  ).toBeVisible(LONG);
  await expect(panel.getByText(BLOCKED)).toHaveCount(0);
});

test("mainnet-deploy-warning: Mainnet picked in Settings", async ({
  seededPage: page,
}) => {
  await page.route("https://api.mainnet-beta.solana.com/**", (route) =>
    route.abort("connectionrefused")
  );
  await build(page);
  const settings = page.getByRole("region", { name: "Settings" });
  const chipsOf = async (name: string) =>
    settings
      .getByRole("radiogroup", { name: "Network" })
      .getByRole("radio", { name })
      .click();
  const pick = async (name: string) => {
    await page.getByRole("button", { name: /^Change cluster/ }).click();
    await chipsOf(name);
  };
  /** A cluster that is not answering opens the status panel first (Spec 06) */
  const pickFromStatusPanel = async (name: string) => {
    await page.getByRole("button", { name: /^Change cluster/ }).click();
    await page
      .getByRole("dialog", { name: "Network" })
      .getByRole("button", { name: "Change network" })
      .click();
    await chipsOf(name);
  };

  await pick("Mainnet");
  await expect(
    settings.getByRole("radiogroup", {
      name: "Network",
      description: "Not available for deploys",
    })
  ).toBeVisible();
  await settings.getByRole("button", { name: "Back to app" }).click();
  const panel = await openDeploy(page);
  await expect(panel.getByText(BLOCKED)).toBeVisible(LONG);

  await pickFromStatusPanel("Devnet");
  await settings.getByRole("button", { name: "Back to app" }).click();
  await expect(
    panel.getByRole("button", { name: "Deploy to devnet" })
  ).toBeVisible(LONG);
  await expect(panel.getByText(BLOCKED)).toHaveCount(0);
});

test("mainnet-deploy-warning: Five networks are offered, Mainnet first", async ({
  seededPage: page,
}) => {
  await page.getByRole("button", { name: /^Change cluster/ }).click();
  const network = page
    .getByRole("region", { name: "Settings" })
    .getByRole("radiogroup", { name: "Network" });
  await expect(network.getByRole("radio")).toHaveText([
    "Mainnet",
    "Devnet",
    "Testnet",
    "Localnet",
    "Surfpool",
  ]);
});
