import type { Locator, Page } from "@playwright/test";

import { expect, home, LONG, test } from "./fixtures";
import { DESK } from "./viewports";

/**
 * The keyboard pass over the main dialogs and the keys that act globally
 * (HOO-2696): every control in a dialog takes focus by Tab, Tab never leaves
 * the dialog, Escape closes it, and focus goes back where it came from.
 */

test.use({ viewport: DESK });

const TAB = '#tabs [data-slot="editor-tab"][id^="/"]';

const nav = (page: Page) => page.locator('[data-slot="sidebar"]');

/** The project's Actions menu item `name`, with the menu's trigger */
const fromActions = (name: RegExp) => async (page: Page) => {
  const trigger = page.getByRole("button", { name: /^Actions for/ });
  await trigger.click();
  await page.getByRole("menuitem", { name }).click();
  return trigger;
};

/** A navigation button, pressed */
const fromNav = (name: string) => async (page: Page) => {
  const trigger = nav(page).getByRole("button", { name });
  await trigger.click();
  return trigger;
};

const DIALOGS: [string, (page: Page) => Promise<Locator>][] = [
  ["New project", fromNav("New project")],
  ["Connect a wallet", fromNav("Connect a wallet")],
  ["Share", fromActions(/^Share/)],
  ["Export", fromActions(/^Export/)],
  ["Delete", fromActions(/^Delete/)],
  [
    "Connect a model",
    async (page) => {
      const trigger = page.locator('[data-slot="composer-model"]');
      await trigger.click();
      return trigger;
    },
  ],
];

/**
 * Marks each control in the dialog Tab should land on (`data-kb-stop`) and
 * returns how many there are. A radio group is one stop: its checked item.
 */
const markStops = (dialog: Locator) =>
  dialog.evaluate((root) => {
    const stops = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    ).filter(
      (el) =>
        el.tabIndex >= 0 &&
        // Radix's roving group hands its focus straight to the checked item
        !el.matches(
          '[role="radiogroup"], [role="tablist"], [role="toolbar"]'
        ) &&
        !el.hasAttribute("disabled") &&
        !el.closest('[aria-hidden="true"], [inert]') &&
        el.getClientRects().length > 0 &&
        getComputedStyle(el).visibility !== "hidden"
    );
    stops.forEach((el, i) => el.setAttribute("data-kb-stop", String(i)));
    return stops.length;
  });

/** The marked stops Tab has not reached, as a line of HTML each */
const unreached = (dialog: Locator, reached: Set<string>) =>
  dialog.evaluate(
    (root, seen) =>
      Array.from(root.querySelectorAll("[data-kb-stop]"))
        .filter((el) => !seen.includes(el.getAttribute("data-kb-stop") ?? ""))
        .map((el) => el.outerHTML.slice(0, 160)),
    Array.from(reached)
  );

for (const [name, open] of DIALOGS) {
  test(`keyboard: ${name} keeps Tab inside, closes on Escape and gives focus back`, async ({
    seededPage: page,
  }) => {
    const trigger = await open(page);
    const dialog = page.getByRole("dialog").last();
    await expect(dialog).toBeVisible();

    const stops = await markStops(dialog);
    expect(stops).toBeGreaterThan(0);
    const reached = new Set<string>();
    // Around the dialog twice over: every stop, and Tab never leaves it
    for (let i = 0; i < stops * 2 + 2; i++) {
      await page.keyboard.press("Tab");
      const stop = await dialog.evaluate((root) =>
        root.contains(document.activeElement)
          ? document.activeElement?.getAttribute("data-kb-stop") ?? "frame"
          : "outside"
      );
      expect(stop, `Tab ${i + 1} left the dialog`).not.toBe("outside");
      reached.add(stop);
    }
    expect(await unreached(dialog, reached)).toEqual([]);

    await page.keyboard.press("Shift+Tab");
    expect(
      await dialog.evaluate((root) => root.contains(document.activeElement))
    ).toBe(true);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
}

test("keyboard: Enter opens a file from the tree, Space folds a folder", async ({
  seededPage: page,
}) => {
  const tree = page.locator("#root-dir");
  const src = tree.getByRole("button", { name: "src", exact: true });
  const lib = tree.getByRole("button", { name: "lib.rs", exact: true });
  await expect(lib).toBeVisible();

  // Close lib.rs, then open it again by key
  await page.locator(TAB).first().hover();
  await page.getByRole("button", { name: /^Close lib\.rs/ }).click();
  await expect(page.locator(TAB)).toHaveCount(0);
  await lib.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(TAB)).toHaveCount(1, LONG);

  await src.focus();
  await page.keyboard.press(" ");
  await expect(lib).toBeHidden();
  await page.keyboard.press(" ");
  await expect(lib).toBeVisible();
});

test("keyboard: Alt+W typed in the composer leaves the editor's tab open", async ({
  seededPage: page,
}) => {
  await expect(page.locator(TAB)).toHaveCount(1, LONG);
  await page.getByRole("textbox", { name: "Message the assistant" }).focus();
  await page.keyboard.press("Alt+w");
  await expect(page.locator(TAB)).toHaveCount(1);
  // The same key outside any field closes it, so the field is what kept it
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await page.keyboard.press("Alt+w");
  await expect(page.locator(TAB)).toHaveCount(0);
});

test("keyboard: global keys work from the composer", async ({
  seededPage: page,
}) => {
  const input = page.getByRole("textbox", { name: "Message the assistant" });
  await input.focus();
  // The console, by its key, from the text field
  await page.keyboard.press("ControlOrMeta+j");
  await expect(page.getByRole("button", { name: "Clear" })).toBeVisible();
  // Settings, by its key, from the text field
  await input.focus();
  await page.keyboard.press("ControlOrMeta+,");
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
});

test("keyboard: Home leaves the reload key to the browser", async ({
  page,
}) => {
  await page.goto("/");
  await expect(home(page)).toBeVisible();
  const prevented = await page.evaluate(() => {
    const ev = new KeyboardEvent("keydown", {
      key: "r",
      metaKey: true,
      ctrlKey: true,
      cancelable: true,
      bubbles: true,
    });
    document.body.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  expect(prevented).toBe(false);
});

test("keyboard: Cmd+L is the browser's outside the terminal, the terminal's inside", async ({
  seededPage: page,
}) => {
  /** Press Cmd+L where focus is now; whether the page kept the key */
  const pressL = () =>
    page.evaluate(() => {
      const ev = new KeyboardEvent("keydown", {
        key: "l",
        metaKey: true,
        ctrlKey: true,
        cancelable: true,
        bubbles: true,
      });
      (document.activeElement ?? document.body).dispatchEvent(ev);
      return ev.defaultPrevented;
    });

  await expect(page.locator(TAB)).toHaveCount(1, LONG);
  expect(await pressL()).toBe(false);

  await page.keyboard.press("ControlOrMeta+j");
  const input = page.locator(".xterm textarea").first();
  await input.focus();
  await expect(input).toBeFocused();
  expect(await pressL()).toBe(true);
});

test("keyboard: Shift+Tab from a dialog's frame reaches its last control", async ({
  seededPage: page,
}) => {
  await fromNav("New project")(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // A press on the dialog's body leaves the focus on its frame
  await dialog.focus();
  await expect(dialog).toBeFocused();

  await page.keyboard.press("Shift+Tab");

  await expect(dialog).not.toBeFocused();
  expect(
    await dialog.evaluate((el) => el.contains(document.activeElement))
  ).toBe(true);
});
