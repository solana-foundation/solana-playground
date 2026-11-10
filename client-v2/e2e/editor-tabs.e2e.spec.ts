import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

import { requireFor } from "../src/test-utils/require-for";
import { LONG, test } from "./fixtures";

/**
 * The editor's tab strip in a real browser: what jsdom cannot lay out or
 * paint (the drag, the current tab's ground, close on hover, the clickable
 * edge) and
 * what only the page's own key handling can show (arrows in the editor).
 */

/** A tab's frame, by its path (the drag's copy has no id) */
const TAB = '#tabs [data-slot="editor-tab"][id^="/"]';

const tabIds = (page: Page) =>
  page.locator(TAB).evaluateAll((tabs) => tabs.map((tab) => tab.id));

const trigger = (tab: Locator) => tab.getByRole("tab");

const currentName = (page: Page) =>
  page.locator('#tabs [role="tab"][aria-selected="true"]').textContent();

/** Opens a new file at the root, which opens a tab for it */
const newFile = async (page: Page, name: string) => {
  const tabs = page.locator(TAB);
  const before = await tabs.count();
  await page.getByRole("button", { name: "New file" }).click();
  const field = page.locator("#root-dir input");
  await expect(field).toBeFocused();
  await page.keyboard.type(name);
  await page.keyboard.press("Enter");
  await expect(tabs).toHaveCount(before + 1, LONG);
};

/** Three tabs: the seeded file and two new ones, the last one current */
const threeTabs = async (page: Page) => {
  await expect(page.locator(TAB)).toHaveCount(1, LONG);
  await newFile(page, "one.rs");
  await newFile(page, "two.rs");
  await expect.poll(() => currentName(page)).toBe("two.rs");
};

/** Puts the pointer over the editor, away from every tab */
const pointerAway = async (page: Page) => {
  const box = requireFor("the editor's box")(
    await page.locator(".monaco-editor").first().boundingBox()
  );
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
};

const style = (target: Locator, property: string, pseudo?: string) =>
  target.evaluate(
    (el, [prop, pseudoElt]) =>
      getComputedStyle(el, pseudoElt || null).getPropertyValue(prop),
    [property, pseudo ?? ""] as const
  );

test("dragging a tab reorders it", async ({ seededPage: page }) => {
  await threeTabs(page);
  const [first, second, third] = await tabIds(page);
  const current = await currentName(page);

  const from = requireFor("the first tab's drag handle box")(
    await trigger(page.locator(TAB).nth(0)).boundingBox()
  );
  const to = requireFor("the second tab's box")(
    await page.locator(TAB).nth(1).boundingBox()
  );
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // The sensor starts a drag only after 8px of travel, in mouse moves
  await page.mouse.move(to.x + to.width * 0.75, to.y + to.height / 2, {
    steps: 12,
  });
  await page.mouse.up();

  await expect.poll(() => tabIds(page)).toEqual([second, first, third]);
  expect(await currentName(page)).toBe(current);

  // Close the tab now in front, which is not the current one
  const front = page.locator(TAB).nth(0);
  await front.hover();
  await front.getByRole("button", { name: /^Close / }).click();

  await expect.poll(() => tabIds(page)).toEqual([first, third]);
  expect(await currentName(page)).toBe(current);
});

test("the current tab has no line of its own and close shows on hover", async ({
  seededPage: page,
}) => {
  await threeTabs(page);
  const current = page.locator(`${TAB}[data-active]`);
  const other = page.locator(TAB).nth(0);
  await expect(current).toHaveCount(1);
  await expect(other).not.toHaveAttribute("data-active");

  // The current tab is marked by its own ground alone (DES-130)
  expect(await style(current, "content", "::before")).toBe("none");
  expect(await style(other, "content", "::before")).toBe("none");
  expect(await style(current, "background-color")).not.toBe(
    await style(other, "background-color")
  );

  const close = other.getByRole("button", { name: /^Close / });
  await pointerAway(page);
  await expect.poll(() => style(close, "opacity")).toBe("0");
  await other.hover();
  await expect.poll(() => style(close, "opacity")).toBe("1");
});

