import type { Page } from "@playwright/test";

import { requireFor } from "../src/test-utils/require-for";
import { expect, LONG, test } from "./fixtures";
import { DESK, PHONE } from "./viewports";

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

// HOO-2701: Anchor's extra lines made the guide taller than a short window,
// and its last step was cut off with nothing to scroll
for (const [layout, size] of [
  ["desk", { width: DESK.width, height: 560 }],
  ["phone", { width: PHONE.width, height: 640 }],
] as const) {
  test(`cli-deploy: the guide scrolls inside a short window (${layout})`, async ({
    seededPage: page,
  }) => {
    const guide = await openGuide(page);
    await guide.getByRole("radio", { name: "Anchor" }).click();
    await page.setViewportSize(size);
    // Measure the settled dialog, not one mid zoom-in
    await guide.evaluate((el) =>
      Promise.all(el.getAnimations().map((a) => a.finished))
    );

    const inWindow = async (locator: ReturnType<Page["locator"]>) => {
      const box = requireFor("its box")(await locator.boundingBox());
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(size.height);
    };
    await inWindow(guide);

    const last = guide.getByRole("heading", { name: "3.1 Upload the IDL" });
    // The window is short enough that the steps overflow: the test is about
    // scrolling, not about content that happens to fit
    const steps = last.locator("xpath=ancestor::ol");
    expect(
      await steps.evaluate((el) => el.scrollHeight > el.clientHeight)
    ).toBe(true);

    const title = guide.getByRole("heading", {
      name: "Deploy from your machine",
    });
    const titleTop = requireFor("the title's box")(await title.boundingBox()).y;
    await last.scrollIntoViewIfNeeded();
    await inWindow(last);
    // The header and the toggles stay put while the steps scroll
    await inWindow(title);
    expect(requireFor("the title's box")(await title.boundingBox()).y).toBe(
      titleTop
    );
    await inWindow(guide.getByRole("radio", { name: "Anchor" }));
  });
}

test("cli-deploy: Anchor on mainnet", async ({ seededPage: page }) => {
  const guide = await openGuide(page);
  await guide.getByRole("radio", { name: "Anchor" }).click();
  await guide.getByRole("radio", { name: "Mainnet" }).click();

  await expect(lines(guide)).toHaveText([
    /^mkdir -p target\/deploy && cp (\w+)\.so \1-keypair\.json target\/deploy\/$/,
    "anchor deploy --provider.cluster mainnet",
  ]);
});
