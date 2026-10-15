import type { Page } from "@playwright/test";

import { expect, json, leaveEditor, seedWorkspace, test } from "./fixtures";
import { lineOf, linesOn } from "./telemetry";

/** Names of the telemetry events the page has logged so far */
const eventsOn = (page: Page) => {
  const lines = linesOn(page);
  return { has: (name: string) => lines.some((l) => l.split(" ")[1] === name) };
};

/**
 * The one event line with this name: waits for it, then a moment more, so a
 * second copy sent by the same gesture (a key, then the drag it causes) fails
 * the test instead of passing unread
 */
const onlyLineOf = async (page: Page, lines: string[], name: string) => {
  await expect.poll(() => lineOf(lines, name)).toBeTruthy();
  await page.waitForTimeout(300);
  const all = lines.filter((line) =>
    line.startsWith(`[telemetry:event] ${name} `)
  );
  expect(all).toHaveLength(1);
  return all[0];
};

const assistantPanel = (page: Page) => page.locator("#assistant[data-panel]");
const consoleHandle = (page: Page) =>
  page.getByRole("button", { name: "Console" });
// A separator controls the panel before it: the assistant's is right of it
const assistantHandle = (page: Page) =>
  page.locator('[data-slot="resizable-handle"][aria-controls="assistant"]');

const consolePanel = (page: Page) => page.locator("#console[data-panel]");
const filesPanel = (page: Page) => page.locator("#files[data-panel]");
const stagePanel = (page: Page) => page.locator("#stage[data-panel]");
/** The stock Sidebar's column, which holds the navigation */
const navColumn = (page: Page) =>
  page.locator('[data-slot="sidebar-container"]');
const nav = (page: Page) => page.locator('[data-slot="sidebar"]');
// The separator that resizes the console is the one controlling the stage
const consoleSeparator = (page: Page) =>
  page.locator('[data-slot="resizable-handle"][aria-controls="stage"]');

const widthOf = (page: Page) =>
  assistantPanel(page).evaluate((el) => el.getBoundingClientRect().width);
const heightOf = (page: Page) =>
  consolePanel(page).evaluate((el) => el.getBoundingClientRect().height);

/** Drags a separator by (dx, dy) from its centre */
const drag = async (
  page: Page,
  separator: ReturnType<typeof assistantHandle>,
  dx: number,
  dy: number
) => {
  const box = (await separator.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
};

test("client-v2-layout: A resized assistant and an open console", async ({
  seededPage: page,
}) => {
  const before = await widthOf(page);
  const box = (await assistantHandle(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  const widened = await widthOf(page);
  expect(widened).toBeGreaterThan(before + 80);

  await consoleHandle(page).click();
  await expect(consoleHandle(page)).toHaveAttribute("aria-expanded", "true");
  const shorter = await heightOf(page);
  await drag(page, consoleSeparator(page), 0, -100);
  const taller = await heightOf(page);
  expect(taller).toBeGreaterThan(shorter + 60);

  await page.reload();
  await expect(consoleHandle(page)).toHaveAttribute("aria-expanded", "true");
  await expect
    .poll(async () => Math.abs((await widthOf(page)) - widened))
    .toBeLessThan(4);
  await expect
    .poll(async () => Math.abs((await heightOf(page)) - taller))
    .toBeLessThan(4);
});

test("a dragged assistant folded by its button stays folded after a reload", async ({
  seededPage: page,
}) => {
  await drag(page, assistantHandle(page), 120, 0);
  await page.getByRole("button", { name: "Collapse assistant" }).click();
  await expect.poll(() => widthOf(page)).toBeLessThan(40);

  await page.reload();
  await expect(
    page.getByRole("button", { name: "Expand assistant" })
  ).toBeVisible();
  await expect.poll(() => widthOf(page)).toBeLessThan(40);

  await page.getByRole("button", { name: "Expand assistant" }).click();
  await expect.poll(() => widthOf(page)).toBeGreaterThan(270);
});

test("a dragged console folded by its handle stays folded after a reload", async ({
  seededPage: page,
}) => {
  await consoleHandle(page).click();
  await expect(consoleHandle(page)).toHaveAttribute("aria-expanded", "true");
  await drag(page, consoleSeparator(page), 0, -100);
  await consoleHandle(page).click();
  await expect(consoleHandle(page)).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => heightOf(page)).toBeLessThan(40);

  await page.reload();
  await expect(consoleHandle(page)).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => heightOf(page)).toBeLessThan(40);

  await consoleHandle(page).click();
  await expect(consoleHandle(page)).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => heightOf(page)).toBeGreaterThan(110);
});

