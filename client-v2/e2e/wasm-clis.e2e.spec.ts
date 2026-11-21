import { expect, LONG, test } from "./fixtures";

// `client-v2-with-stubs.yml` excludes this tag; `client-v2.yml` runs on the real packages and includes it.
const REAL_WASM = { tag: "@real-wasm" };

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
