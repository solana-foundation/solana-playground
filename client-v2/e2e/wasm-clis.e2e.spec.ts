import { type Page } from "@playwright/test";

import { WASM_STUB_MARKER } from "../scripts/wasm-stubs.mjs";
import { expect, LONG, test } from "./fixtures";

// `client-v2.yml` runs on the wasm stubs and excludes this tag; `client-v2-real-wasm.yml` runs only it.
const REAL_WASM = { tag: "@real-wasm" };

const terminal = (page: Page) => page.locator(".xterm-rows").first();

const run = async (page: Page, command: string) => {
  await page.getByLabel("Terminal input").first().click();
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
};

test.describe("the wasm CLIs", REAL_WASM, () => {
  test.beforeEach(async ({ seededPage: page }) => {
    // Every CLI command asks for the Playground Wallet first
    await page.getByRole("button", { name: "Connect wallet" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Toggle wallet" }).waitFor();

    const drawer = page.getByRole("button", { name: "Console", exact: true });
    if ((await drawer.getAttribute("aria-expanded")) !== "true") {
      await drawer.click();
    }
    // The terminal drops keys until the setup's own command has returned to the prompt
    await expect(terminal(page)).toContainText(/Setup completed\.\$/);
  });

  test("solana config get prints the RPC URL", async ({ seededPage: page }) => {
    await run(page, "solana config get");
    await expect(terminal(page)).toContainText(/RPC URL: https?:\/\//, LONG);
    await expect(terminal(page)).not.toContainText(WASM_STUB_MARKER);
  });

  // The last lines of each help text: the terminal renders only the rows that fit, so its first lines scroll away
  for (const [cli, lastLine] of [
    ["spl-token", "Wrap native SOL in a SOL token account"],
    ["anchor", "Commands for interacting with interface definitions"],
    ["sugar", "Withdraw funds from candy machine account by closing it"],
  ]) {
    test(`${cli} --help lists its subcommands`, async ({
      seededPage: page,
    }) => {
      await run(page, `${cli} --help`);
      await expect(terminal(page)).toContainText(lastLine, LONG);
      await expect(terminal(page)).not.toContainText(WASM_STUB_MARKER);
    });
  }
});