const savedLayout = (page: Page) =>
  page.evaluate(() => localStorage.getItem("layout"));

test("a visit that moves nothing leaves the saved layout alone", async ({
  seededPage: page,
}) => {
  // A layout this version reads and uses, with sizes the panels' own mount
  // would report differently, so a write on mount would change the string
  const saved = JSON.stringify({
    v: 2,
    open: { nav: true, files: true, assistant: true, console: true },
    h: { assistant: 34, work: 66 },
    w: { files: 30, center: 70 },
    vert: { stage: 61, console: 39 },
  });
  await page.evaluate((value) => localStorage.setItem("layout", value), saved);
  await page.reload();
  await expect(assistantPanel(page)).toBeVisible();
  await expect(consoleHandle(page)).toHaveAttribute("aria-expanded", "true");
  await page.waitForTimeout(300);
  expect(await savedLayout(page)).toBe(saved);
});

test("a window resize does not pin the panels' sizes", async ({
  seededPage: page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await expect(assistantPanel(page)).toBeVisible();
  expect(await savedLayout(page)).toBeNull();

  await page.setViewportSize({ width: 1920, height: 900 });
  await expect.poll(() => widthOf(page)).toBeGreaterThan(300);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
  expect(await savedLayout(page)).toBeNull();
});

test("a restored width the library would fold opens the assistant, and changes nothing", async ({
  seededPage: page,
}) => {
  // 10% of a 1440 px window's group is below the assistant's fold point, so
  // the library mounts it folded; the saved flag says open, and decides
  const lines = linesOn(page);
  const saved = JSON.stringify({
    v: 2,
    open: { nav: true, files: true, assistant: true, console: false },
    h: { assistant: 10, work: 90 },
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate((value) => localStorage.setItem("layout", value), saved);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Collapse assistant" })
  ).toBeVisible();
  await expect.poll(() => widthOf(page)).toBeGreaterThan(270);
  await page.waitForTimeout(300);
  expect(lineOf(lines, "layout_panel_toggled")).toBeUndefined();
  expect(await savedLayout(page)).toBe(saved);
});

test("the assistant keeps its width when the window widens", async ({
  seededPage: page,
}) => {
  // Measured where the page was seeded, before the window moves
  await expect(assistantPanel(page)).toBeVisible();
  const before = await widthOf(page);
  await page.setViewportSize({ width: 1920, height: 900 });
  await expect
    .poll(async () => Math.abs((await widthOf(page)) - before))
    .toBeLessThan(2);
});

test("client-v2-layout: An unreadable saved layout", async ({
  seededPage: page,
}) => {
  await page.evaluate(() => localStorage.setItem("layout", "{"));
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Collapse project panel" })
  ).toBeVisible();
  await expect(page.locator(".monaco-editor")).toBeVisible();
});

test("client-v2-layout: Folding the console", async ({ seededPage: page }) => {
  await consoleHandle(page).click();
  await page.locator(".xterm").click();
  await page.keyboard.type("echo-marker");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText("echo-marker");

  await consoleHandle(page).click();
  await expect(consoleHandle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".xterm")).toHaveCount(1);

  await consoleHandle(page).click();
  await expect(page.locator(".xterm-rows")).toContainText("echo-marker");
});

test("client-v2-layout: Folding the project panel", async ({
  seededPage: page,
}) => {
  const files = filesPanel(page);
  await expect(
    page.getByRole("button", { name: "Collapse project panel" })
  ).toBeVisible();
  await expect(files).toHaveJSProperty("offsetWidth", 232);
  await leaveEditor(page);
  await page.keyboard.press("ControlOrMeta+e");
  await expect(files).toHaveJSProperty("offsetWidth", 52);
  await expect(
    files.getByRole("button", { name: "Expand project panel" })
  ).toBeVisible();
  await expect(files.getByRole("button", { name: "New file" })).toBeVisible();
  // The fold is kept over a reload
  await page.reload();
  await expect(files).toHaveJSProperty("offsetWidth", 52);
  await leaveEditor(page);
  await page.keyboard.press("ControlOrMeta+e");
  await expect(files).toHaveJSProperty("offsetWidth", 232);
  await expect(files.locator("#root-dir")).toBeVisible();
});

