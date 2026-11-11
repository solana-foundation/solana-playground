import type { ConsoleMessage } from "@playwright/test";

import { expect, homeRegion, test } from "./fixtures";
import { WIDE_DESK } from "./viewports";

// Firefox 159 panicked in the analyzer's `loadDependency` while Chromium never did
test.use({ viewport: WIDE_DESK });

/** What a wasm trap or a Rust panic prints; other errors, such as a refused local cluster, do not match */
const WASM_FAILURE =
  /panicked at|RuntimeError|unreachable|recursive use of an object/;

test(
  "loads the Rust analyzer in Firefox without a wasm or Rust error",
  { tag: "@real-wasm" },
  async ({ page }) => {
    // Loading the crates into the worker takes minutes on a cold runner
    test.slow();
    const failures: string[] = [];
    const record = (text: string) => {
      if (WASM_FAILURE.test(text) && !failures.includes(text)) {
        failures.push(text);
      }
    };
    const recordError = (message: ConsoleMessage) => {
      if (message.type() === "error") record(message.text());
    };
    page.on("console", recordError);
    page.on("pageerror", (error) => record(`${error.name}: ${error.message}`));
    // The analyzer runs in a worker, whose console the page's listener does not get
    page.on("worker", (worker) => worker.on("console", recordError));
    // The example's build is not what this test is about
    await page.route("**/build", (route) =>
      route.fulfill({
        contentType: "application/json",
        // eslint-disable-next-line unicorn/no-null -- the stubbed build response is wire JSON, where `null` means no IDL
        body: JSON.stringify({ stderr: "", uuid: "e2e-build", idl: null }),
      })
    );

    await page.goto("/");
    const example = homeRegion(page).getByRole("region", {
      name: "Try an example",
    });
    await expect(example).toContainText("Try the Anchor starter");
    await example.getByRole("button", { name: "Run it" }).click();

    const ready = page
      .getByTestId("status-row")
      .getByRole("button", { name: "Rust analyzer, ready" });
    // Stops on the first failure line, so a panic that leaves the analyzer starting fails at once
    await expect
      .poll(async () => failures.length > 0 || (await ready.count()) > 0, {
        timeout: 150_000,
      })
      .toBe(true);
    // "ready" can come before `loadDependency("anchor_lang")`; a hover the worker answers from that crate proves it loaded
    await page.getByRole("tab", { name: /^Write/ }).click();
    const context = page
      .locator(".monaco-editor .view-line span", { hasText: /^Context$/ })
      .first();
    const anchorHover = page
      .locator(".monaco-hover")
      .filter({ hasText: "anchor_lang" });
    const isAnchorHoverShown = async () => {
      await page.mouse.move(0, 0);
      await context.hover();
      return anchorHover.waitFor({ timeout: 10_000 }).then(
        () => true,
        // A hover asked before the crate loaded shows nothing from it; the poll hovers again
        () => false
      );
    };
    await expect
      .poll(async () => failures.length > 0 || (await isAnchorHoverShown()), {
        timeout: 150_000,
      })
      .toBe(true);
    expect(failures, `wasm or Rust errors:\n${failures.join("\n")}`).toEqual(
      []
    );
    await expect(ready).toBeVisible();
  }
);
