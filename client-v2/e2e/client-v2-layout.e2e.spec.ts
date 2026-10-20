import type { Page } from "@playwright/test";

import { expect, seedWorkspace, test } from "./fixtures";

/**
 * The telemetry event lines the page logs from now on.
 *
 * The dev server logs each event at `debug` from the `telemetry:event`
 * namespace, as `[telemetry:event] <name> {<params>}`.
 */
const linesOn = (page: Page) => {
  const lines: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (text.startsWith("[telemetry:event]")) lines.push(text);
  });
  return lines;
};

/** Names of the telemetry events the page has logged so far */
const eventsOn = (page: Page) => {
  const lines = linesOn(page);
  return { has: (name: string) => lines.some((l) => l.split(" ")[1] === name) };
};

/** The first event line with this name, params included */
const lineOf = (lines: string[], name: string) =>
  lines.find((line) => line.startsWith(`[telemetry:event] ${name} `));

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
// The separator that resizes the assistant is the one controlling the centre
const assistantHandle = (page: Page) =>
  page.locator('[data-slot="resizable-handle"][aria-controls="center"]');

const consolePanel = (page: Page) => page.locator("#console[data-panel]");
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
  await page.mouse.move(box.x - 120, box.y + box.height / 2, { steps: 8 });
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
  await drag(page, assistantHandle(page), -120, 0);
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
    v: 1,
    open: { left: true, assistant: true, console: true },
    h: { center: 66, assistant: 34 },
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
    v: 1,
    open: { left: true, assistant: true, console: false },
    h: { center: 90, assistant: 10 },
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
  const left = page.locator('[data-slot="sidebar-container"]');
  await expect(left).toHaveJSProperty("offsetWidth", 232);
  await page.keyboard.press("ControlOrMeta+b");
  await expect(left).toHaveJSProperty("offsetWidth", 52);
  await page.reload();
  await expect(left).toHaveJSProperty("offsetWidth", 52);
  await page.keyboard.press("ControlOrMeta+b");
  await expect(left).toHaveJSProperty("offsetWidth", 232);
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
    // The open file's tab, not any text: the closing Sheet's tree also shows
    // the new name until it unmounts, which made a page-wide match ambiguous
    await expect(
      page.getByTestId("stage").getByRole("button", { name: "renamed.rs" })
    ).toBeVisible();
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
  const left = page.locator('[data-slot="sidebar-container"]');
  const measure = async () => ({
    left: await left.evaluate((el) => el.getBoundingClientRect().width),
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

// The header sits above the left panel so its menus can be clicked; the
// wallet window opens at the top right, over the header's bottom edge.
test("the wallet window's close button is clickable over the header", async ({
  seededPage: page,
}) => {
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Toggle wallet" }).waitFor();
  await page
    .getByRole("main")
    .getByRole("button", { name: /Wallet/ })
    .click();

  const wallet = page.locator(".react-draggable");
  await expect(wallet).toBeVisible();
  // The top bar's buttons are, in order, settings and close
  await wallet.getByRole("button").nth(1).click();
  await expect(wallet).toHaveCount(0);
});

// Toasts open at the bottom left, over the left panel. The stock Sidebar's
// container is z-10, so the toast layer must sit above it.
test("a toast opens above the left panel", async ({ seededPage: page }) => {
  await page.evaluate(() =>
    document.dispatchEvent(
      new CustomEvent("viewtoastset", {
        detail: {
          elementable: "div",
          props: { componentProps: { children: "layout e2e toast" } },
        },
      })
    )
  );
  const toast = page.getByText("layout e2e toast");
  await expect(toast).toBeVisible();
  // It slides in from the left; measure where it comes to rest
  await expect
    .poll(async () => (await toast.boundingBox())?.x ?? -1)
    .toBeGreaterThanOrEqual(0);
  const box = (await toast.boundingBox())!;
  const left = (await page
    .locator('[data-slot="sidebar-container"]')
    .boundingBox())!;
  // The toast really is over the left panel, not beside it
  expect(box.x).toBeLessThan(left.x + left.width);
  const onTop = await toast.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2
    );
    return hit !== null && el.contains(hit);
  });
  expect(onTop).toBe(true);
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
  await drag(page, assistantHandle(page), 600, 0);
  await expect.poll(() => widthOf(page)).toBeLessThan(40);
  const line = await onlyLineOf(page, lines, "layout_panel_toggled");
  expect(line).toContain("panel: assistant");
  expect(line).toContain("open: false");
  expect(line).toContain("via: drag");
});

test.describe("a select inside the assistant Sheet", () => {
  test.use({ viewport: { width: 800, height: 1000 } });

  test("opens its options above the Sheet", async ({ seededPage: page }) => {
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
