import type { Page } from "@playwright/test";

import {
  consoleTrigger,
  expect,
  HELP_TAIL,
  runInTerminal,
  test,
} from "./fixtures";

/**
 * The scenarios of `client-v2-terminal` for an unknown command (Spec 13,
 * "Not found") and for a command run offline (Spec 13, "Offline"). The yes or
 * no questions are manual: no command that asks one runs in the browser suite
 * without a cluster or a WASM build.
 */

const terminalText = (page: Page) => page.locator(".xterm-rows").first();

const openConsole = async (page: Page) => {
  const drawer = consoleTrigger(page);
  if ((await drawer.getAttribute("aria-expanded")) !== "true") {
    await drawer.click();
  }
};

test.describe("client-v2-terminal", () => {
  test("client-v2-terminal: A typo gets a suggestion", async ({
    seededPage: page,
  }) => {
    await openConsole(page);
    await runInTerminal(page, "biuld");

    await expect(terminalText(page)).toContainText(
      "`biuld` is not a command. Did you mean `build`?"
    );
    await expect(terminalText(page)).not.toContainText("Process error");
  });

  test("client-v2-terminal: Up brings back the suggestion", async ({
    seededPage: page,
  }) => {
    await openConsole(page);
    await runInTerminal(page, "biuld");
    await expect(terminalText(page)).toContainText("Did you mean `build`?");
    await expect(terminalText(page)).toHaveText(/\$\s*$/);

    await page.keyboard.press("ArrowUp");

    await expect(terminalText(page)).toHaveText(/\$ build\s*$/);
  });

  test("client-v2-terminal: A shell habit is named as one", async ({
    seededPage: page,
  }) => {
    await openConsole(page);
    await runInTerminal(page, "ls");

    await expect(terminalText(page)).toContainText(
      "This terminal runs Playground commands, not a system shell. Type `help` to see them."
    );
  });

  test("client-v2-terminal: Nothing close", async ({ seededPage: page }) => {
    await openConsole(page);
    await runInTerminal(page, "xyzzy");

    await expect(terminalText(page)).toContainText(
      "`xyzzy` is not a command. Type `help` to see commands."
    );
  });

  test("client-v2-terminal: Build offline", async ({
    seededPage: page,
    context,
  }) => {
    await openConsole(page);
    await context.setOffline(true);
    await runInTerminal(page, "build");

    await expect(terminalText(page)).toContainText(
      "You're offline. This command needs a connection."
    );
    await expect(terminalText(page)).not.toContainText("Process error");
    await expect(terminalText(page)).not.toContainText("Building");
  });

  test("client-v2-terminal: Help offline", async ({
    seededPage: page,
    context,
  }) => {
    await openConsole(page);
    await context.setOffline(true);
    await runInTerminal(page, "help");

    await expect(terminalText(page)).toContainText(HELP_TAIL);
    await expect(terminalText(page)).not.toContainText("You're offline");
  });
});
