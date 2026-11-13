import type { Page } from "@playwright/test";

import { requireFor } from "../src/test-utils/require-for";
import {
  consoleTrigger,
  expect,
  filesDropdown,
  filesToggle,
  leaveEditor,
  LONG,
  openFiles,
  startProject,
  test,
} from "./fixtures";
import { linesOn, linesRead } from "./telemetry";
import {
  DESK,
  DOCK_DESK,
  PHONE,
  waitForPhonePage,
  WIDE_DESK,
} from "./viewports";

/**
 * The editor head (the `client-v2-editor-head` capability): the tab
 * row, Files and Terminal, then the project's Share and More, in one 44 px
 * bar over the files column and the stage. Titles are the spec's scenarios.
 *
 * The tree docks only on a code area of 1100 px or more. At 1440, with the
 * navigation and the assistant open, the code area is about 840 px, so the
 * tree there is the dropdown, with no pin; the docked cases run at 1920.
 */

const head = (page: Page) => page.locator("#editor-head");
const terminalToggle = (page: Page) => page.locator("#editor-head-terminal");
const filesPanel = (page: Page) => page.locator("#files[data-panel]");
const dockPin = (page: Page) =>
  page.getByRole("button", { name: "Dock beside the editor" });
const undockPin = (page: Page) =>
  page.getByRole("button", { name: "Undock the files" });

/** The head's buttons after the tab row, by accessible name, in order */
const headControls = (page: Page) =>
  head(page)
    .locator("#editor-head-files")
    .locator("xpath=..")
    .getByRole("button")
    .evaluateAll((buttons) =>
      buttons.map((b) => b.getAttribute("aria-label") ?? b.textContent ?? "")
    );

/** A project opened on a first visit, with no saved layout */
const firstVisit = async (page: Page) => {
  await page.goto("/");
  // The suite's profile is a visitor who left the tree docked
  // (`playwright.config`); it is applied once, so a reload stays clear
  await page.evaluate(() => localStorage.removeItem("layout"));
  await page.reload();
  await startProject(page, "head-project");
  await expect(head(page)).toBeVisible(LONG);
  await expect(page.locator(".monaco-editor")).toBeVisible(LONG);
};

const boxOf = async (page: Page, selector: string) =>
  requireFor(`${selector}'s bounding box`)(
    await page.locator(selector).boundingBox()
  );

/** Where the tree shows, and how a test reads that it still does */
interface TreePlace {
  /** Brings the tree back after the head's "New file" opened the new file */
  reopen: (page: Page) => Promise<void>;
  /** The tree still shows where it did */
  stays: (page: Page) => Promise<void>;
}

/** The docked column stays where it is */
const inColumn: TreePlace = {
  reopen: async () => {},
  stays: async (page) => {
    await expect(filesPanel(page)).toBeVisible();
    await expect(filesToggle(page)).toHaveAttribute("aria-pressed", "true");
  },
};

/**
 * The dropdown: the new file opens from the tree's field, which closes the
 * dropdown as a pick does, so "Files" opens it again. Its state, not its
 * visibility, is read: a closing dropdown stays visible while it zooms out
 */
const throughDropdown: TreePlace = {
  reopen: async (page) => {
    await expect(filesDropdown(page)).toHaveCount(0);
    await openFiles(page);
  },
  stays: async (page) => {
    await expect(filesDropdown(page)).toHaveAttribute("data-state", "open");
    await expect(filesToggle(page)).toHaveAttribute("aria-pressed", "true");
  },
};

/**
 * The editor shows `name`: its decision to take focus or leave it runs as
 * the model is set, so whatever that decision closes has closed after this
 */
const editorOpened = (page: Page, name: string) =>
  expect(page.locator(".monaco-editor[data-uri]")).toHaveAttribute(
    "data-uri",
    new RegExp(`/${name.replaceAll(".", String.raw`\.`)}$`)
  );

/**
 * The head's "New file", then a rename and a delete from the file's menu, in whatever
 * shows the tree; the menu and its dialogs portal out of the dropdown and
 * keep it open, and so does the open file's re-open under its new name or,
 * after the delete, of the next file, which nobody picked
 */
