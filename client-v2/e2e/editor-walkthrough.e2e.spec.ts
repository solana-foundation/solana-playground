import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { seedWorkspace } from "./fixtures";

/**
 * The editor and its neighbours, end to end. Written for the React 19 move,
 * where every step here matched React 17 pixel for pixel; it stays as the
 * gate for any change to the runtime under the editor.
 */
const editorText = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".monaco-editor .view-line")]
      .sort(
        (a, b) =>
          parseFloat((a as HTMLElement).style.top) -
          parseFloat((b as HTMLElement).style.top)
      )
      .map((l) => (l.textContent ?? "").replace(/\u00a0/g, " "))
      .join("\n")
  );

/**
 * Puts the caret at the end of the file's first line, so typed text lands in
 * the lines Monaco has rendered whatever the scroll position.
 */
const focusEditor = async (page: Page) => {
  const firstLine = page.locator(".monaco-editor .view-line").first();
  // A freshly mounted editor has no lines until its model loads.
  await expect(firstLine).toBeVisible();
  await firstLine.click();
  await expect(page.locator(".monaco-editor.focused").first()).toBeVisible();
  await page.keyboard.press("End");
};

const item = (page: Page, name: string) =>
  page.locator("#root-dir").getByText(name, { exact: true }).first();

test.describe.serial("the editor", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await seedWorkspace(page, "walk");
    await expect(page.locator(".monaco-editor").first()).toBeVisible();
  });

  test.afterAll(() => page.close());

  test("shows exactly one editor after creating a project", async () => {
    await expect(page.locator(".monaco-editor")).toHaveCount(1);
  });

  test("formats Rust on Ctrl+S", async () => {
    await focusEditor(page);
    await page.keyboard.type("\nfn   ugly( ){let a=1;}");
    await page.keyboard.press("Control+S");
    await expect.poll(() => editorText(page)).toMatch(/fn ugly\(\) \{/);
  });

  test("completes and checks TypeScript", async () => {
    // Workaround: the editor's autosave debounce (500 ms) is cancelled, not
    // flushed, when the editor unmounts, so closing the last tab right after
    // an edit drops it (Monaco.tsx autosave effect). Remove this wait when
    // that is fixed.
    await page.waitForTimeout(1000);
    await item(page, "client").click();
    await page
      .locator("#root-dir")
      .getByText(/client\.ts$/)
      .first()
      .click();
    await focusEditor(page);
    await page.keyboard.type("\nconsole.");
    await expect(page.locator(".suggest-widget.visible")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.type("notAThing();");
    await expect(page.locator(".squiggly-error").first()).toBeVisible();
  });

  test("closes every tab to the start screen and reopens", async () => {
    const tabs = page.locator('#tabs [role="button"][id^="/"]');
    for (let left = await tabs.count(); left > 0; left--) {
      const tab = tabs.first();
      await tab.hover({ force: true });
      await tab.locator("svg").last().click({ force: true });
      await expect(tabs).toHaveCount(left - 1);
    }
    await expect(page.locator(".monaco-editor")).toHaveCount(0);
    await item(page, "lib.rs").click();
    await expect(page.locator(".monaco-editor")).toHaveCount(1);
    await focusEditor(page);
    await expect.poll(() => editorText(page)).toMatch(/fn ugly\(\)/);
  });

  test("keeps the edit across a reload", async () => {
    await page.reload();
    await expect(page.locator("#root-dir")).toBeVisible();
    if (!(await item(page, "lib.rs").isVisible())) {
      await item(page, "src").click();
    }
    await item(page, "lib.rs").click();
    await expect(page.locator(".monaco-editor")).toHaveCount(1);
    await focusEditor(page);
    await expect.poll(() => editorText(page)).toMatch(/fn ugly\(\)/);
  });

  test("runs a terminal command", async () => {
    const drawer = page.getByRole("button", { name: "Console", exact: true });
    if ((await drawer.getAttribute("aria-expanded")) !== "true") {
      await drawer.click();
    }
    await page.getByLabel("Terminal input").first().click();
    await page.keyboard.type("help");
    await page.keyboard.press("Enter");
    await expect(page.locator(".xterm-rows").first()).toContainText("rustfmt");
    await expect(page.locator(".xterm")).toHaveCount(1);
  });
});