test("client-v2-layout: Folding the navigation", async ({
  seededPage: page,
}) => {
  const column = navColumn(page);
  await expect(column).toHaveJSProperty("offsetWidth", 232);
  await page.keyboard.press("ControlOrMeta+b");
  await expect(column).toHaveJSProperty("offsetWidth", 52);
  // A rail of icons: the items stay, the switcher and the chips give way to
  // the cluster's dot and the account
  await expect(
    nav(page).getByRole("button", { name: "Expand navigation" })
  ).toBeVisible();
  for (const item of ["Home", "New project", "Tutorials", "Programs"]) {
    await expect(nav(page).getByRole("button", { name: item })).toBeVisible();
  }
  await expect(nav(page).locator('[aria-haspopup="true"]')).toHaveCount(0);
  await expect(
    nav(page).getByRole("button", { name: "Open settings" })
  ).toHaveCount(0);
  await expect(
    nav(page).getByRole("button", { name: /^Cluster: / })
  ).toBeVisible();
  await expect(
    nav(page).getByRole("button", { name: "Account" })
  ).toBeVisible();
  await page.keyboard.press("ControlOrMeta+b");
  await expect(column).toHaveJSProperty("offsetWidth", 232);
  await expect(
    nav(page).getByRole("button", { name: "Collapse navigation" })
  ).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("client-v2-layout: A phone", async ({ page }) => {
    // The project tree lives in a closed Sheet on a phone, which the fixture
    // waits on, so seed on a desktop-sized page and narrow it afterwards.
    await page.setViewportSize({ width: 1280, height: 800 });
    await seedWorkspace(page);
    await page.setViewportSize({ width: 375, height: 812 });
    const events = eventsOn(page);
    const lines = page.locator(".monaco-editor .view-lines");
    await expect(lines).toContainText("use anchor_lang");
    const before = await lines.innerText();
    await page.locator(".monaco-editor textarea.inputarea").focus();
    // The cursor on line 1 is the common case: the message must still land
    // inside the editor, not above it under the tab bar
    await page.keyboard.press("ControlOrMeta+Home");
    await page.keyboard.type("zzz");
    const message = page
      .locator(".monaco-editor .message")
      .getByText("Editing works on screens 600 px and wider");
    await expect(message).toBeVisible();
    const editorBox = (await page.locator(".monaco-editor").boundingBox())!;
    const messageBox = (await message.boundingBox())!;
    expect(messageBox.y).toBeGreaterThanOrEqual(editorBox.y);
    expect(await lines.innerText()).toBe(before);
    await expect
      .poll(() => events.has("layout_readonly_edit_blocked"))
      .toBe(true);

    await page.getByRole("button", { name: "Expand assistant" }).click();
    const sheet = page.locator('[data-slot="sheet-content"]');
    // The Sheet fills a phone's width (the design system's own is 3/4)
    await expect
      .poll(async () => (await sheet.boundingBox())?.width)
      .toBeGreaterThanOrEqual(374);
    // A fresh profile has no backend, so the assistant opens on its picker; a
    // key of any value connects, as nothing is sent until a message is.
    await sheet.getByRole("textbox", { name: "API KEY" }).fill("e2e-key");
    await sheet.getByRole("button", { name: "Connect", exact: true }).click();
    const composer = sheet.getByRole("textbox", {
      name: "Message the assistant",
    });
    await composer.fill("hello");
    await expect(composer).toHaveValue("hello");
  });

  test("the editor takes typing again once the window widens", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await seedWorkspace(page);
    await page.setViewportSize({ width: 375, height: 812 });
    const lines = page.locator(".monaco-editor .view-lines");
    await expect(lines).toContainText("use anchor_lang");
    await page.setViewportSize({ width: 768, height: 812 });
    await page.locator(".monaco-editor textarea.inputarea").focus();
    await page.keyboard.press("ControlOrMeta+Home");
    await page.keyboard.type("zzz");
    await expect(lines).toContainText("zzzuse anchor_lang");
  });

  test("a format still applies to the read-only editor", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await seedWorkspace(page);
    await page.getByRole("button", { name: "New file" }).click();
    await page.locator("#root-dir input").fill("fmt.ts");
    await page.keyboard.press("Enter");
    const lines = page.locator(".monaco-editor .view-lines");
    await expect(page.locator("#tabs")).toContainText("fmt.ts");
    await page.locator(".monaco-editor textarea.inputarea").focus();
    await page.keyboard.type("const  a=1");
    await expect(lines).toContainText("const  a=1");

    await page.setViewportSize({ width: 375, height: 812 });
    await page.locator(".monaco-editor textarea.inputarea").focus();
    await page.keyboard.press("ControlOrMeta+s");
    await expect(lines).toContainText("const a = 1;");
  });

  test("client-v2-layout: Settings on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await seedWorkspace(page);
    await page.setViewportSize({ width: 375, height: 812 });
    // The editor focuses itself when it opens the first file; landing after
    // the Sheet closed, it would take focus from the settings
    await expect(
      page.locator(".monaco-editor textarea.inputarea")
    ).toBeFocused();
    const lines = linesOn(page);
    await page.getByRole("button", { name: "Expand project panel" }).click();
    const sheet = page.locator('[data-slot="sidebar"][data-mobile="true"]');
    await sheet.getByRole("button", { name: /^Change cluster/ }).click();

    // The Sheet's overlay would cover the settings and trap focus away from
    // them, so opening them closes it, as the product's doing
    await expect(sheet).toHaveCount(0);
    const settings = page.getByRole("region", { name: "Settings" });
    const network = settings.getByRole("radiogroup", { name: "Network" });
    await expect(network.getByRole("radio", { checked: true })).toBeFocused();
    await expect
      .poll(() =>
        lines.find(
          (line) =>
            line.startsWith("[telemetry:event] layout_panel_toggled ") &&
            line.includes("open: false")
        )
      )
      .toContain("via: auto");

    await network.getByRole("radio", { name: "Localnet" }).click();
    await expect(
      network.getByRole("radio", { name: "Localnet" })
    ).toHaveAttribute("aria-checked", "true");
    // Still open and in front: a second pick lands too
    await network.getByRole("radio", { name: "Devnet" }).click();
    await expect(
      network.getByRole("radio", { name: "Devnet" })
    ).toHaveAttribute("aria-checked", "true");
    await settings.getByRole("button", { name: "Close settings" }).click();
    await page.getByRole("button", { name: "Expand project panel" }).click();
    await expect(
      sheet.getByRole("button", { name: "Change cluster, currently devnet" })
    ).toBeVisible();
  });

  test("a file can be renamed from the project Sheet", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await seedWorkspace(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole("button", { name: "Expand project panel" }).click();
    const sheet = page.locator('[data-slot="sidebar"][data-mobile="true"]');
    const file = sheet.getByText("lib.rs", { exact: true });
    await file.click({ button: "right" });
    const rename = page.getByText("Rename", { exact: true });
    // Clicked once the menu's own fade has ended: while it plays, the menu is
    // drawn on a layer of its own and sits on top whatever the stacking says,
    // which is how a menu under the Sheet passed half the time
    await rename.evaluate(async (el) => {
      for (let e: Element | null = el; e; e = e.parentElement) {
        await Promise.all(e.getAnimations().map((a) => a.finished));
      }
    });
    await rename.click();
    // Tapped, as on a phone: the modal Sheet, closing, keeps the modal's
    // field from taking focus itself. Left to the adaptive design, which
    // decides how the project panel behaves on a phone.
    const input = page.locator('input[value="lib.rs"]');
    await input.click();
    await input.fill("renamed.rs");
    await page.keyboard.press("Enter");
    // The modal closed the Sheet; its tree stays in the page for the length
    // of the Sheet's exit animation, holding the new name too, so the page
    // has one copy of it only once the Sheet is gone
    await expect(sheet).toHaveCount(0);
    await expect(page.getByText("renamed.rs", { exact: true })).toBeVisible();
  });
});

