import type { Page } from "@playwright/test";

import {
  expect,
  FAILED_BUILD_STDERR,
  json,
  LONG,
  seedWorkspace,
  test,
} from "./fixtures";

/**
 * The scenarios of `client-v2-stages`: what the Build, Deploy and Interact
 * stages show, and where their action sits on a phone; and the
 * `client-v2-search-field` scenarios, which reuse this file's Interact setup.
 */

const PROGRAM_ID = "6PNd3SLJU8V6mqVmDNaV6x2UR6A8ZedA3p5FPrBjAVkj";

/**
 * A small Anchor IDL: the `u64` argument is what "Random fills an instruction
 * value" picks for, the `counter` account gives the form a field with "From
 * seed" for the screenshots, and the `Counter` type is the Accounts section
 * "An address that is not a public key" types into
 */
const IDL = {
  version: "0.1.0",
  name: "e2e_project",
  instructions: [
    {
      name: "initialize",
      accounts: [{ name: "counter", isMut: true, isSigner: false }],
      args: [{ name: "amount", type: "u64" }],
    },
  ],
  accounts: [
    {
      name: "Counter",
      type: { kind: "struct", fields: [{ name: "count", type: "u64" }] },
    },
  ],
};

/**
 * A program account owned by the non-upgradeable loader: the chain read
 * settles on "deployed" with no program-data account to follow
 */
const DEPLOYED_ACCOUNT = {
  data: ["", "base64"],
  executable: true,
  lamports: 1141440,
  owner: "BPFLoader2111111111111111111111111111111111",
  rentEpoch: 0,
  space: 0,
};

/**
 * The cluster answers `getAccountInfo` with `account` (`null`: the program
 * account does not exist); every other call goes to the cluster as usual
 */
const stubProgramAccount = (page: Page, account: object | null) =>
  page.route("https://api.devnet.solana.com/**", async (route) => {
    const body = route.request().postDataJSON() as {
      id?: unknown;
      method?: string;
    } | null;
    if (body?.method !== "getAccountInfo") return route.continue();
    return json(route, {
      jsonrpc: "2.0",
      id: body.id,
      result: { context: { slot: 1 }, value: account },
    });
  });

/**
 * Builds the project as a user does, which gives it a program id, with the
 * build server's answer stubbed to carry the IDL; then opens Interact
 */
const buildThenInteract = async (page: Page) => {
  // CI has no build server: the request is answered here
  await page.route("**/build", (route) =>
    json(route, { stderr: "", uuid: null, idl: IDL })
  );
  await page.locator("#flow-stage-tab-build").click();
  const build = page.locator("#flow-stage-panel-build");
  await build.getByRole("button", { name: /^Build$/ }).click();
  await expect(
    build.getByRole("heading", { name: "Build succeeded" })
  ).toBeVisible(LONG);

  await page.locator("#flow-stage-tab-interact").click();
  return page.locator("#flow-stage-panel-interact");
};

test.describe("client-v2-stages", () => {
  test("client-v2-stages: A failed build marks the faulty line", async ({
    seededPage: page,
  }) => {
    // CI has no build server: the request is answered here
    await page.route("**/build", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          stderr: FAILED_BUILD_STDERR,
          uuid: null,
          idl: null,
        }),
      })
    );

    await page.locator("#flow-stage-tab-build").click();
    const panel = page.locator("#flow-stage-panel-build");
    await panel.getByRole("button", { name: /^Build$/ }).click();

    const diagnostic = panel.locator('[data-slot="diagnostic"]');
    await expect(diagnostic).toHaveCount(1, LONG);
    await expect(
      diagnostic.locator('[data-slot="diagnostic-code"]')
    ).toHaveText("E0308");
    // The line itself, read from the project, not rustc's excerpt
    const fault = diagnostic.locator("[data-fault]");
    await expect(fault.locator("span").first()).toHaveText("5");
    await expect(fault).toContainText("expected u32, found &str");
    // Spec 04: Explain and Fix on every error card
    await expect(
      diagnostic.getByRole("button", { name: "Explain" })
    ).toBeVisible();
    await expect(diagnostic.getByRole("button", { name: "Fix" })).toBeVisible();
  });

  test("client-v2-stages: A deployment shows its program id to copy", async ({
    seededPage: page,
  }) => {
    // A deploy needs a wallet and a cluster; the record it leaves is what
    // the stage reads, so the record is written here
    await page.evaluate(
      ([programId, at]) =>
        localStorage.setItem(
          "flow.deploys",
          JSON.stringify([
            {
              id: "e2e-deploy",
              workspace: "e2e-project",
              cluster: "devnet",
              programId,
              signature: null,
              at,
            },
          ])
        ),
      [PROGRAM_ID, Date.now()] as const
    );
    await page.reload();
    await expect(page.locator("#root-dir")).toBeVisible(LONG);

    await page.locator("#flow-stage-tab-deploy").click();
    const result = page
      .locator("#flow-stage-panel-deploy")
      .getByRole("status")
      .filter({ hasText: "Deployed to" });
    await expect(result).toContainText("Deployed to devnet", LONG);
    await expect(result.locator("code")).toHaveText(PROGRAM_ID);
    await expect(result.locator('[data-slot="copy-button"]')).toBeVisible();
  });
});

