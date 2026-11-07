import type { Page } from "@playwright/test";

import { requireFor } from "../src/test-utils/require-for";
import {
  expect,
  FAILED_BUILD_STDERR,
  json,
  LONG,
  seedWorkspace,
  test,
} from "./fixtures";
import { DESK, PHONE } from "./viewports";

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
const buildThenInteract = async (page: Page, idl: object = IDL) => {
  // CI has no build server: the request is answered here
  await page.route("**/build", (route) =>
    json(route, { stderr: "", uuid: null, idl })
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
    // Shortened in the middle, whole in its title
    await expect(result.locator("code")).toHaveText("6PNd…AVkj");
    await expect(result.locator("code")).toHaveAttribute("title", PROGRAM_ID);
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

    await expect(
      panel.getByRole("button", { name: "Copy program id" })
    ).toBeVisible(LONG);
    // Every instruction is a card, folded on arrival; opened, it ends in Test
    const card = panel.getByRole("button", { name: /^initialize/ });
    await expect(card).toHaveAttribute("aria-expanded", "false");
    await card.click();
    await expect(panel.getByRole("button", { name: "Test" })).toBeVisible();
    await expect(panel.locator('[data-slot="stage-empty"]')).toHaveCount(0);
  });

  test("Interact keeps a long instruction name inside the form's column", async ({
    seededPage: page,
  }) => {
    const longName = "initialize_".repeat(12) + "account";
    await stubProgramAccount(page, DEPLOYED_ACCOUNT);
    const panel = await buildThenInteract(page, {
      version: IDL.version,
      name: IDL.name,
      instructions: [
        { name: longName, accounts: [], args: [] },
        { name: "increment", accounts: [], args: [] },
      ],
    });

    const card = panel.getByRole("button", {
      name: new RegExp(`^${longName}`),
    });
    await expect(card).toBeVisible(LONG);
    const nameBox = await card
      .getByText(longName, { exact: true })
      .boundingBox();
    const cardBox = await card.boundingBox();
    if (!nameBox || !cardBox) {
      throw new Error("the instruction card or its name has no box");
    }
    expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(
      cardBox.x + cardBox.width + 0.5
    );
  });
});

test.describe("client-v2-stages on a phone", () => {
  test("client-v2-stages: The Build action at the foot on a phone", async ({
    page,
  }) => {
    // The project tree lives in a closed Sheet on a phone, which the seeding
    // waits on, so seed on a desktop-sized page and narrow it afterwards
    await page.setViewportSize(DESK);
    await seedWorkspace(page);
    await page.setViewportSize(PHONE);

    await page.locator("#flow-stage-tab-build").click();
    const panel = page.locator("#flow-stage-panel-build");
    const actions = panel.locator('[data-slot="stage-empty-actions"]');
    await expect(actions.getByRole("button", { name: /^Build$/ })).toBeVisible(
      LONG
    );

    const panelBox = requireFor("the panel's bounding box")(
      await panel.boundingBox()
    );
    const actionsBox = requireFor("the actions' bounding box")(
      await actions.boundingBox()
    );
    const gap =
      panelBox.y + panelBox.height - (actionsBox.y + actionsBox.height);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThan(32);
  });

  /** Deploy's stage is the longest: its result, history and drop zone */
  test("client-v2-stages: The Deploy action at the foot on a phone", async ({
    page,
  }) => {
    await page.setViewportSize(DESK);
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
    await page.setViewportSize(PHONE);

    await page.locator("#flow-stage-tab-deploy").click();
    const panel = page.locator("#flow-stage-panel-deploy");
    const actions = panel.locator('[data-slot="stage-empty-actions"]');
    // Nothing is built in this page, so the pill is Go to Build
    await expect(
      actions.getByRole("button", { name: "Go to Build" })
    ).toBeVisible(LONG);

    const panelBox = requireFor("the panel's bounding box")(
      await panel.boundingBox()
    );
    const actionsBox = requireFor("the actions' bounding box")(
      await actions.boundingBox()
    );
    const gap =
      panelBox.y + panelBox.height - (actionsBox.y + actionsBox.height);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThan(32);
  });

  test("client-v2-stages: The Interact action at the foot on a phone", async ({
    page,
  }) => {
    await page.setViewportSize(DESK);
    await seedWorkspace(page);
    await stubProgramAccount(page, null);
    await page.setViewportSize(PHONE);

    const panel = await buildThenInteract(page);
    const actions = panel.locator('[data-slot="stage-empty-actions"]');
    await expect(
      actions.getByRole("button", { name: "Go to Deploy" })
    ).toBeVisible(LONG);

    const panelBox = requireFor("the panel's bounding box")(
      await panel.boundingBox()
    );
    const actionsBox = requireFor("the actions' bounding box")(
      await actions.boundingBox()
    );
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
    ).toBeLessThanOrEqual(PHONE.width);
  });
});

/** The search field, where the Interact stage's values are picked */
test.describe("client-v2-search-field", () => {
  test("client-v2-search-field: Random fills an instruction value", async ({
    seededPage: page,
  }) => {
    await stubProgramAccount(page, DEPLOYED_ACCOUNT);
    const panel = await buildThenInteract(page);
    await panel.getByRole("button", { name: /^initialize/ }).click();

    // Reached by its id: `updateRefs` (InstructionInput) finds dependent
    // inputs by it, so SearchBar must keep it
    const amount = panel.locator("#initializeargsamount");
    // A number's one pick is Random, a button in the field with no list
    await amount
      .locator("xpath=..")
      .getByRole("button", { name: "Random" })
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