test.describe("on a compact window", () => {
  test.use({ viewport: { width: 800, height: 1000 } });

  test("the assistant Sheet is the assistant's default width", async ({
    seededPage: page,
  }) => {
    await page.getByRole("button", { name: "Expand assistant" }).click();
    const sheet = page.locator('[data-slot="sheet-content"]');
    // 21.75 rem, not the design system's 3/4 of the window capped at 24 rem
    // (384 px)
    await expect
      .poll(async () => (await sheet.boundingBox())?.width)
      .toBeCloseTo(348, -1);
  });
});

test.describe("on a portrait iPad", () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test("client-v2-layout: A portrait iPad", async ({ seededPage: page }) => {
    const lines = page.locator(".monaco-editor .view-lines");
    await page.locator(".monaco-editor textarea.inputarea").focus();
    await page.keyboard.type("zzz");
    await expect(lines).toContainText("zzz");
  });
});

test("client-v2-layout: The classic parameter", async ({
  seededPage: page,
}) => {
  // The parameter is ignored: the page is the one without it
  const measure = async () => ({
    nav: await navColumn(page).evaluate(
      (el) => el.getBoundingClientRect().width
    ),
    files: await filesPanel(page).evaluate(
      (el) => el.getBoundingClientRect().width
    ),
    assistant: await widthOf(page),
    console: await consoleHandle(page).isVisible(),
    sidebars: await page.locator('[data-slot="sidebar"]').count(),
  });
  const plain = await measure();
  await page.goto("/?classic");
  await expect(consoleHandle(page)).toBeVisible();
  await expect(assistantPanel(page)).toBeVisible();
  expect(await measure()).toEqual(plain);
});

