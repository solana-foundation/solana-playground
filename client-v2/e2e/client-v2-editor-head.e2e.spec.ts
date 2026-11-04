import type { Page } from "@playwright/test";

import {
  consoleTrigger,
  expect,
  filesToggle,
  leaveEditor,
  LONG,
  openFiles,
  startProject,
  test,
} from "./fixtures";

/**
 * The editor head (the `client-v2-editor-head` capability): the tab
 * row, Files and Terminal in one 44 px bar over the files column and the
 * stage. Titles are the spec's scenarios.
 */

const head = (page: Page) => page.locator("#editor-head");
const terminalToggle = (page: Page) => page.locator("#editor-head-terminal");
const filesPanel = (page: Page) => page.locator("#files[data-panel]");

/** A project opened on a first visit, with no saved layout */
const firstVisit = async (page: Page) => {
  await page.goto("/");
  // The suite's profile is a visitor who left the tree open
  // (`playwright.config`); it is applied once, so a reload stays clear
  await page.evaluate(() => localStorage.removeItem("layout"));
  await page.reload();
  await startProject(page, "head-project");
  await expect(head(page)).toBeVisible(LONG);
  await expect(page.locator(".monaco-editor")).toBeVisible(LONG);
};

const boxOf = async (page: Page, selector: string) => {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} has no box`);
  return box;
};

test.describe("at 1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("client-v2-editor-head: The head at 1440", async ({ page }) => {
    await firstVisit(page);
    await expect(head(page)).toHaveJSProperty("offsetHeight", 44);
    await expect(head(page).locator("#tabs")).toBeVisible();
    await expect(head(page).locator("#tabs")).toContainText("lib.rs");
    await expect(filesToggle(page)).toHaveAccessibleName("Files");
    await expect(terminalToggle(page)).toHaveAccessibleName("Terminal");
    // Under the stage tabs
    const tabs = await boxOf(page, "#flow-stage-tab-write");
    const bar = await boxOf(page, "#editor-head");
    expect(bar.y).toBeGreaterThan(tabs.y);
    await expect(
      page.getByRole("button", { name: /^(Expand|Collapse) project panel$/ })
    ).toHaveCount(0);
  });

  test("client-v2-editor-head: Nothing in the head moves", async ({ page }) => {
    await firstVisit(page);
    const before = {
      head: await boxOf(page, "#editor-head"),
      files: await boxOf(page, "#editor-head-files"),
      terminal: await boxOf(page, "#editor-head-terminal"),
    };
    await filesToggle(page).click();
    await expect(filesPanel(page)).toBeVisible();
    const after = {
      head: await boxOf(page, "#editor-head"),
      files: await boxOf(page, "#editor-head-files"),
      terminal: await boxOf(page, "#editor-head-terminal"),
    };
    expect(after.head.x).toBe(before.head.x);
    expect(after.head.width).toBe(before.head.width);
    expect(after.files.x).toBe(before.files.x);
    expect(after.terminal.x).toBe(before.terminal.x);
    expect(after.head.y).toBe(before.head.y);
    // And back: closing moves nothing either
    await filesToggle(page).click();
    await expect(filesPanel(page)).toHaveCount(0);
    const closed = await boxOf(page, "#editor-head-files");
    expect(closed.x).toBe(before.files.x);
  });

  test("client-v2-editor-head: The head on another stage", async ({ page }) => {
    await firstVisit(page);
    await page.locator("#flow-stage-tab-build").click();
    await expect(filesToggle(page)).toBeVisible();
    await expect(terminalToggle(page)).toBeVisible();
    await expect(page.locator("#tabs")).toBeHidden();
    // Back on Write the row shows again, in the head
    await page.locator("#flow-stage-tab-write").click();
    await expect(head(page).locator("#tabs")).toBeVisible();
    await expect(head(page).locator("#tabs")).toContainText("lib.rs");
  });

  test("client-v2-editor-head: Opening and closing the tree", async ({
    page,
  }) => {
    await firstVisit(page);
    await filesToggle(page).click();
    await expect(filesPanel(page)).toBeVisible();
    await expect(filesToggle(page)).toHaveAttribute("aria-pressed", "true");
    // Left of the stage, under the head
    const panel = await boxOf(page, "#files[data-panel]");
    const bar = await boxOf(page, "#editor-head");
    expect(panel.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
    const center = await boxOf(page, "#center[data-panel]");
    expect(panel.x + panel.width).toBeLessThanOrEqual(center.x + 1);

    // A file that is not open yet, so the tab and the highlight have to move
    await page
      .locator("#root-dir [data-path]")
      .filter({ hasText: /^tests$/ })
      .first()
      .click();
    const file = page
      .locator('#root-dir [data-path*="/tests/"][data-path$=".ts"]')
      .first();
    const path = await file.getAttribute("data-path");
    if (!path) throw new Error("the tree's first file has no data-path");
    const name = path.split("/").pop() ?? path;
    await file.click();
    await expect(head(page).locator("#tabs")).toContainText(name);
    await expect(file).toHaveClass(/\bselected\b/);

    await filesToggle(page).click();
    await expect(filesPanel(page)).toHaveCount(0);
    await expect(filesToggle(page)).toHaveAttribute("aria-pressed", "false");
  });

  test("client-v2-editor-head: The key and the head agree", async ({
    page,
  }) => {
    await firstVisit(page);
    await expect(filesToggle(page)).toHaveAttribute("aria-pressed", "false");
    await leaveEditor(page);
    await page.keyboard.press("ControlOrMeta+e");
    await expect(filesPanel(page)).toBeVisible();
    await expect(filesToggle(page)).toHaveAttribute("aria-pressed", "true");
  });

  test("client-v2-editor-head: File actions from the tree", async ({
    page,
  }) => {
    await firstVisit(page);
    await openFiles(page);
    await page.getByRole("button", { name: "New file" }).click();
    const field = page.locator("#root-dir input");
    await expect(field).toBeFocused();
    await page.keyboard.type("y.rs");
    await page.keyboard.press("Enter");
    const created = page.locator('#root-dir [data-path$="/y.rs"]');
    await expect(created).toBeVisible();

    await created.click({ button: "right" });
    await page.getByRole("menuitem", { name: /^Rename/ }).click();
    const rename = page.getByRole("dialog", { name: "Rename 'y.rs'" });
    await rename.getByRole("textbox").fill("z.rs");
    await rename.getByRole("button", { name: "Rename" }).click();
    const renamed = page.locator('#root-dir [data-path$="/z.rs"]');
    await expect(renamed).toBeVisible();

    await renamed.click({ button: "right" });
    await page.getByRole("menuitem", { name: /^Delete/ }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^Delete/ })
      .click();
    await expect(renamed).toHaveCount(0);
  });

  test("client-v2-editor-head: The terminal from the head", async ({
    page,
  }) => {
    await firstVisit(page);
    await terminalToggle(page).click();
    await expect(consoleTrigger(page)).toHaveAttribute("aria-expanded", "true");
    await expect(terminalToggle(page)).toHaveAttribute("aria-pressed", "true");
    // The click left the focus on the toggle, outside the editor, where the
    // shell's Ctrl+J reaches it
    await expect(terminalToggle(page)).toBeFocused();
    await page.keyboard.press("Control+j");
    await expect(consoleTrigger(page)).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    await expect(terminalToggle(page)).toHaveAttribute("aria-pressed", "false");
  });

  test("client-v2-editor-head: A first visit", async ({ page }) => {
    await firstVisit(page);
    await expect(filesPanel(page)).toHaveCount(0);
    await expect(filesToggle(page)).toHaveAttribute("aria-pressed", "false");
    // The stage starts at the assistant's edge
    const assistant = await boxOf(page, "#assistant[data-panel]");
    const center = await boxOf(page, "#center[data-panel]");
    expect(Math.abs(center.x - (assistant.x + assistant.width))).toBeLessThan(
      2
    );
  });

  test("client-v2-editor-head: A saved open tree", async ({ page }) => {
    await firstVisit(page);
    await filesToggle(page).click();
    await expect(filesPanel(page)).toBeVisible();
    await page.reload();
    await expect(filesPanel(page)).toBeVisible(LONG);
    await expect(filesToggle(page)).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("client-v2-editor-head: A phone", async ({ page }) => {
    // Home's New project tile is on the desktop's page; the window is
    // narrowed once the project is open, as client-v2-layout's phone does
    await page.setViewportSize({ width: 1280, height: 800 });
    await firstVisit(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(head(page)).toHaveCount(0);
    await page.getByRole("button", { name: /^Files, .* open$/ }).click();
    const files = page.getByRole("dialog", { name: "Files" });
    await expect(files.locator("#root-dir")).toBeVisible(LONG);
    await page.keyboard.press("Escape");
    await expect(files).toBeHidden();

    // Back over the phone's line, a new head takes the tab row again
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(head(page).locator("#tabs")).toBeVisible(LONG);
    await expect(head(page).locator("#tabs")).toContainText("lib.rs");
  });
});
