import type { Page } from "@playwright/test";

import { expect, json, LONG, test } from "./fixtures";

/**
 * The scenarios of `client-v2-idl` that show in Interact, and the
 * `client-v2-interact` scenario for a refused 1.x IDL: the build server's
 * answer carries an Anchor 1.x IDL, the cluster says the program is deployed.
 */

/** An Anchor 1.x IDL (spec 0.1.0), as `anchor idl build` writes one */
const IDL_V1 = {
  address: "6PNd3SLJU8V6mqVmDNaV6x2UR6A8ZedA3p5FPrBjAVkj",
  metadata: {
    name: "e2e_project",
    version: "0.1.0",
    spec: "0.1.0",
    description: "Created with Anchor",
  },
  instructions: [
    {
      name: "initialize",
      discriminator: [175, 175, 109, 31, 13, 152, 155, 237],
      accounts: [
        {
          name: "counter",
          writable: true,
          pda: {
            seeds: [
              { kind: "const", value: [99, 111, 117, 110, 116, 101, 114] },
            ],
          },
        },
        { name: "user", writable: true, signer: true },
        {
          name: "system_program",
          address: "11111111111111111111111111111111",
        },
      ],
      args: [],
    },
    {
      name: "increment_by",
      discriminator: [103, 82, 124, 55, 231, 50, 146, 138],
      accounts: [{ name: "counter", writable: true }],
      args: [{ name: "amount", type: "u64" }],
    },
  ],
  accounts: [
    { name: "Counter", discriminator: [255, 176, 4, 245, 188, 253, 124, 25] },
  ],
  types: [
    {
      name: "Counter",
      type: { kind: "struct", fields: [{ name: "count", type: "u64" }] },
    },
  ],
};

/** A program account owned by the non-upgradeable loader: "deployed" */
const DEPLOYED_ACCOUNT = {
  data: ["", "base64"],
  executable: true,
  lamports: 1141440,
  owner: "BPFLoader2111111111111111111111111111111111",
  rentEpoch: 0,
  space: 0,
};

/** Builds with `idl` as the build server's IDL, then opens Interact */
const buildThenInteract = async (page: Page, idl: object) => {
  await page.route("https://api.devnet.solana.com/**", async (route) => {
    const body = route.request().postDataJSON() as {
      id?: unknown;
      method?: string;
    } | null;
    if (body?.method !== "getAccountInfo") return route.continue();
    return json(route, {
      jsonrpc: "2.0",
      id: body.id,
      result: { context: { slot: 1 }, value: DEPLOYED_ACCOUNT },
    });
  });
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

test.describe("client-v2-idl", () => {
  test("client-v2-idl: A 1.x IDL", async ({ seededPage: page }) => {
    const panel = await buildThenInteract(page, IDL_V1);

    const chips = panel.getByRole("radiogroup", { name: "Instruction" });
    await expect(chips.getByRole("radio", { name: "initialize" })).toBeChecked(
      LONG
    );
    await expect(
      chips.getByRole("radio", { name: "incrementBy" })
    ).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "Call initialize" })
    ).toBeVisible();
    await expect(panel.locator('[data-slot="stage-empty"]')).toHaveCount(0);
  });
});

test.describe("client-v2-interact", () => {
  test("client-v2-interact: A 1.x IDL with a custom discriminator", async ({
    seededPage: page,
  }) => {
    const idl = {
      address: IDL_V1.address,
      metadata: IDL_V1.metadata,
      instructions: [
        {
          name: "initialize",
          discriminator: [1],
          accounts: [],
          args: [],
        },
      ],
    };
    const panel = await buildThenInteract(page, idl);

    await expect(
      panel.getByRole("heading", { name: "This IDL can't be read" })
    ).toBeVisible(LONG);
    await expect(panel.locator('[data-slot="callout"]')).toHaveText(
      "This IDL uses a custom discriminator on initialize, which Interact cannot call yet."
    );
    await expect(
      panel.getByRole("radiogroup", { name: "Instruction" })
    ).toHaveCount(0);
  });
});

test.describe("client-v2-idl, 0.29", () => {
  test("client-v2-idl: A 0.29 IDL", async ({ seededPage: page }) => {
    const panel = await buildThenInteract(page, {
      version: "0.1.0",
      name: "e2e_project",
      instructions: [
        {
          name: "incrementBy",
          accounts: [{ name: "counter", isMut: true, isSigner: false }],
          args: [{ name: "amount", type: "u64" }],
        },
      ],
    });

    await expect(
      panel
        .getByRole("radiogroup", { name: "Instruction" })
        .getByRole("radio", { name: "incrementBy" })
    ).toBeChecked(LONG);
    await expect(
      panel.getByRole("button", { name: "Call incrementBy" })
    ).toBeVisible();
  });
});
