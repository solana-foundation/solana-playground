import { type Page } from "@playwright/test";

import { WASM_STUB_MARKER } from "../scripts/wasm-stubs.mjs";
import { consoleTrigger, expect, LONG, test } from "./fixtures";

// `client-v2-with-stubs.yml` excludes this tag; `client-v2.yml` runs on the real packages and includes it.
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
    const account = page.getByRole("button", { name: /^Account/ });
    await account.click();
    await page.getByRole("menuitem", { name: "Connect wallet" }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    // The account menu's wallet group shows the balance once it is connected
    await account.click();
    await expect(page.getByRole("menuitem", { name: /SOL/ })).toBeVisible(LONG);
    await page.keyboard.press("Escape");

    // The console bar's own trigger: the editor head's Terminal shares its name
    const drawer = consoleTrigger(page);
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

// The rust-analyzer stub carries no marker and answers every completion with an empty list.
test(
  "rust-analyzer completes Vec:: in lib.rs",
  REAL_WASM,
  async ({ seededPage: page }) => {
    // Loading the crates and the sysroot into the worker takes longer than a CLI call.
    test.slow();
    // The seeded project opens lib.rs; a click in its text keeps the focus in the editor.
    await expect(
      page.getByRole("button", { name: "Close lib.rs" })
    ).toBeVisible();
    await page.locator(".monaco-editor .view-lines").first().click();
    const input = page.locator(".monaco-editor textarea.inputarea");
    await expect(input).toBeFocused(LONG);
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("Enter");
    // The list renders only its visible rows, so the prefix narrows it to the item
    await page.keyboard.type("fn probe() { Vec::with_cap");
    await page.keyboard.press("Control+Space");
    // Monaco's word-based fallback cannot offer a word lib.rs does not hold.
    await expect(
      page.locator(".suggest-widget .monaco-list-row", {
        hasText: "with_capacity",
      })
    ).not.toHaveCount(0, { timeout: 120_000 });
  }
);