const fileActionsWith = (place: TreePlace) => async (page: Page) => {
  // The head's +: it shows the tree, wherever it shows, with the field in it
  await page.getByRole("button", { name: "New file" }).click();
  await place.stays(page);
  const field = page.locator("#root-dir input");
  await expect(field).toBeFocused();
  await page.keyboard.type("y.rs");
  await page.keyboard.press("Enter");
  await expect(head(page).locator("#tabs")).toContainText("y.rs");
  await place.reopen(page);
  const created = page.locator('#root-dir [data-path$="/y.rs"]');
  await expect(created).toBeVisible();

  await created.click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Rename/ }).click();
  const rename = page.getByRole("dialog", { name: "Rename 'y.rs'" });
  await rename.getByRole("textbox").fill("z.rs");
  await rename.getByRole("button", { name: "Rename" }).click();
  await expect(rename).toHaveCount(0);
  await expect(head(page).locator("#tabs")).toContainText("z.rs");
  await editorOpened(page, "z.rs");
  await place.stays(page);
  const renamed = page.locator('#root-dir [data-path$="/z.rs"]');
  await expect(renamed).toBeVisible();

  await renamed.click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Delete/ }).click();
  // The dropdown is a dialog too, but holds no Delete
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Delete/ })
    .click();
  await expect(renamed).toHaveCount(0);
  await editorOpened(page, "lib.rs");
  await place.stays(page);
};

