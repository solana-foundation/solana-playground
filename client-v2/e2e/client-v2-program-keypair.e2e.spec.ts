import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { Keypair } from "@solana/web3.js";

import {
  DEVNET_RPC,
  expect,
  isStored,
  LONG,
  reloadAndBoot,
  test,
} from "./fixtures";

/**
 * The browser scenarios of `client-v2-program-keypair`: the Deploy stage's
 * folded Program id block. The deploy refusal needs a cluster and is walked
 * by hand (`(manual)` in the spec).
 */

/**
 * A custom id with no account: the block counts an id with an account as
 * deployed, and a deployed program shows no mismatch. From a fixed seed, so
 * every run checks the same id, and devnet is stubbed below to hold no
 * account for it (the real devnet does hold one at this address)
 */
const OTHER_ID = Keypair.fromSeed(
  new Uint8Array(32).fill(7)
).publicKey.toBase58();

// Every program account read answers "no account": a real devnet answer
// depends on what someone deployed there, which made the mismatch flaky
test.beforeEach(async ({ page }) => {
  await page.route(DEVNET_RPC, async (route) => {
    const body = route.request().postDataJSON();
    if (body?.method !== "getAccountInfo") return route.fallback();
    return route.fulfill({
      json: {
        jsonrpc: "2.0",
        id: body.id,
        // eslint-disable-next-line unicorn/no-null -- JSON-RPC answers a missing account as `value: null`
        result: { context: { slot: 1 }, value: null },
      },
    });
  });
});

const block = (page: Page) =>
  page
    .locator("#flow-stage-panel-deploy")
    .getByRole("region", { name: "Program id", exact: true });

const field = (page: Page) =>
  block(page).getByRole("textbox", { name: "Program id", exact: true });

const button = (page: Page, name: string) =>
  block(page).getByRole("button", { name, exact: true });

const openDeploy = async (page: Page) => {
  await page.locator("#flow-stage-tab-deploy").click();
  await expect(block(page)).toBeVisible(LONG);
};

const openFold = async (page: Page) => {
  if (!(await field(page).isVisible()))
    await button(page, "Program id").click();
  await expect(field(page)).toBeVisible();
};

/**
 * Leaves the project with a new keypair. With none yet New generates at once;
 * with one it asks first, so wait for whichever happens rather than probe.
 */
const newKeypair = async (page: Page) => {
  const before = await field(page).inputValue();
  await button(page, "New keypair").click();
  const dialog = page.getByRole("dialog", {
    name: "Create a new program keypair?",
  });
  await expect
    .poll(
      async () =>
        (await dialog.isVisible()) ||
        (await field(page).inputValue()) !== before
    )
    .toBe(true);
  if (await dialog.isVisible()) {
    await dialog.getByRole("button", { name: "Generate" }).click();
    await expect(dialog).toBeHidden();
  }
  await expect(field(page)).not.toHaveValue(before);
};

const importFile = (page: Page, text: string) =>
  block(page)
    .locator('[data-slot="drop-zone"] input[type="file"]')
    .setInputFiles({
      name: "program-keypair.json",
      mimeType: "application/json",
      buffer: Buffer.from(text),
    });

test("client-v2-program-keypair: Closed until asked", async ({
  seededPage: page,
}) => {
  await openDeploy(page);
  await expect(button(page, "Program id")).toBeVisible();
  await expect(field(page)).toBeHidden();
});

test("client-v2-program-keypair: Replace a keypair", async ({
  seededPage: page,
}) => {
  await openDeploy(page);
  await openFold(page);
  await newKeypair(page);
  const before = await field(page).inputValue();

  await button(page, "New keypair").click();
  const dialog = page.getByRole("dialog", {
    name: "Create a new program keypair?",
  });
  await dialog.getByRole("button", { name: "Generate" }).click();

  await expect(dialog).toBeHidden();
  await expect(field(page)).not.toHaveValue(before);
  await expect(button(page, "Remove custom id")).toBeHidden();
});

test("client-v2-program-keypair: Cancel", async ({ seededPage: page }) => {
  await openDeploy(page);
  await openFold(page);
  await newKeypair(page);
  const before = await field(page).inputValue();

  await button(page, "New keypair").click();
  const dialog = page.getByRole("dialog", {
    name: "Create a new program keypair?",
  });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(dialog).toBeHidden();
  await expect(field(page)).toHaveValue(before);
});

test("client-v2-program-keypair: Round trip", async ({ seededPage: page }) => {
  await openDeploy(page);
  await openFold(page);
  await newKeypair(page);
  const exported = await field(page).inputValue();

  const saving = page.waitForEvent("download");
  await button(page, "Export keypair").click();
  const download = await saving;
  expect(download.suggestedFilename()).toBe("program-keypair.json");
  const downloaded = await download.path();
  if (!downloaded) throw new Error("the exported keypair was not saved");
  const text = await readFile(downloaded, "utf8");
  const bytes = JSON.parse(text);
  expect(Array.isArray(bytes) && bytes.length).toBe(64);

  await newKeypair(page);
  await expect(field(page)).not.toHaveValue(exported);

  await importFile(page, text);
  // The import replaces a keypair, so it asks first
  const dialog = page.getByRole("dialog", {
    name: "Replace the program keypair?",
  });
  await dialog.getByRole("button", { name: "Replace" }).click();
  await expect(field(page)).toHaveValue(exported);
});

test("client-v2-program-keypair: Refused file", async ({
  seededPage: page,
}) => {
  await openDeploy(page);
  await openFold(page);
  const before = await field(page).inputValue();

  await importFile(page, JSON.stringify(Array.from({ length: 32 }, () => 1)));

  await expect(
    block(page).getByText(
      "That file is not a program keypair: expected the 64-number JSON the Solana CLI writes."
    )
  ).toBeVisible();
  await expect(field(page)).toHaveValue(before);
});

test("client-v2-program-keypair: Invalid text", async ({
  seededPage: page,
}) => {
  await openDeploy(page);
  await openFold(page);
  const before = await field(page).inputValue();

  await field(page).fill("abc");
  await button(page, "Change program id").click();

  await expect(block(page).getByText("Not a valid public key")).toBeVisible();
  await expect(button(page, "Remove custom id")).toBeHidden();

  // The id itself is unchanged: a fresh load shows it again
  await reloadAndBoot(page);
  await openDeploy(page);
  await openFold(page);
  await expect(field(page)).toHaveValue(before, LONG);
});

test("client-v2-program-keypair: Open on a mismatch", async ({
  seededPage: page,
}) => {
  await openDeploy(page);
  await openFold(page);
  await newKeypair(page);
  await field(page).fill(OTHER_ID);
  await button(page, "Change program id").click();
  await expect(
    block(page).getByText(/This program id does not match the program keypair/)
  ).toBeVisible();

  // A fresh load opens the fold by itself: the mismatch blocks a first deploy.
  // The id is in the store before the reload, which would otherwise race the
  // write on a slow runner
  await expect.poll(() => isStored(page, OTHER_ID), LONG).toBe(true);
  await reloadAndBoot(page);
  await openDeploy(page);
  await expect(field(page)).toHaveValue(OTHER_ID, LONG);
  await expect(
    block(page).getByText(/This program id does not match the program keypair/)
  ).toBeVisible();
});
