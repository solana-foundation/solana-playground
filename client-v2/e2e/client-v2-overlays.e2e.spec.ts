import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { lineOf, linesOn } from "./telemetry";

const file = (page: Page, name: string): Locator =>
  page.locator("#root-dir").getByText(name, { exact: true });

const openMenu = async (page: Page, name = "lib.rs") => {
  await expect(file(page, name)).toBeVisible();
  await file(page, name).click({ button: "right" });
};

const openRename = async (page: Page, name = "lib.rs") => {
  await openMenu(page, name);
  await page.getByRole("menuitem", { name: /Rename/ }).click();
  await expect(
    page.getByRole("dialog", { name: `Rename '${name}'` })
  ).toBeVisible();
};

/** A second file in lib.rs's folder, so that renaming onto it fails */
const createSibling = async (page: Page, name: string) => {
  await openMenu(page, "src");
  await page.getByRole("menuitem", { name: /New File/ }).click();
  const input = page.locator("#root-dir").getByRole("textbox");
  await expect(input).toBeFocused();
  await input.fill(name);
  await page.keyboard.press("Enter");
  await expect(file(page, name)).toBeVisible();
};

const renameToExisting = async (page: Page) => {
  await createSibling(page, "b.rs");
  await openRename(page);
  const dialog = page.getByRole("dialog", { name: "Rename 'lib.rs'" });
  await dialog.getByRole("textbox").fill("b.rs");
  await page.keyboard.press("Enter");
  return dialog;
};

test("client-v2-overlays: Choosing an item from the explorer's menu", async ({
  seededPage: page,
}) => {
  await openRename(page);
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("client-v2-overlays: Escape closes a menu", async ({
  seededPage: page,
}) => {
  await openMenu(page);
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // In the explorer: the assistant's chip has a "Leave lib.rs out…" button
  await expect(
    page.locator("#root-dir").getByRole("button", { name: "lib.rs" }).first()
  ).toBeFocused();
});

test("client-v2-overlays: Renaming a file through its dialog", async ({
  seededPage: page,
}) => {
  await openRename(page);
  const dialog = page.getByRole("dialog", { name: "Rename 'lib.rs'" });
  await dialog.getByRole("textbox").fill("renamed.rs");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(file(page, "renamed.rs")).toBeVisible();
  await expect(file(page, "lib.rs")).toHaveCount(0);
});

test("client-v2-overlays: A failing submit keeps the dialog", async ({
  seededPage: page,
}) => {
  const dialog = await renameToExisting(page);
  await expect(dialog.getByRole("alert")).toHaveText(/already exists/i);
  await expect(dialog).toBeVisible();
});

test("client-v2-overlays: Escape closes a dialog without an answer", async ({
  seededPage: page,
}) => {
  await openRename(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(file(page, "lib.rs")).toBeVisible();
});

test("client-v2-overlays: A dialog closes the Files sheet on a phone", async ({
  seededPage: page,
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.getByRole("button", { name: /^Files/ }).click();
  const sheet = page.locator('[data-slot="sheet-content"]');
  await expect(sheet).toBeVisible();
  await openRename(page);
  await expect(sheet).toBeHidden();
  const dialog = page.getByRole("dialog", { name: "Rename 'lib.rs'" });
  await expect(dialog.getByRole("textbox")).toBeFocused();
});

test("client-v2-overlays: A toast clear of the rail", async ({
  seededPage: page,
}) => {
  // The navigation is the leftmost column; folded, it is the rail
  await page.getByRole("button", { name: "Collapse navigation" }).click();
  const rail = page.locator('[data-slot="sidebar-container"]');
  await expect(rail).toHaveJSProperty("offsetWidth", 52);
  await page.evaluate(() =>
    document.dispatchEvent(
      new CustomEvent("viewtoastset", {
        detail: {
          elementable: "div",
          props: {
            componentProps: { children: "overlays e2e toast" },
            options: { name: "e2e-toast" },
          },
        },
      })
    )
  );
  const toast = page.getByText("overlays e2e toast");
  await expect(toast).toBeVisible();
  const railBox = (await rail.boundingBox())!;
  // It rises into place from below the window; wait for it to be the topmost
  // thing at its own centre, which it only is once it is on screen
  await expect
    .poll(() =>
      toast.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2
        );
        return hit !== null && el.contains(hit);
      })
    )
    .toBe(true);
  const box = (await toast.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(railBox.x + railBox.width);
  expect(box.y).toBeGreaterThan(viewport.height / 2);
});

test("client-v2-overlays: Events of a failing dialog", async ({
  seededPage: page,
}) => {
  const lines = linesOn(page);
  await renameToExisting(page);
  await expect
    .poll(() => lineOf(lines, "overlay_modal_submit_failed"))
    .toBeTruthy();
  expect(lineOf(lines, "overlay_modal_opened")).toContain("name: rename-item");
  expect(lineOf(lines, "overlay_modal_submit_failed")).toContain(
    "name: rename-item"
  );
  // The dialog is reported once, and no event carries what the user typed
  const overlayLines = lines.filter((line) =>
    line.startsWith("[telemetry:event] overlay_")
  );
  expect(
    overlayLines.filter((line) =>
      line.startsWith("[telemetry:event] overlay_modal_opened ")
    )
  ).toHaveLength(1);
  expect(overlayLines.filter((line) => line.includes("b.rs"))).toEqual([]);
});