test("a click at the tab's left edge selects it", async ({
  seededPage: page,
}) => {
  await threeTabs(page);

  const first = page.locator(TAB).nth(0);
  const box = requireFor("the bounding box of first")(
    await first.boundingBox()
  );
  await page.mouse.click(box.x + 2, box.y + box.height / 2);
  await expect(trigger(first)).toHaveAttribute("aria-selected", "true");

  const second = page.locator(TAB).nth(1);
  await expect(trigger(second)).toHaveAttribute("aria-selected", "false");
  const close = requireFor("the second tab's close button box")(
    await second.getByRole("button", { name: /^Close / }).boundingBox()
  );
  await page.mouse.click(close.x - 4, close.y + close.height / 2);
  await expect(trigger(second)).toHaveAttribute("aria-selected", "true");
});

test("arrow keys in the editor stay in the editor", async ({
  seededPage: page,
}) => {
  await newFile(page, "keys.rs");
  await expect.poll(() => currentName(page)).toBe("keys.rs");

  const input = page.locator(".monaco-editor textarea.inputarea");
  await expect(input).toBeFocused(LONG);
  await page.keyboard.type("abcdef");
  await page.keyboard.press("Home");

  const cursor = page.locator(".monaco-editor .cursors-layer .cursor").first();
  const column = () => style(cursor, "left");
  const start = await column();

  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect.poll(column).not.toBe(start);
  const moved = await column();

  await page.keyboard.press("ArrowLeft");
  await expect.poll(column).not.toBe(moved);

  await expect(input).toBeFocused();
  expect(await currentName(page)).toBe("keys.rs");
});

test("a tab opened past the row's edge scrolls into view, and the wheel scrolls the row", async ({
  seededPage: page,
}) => {
  await page.setViewportSize({ width: 834, height: 900 });
  // The row spans the editor head, over the files column and the stage, so
  // it takes a dozen tabs to overflow it at this width
  const names = Array.from({ length: 12 }, (_, i) => `f${i + 1}.rs`);
  for (const name of names) await newFile(page, name);
  const lastName = names[names.length - 1];
  const list = page.locator('#tabs [role="tablist"]');
  const overflow = () => list.evaluate((el) => el.scrollWidth - el.clientWidth);
  await expect.poll(overflow).toBeGreaterThan(0);

  // The last tab, far right, opened from the explorer with the row scrolled
  // to its start
  await page
    .locator("#root-dir")
    .getByText("lib.rs", { exact: true })
    .first()
    .click();
  await expect.poll(() => currentName(page)).toBe("lib.rs");
  await list.evaluate((el) => {
    el.scrollLeft = 0;
  });
  await page
    .locator("#root-dir")
    .getByText(lastName, { exact: true })
    .first()
    .click();
  await expect.poll(() => currentName(page)).toBe(lastName);

  const last = page.locator(`${TAB}[id$="/${lastName}"]`);
  const inView = async () => {
    const row = requireFor("the bounding box of list")(
      await list.boundingBox()
    );
    const tab = requireFor("the bounding box of last")(
      await last.boundingBox()
    );
    return tab.x >= row.x - 1 && tab.x + tab.width <= row.x + row.width + 1;
  };
  await expect.poll(inView).toBe(true);

  // A plain wheel, vertical only, over the row
  await list.evaluate((el) => {
    el.scrollLeft = 0;
  });
  const row = requireFor("the bounding box of list")(await list.boundingBox());
  await page.mouse.move(row.x + row.width / 2, row.y + row.height / 2);
  await page.mouse.wheel(0, 200);
  await expect
    .poll(() => list.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(0);
});

test("a tab's frame is not focusable: the trigger is the one tab stop", async ({
  seededPage: page,
}) => {
  await threeTabs(page);
  const frames = page.locator('#tabs [data-slot="editor-tab"]');
  await expect(frames).toHaveCount(3);
  for (const frame of await frames.all()) {
    await expect(frame).not.toHaveAttribute("tabindex");
    await expect(frame).toHaveAttribute("role", "presentation");
  }
});
