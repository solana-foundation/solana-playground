import type { Page } from "@playwright/test";

import { expect, LONG, test } from "./fixtures";

/**
 * The scenarios of `cli-deploy` that need no build server: the guide opens
 * from the Deploy stage and gives the command for the tool and cluster
 * picked. The binary download is checked by hand (a build is needed).
 */

const openGuide = async (page: Page) => {
  await page.locator("#flow-stage-tab-deploy").click();
  const panel = page.locator("#flow-stage-panel-deploy");
  await panel.getByRole("button", { name: "Deploy with the CLI" }).click(LONG);
  const guide = page.getByRole("dialog", { name: "Deploy from your machine" });
  await expect(guide).toBeVisible();
  return guide;
};

const lines = (guide: ReturnType<Page["getByRole"]>) =>
  guide.locator('[data-slot="code-block-line"]');

test("cli-deploy: Guide from the Deploy stage", async ({
  seededPage: page,
}) => {
  const guide = await openGuide(page);

  await expect(
    guide.getByRole("button", { name: "Copy the deploy command" })
  ).toBeVisible();
});

test("cli-deploy: Solana CLI on devnet", async ({ seededPage: page }) => {
  const guide = await openGuide(page);

  await expect(lines(guide)).toHaveCount(1);
  await expect(lines(guide).first()).toHaveText(
    /^solana program deploy (\w+)\.so --program-id \1-keypair\.json --url devnet$/
  );
});

test("cli-deploy: Anchor on mainnet", async ({ seededPage: page }) => {
  const guide = await openGuide(page);
  await guide.getByRole("radio", { name: "Anchor" }).click();
  await guide.getByRole("radio", { name: "Mainnet" }).click();

  await expect(lines(guide)).toHaveText([
    /^mkdir -p target\/deploy && cp (\w+)\.so \1-keypair\.json target\/deploy\/$/,
    "anchor deploy --provider.cluster mainnet",
  ]);
});