test("client-v2-layout: Toggling the assistant by key", async ({
  seededPage: page,
}) => {
  const lines = linesOn(page);
  await page.keyboard.press("ControlOrMeta+r");
  await expect(
    page.getByRole("button", { name: "Expand assistant" })
  ).toBeVisible();
  const line = await onlyLineOf(page, lines, "layout_panel_toggled");
  expect(line).toContain("panel: assistant");
  expect(line).toContain("open: false");
  expect(line).toContain("via: key");
});

test("client-v2-layout: A corrupt saved layout is reported", async ({
  seededPage: page,
}) => {
  await page.evaluate(() => localStorage.setItem("layout", "{"));
  const lines = linesOn(page);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Collapse project panel" })
  ).toBeVisible();
  await expect.poll(() => lineOf(lines, "layout_restore_failed")).toBeTruthy();
  expect(lineOf(lines, "layout_restore_failed")).toContain("reason: corrupt");
});

// The wallet window opens at the top right of the work area, just under the
// stage tabs; nothing in the frame (the stage bar, the panels) may sit above
// it and take its clicks.
test("the wallet window's close button is clickable at the top of the work area", async ({
  seededPage: page,
}) => {
  // Connected from the navigation's footer chip, which then reads "Toggle
  // wallet" (and would disconnect, so it is not what opens the window)
  await nav(page)
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    nav(page).getByRole("button", { name: "Toggle wallet", exact: true })
  ).toBeVisible();
  // The window is opened by the editor tab bar's "Wallet" button. Its icon's
  // alt text joins its accessible name ("Wallet Wallet"), so it is found by
  // its text, which is the label alone.
  await page
    .locator("#tabs")
    .getByRole("button")
    .filter({ hasText: /^Wallet$/ })
    .click();

  const wallet = page.locator(".react-draggable");
  await expect(wallet).toBeVisible();
  const close = wallet.getByRole("button", { name: "Close", exact: true });
  await close.click();
  await expect(wallet).toHaveCount(0);
});

// Toasts open at the bottom left, over the navigation. The stock Sidebar's
// container is z-10, so the toast layer must sit above it.
test("a toast opens above the navigation", async ({ seededPage: page }) => {
  await page.evaluate(() =>
    document.dispatchEvent(
      new CustomEvent("viewtoastset", {
        detail: {
          elementable: "div",
          props: {
            componentProps: { children: "layout e2e toast" },
            options: { name: "layout-e2e" },
          },
        },
      })
    )
  );
  const toast = page.getByText("layout e2e toast");
  await expect(toast).toBeVisible();
  const left = (await navColumn(page).boundingBox())!;
  // It rises into place from below the window, so the first frames sit off
  // screen where nothing is hit; wait for it to be the topmost thing at its
  // own centre
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
  // The toast really is over the navigation, not beside it
  const box = (await toast.boundingBox())!;
  expect(box.x).toBeLessThan(left.x + left.width);
});