test.describe("at 1440", () => {
  test.use({ viewport: WIDE_DESK });

  test("client-v2-editor-head: The head at 1440", async ({ page }) => {
    await firstVisit(page);
    await expect(head(page)).toHaveJSProperty("offsetHeight", 44);
    await expect(head(page).locator("#tabs")).toBeVisible();
    await expect(head(page).locator("#tabs")).toContainText("lib.rs");
    await expect(filesToggle(page)).toHaveAccessibleName("Files");
    await expect(terminalToggle(page)).toHaveAccessibleName("Terminal");
    // Files, Terminal, then the project's Share and More; the assistant
    // shows, so no Expand assistant
    await expect
      .poll(() => headControls(page))
      .toEqual(["Files", "Terminal", "Share head-project", "More options"]);
    // The head is the work's one bar
    await expect(
      page.locator('#work[data-panel] [data-slot="stage-bar"]')
    ).toHaveCount(0);
    // Under the stage tabs
    const tabs = await boxOf(page, "#flow-stage-tab-write");
    const bar = await boxOf(page, "#editor-head");
    expect(bar.y).toBeGreaterThan(tabs.y);
    await expect(
      page.getByRole("button", { name: /^(Expand|Collapse) project panel$/ })
    ).toHaveCount(0);
  });

  test("client-v2-editor-head: The project's name moves to the head", async ({
    page,
  }) => {
    await firstVisit(page);
    // The assistant's head names it, so the editor head does not
    await expect(head(page)).not.toContainText("head-project");
    await page.getByRole("button", { name: "Collapse assistant" }).click();
    const name = head(page).getByText("head-project", { exact: true });
    await expect(name).toBeVisible();
    // Left of the tabs
    const tabs = await boxOf(page, "#editor-head #tabs");
    const named = requireFor("the name's bounding box")(
      await name.boundingBox()
    );
    expect(named.x + named.width).toBeLessThanOrEqual(tabs.x + 1);
    await head(page).getByRole("button", { name: "Expand assistant" }).click();
    await expect(name).toHaveCount(0);
  });

  test("client-v2-editor-head: The chat comes back from the head", async ({
    page,
  }) => {
    await firstVisit(page);
    await page.getByRole("button", { name: "Collapse assistant" }).click();
    await expect(page.locator("#assistant[data-panel]")).toHaveJSProperty(
      "offsetWidth",
      0
    );
    // Before More options
    await expect
      .poll(() => headControls(page))
      .toEqual([
        "Files",
        "Terminal",
        "Share head-project",
        "Expand assistant",
        "More options",
      ]);
    await head(page).getByRole("button", { name: "Expand assistant" }).click();
    await expect
      .poll(() =>
        page
          .locator("#assistant[data-panel]")
          .evaluate((el) => el.getBoundingClientRect().width)
      )
      .toBeGreaterThan(270);
    await expect(
      head(page).getByRole("button", { name: "Expand assistant" })
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
    await expect(filesDropdown(page)).toBeVisible();
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
    await expect(filesDropdown(page)).toHaveCount(0);
    const closed = await boxOf(page, "#editor-head-files");
    expect(closed.x).toBe(before.files.x);
  });

  test("client-v2-editor-head: The head on another stage", async ({ page }) => {
    await firstVisit(page);
    await page.locator("#flow-stage-tab-build").click();
    await expect(filesToggle(page)).toBeVisible();
    await expect(terminalToggle(page)).toBeVisible();
    await expect(
      head(page).getByRole("button", { name: "Share head-project" })
    ).toBeVisible();
    await expect(
      head(page).getByRole("button", { name: "More options" })
    ).toBeVisible();
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
    // Too narrow to dock: no column, and "Files" opens the dropdown
    await expect(filesPanel(page)).toHaveCount(0);
    await filesToggle(page).click();
    const dropdown = filesDropdown(page);
    await expect(dropdown.locator("#root-dir")).toBeVisible();
    await expect(filesToggle(page)).toHaveAttribute("aria-pressed", "true");
    // Under the head
    // Polled: the sheet zooms in from its anchor as it opens
    const bar = await boxOf(page, "#editor-head");
    await expect
      .poll(
        async () =>
          requireFor("the dropdown's bounding box")(
            await dropdown.boundingBox()
          ).y
      )
      .toBeGreaterThanOrEqual(bar.y + bar.height - 1);

    // A file that is not open yet, so the tab has to move. Picking it
    // closes the dropdown, as a tutorial's does
    await dropdown
      .locator("#root-dir [data-path]")
      .filter({ hasText: /^tests$/ })
      .first()
      .click();
    const file = dropdown
      .locator('#root-dir [data-path*="/tests/"][data-path$=".ts"]')
      .first();
    const path = await file.getAttribute("data-path");
    if (!path) throw new Error("the tree's first file has no data-path");
    const name = path.split("/").pop() ?? path;
    await file.click();
    await expect(head(page).locator("#tabs")).toContainText(name);
    await expect(dropdown).toHaveCount(0);
    await expect(filesToggle(page)).toHaveAttribute("aria-pressed", "false");

    // Opened again, it shows the picked file selected; "Files" closes it
    await filesToggle(page).click();
    await expect(
      dropdown.locator(`#root-dir [data-path="${path}"]`)
    ).toHaveClass(/\bselected\b/);
    await filesToggle(page).click();
    await expect(dropdown).toHaveCount(0);
    await expect(filesToggle(page)).toHaveAttribute("aria-pressed", "false");
  });

  test("client-v2-editor-head: The key and the head agree", async ({
    page,
  }) => {
    await firstVisit(page);
    await expect(filesToggle(page)).toHaveAttribute("aria-pressed", "false");
    await leaveEditor(page);
    await page.keyboard.press("ControlOrMeta+e");
    await expect(filesDropdown(page).locator("#root-dir")).toBeVisible();
    await expect(filesToggle(page)).toHaveAttribute("aria-pressed", "true");
  });

  test("client-v2-editor-head: No pin when narrow", async ({ page }) => {
    await firstVisit(page);
    await filesToggle(page).click();
    await expect(filesDropdown(page).locator("#root-dir")).toBeVisible();
    await expect(dockPin(page)).toHaveCount(0);
  });

  test("client-v2-editor-head: File actions from the tree", async ({
    page,
  }) => {
    await firstVisit(page);
    await fileActionsWith(throughDropdown)(page);
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

  test("client-v2-editor-head: A first visit too narrow to dock", async ({
    page,
  }) => {
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
});

test.describe("at 1920", () => {
  test.use({ viewport: DOCK_DESK });

  test("client-v2-editor-head: A first visit", async ({ page }) => {
    await firstVisit(page);
    await expect(filesPanel(page).locator("#root-dir")).toBeVisible();
    await expect(filesToggle(page)).toHaveAttribute("aria-pressed", "true");
    // Left of the stage, under the head, with its unpin
    const panel = await boxOf(page, "#files[data-panel]");
    const bar = await boxOf(page, "#editor-head");
    expect(panel.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
    const center = await boxOf(page, "#center[data-panel]");
    expect(panel.x + panel.width).toBeLessThanOrEqual(center.x + 1);
    await expect(
      filesPanel(page).getByRole("button", { name: "Undock the files" })
    ).toBeVisible();
  });

  test("client-v2-editor-head: Undocking and docking again", async ({
    page,
  }) => {
    await firstVisit(page);
    await expect(filesPanel(page)).toBeVisible();
    // "Files" undocks a docked, shown tree
    await filesToggle(page).click();
    await expect(filesPanel(page)).toHaveCount(0);
    await expect(filesToggle(page)).toHaveAttribute("aria-pressed", "false");
    // Then opens the dropdown, with the pin
    await filesToggle(page).click();
    await expect(filesDropdown(page).locator("#root-dir")).toBeVisible();
    await expect(filesToggle(page)).toHaveAttribute("aria-pressed", "true");
    await dockPin(page).click();
    await expect(filesPanel(page).locator("#root-dir")).toBeVisible();
    await expect(filesDropdown(page)).toHaveCount(0);
    await expect(filesToggle(page)).toHaveAttribute("aria-pressed", "true");
    // The column's own unpin undocks it too
    await undockPin(page).click();
    await expect(filesPanel(page)).toHaveCount(0);
    await expect(filesToggle(page)).toHaveAttribute("aria-pressed", "false");
  });

  test("client-v2-editor-head: The dropdown from the button", async ({
    page,
  }) => {
    await firstVisit(page);
    await undockPin(page).click();
    await expect(filesPanel(page)).toHaveCount(0);
    const lines = linesOn(page);
    await filesToggle(page).click();
    await expect(filesDropdown(page).locator("#root-dir")).toBeVisible();
    // A moment more, so a second copy sent by the same press fails the test
    await page.waitForTimeout(300);
    await linesRead(lines);
    expect(
      lines.filter((line) =>
        line.startsWith("[telemetry:event] layout_files_dropdown_opened ")
      )
    ).toEqual([expect.stringContaining("via: button")]);
  });

  test("client-v2-editor-head: A saved open tree", async ({ page }) => {
    await firstVisit(page);
    await expect(filesPanel(page)).toBeVisible();
    await page.reload();
    await expect(filesPanel(page)).toBeVisible(LONG);
    await expect(filesToggle(page)).toHaveAttribute("aria-pressed", "true");
  });

  test("client-v2-editor-head: A saved undocked tree", async ({ page }) => {
    await firstVisit(page);
    await undockPin(page).click();
    await expect(filesPanel(page)).toHaveCount(0);
    await page.reload();
    await expect(head(page)).toBeVisible(LONG);
    await expect(page.locator(".monaco-editor")).toBeVisible(LONG);
    await expect(filesPanel(page)).toHaveCount(0);
    await filesToggle(page).click();
    await expect(filesDropdown(page).locator("#root-dir")).toBeVisible();
  });

  test("client-v2-editor-head: File actions from the docked tree", async ({
    page,
  }) => {
    await firstVisit(page);
    await expect(filesPanel(page).locator("#root-dir")).toBeVisible();
    await fileActionsWith(inColumn)(page);
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: PHONE });

  test("client-v2-editor-head: A phone", async ({ page }) => {
    // Home's New project tile is on the desktop's page; the window is
    // narrowed once the project is open, as client-v2-layout's phone does
    await page.setViewportSize(DESK);
    await firstVisit(page);
    await page.setViewportSize(PHONE);
    await waitForPhonePage(page, "Work");
    await expect(head(page)).toHaveCount(0);
    await page.getByRole("button", { name: /^Files, .* open$/ }).click();
    const files = page.getByRole("dialog", { name: "Files" });
    await expect(files.locator("#root-dir")).toBeVisible(LONG);
    await page.keyboard.press("Escape");
    await expect(files).toBeHidden();

    // Back over the phone's line, a new head takes the tab row again
    await page.setViewportSize(WIDE_DESK);
    await expect(head(page).locator("#tabs")).toBeVisible(LONG);
    await expect(head(page).locator("#tabs")).toContainText("lib.rs");
  });
});