test.describe("client-v2-stages: Interact", () => {
  test("client-v2-stages: Interact before a deploy", async ({
    seededPage: page,
  }) => {
    await stubProgramAccount(page, null);
    const panel = await buildThenInteract(page);

    await expect(
      panel.getByRole("heading", { name: "Nothing to call yet" })
    ).toBeVisible(LONG);
    const goToDeploy = panel
      .locator('[data-slot="stage-empty-actions"]')
      .getByRole("button", { name: "Go to Deploy" });
    await goToDeploy.click();
    await expect(page.locator("#flow-stage-panel-deploy")).toBeVisible();
  });

  test("Interact draws a deployed program's instructions", async ({
    seededPage: page,
  }) => {
    await stubProgramAccount(page, DEPLOYED_ACCOUNT);
    const panel = await buildThenInteract(page);

    await expect(panel.getByText("Program: e2e_project")).toBeVisible(LONG);
    await expect(
      panel.getByRole("heading", { name: "Instructions" })
    ).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "initialize" })
    ).toBeVisible();
    await expect(panel.locator('[data-slot="stage-empty"]')).toHaveCount(0);
  });
});

test.describe("client-v2-stages on a phone", () => {
  test("client-v2-stages: The Build action at the foot on a phone", async ({
    page,
  }) => {
    // The project tree lives in a closed Sheet on a phone, which the seeding
    // waits on, so seed on a desktop-sized page and narrow it afterwards
    await page.setViewportSize({ width: 1280, height: 800 });
    await seedWorkspace(page);
    await page.setViewportSize({ width: 390, height: 844 });

    await page.locator("#flow-stage-tab-build").click();
    const panel = page.locator("#flow-stage-panel-build");
    const actions = panel.locator('[data-slot="stage-empty-actions"]');
    await expect(actions.getByRole("button", { name: /^Build$/ })).toBeVisible(
      LONG
    );

    const panelBox = (await panel.boundingBox())!;
    const actionsBox = (await actions.boundingBox())!;
    const gap =
      panelBox.y + panelBox.height - (actionsBox.y + actionsBox.height);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThan(32);
  });

  /** Deploy's stage is the longest: its result, history and drop zone */
  test("client-v2-stages: The Deploy action at the foot on a phone", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await seedWorkspace(page);
    await page.evaluate(
      ([programId, at]) =>
        localStorage.setItem(
          "flow.deploys",
          JSON.stringify([
            {
              id: "e2e-deploy",
              workspace: "e2e-project",
              cluster: "devnet",
              programId,
              signature: null,
              at,
            },
          ])
        ),
      [PROGRAM_ID, Date.now()] as const
    );
    await page.reload();
    await expect(page.locator("#root-dir")).toBeAttached(LONG);
    await page.setViewportSize({ width: 390, height: 844 });

    await page.locator("#flow-stage-tab-deploy").click();
    const panel = page.locator("#flow-stage-panel-deploy");
    const actions = panel.locator('[data-slot="stage-empty-actions"]');
    await expect(
      actions.getByRole("button", { name: /Redeploy to devnet/ })
    ).toBeVisible(LONG);

    const panelBox = (await panel.boundingBox())!;
    const actionsBox = (await actions.boundingBox())!;
    const gap =
      panelBox.y + panelBox.height - (actionsBox.y + actionsBox.height);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThan(32);
  });

  test("client-v2-stages: The Interact action at the foot on a phone", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await seedWorkspace(page);
    await stubProgramAccount(page, null);
    await page.setViewportSize({ width: 390, height: 844 });

    const panel = await buildThenInteract(page);
    const actions = panel.locator('[data-slot="stage-empty-actions"]');
    await expect(
      actions.getByRole("button", { name: "Go to Deploy" })
    ).toBeVisible(LONG);

    const panelBox = (await panel.boundingBox())!;
    const actionsBox = (await actions.boundingBox())!;
    const gap =
      panelBox.y + panelBox.height - (actionsBox.y + actionsBox.height);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThan(32);
    // The row's fade starts from the colour behind it, so no band shows
    const [fadeFrom, behind] = await actions.evaluate((el) => {
      let under = el.parentElement;
      while (
        under &&
        getComputedStyle(under).backgroundColor === "rgba(0, 0, 0, 0)"
      ) {
        under = under.parentElement;
      }
      const fade = getComputedStyle(el).backgroundImage;
      return [
        /rgb\([^)]*\)/.exec(fade)?.[0],
        under && getComputedStyle(under).backgroundColor,
      ];
    });
    expect(fadeFrom).toBe(behind);
    // A long program id or meta line scrolls inside the stage, never the page
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(390);
  });
});

/** The search field, where the Interact stage's values are picked */
test.describe("client-v2-search-field", () => {
  test("client-v2-search-field: Random fills an instruction value", async ({
    seededPage: page,
  }) => {
    await stubProgramAccount(page, DEPLOYED_ACCOUNT);
    const panel = await buildThenInteract(page);
    await panel.getByRole("button", { name: "initialize" }).click();

    // Reached by its id: `updateRefs` (InstructionInput) finds dependent
    // inputs by it, so SearchBar must keep it
    const amount = panel.locator("#initializeargsamount");
    await amount.click();
    await page
      .locator('[data-slot="command"]')
      .getByRole("option", { name: "Random" })
      .click();
    await expect(amount).toHaveValue(/^\d+$/);
  });

  test("client-v2-search-field: An address that is not a public key", async ({
    seededPage: page,
  }) => {
    await stubProgramAccount(page, DEPLOYED_ACCOUNT);
    const panel = await buildThenInteract(page);
    await panel.getByRole("button", { name: "Counter" }).click();

    // Account's address field offers nothing to pick, so it is a textbox
    const address = panel.getByRole("textbox").last();
    await address.fill("not-a-key");
    await expect(address).toHaveAttribute("aria-invalid", "true");
  });
});