test.describe("the layout_viewport event", () => {
  const widthClassAt = async (page: Page, width: number) => {
    // Seeded on a desktop-sized page, as the phone test is: the project
    // tree lives in a closed Sheet on a phone, which the fixture waits on
    await page.setViewportSize({ width: 1280, height: 800 });
    await seedWorkspace(page);
    await page.setViewportSize({ width, height: 800 });
    const lines = linesOn(page);
    await page.reload();
    await expect.poll(() => lineOf(lines, "layout_viewport")).toBeTruthy();
    return lineOf(lines, "layout_viewport");
  };

  test("reports wide at 1280 px", async ({ page }) => {
    expect(await widthClassAt(page, 1280)).toContain("viewport: wide");
  });

  test("reports compact at 800 px", async ({ page }) => {
    expect(await widthClassAt(page, 800)).toContain("viewport: compact");
  });

  test("reports phone at 375 px", async ({ page }) => {
    expect(await widthClassAt(page, 375)).toContain("viewport: phone");
  });
});

test("dragging the assistant shut is reported as a drag", async ({
  seededPage: page,
}) => {
  const lines = linesOn(page);
  await drag(page, assistantHandle(page), -600, 0);
  await expect.poll(() => widthOf(page)).toBeLessThan(40);
  const line = await onlyLineOf(page, lines, "layout_panel_toggled");
  expect(line).toContain("panel: assistant");
  expect(line).toContain("open: false");
  expect(line).toContain("via: drag");
});

test.describe("a select inside the assistant Sheet", () => {
  test.use({ viewport: { width: 800, height: 1000 } });

  test("opens its options above the Sheet", async ({ seededPage: page }) => {
    // The editor focuses itself when it opens the first file; landing after
    // the select opened, it closes the select
    await expect(
      page.locator(".monaco-editor textarea.inputarea")
    ).toBeFocused();
    await page.getByRole("button", { name: "Expand assistant" }).click();
    const sheet = page.locator('[data-slot="sheet-content"]');
    await expect(sheet).toBeVisible();
    await sheet.getByText("claude-opus-5-5").click();
    const option = page.getByRole("option").first();
    await expect(option).toBeVisible();
    await expect(option).toContainText("claude");
    const hit = await option.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const top = document.elementFromPoint(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2
      );
      return top !== null && el.contains(top);
    });
    expect(hit).toBe(true);
  });
});

test("a toggle on a wide window works after a trip through the compact Sheet", async ({
  seededPage: page,
}) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.getByRole("button", { name: "Expand assistant" }).click();
  await expect(page.locator('[data-slot="sheet-content"]')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(assistantPanel(page)).toBeVisible();
  await page.keyboard.press("ControlOrMeta+r");
  await expect.poll(() => widthOf(page)).toBeLessThan(40);
});

test("client-v2-layout: A layout saved before the four columns", async ({
  seededPage: page,
}) => {
  // As the version with the header wrote it: project panel folded, console open
  await page.evaluate(() =>
    localStorage.setItem(
      "layout",
      JSON.stringify({
        v: 1,
        open: { left: false, assistant: true, console: true },
      })
    )
  );
  await page.reload();
  await expect(filesPanel(page)).toHaveJSProperty("offsetWidth", 52);
  await expect(
    filesPanel(page).getByRole("button", { name: "Expand project panel" })
  ).toBeVisible();
  await expect(consoleHandle(page)).toHaveAttribute("aria-expanded", "true");
  await expect(navColumn(page)).toHaveJSProperty("offsetWidth", 232);
  await expect(
    nav(page).getByRole("button", { name: "Collapse navigation" })
  ).toBeVisible();
  await expect
    .poll(async () => JSON.parse((await savedLayout(page)) ?? "null"))
    .toEqual({
      v: 2,
      open: { nav: true, files: false, assistant: true, console: true },
    });
});

/** Where an element sits on the page */
const boxOf = async (locator: ReturnType<Page["locator"]>) => {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
};

