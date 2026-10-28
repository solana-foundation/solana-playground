import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { HELP_TAIL, runInTerminal, seedWorkspace } from "./fixtures";

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

/**
 * Renames an explorer item through its menu and dialog with no pause first, so
 * it starts inside the autosave's delay, and returns once the new name shows
 */
const renameTo = async (page: Page, name: string, to: string) => {
  await item(page, name).click({ button: "right" });
  await page.getByRole("menuitem", { name: /Rename/ }).click();
  const dialog = page.getByRole("dialog", { name: `Rename '${name}'` });
  await dialog.getByRole("textbox").fill(to);
  await page.keyboard.press("Enter");
  await expect(item(page, to)).toBeVisible();
};

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
    // Opened inside the autosave's delay: the edit is saved to the file it
    // was made in, not to the one the editor shows when the timer fires
    await focusEditor(page);
    await page.keyboard.type(" // switched");
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
    const tabs = page.locator('#tabs [data-slot="editor-tab"][id^="/"]');
    for (let left = await tabs.count(); left > 0; left--) {
      const tab = tabs.first();
      await tab.hover({ force: true });
      await tab.getByRole("button", { name: /^Close / }).click({ force: true });
      await expect(tabs).toHaveCount(left - 1);
    }
    await expect(page.locator(".monaco-editor")).toHaveCount(0);
    await item(page, "lib.rs").click();
    await expect(page.locator(".monaco-editor")).toHaveCount(1);
    await focusEditor(page);
    await expect.poll(() => editorText(page)).toMatch(/fn ugly\(\)/);
    await expect.poll(() => editorText(page)).toContain("// switched");
  });

  test("keeps an edit made just before the last tab closes", async () => {
    const tabs = page.locator('#tabs [data-slot="editor-tab"][id^="/"]');
    await expect(tabs).toHaveCount(1);
    await focusEditor(page);
    await page.keyboard.type(" // kept");
    // Closed inside the autosave's delay: the edit is saved as the editor
    // unmounts, not dropped with its timer
    const tab = tabs.first();
    await tab.hover({ force: true });
    await tab.getByRole("button", { name: /^Close / }).click({ force: true });
    await expect(page.locator(".monaco-editor")).toHaveCount(0);
    await item(page, "lib.rs").click();
    await focusEditor(page);
    await expect.poll(() => editorText(page)).toContain("// kept");
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
    const drawer = page.getByRole("button", { name: "Terminal", exact: true });
    if ((await drawer.getAttribute("aria-expanded")) !== "true") {
      await drawer.click();
    }
    await runInTerminal(page, "help");
    await expect(page.locator(".xterm-rows").first()).toContainText(HELP_TAIL);
    await expect(page.locator(".xterm")).toHaveCount(1);
  });

  test("keeps an edit made just before its file is renamed", async () => {
    await item(page, "lib.rs").click();
    await focusEditor(page);
    await page.keyboard.type(" // renamed");
    // Meant to land inside the autosave's delay, where the edit is saved before
    // the move; on a slow runner the timer may win, so the event's ordering is
    // pinned in `explorer.test.ts`, and this checks the user's path end to end
    await renameTo(page, "lib.rs", "moved.rs");
    await item(page, "moved.rs").click();
    await focusEditor(page);
    await expect.poll(() => editorText(page)).toContain("// renamed");
    // And on disk: the write lands before the rename, not at the old path after
    await page.reload();
    await expect(page.locator("#root-dir")).toBeVisible();
    if (!(await item(page, "moved.rs").isVisible())) {
      await item(page, "src").click();
    }
    await expect(item(page, "lib.rs")).toBeHidden();
    await item(page, "moved.rs").click();
    await focusEditor(page);
    await expect.poll(() => editorText(page)).toContain("// renamed");
    await renameTo(page, "moved.rs", "lib.rs");
  });

  test("keeps an edit made just before its folder is renamed", async () => {
    if (!(await item(page, "client.ts").isVisible())) {
      await item(page, "client").click();
    }
    await item(page, "client.ts").click();
    await focusEditor(page);
    await page.keyboard.type(" // folder");
    await renameTo(page, "client", "web");
    if (!(await item(page, "client.ts").isVisible())) {
      await item(page, "web").click();
    }
    await item(page, "client.ts").click();
    await focusEditor(page);
    await expect.poll(() => editorText(page)).toContain("// folder");
    // On disk too, and the old folder is not written back
    await page.reload();
    await expect(item(page, "web")).toBeVisible();
    await expect(item(page, "client")).toBeHidden();
    if (!(await item(page, "client.ts").isVisible())) {
      await item(page, "web").click();
    }
    await item(page, "client.ts").click();
    await focusEditor(page);
    await expect.poll(() => editorText(page)).toContain("// folder");
    await renameTo(page, "web", "client");
    // The reload may draw `src` closed, and the next test starts from `lib.rs`
    if (!(await item(page, "lib.rs").isVisible())) {
      await item(page, "src").click();
    }
  });

  test("keeps a file deleted just after an edit deleted", async () => {
    await item(page, "lib.rs").click();
    await focusEditor(page);
    await page.keyboard.type(" // gone");
    // Deleted inside the autosave's delay: disposing its model flushes the
    // edit, which must not write the file back
    await item(page, "lib.rs").click({ button: "right" });
    await page.getByRole("menuitem", { name: /Delete/ }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(item(page, "lib.rs")).toBeHidden();
    // Past the delay, so a save the delete left behind has run by the reload
    await page.waitForTimeout(1000);
    await page.reload();
    await expect(item(page, "src")).toBeVisible();
    // Whether the reload drew `src` open or closed, `lib.rs` is in neither
    await expect(item(page, "lib.rs")).toBeHidden();
    await item(page, "src").click();
    await expect(item(page, "lib.rs")).toBeHidden();
  });
});
