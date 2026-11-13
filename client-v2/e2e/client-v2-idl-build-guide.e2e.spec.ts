import type { Page } from "@playwright/test";

import { Endpoint } from "../src/entities/cluster/model/endpoint";
import { expect, json, LONG, test } from "./fixtures";

/**
 * The Flow scenarios of `client-v2-idl-build-guide`: where the guide is
 * offered, and that it opens from each stage.
 */

const GUIDE = "Build the IDL locally";
const DIALOG = "Build the IDL on your machine";

/** A program account owned by the non-upgradeable loader: the chain read settles on "deployed" */
const DEPLOYED_ACCOUNT = {
  data: ["", "base64"],
  executable: true,
  lamports: 1141440,
  owner: "BPFLoader2111111111111111111111111111111111",
  rentEpoch: 0,
  space: 0,
};

/** The cluster says the program is deployed; every other call goes through */
const stubDeployedProgram = (page: Page) =>
  page.route(`${Endpoint.DEVNET}/**`, async (route) => {
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

/** Builds the project against the stable server's answer: a uuid and no IDL */
const buildWithoutIdl = async (page: Page) => {
  // CI has no build server: the request is answered here
  await page.route("**/build", (route) =>
    json(route, {
      stderr: "",
      uuid: "00000000-0000-4000-8000-000000000000",
      // eslint-disable-next-line unicorn/no-null -- the server's wire value
      idl: null,
    })
  );
  await page.locator("#flow-stage-tab-build").click();
  const build = page.locator("#flow-stage-panel-build");
  await build.getByRole("button", { name: /^Build$/ }).click();
  await expect(
    build.getByRole("heading", { name: "Build succeeded" })
  ).toBeVisible(LONG);
};

test.describe("client-v2-idl-build-guide", () => {
  test("client-v2-idl-build-guide: Interact without an IDL", async ({
    seededPage: page,
  }) => {
    await stubDeployedProgram(page);
    await buildWithoutIdl(page);

    await page.locator("#flow-stage-tab-interact").click();
    const panel = page.locator("#flow-stage-panel-interact");
    await expect(
      panel.getByRole("heading", { name: "This program has no IDL" })
    ).toBeVisible(LONG);
    const actions = panel.locator('[data-slot="stage-empty-actions"]');
    await expect(actions.getByRole("button", { name: GUIDE })).toBeVisible();
    await expect(actions.getByText("Upload IDL")).toBeVisible();
  });

  test("client-v2-idl-build-guide: Opening the guide", async ({
    seededPage: page,
  }) => {
    await stubDeployedProgram(page);
    await buildWithoutIdl(page);

    for (const stage of ["build", "deploy", "interact"]) {
      await page.locator(`#flow-stage-tab-${stage}`).click();
      const panel = page.locator(`#flow-stage-panel-${stage}`);
      await panel.getByRole("button", { name: GUIDE }).first().click();

      const dialog = page.getByRole("dialog", { name: DIALOG });
      await expect(dialog).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    }
  });
});