test("client-v2-layout: A wide window", async ({ seededPage: page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(filesPanel(page).locator("#root-dir")).toBeVisible();
  await expect(stagePanel(page)).toBeVisible();
  await expect(assistantPanel(page)).toBeVisible();

  const navBox = await boxOf(navColumn(page));
  const assistantBox = await boxOf(assistantPanel(page));
  const filesBox = await boxOf(filesPanel(page));
  const stageBox = await boxOf(stagePanel(page));
  const consoleBox = await boxOf(consolePanel(page));

  // Side by side, left to right, none overlapping the next
  expect(navBox.x + navBox.width).toBeLessThanOrEqual(assistantBox.x);
  expect(assistantBox.x + assistantBox.width).toBeLessThanOrEqual(filesBox.x);
  expect(filesBox.x + filesBox.width).toBeLessThanOrEqual(stageBox.x);
  // The console under the stage, in the same column
  expect(consoleBox.y).toBeGreaterThanOrEqual(stageBox.y + stageBox.height - 1);
  expect(Math.abs(consoleBox.x - stageBox.x)).toBeLessThan(2);

  // The stage tabs above the files column and the stage, within their span
  for (const stage of ["write", "build", "deploy", "interact"]) {
    const tab = await boxOf(page.locator(`#flow-stage-tab-${stage}`));
    expect(tab.y + tab.height).toBeLessThanOrEqual(filesBox.y);
    expect(tab.y + tab.height).toBeLessThanOrEqual(stageBox.y);
    expect(tab.x).toBeGreaterThanOrEqual(filesBox.x);
    expect(tab.x + tab.width).toBeLessThanOrEqual(stageBox.x + stageBox.width);
  }

  // No header: nothing sits above the columns, which start at the top
  await expect(page.locator("header, [role=banner]")).toHaveCount(0);
  expect(Math.abs(navBox.y - assistantBox.y)).toBeLessThan(2);
  expect(assistantBox.y).toBeLessThan(16);
});

test("client-v2-layout: Everything the header did", async ({
  seededPage: page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const switcher = nav(page).locator('[aria-haspopup="true"]');
  await expect(switcher).toContainText("e2e-project");

  // A second project, so there is one to switch back to
  await nav(page).getByRole("button", { name: "New project" }).click();
  const gallery = page.locator("[data-gallery-modal]");
  await expect(gallery).toBeVisible();
  await gallery.getByLabel("Project name").fill("second");
  await gallery.getByRole("button", { name: /^Start/ }).click();
  await expect(gallery).toBeHidden();
  await expect(switcher).toContainText("second");

  // The switcher, in the navigation
  await switcher.click();
  await page
    .getByLabel("Projects and lessons")
    .getByText("e2e-project", { exact: true })
    .click();
  await expect(switcher).toContainText("e2e-project");
  await expect(page.locator("#root-dir")).toBeVisible();

  // The settings, from the navigation's footer
  await page
    .locator('[data-slot="sidebar-footer"]')
    .getByRole("button", { name: "Open settings" })
    .click();
  const settings = page.getByRole("region", { name: "Settings" });
  await expect(settings).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();

  // The stages, by key
  await page.keyboard.press("Control+2");
  await expect(page.locator("#flow-stage-tab-build")).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await expect(page.locator("#flow-stage-panel-build")).toBeVisible();
});

test.describe("on a tablet", () => {
  test.use({ viewport: { width: 834, height: 1112 } });

  test("client-v2-layout: A tablet", async ({ seededPage: page }) => {
    await expect(navColumn(page)).toHaveJSProperty("offsetWidth", 52);
    await expect(
      nav(page).getByRole("button", { name: "Expand navigation" })
    ).toBeVisible();
    await expect(filesPanel(page).locator("#root-dir")).toBeVisible();
    await expect(stagePanel(page)).toBeVisible();
    await expect(assistantPanel(page)).toHaveCount(0);

    await page.getByRole("button", { name: "Expand assistant" }).click();
    await expect(page.getByRole("dialog", { name: "Assistant" })).toBeVisible();
  });

  test("client-v2-layout: The rail's footer", async ({ seededPage: page }) => {
    // The editor focuses itself when it opens the first file; landing after
    // the settings opened, it would take focus from them
    await expect(
      page.locator(".monaco-editor textarea.inputarea")
    ).toBeFocused();
    const footer = nav(page).locator('[data-slot="sidebar-footer"]');
    await footer.getByRole("button", { name: /^Cluster: / }).click();
    const settings = page.getByRole("region", { name: "Settings" });
    const network = settings.getByRole("radiogroup", { name: "Network" });
    await expect(network.getByRole("radio", { checked: true })).toBeFocused();
    // A second click on the dot is the way out, as on the chip
    await footer.getByRole("button", { name: /^Cluster: / }).click();
    await expect(settings).toBeHidden();

    await footer.getByRole("button", { name: "Account" }).click();
    await expect(navColumn(page)).toHaveJSProperty("offsetWidth", 232);
    await expect(
      footer.getByRole("button", { name: /^Change cluster, currently / })
    ).toBeVisible();
  });
});

test("client-v2-layout: Programs from the navigation", async ({
  seededPage: page,
}) => {
  await nav(page).getByRole("button", { name: "Programs" }).click();
  await expect(page.locator("[data-gallery-modal]")).toBeVisible();
  await expect(page.locator("#gallery-tab-programs")).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await expect(page.locator("#gallery-tab-tutorials")).toHaveAttribute(
    "aria-selected",
    "false"
  );
});

test("client-v2-layout: Picking Tutorials", async ({ seededPage: page }) => {
  const lines = linesOn(page);
  await nav(page).getByRole("button", { name: "Tutorials" }).click();
  await expect(page.locator("#gallery-tab-tutorials")).toHaveAttribute(
    "aria-selected",
    "true"
  );
  const line = await onlyLineOf(page, lines, "nav_item_opened");
  expect(line).toContain("item: tutorials");
});

test.describe("on a 1024 px window", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  // The narrowest window with all four columns: the work area's minimum
  // (the files column's 12 rem, a handle and the stage's 240 px) fits only
  // because the assistant gives way below its default width
  test("the four columns fit side by side, none below its minimum", async ({
    seededPage: page,
  }) => {
    await expect(
      nav(page).getByRole("button", { name: "Collapse navigation" })
    ).toBeVisible();
    await expect(filesPanel(page).locator("#root-dir")).toBeVisible();
    await expect(stagePanel(page)).toBeVisible();
    await expect(assistantPanel(page)).toBeVisible();

    const navBox = await boxOf(navColumn(page));
    const assistantBox = await boxOf(assistantPanel(page));
    const filesBox = await boxOf(filesPanel(page));
    const stageBox = await boxOf(stagePanel(page));

    expect(navBox.x + navBox.width).toBeLessThanOrEqual(assistantBox.x);
    expect(assistantBox.x + assistantBox.width).toBeLessThanOrEqual(filesBox.x);
    expect(filesBox.x + filesBox.width).toBeLessThanOrEqual(stageBox.x);
    expect(filesBox.width).toBeGreaterThanOrEqual(192);
    expect(stageBox.width).toBeGreaterThanOrEqual(240);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(1024);
  });
});

// A separator controls the panel before it: the files column's is right of it
const filesHandle = (page: Page) =>
  page.locator('[data-slot="resizable-handle"][aria-controls="files"]');
const filesWidthOf = (page: Page) =>
  filesPanel(page).evaluate((el) => el.getBoundingClientRect().width);

test("a dragged files column keeps its width over a reload", async ({
  seededPage: page,
}) => {
  await expect(filesPanel(page).locator("#root-dir")).toBeVisible();
  const before = await filesWidthOf(page);
  await drag(page, filesHandle(page), 80, 0);
  const widened = await filesWidthOf(page);
  expect(widened).toBeGreaterThan(before + 60);

  await page.reload();
  await expect(filesPanel(page).locator("#root-dir")).toBeVisible();
  await expect
    .poll(async () => Math.abs((await filesWidthOf(page)) - widened))
    .toBeLessThan(4);
});

// The profile chip sits in the navigation's footer at the bottom left of the
// window, so its menu opens upward and is anchored to the chips' row: one
// opening downward, or hung off the chip's right edge, would run off the window
test("the GitHub profile menu opens inside the window, its Sign out on top", async ({
  page,
}) => {
  // Signing in for real needs a live GitHub round trip, so the account
  // endpoints are stubbed, as `account-sync.e2e.spec.ts` does, for an
  // account that holds nothing yet
  await page.route("**/api/auth/get-session", (r) =>
    json(r, { user: { id: "u1", name: "Tester", image: null, login: "t" } })
  );
  await page.route("**/api/sync", (r) => json(r, { enabled: true, db: "ok" }));
  await page.route("**/api/conversations*", (r) => json(r, { items: [] }));
  await page.route("**/api/projects*", (r) =>
    r.request().method() === "PUT"
      ? json(r, { updatedAt: new Date().toISOString() })
      : json(r, { projects: [] })
  );
  await seedWorkspace(page);

  await page
    .locator('[data-slot="sidebar-footer"]')
    .getByRole("button", { name: "GitHub profile: t" })
    .click();
  const menu = page.locator('div[aria-label="GitHub profile"]');
  await expect(menu).toBeVisible();

  const box = await boxOf(menu);
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);

  const signOut = menu.getByRole("button", { name: "Sign out" });
  const onTop = await signOut.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2
    );
    return hit !== null && el.contains(hit);
  });
  expect(onTop).toBe(true);
});
