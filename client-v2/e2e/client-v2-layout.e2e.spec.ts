import type { Page } from "@playwright/test";

import {
  currentProject,
  expect,
  HELP_TAIL,
  home,
  homeRegion,
  json,
  leaveEditor,
  projectRow,
  runInTerminal,
  seedWorkspace,
  stubSignedIn,
  test,
} from "./fixtures";
import { lineOf, linesOn } from "./telemetry";

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

/**
 * Starts Hello Anchor's first lesson on a fresh profile, which opens on Home,
 * from Home's tutorial card
 */
const startTutorial = async (page: Page) => {
  await expect(home(page)).toBeVisible({ timeout: 20_000 });
  await homeRegion(page)
    .getByRole("button", { name: "Open Hello Anchor" })
    .click();
  // `exact`: Connect a model's dialog has a "Start" of its own
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Steps" })).toBeVisible();
};

const assistantPanel = (page: Page) => page.locator("#assistant[data-panel]");
const consoleHandle = (page: Page) =>
  page.getByRole("button", { name: "Terminal" });
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
/** The footer's account row, or the rail's "Account", whatever the session */
const account = (page: Page) =>
  nav(page)
    .locator('[data-slot="sidebar-footer"]')
    .getByRole("button", { name: /^Account/ });
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

test("Widen sizes the assistant to its maximum for the visit, and saves nothing", async ({
  seededPage: page,
}) => {
  await expect(assistantPanel(page)).toBeVisible();
  const before = await widthOf(page);
  const saved = await savedLayout(page);
  await page.getByRole("button", { name: "Widen the assistant" }).click();
  await expect
    .poll(async () => Math.abs((await widthOf(page)) - 560))
    .toBeLessThan(2);
  await page.waitForTimeout(300);
  expect(await savedLayout(page)).toBe(saved);

  await page.getByRole("button", { name: "Narrow the assistant" }).click();
  await expect
    .poll(async () => Math.abs((await widthOf(page)) - before))
    .toBeLessThan(2);

  // Not saved, so a reload opens at the width the assistant had before
  await page.getByRole("button", { name: "Widen the assistant" }).click();
  await expect.poll(() => widthOf(page)).toBeGreaterThan(before + 100);
  await page.reload();
  await expect(assistantPanel(page)).toBeVisible();
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
  await runInTerminal(page, "echo-marker");
  await expect(page.locator(".xterm-rows")).toContainText("echo-marker");

  await consoleHandle(page).click();
  await expect(consoleHandle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".xterm")).toHaveCount(1);

  await consoleHandle(page).click();
  await expect(page.locator(".xterm-rows")).toContainText("echo-marker");
});

// The terminal was a grid item as wide as its own content, so when the stage
// narrowed after it mounted (as it does while the layout settles on load) it
// overhung the console and shrank one scrollbar per throttled fit, 15 fits on
// a load here. On the runner a `help` sent in that window once printed with
// the view left at the top of the buffer (HOO-2370); that xterm step is not
// reproduced, so this guards the overhang, the condition it ran in
test("the terminal never overhangs the console while it opens and runs a command", async ({
  page,
}) => {
  // How far the terminal reaches past the console, every frame from the load
  await page.addInitScript(() => {
    const w = window as unknown as { overhang: number; samples: number };
    w.overhang = 0;
    w.samples = 0;
    const sample = () => {
      const terminal = document.querySelector(".xterm");
      const well = document.querySelector(
        '[data-slot="console-drawer-content"]'
      );
      if (terminal && well) {
        w.samples++;
        w.overhang = Math.max(
          w.overhang,
          terminal.getBoundingClientRect().width -
            well.getBoundingClientRect().width
        );
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await seedWorkspace(page);

  // Typed and sent while the drawer is still opening: no wait for it
  await consoleHandle(page).click();
  await page.getByLabel("Terminal input").first().focus();
  await page.keyboard.type("help");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText(HELP_TAIL);

  const { overhang, samples } = await page.evaluate(() => {
    const w = window as unknown as { overhang: number; samples: number };
    return { overhang: w.overhang, samples: w.samples };
  });
  // A renamed selector would measure nothing and pass
  expect(samples).toBeGreaterThan(0);
  expect(overhang).toBeLessThanOrEqual(0);
});

// React's StrictMode runs an effect twice in dev; opening the terminal on
// both runs printed the welcome twice and left `$ $` as the prompt
test("client-v2-layout: The terminal greets once", async ({
  seededPage: page,
}) => {
  // xterm renders only the rows in view, so the console is made tall enough
  // to hold a doubled greeting: a second copy must be on screen to be counted
  await page.setViewportSize({ width: 1280, height: 1200 });
  await consoleHandle(page).click();
  await expect(consoleHandle(page)).toHaveAttribute("aria-expanded", "true");
  await drag(page, consoleSeparator(page), 0, -600);
  const rows = page.locator(".xterm-rows");
  await expect(rows).toContainText("Type help to see all commands");
  await expect
    .poll(() =>
      page
        .locator(".xterm-viewport")
        .evaluate((el) => el.scrollHeight - el.clientHeight)
    )
    .toBeLessThanOrEqual(0);

  const lines = await rows.evaluate((el) =>
    Array.from(el.children, (row) =>
      (row.textContent ?? "").replace(/\u00a0/g, " ").trimEnd()
    ).filter((line) => line !== "")
  );
  expect(lines.filter((line) => line.includes("Welcome to"))).toHaveLength(1);
  expect(lines.at(-1)).toBe("$");
});

test("client-v2-layout: Folding the project panel", async ({
  seededPage: page,
}) => {
  const files = filesPanel(page);
  await expect(files).toHaveJSProperty("offsetWidth", 240);
  await leaveEditor(page);
  await page.keyboard.press("ControlOrMeta+e");
  // Hidden: the column is out of the layout and takes no width
  await expect(files).toHaveCount(0);
  // The fold is kept over a reload
  await page.reload();
  await expect(files).toHaveCount(0);
  await page.getByRole("button", { name: "Expand project panel" }).click();
  await expect(files).toHaveJSProperty("offsetWidth", 240);
  await expect(files.locator("#root-dir")).toBeVisible();
});

test("client-v2-layout: The files column keeps its tree", async ({
  seededPage: page,
}) => {
  // Short enough that the tree, with its folders open, scrolls
  await page.setViewportSize({ width: 1280, height: 280 });
  const files = filesPanel(page);
  const body = page.locator("#flow-left-tabpanel");
  const folder = (path: string) =>
    page.locator(`#root-dir .folder[data-path="${path}"]`);

  // The current file, selected before a folder click selects that folder
  const current = await page
    .locator("#root-dir .file.selected")
    .getAttribute("data-path");
  expect(current).toBeTruthy();

  // Every folder the current file does not sit in starts closed
  const closed = page.locator("#root-dir .folder:not(.open)");
  await expect(closed.first()).toBeVisible();
  const opened = await closed.evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-path") ?? "")
  );
  expect(opened.length).toBeGreaterThan(0);
  for (const path of opened) await folder(path).click();
  for (const path of opened) await expect(folder(path)).toHaveClass(/\bopen\b/);

  const scrolled = await body.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    return el.scrollTop;
  });
  expect(scrolled).toBeGreaterThan(0);
  const hideAndShow = {
    // The folder clicks above took the focus out of the editor, which keeps
    // ⌘E for itself
    "⌘E": async () => {
      await page.keyboard.press("ControlOrMeta+e");
      await expect(files).toHaveCount(0);
      await page.keyboard.press("ControlOrMeta+e");
    },
    "the stage bar": async () => {
      await page
        .getByRole("button", { name: "Collapse project panel" })
        .click();
      await expect(files).toHaveCount(0);
      await page.getByRole("button", { name: "Expand project panel" }).click();
    },
  };
  for (const [via, toggle] of Object.entries(hideAndShow)) {
    await test.step(via, async () => {
      await toggle();
      await expect(files.locator("#root-dir")).toBeVisible();
      for (const path of opened) {
        await expect(folder(path)).toHaveClass(/\bopen\b/);
      }
      await expect(
        page.locator(`#root-dir [data-path="${current}"]`)
      ).toHaveClass(/\bselected\b/);
      await expect
        .poll(() => body.evaluate((el) => el.scrollTop))
        .toBe(scrolled);
    });
  }
});

test("client-v2-layout: A lesson's column keeps its tab", async ({ page }) => {
  // Opening a tutorial boots the dev server's tutorial chunk and imports it
  test.setTimeout(120_000);
  await page.goto("/");
  await startTutorial(page);

  const filesTab = page.getByRole("radio", { name: "Files" });
  await filesTab.click();
  await expect(filesTab).toHaveAttribute("aria-checked", "true");

  await page.getByRole("button", { name: "Collapse project panel" }).click();
  await expect(filesPanel(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Expand project panel" }).click();

  await expect(page.getByRole("radio", { name: "Files" })).toHaveAttribute(
    "aria-checked",
    "true"
  );
});

test("client-v2-layout: Folding the navigation", async ({
  seededPage: page,
}) => {
  const column = navColumn(page);
  await expect(column).toHaveJSProperty("offsetWidth", 232);
  await page.keyboard.press("ControlOrMeta+b");
  await expect(column).toHaveJSProperty("offsetWidth", 52);
  // A rail of icons: the items stay, the project list and the session footer
  // give way to the cluster's dot and the account
  await expect(
    nav(page).getByRole("button", { name: "Expand navigation" })
  ).toBeVisible();
  for (const item of ["Home", "New project", "Tutorials", "Programs"]) {
    await expect(nav(page).getByRole("button", { name: item })).toBeVisible();
  }
  await expect(nav(page).getByRole("group", { name: "Projects" })).toHaveCount(
    0
  );
  await expect(
    nav(page).getByRole("button", { name: /^Change cluster/ })
  ).toHaveCount(0);
  await expect(
    nav(page).getByRole("button", { name: /^Cluster: / })
  ).toBeVisible();
  await expect(account(page)).toBeVisible();
  await page.keyboard.press("ControlOrMeta+b");
  await expect(column).toHaveJSProperty("offsetWidth", 232);
  await expect(
    nav(page).getByRole("button", { name: "Collapse navigation" })
  ).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  // The seed runs on a desktop-sized page, as the fixture waits on the tree
  // a phone keeps in a closed Sheet; the window is narrowed afterwards
  const seedThenNarrow = async (page: Page) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await seedWorkspace(page);
    await page.setViewportSize({ width: 390, height: 844 });
  };

  test("the account is a page of its own on a phone", async ({ page }) => {
    await seedThenNarrow(page);
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    // A tap: the page opens over the row, and the release lands on its foot
    await page.getByRole("button", { name: "Account, signed out" }).click();
    const account = page.getByRole("menu", { name: "Account" });
    await expect(account).toBeVisible();
    // Once its opening animation has settled
    await expect
      .poll(() => account.boundingBox())
      .toEqual({ x: 0, y: 0, width: 390, height: 844 });
    await expect(
      account.getByRole("menuitem", { name: "Sign in with GitHub" })
    ).toBeInViewport();
    await account.getByRole("menuitem", { name: "Close" }).click();
    await expect(account).toHaveCount(0);
    // The release that opened it was no pick: no sign-in started
    await expect(
      page.getByRole("button", { name: "Account, signed out" })
    ).toBeVisible();
  });

  test("client-v2-layout: A phone", async ({ page }) => {
    await seedThenNarrow(page);
    const lines = page.locator(".monaco-editor .view-lines");
    await expect(lines).toContainText("use anchor_lang");
    await page.locator(".monaco-editor textarea.inputarea").focus();
    await page.keyboard.press("ControlOrMeta+Home");
    await page.keyboard.type("// phone\n");
    await expect(lines).toContainText("// phone");

    await page.getByRole("button", { name: /^Files, .* open$/ }).click();
    const files = page.getByRole("dialog", { name: "Files" });
    await files.getByRole("button", { name: "client", exact: true }).click();
    await files.getByRole("button", { name: "client.ts" }).click();
    await expect(
      page.getByRole("button", { name: "Files, client.ts open" })
    ).toBeVisible();
    await expect(files).toHaveCount(0);

    await page.getByRole("button", { name: "Preview the build" }).click();
    await expect(page.locator("#flow-stage-panel-build")).toBeInViewport();
    await expect(consoleHandle(page)).toBeInViewport();
    await page.getByRole("button", { name: "Back to the code" }).click();
    await expect(page.locator(".monaco-editor")).toBeInViewport();

    await page.getByRole("button", { name: "Menu", exact: true }).click();
    const menu = page.getByRole("region", { name: "Navigation" });
    await expect(menu).toBeInViewport();
    await page.getByRole("button", { name: "Close the menu" }).click();
    await expect(page.getByRole("region", { name: "Work" })).toBeInViewport();
    await page.getByRole("radio", { name: "Chat" }).click();
    // The composer is there and takes typing with nothing connected
    const composer = page.getByRole("textbox", {
      name: "Message the assistant",
    });
    await composer.fill("hello");
    await expect(composer).toHaveValue("hello");
  });

  test("client-v2-layout: Turning a phone across 768 px", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await seedWorkspace(page);
    // The editor focuses itself when it opens the first file; landing after
    // the click below, it would take the typed command away from the terminal
    await expect(
      page.locator(".monaco-editor textarea.inputarea")
    ).toBeFocused();
    if ((await consoleHandle(page).getAttribute("aria-expanded")) !== "true") {
      await consoleHandle(page).click();
    }
    await runInTerminal(page, "help");
    await expect(page.locator(".xterm-rows").first()).toContainText(HELP_TAIL);

    const lines = page.locator(".monaco-editor .view-lines");
    await expect(lines).toContainText("use anchor_lang");
    await page.locator(".monaco-editor textarea.inputarea").focus();
    await page.keyboard.press("ControlOrMeta+Home");
    await page.keyboard.type("// across\n");
    await expect(lines).toContainText("// across");
    const before = await savedLayout(page);

    for (const width of [390, 767, 768, 1024, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await expect(lines).toContainText("// across");
    }
    await expect(page.locator(".xterm-rows").first()).toContainText(HELP_TAIL);
    expect(await savedLayout(page)).toBe(before);
  });

  test("client-v2-layout: Settings on a phone", async ({ page }) => {
    await seedThenNarrow(page);
    // The editor focuses itself when it opens the first file; landing after
    // the menu opened, it would take focus from the settings
    await expect(
      page.locator(".monaco-editor textarea.inputarea")
    ).toBeFocused();
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page
      .getByRole("region", { name: "Navigation" })
      .getByRole("button", { name: /^Change cluster/ })
      .click();

    const settings = page.getByRole("region", { name: "Settings" });
    const network = settings.getByRole("radiogroup", { name: "Network" });
    await expect(network.getByRole("radio", { checked: true })).toBeFocused();
    await network.getByRole("radio", { name: "Localnet" }).click();
    await expect(
      network.getByRole("radio", { name: "Localnet" })
    ).toHaveAttribute("aria-checked", "true");
    await network.getByRole("radio", { name: "Devnet", exact: true }).click();
    await expect(
      network.getByRole("radio", { name: "Devnet", exact: true })
    ).toHaveAttribute("aria-checked", "true");
  });

  // The cluster row that opened them is on the menu page, inert once Work
  // shows, so focus goes to the control that opens the navigation instead
  test("client-v2-layout: Closing the settings on a phone", async ({
    page,
  }) => {
    await seedThenNarrow(page);
    await expect(
      page.locator(".monaco-editor textarea.inputarea")
    ).toBeFocused();
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page
      .getByRole("region", { name: "Navigation" })
      .getByRole("button", { name: /^Change cluster/ })
      .click();
    const settings = page.getByRole("region", { name: "Settings" });
    await expect(settings).toBeVisible();

    await settings.getByRole("button", { name: "Back to app" }).click();

    await expect(
      page.getByRole("button", { name: "Menu", exact: true })
    ).toBeFocused();
  });

  // A swipe made while the editor loads stays. Opening its file must not
  // focus the editor while it is swiped out of the window, and its tab row
  // must scroll only itself: either would scroll the pager back to the work
  // page. The touch stays down until the editor is in, so the pager has not
  // settled when the editor mounts.
  test("a swipe made while the editor loads stays on the preview", async ({
    page,
  }) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    // The editor's chunk (webpack's name for it), held so it mounts under the
    // swipe; a name that stopped matching would hold nothing and pass for the
    // wrong reason
    let heldChunk = false;
    await page.route(/src_components_Editor_Monaco_index_ts/, async (route) => {
      heldChunk = true;
      await held;
      await route.continue();
    });
    await seedThenNarrow(page);
    const pager = page.getByTestId("phone-pager");
    await expect(page.getByRole("region", { name: "Work" })).toBeInViewport();
    await pager.evaluate((el) => {
      el.dispatchEvent(new TouchEvent("touchstart"));
      el.scrollTo({ left: el.clientWidth * 2, behavior: "instant" });
    });
    const preview = page.getByRole("region", { name: "Preview" });
    await expect(preview).toBeInViewport({ ratio: 1 });

    await expect.poll(() => heldChunk).toBe(true);
    release();
    await expect(page.locator(".monaco-editor .view-lines")).toContainText(
      "use anchor_lang"
    );
    await pager.evaluate((el) => el.dispatchEvent(new TouchEvent("touchend")));

    await expect(page.locator("#flow-stage-panel-build")).toBeInViewport();
    await expect(preview).toBeInViewport({ ratio: 1 });
  });

  // The gallery is a dialog over the menu page; the project it starts opens
  // on Work, not behind the menu that started it
  test("client-v2-layout: A project started from the phone's menu", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await seedWorkspace(page);
    for (const width of [393, 740]) {
      await page.setViewportSize({ width, height: 852 });
      await page.getByRole("button", { name: "Menu", exact: true }).click();
      await page
        .getByRole("region", { name: "Navigation" })
        .getByRole("button", { name: "New project", exact: true })
        .click();
      const gallery = page.getByRole("dialog");
      await gallery.getByLabel("Project name").fill(`from-the-menu-${width}`);
      await gallery.getByRole("button", { name: /^Start/ }).click();

      await expect(gallery).toHaveCount(0);
      // Whole, once the pager's scroll has settled on it
      await expect(page.getByRole("region", { name: "Work" })).toBeInViewport({
        ratio: 1,
      });
      // No tab row: the code's head names the open file
      await expect(page.locator("#tabs")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: /^Files, .+ open$/ })
      ).toBeVisible();
    }
  });

  test("client-v2-layout: Swiping between pages on a phone", async ({
    page,
  }) => {
    await seedThenNarrow(page);
    const lines = linesOn(page);
    // Over the work page's bar, which no editor or terminal takes a wheel from
    const bar = page
      .getByRole("region", { name: "Work" })
      .getByTestId("phone-bar");
    const box = (await bar.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(390, 0);
    await expect(page.locator("#flow-stage-panel-build")).toBeInViewport();
    await expect
      .poll(() => lineOf(lines, "layout_page_shown"))
      .toContain("via: swipe");
    // Settled once: the stage this page sets does not send a second move
    await page.waitForTimeout(400);
    const shown = lines.filter((line) =>
      line.startsWith("[telemetry:event] layout_page_shown ")
    );
    expect(shown).toHaveLength(1);
    expect(shown[0]).toContain("page: preview");
  });

  test("client-v2-layout: Opening the preview on a phone", async ({ page }) => {
    await seedThenNarrow(page);
    const lines = linesOn(page);
    await page.getByRole("button", { name: "Preview the build" }).click();
    await expect
      .poll(() =>
        lines.find(
          (line) =>
            line.startsWith("[telemetry:event] layout_page_shown ") &&
            line.includes("page: preview")
        )
      )
      .toContain("via: button");
    // Build, Deploy and Interact in full; Write is the code's own page
    const preview = page.getByRole("region", { name: "Preview" });
    await expect(preview.getByRole("tab")).toHaveCount(3);
    await expect(preview.locator("#flow-stage-tab-write")).toHaveCount(0);
    await expect(preview.getByRole("tablist")).toHaveAttribute(
      "data-compact",
      "false"
    );
  });
});

// Below 768 px the phone's pager holds the navigation on its menu page, apart
// from the files, as on the prototype's phone; there is no left Sheet whose
// files column could take the navigation's height (HOO-2208)
test("client-v2-layout: The navigation on a narrow window", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await seedWorkspace(page);
  // The editor focuses itself when it opens the first file; landing after
  // the menu opened, it would bring Work back
  await expect(page.locator(".monaco-editor textarea.inputarea")).toBeFocused();
  const navigation = page.getByRole("region", { name: "Navigation" });
  for (const width of [720, 740, 767]) {
    await page.setViewportSize({ width, height: 812 });
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    for (const name of ["Home", "New project", "Tutorials", "Programs"]) {
      await expect(
        navigation.getByRole("button", { name, exact: true })
      ).toBeInViewport({ ratio: 1 });
    }
    await expect(projectRow(page, "e2e-project")).toBeInViewport();
    await expect(
      navigation.getByRole("button", { name: /^Get set up/ })
    ).toBeInViewport();
    if (width === 767) break;
    await page.getByRole("button", { name: "Close the menu" }).click();
  }

  await navigation
    .getByRole("button", { name: "Tutorials", exact: true })
    .click();
  await expect(
    page.getByRole("searchbox", { name: "Search tutorials" })
  ).toBeVisible();
});

// The key has no way of its own to leave the menu page, so it takes the one
// the navigation handed over, and the settings show over Work
test("⌘, opens the settings from the phone's menu page", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await seedWorkspace(page);
  await page.setViewportSize({ width: 740, height: 812 });
  await expect(page.locator(".monaco-editor textarea.inputarea")).toBeFocused();
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Navigation" })
  ).toBeInViewport();

  await page.keyboard.press("ControlOrMeta+Comma");

  await expect(page.getByRole("region", { name: "Settings" })).toBeVisible();
});

// Focus goes back to a settings trigger only after the settings close; a page
// that never opened them leaves focus where the browser puts it (HOO-2240)
test("client-v2-layout: A fresh load focuses no settings trigger", async ({
  page,
}) => {
  for (const width of [1440, 834]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(home(page)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("[data-settings-trigger]").first()).toBeVisible();
    // Long enough for an effect that runs after the first render to land
    await page.waitForTimeout(500);
    expect(
      await page.evaluate(
        () => document.activeElement?.closest("[data-settings-trigger]") != null
      )
    ).toBe(false);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  }
});

test.describe("on a compact window", () => {
  test.use({ viewport: { width: 800, height: 1000 } });

  test("the assistant Sheet keeps 21.75 rem", async ({ seededPage: page }) => {
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
  // Connected from the account menu; the account row then shows the wallet
  await account(page).click();
  await page.getByRole("menuitem", { name: "Connect wallet" }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(account(page)).toContainText("SOL");
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

  test("reports phone at 740 px", async ({ page }) => {
    expect(await widthClassAt(page, 740)).toContain("viewport: phone");
  });

  test("reports phone at 390 px", async ({ page }) => {
    expect(await widthClassAt(page, 390)).toContain("viewport: phone");
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
    // Connect a model opens from the head's More, as a dialog over the Sheet
    await sheet.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: /Connect a model/ }).click();
    const dialog = page.getByRole("dialog", { name: "Connect a model" });
    await dialog.getByRole("combobox", { name: "Model" }).click();
    const option = page.getByRole("option").first();
    await expect(option).toBeVisible();
    // The model by name, as the prototype writes it (R39)
    await expect(option).toContainText("Opus");
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
  await expect(filesPanel(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Expand project panel" })
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
  const current = currentProject(page);
  await expect(current).toHaveText("e2e-project");

  // A second project, so there is one to switch back to
  await nav(page).getByRole("button", { name: "New project" }).click();
  const gallery = page.locator("[data-gallery-modal]");
  await expect(gallery).toBeVisible();
  await gallery.getByLabel("Project name").fill("second");
  await gallery.getByRole("button", { name: /^Start/ }).click();
  await expect(gallery).toBeHidden();
  await expect(current).toHaveText("second");

  // The project list, in the navigation
  await projectRow(page, "e2e-project").click();
  await expect(current).toHaveText("e2e-project");
  await expect(page.locator("#root-dir")).toBeVisible();

  // The settings, from the navigation's footer, through the account menu
  await account(page).click();
  await page.getByRole("menuitem", { name: /^Settings/ }).click();
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
    // The page covers the rail, so "Back to app" is the way out
    await settings.getByRole("button", { name: "Back to app" }).click();
    await expect(settings).toBeHidden();

    // "Account" opens the account menu beside the rail; the rail stays.
    // Measured first: the open menu hides the rest from the accessibility tree
    const trigger = await boxOf(account(page));
    await account(page).click();
    const menu = page.getByRole("menu", { name: "Account" });
    await expect(menu).toBeVisible();
    await expect(navColumn(page)).toHaveJSProperty("offsetWidth", 52);
    // Beside the rail's Account, not over it
    expect((await boxOf(menu)).x).toBeGreaterThanOrEqual(
      trigger.x + trigger.width
    );
  });
});

test("client-v2-layout: Programs from the navigation", async ({
  seededPage: page,
}) => {
  const lines = linesOn(page);
  const item = nav(page).getByRole("button", { name: "Programs" });
  await item.click();
  await expect(
    page.getByRole("searchbox", { name: "Search programs" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Open / }).first()
  ).toBeVisible();
  await expect(item).toHaveAttribute("data-active", "true");
  await expect(page.locator("[data-gallery-modal]")).toHaveCount(0);
  expect(await onlyLineOf(page, lines, "catalog_shown")).toContain("via: nav");
});

test("client-v2-layout: Picking Tutorials", async ({ seededPage: page }) => {
  const lines = linesOn(page);
  await nav(page).getByRole("button", { name: "Tutorials" }).click();
  await expect(
    page.getByRole("searchbox", { name: "Search tutorials" })
  ).toBeVisible();
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

// The account row sits in the navigation's footer at the bottom left of the
// window, so its menu opens upward: one opening downward would run off the
// window
test("the account menu opens inside the window, its Sign out on top", async ({
  page,
}) => {
  await stubSignedIn(page.context());
  await seedWorkspace(page);

  await account(page).click();
  const menu = page.getByRole("menu", { name: "Account" });
  await expect(menu).toBeVisible();

  const box = await boxOf(menu);
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);

  const signOut = menu.getByRole("menuitem", { name: "Sign out" });
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

/** The top edge and height of an element, in px */
const barOf = async (locator: ReturnType<Page["locator"]>) => {
  const box = (await locator.boundingBox())!;
  return { y: Math.round(box.y), height: Math.round(box.height) };
};

test("client-v2-layout: The frame at 1440", async ({ seededPage: page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // Flush: the navigation starts at the window's edge, the bars at its top
  await expect
    .poll(async () => (await navColumn(page).boundingBox())!.x)
    .toBe(0);
  const head = assistantPanel(page)
    .getByRole("heading", { level: 2 })
    .locator("..");
  const stageBar = page.locator('[data-slot="stage-bar"]');
  await expect.poll(() => barOf(head)).toEqual({ y: 0, height: 44 });
  await expect.poll(() => barOf(stageBar)).toEqual({ y: 0, height: 44 });
  // The stage tabs span the files column and the stage together
  const tabs = (await page
    .locator('[data-slot="stepper-list"]')
    .boundingBox())!;
  const work = (await page.locator("#work[data-panel]").boundingBox())!;
  expect(tabs.width).toBeGreaterThan(work.width - 20);
  // The prototype's widths: nav 232, assistant 368, files 240
  expect(Math.round((await navColumn(page).boundingBox())!.width)).toBe(232);
  expect(Math.round(await widthOf(page))).toBe(368);
  await expect(filesPanel(page)).toHaveJSProperty("offsetWidth", 240);
  // One background, separated by 1 px lines: no gutter between the columns
  const assistant = (await assistantPanel(page).boundingBox())!;
  const handle = (await assistantHandle(page).boundingBox())!;
  expect(Math.round(handle.width)).toBe(1);
  expect(Math.round(work.x - (assistant.x + assistant.width))).toBe(1);
});

test("client-v2-layout: Hiding the assistant from the stage bar", async ({
  seededPage: page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const before = await widthOf(page);
  const stageBar = page.locator('[data-slot="stage-bar"]');
  await expect(stageBar).not.toContainText("e2e-project");
  await page.getByRole("button", { name: "Hide the assistant" }).click();
  await expect.poll(() => widthOf(page)).toBe(0);
  // The project's name moves into the stage bar while the assistant is hidden
  await expect(stageBar).toContainText("e2e-project");
  await page.getByRole("button", { name: "Expand assistant" }).click();
  await expect
    .poll(async () => Math.abs((await widthOf(page)) - before))
    .toBeLessThanOrEqual(2);
});

test("client-v2-layout: A layout saved before the column bars", async ({
  seededPage: page,
}) => {
  // As the flush frame's predecessor wrote it: files folded, the assistant
  // dragged to 30% of the row
  await page.evaluate(() =>
    localStorage.setItem(
      "layout",
      JSON.stringify({
        v: 2,
        open: { nav: true, files: false, assistant: true, console: false },
        h: { assistant: 30, work: 70 },
      })
    )
  );
  await page.reload();
  await expect(filesPanel(page)).toHaveCount(0);
  const row = (await page
    .locator('[data-slot="sidebar-inset"]')
    .boundingBox())!;
  await expect
    .poll(async () => Math.abs((await widthOf(page)) / row.width - 0.3))
    .toBeLessThan(0.02);
});

test("client-v2-layout: Widening the assistant", async ({
  seededPage: page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const lines = linesOn(page);
  await page.getByRole("button", { name: "Widen the assistant" }).click();
  await expect(
    page.getByRole("button", { name: "Narrow the assistant" })
  ).toBeVisible();
  const line = await onlyLineOf(page, lines, "layout_assistant_widened");
  expect(line).toContain("wide: true");
});

// A hidden files column takes no width, so a handle of its own would sit 1 px
// from the assistant's, and the library takes every separator within reach of
// the pointer: one drag resized both. Hidden, the column has no handle; the
// stage bar and ⌘E bring it back, and a drag there moves the assistant alone.
test("dragging at a hidden files column's edge moves only the assistant", async ({
  seededPage: page,
}) => {
  await page.getByRole("button", { name: "Collapse project panel" }).click();
  await expect(filesPanel(page)).toHaveCount(0);
  await expect(filesHandle(page)).toHaveCount(0);
  const before = await widthOf(page);
  await drag(page, assistantHandle(page), 200, 0);
  await expect.poll(() => widthOf(page)).toBeGreaterThan(before + 100);
  await expect(filesPanel(page)).toHaveCount(0);
});

// Widen keeps the size the panel had, and hiding ends the widening: shown
// again, the assistant is back at that size, not at its maximum
test("a widened assistant, hidden and shown, opens at the width it had before", async ({
  seededPage: page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const before = await widthOf(page);
  await page.getByRole("button", { name: "Widen the assistant" }).click();
  await expect.poll(() => widthOf(page)).toBeGreaterThan(before + 100);
  await page.getByRole("button", { name: "Hide the assistant" }).click();
  await expect.poll(() => widthOf(page)).toBe(0);
  await page.getByRole("button", { name: "Expand assistant" }).click();
  await expect
    .poll(async () => Math.abs((await widthOf(page)) - before))
    .toBeLessThanOrEqual(2);
});

test("client-v2-layout: Signing in from the account menu", async ({
  seededPage: page,
}) => {
  // The sign-in request is held, so the wait can be seen, then fails
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/auth/sign-in/social", async (route) => {
    await held;
    await route.fulfill({ status: 500, body: "" });
  });
  await account(page).click();
  await page.getByRole("menuitem", { name: "Sign in with GitHub" }).click();

  const footer = nav(page).locator('[data-slot="sidebar-footer"]');
  await expect(footer.getByText("Signing in...")).toBeVisible();
  await expect(footer.getByRole("button", { name: "Cancel" })).toBeVisible();
  release();
  await expect(account(page)).toContainText("Sign in");
  await expect(account(page)).toContainText("Couldn't sign in");
});

test("client-v2-layout: Signing out asks first", async ({ page }) => {
  await stubSignedIn(page.context());
  await seedWorkspace(page);
  let signedOut = false;
  await page.route("**/api/auth/sign-out", (route) => {
    signedOut = true;
    return json(route, { success: true });
  });
  await expect(account(page)).toHaveAccessibleName("Account: t");

  await account(page).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  const dialog = page.getByRole("dialog", { name: "Sign out of Playground?" });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  expect(signedOut).toBe(false);
  await expect(account(page)).toHaveAccessibleName("Account: t");

  await account(page).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await dialog.getByRole("button", { name: "Sign out" }).click();
  await expect(account(page)).toHaveAccessibleName("Account, signed out");
  expect(signedOut).toBe(true);
});

test("client-v2-layout: Settings from the menu and by key", async ({
  seededPage: page,
}) => {
  const settings = page.getByRole("region", { name: "Settings" });
  await account(page).click();
  await page.getByRole("menuitem", { name: /^Settings/ }).click();
  await expect(settings).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
  // The menu item is gone with its menu: focus goes back to its trigger
  await expect(account(page)).toBeFocused();

  // From inside the editor too, which binds keys of its own
  await page.locator(".monaco-editor .view-lines").first().click();
  await page.keyboard.press("ControlOrMeta+Comma");
  await expect(settings).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Comma");
  await expect(settings).toBeHidden();
});

test("client-v2-layout: The wallet in the menu", async ({
  seededPage: page,
}) => {
  await account(page).click();
  await page.getByRole("menuitem", { name: "Connect wallet" }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  await expect(account(page)).toContainText(/\w{4}…\w{4} · /);
  await account(page).click();
  await expect(
    page.getByRole("menuitem", { name: "Disconnect wallet" })
  ).toBeVisible();
});

test("client-v2-layout: A cluster that is down", async ({
  seededPage: page,
}) => {
  // A cluster is down when its slot does not move between two reads a second
  // apart (`PgConnection.getIsClusterDown`), so every `getSlot` answers the
  // same slot; anything else goes to the cluster as usual
  await page.route("https://api.devnet.solana.com/**", async (route) => {
    const body = route.request().postDataJSON() as {
      id?: unknown;
      method?: string;
    } | null;
    if (body?.method !== "getSlot") return route.continue();
    return json(route, { jsonrpc: "2.0", result: 123, id: body.id });
  });
  await page.reload();

  const row = nav(page).getByRole("button", {
    name: "Change cluster, currently devnet, down",
  });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await account(page).click();
  const first = page
    .getByRole("menu", { name: "Account" })
    .getByRole("menuitem")
    .first();
  await expect(first).toContainText("devnet is not answering");
  await first.click();
  const network = page
    .getByRole("region", { name: "Settings" })
    .getByRole("radiogroup", { name: "Network" });
  await expect(network.getByRole("radio", { checked: true })).toBeFocused();
});

/** Every HTTP request to the cluster fails the way a stopped validator does */
const refuseCluster = (page: Page, url = "https://api.devnet.solana.com") =>
  page.route(`${url}/**`, (route) => route.abort("connectionrefused"));

/** Reloads on the endpoint picked in Settings, by its option name */
const reloadOn = async (page: Page, option: string) => {
  await page.evaluate((picked) => {
    const settings = JSON.parse(localStorage.getItem("settings") ?? "{}");
    settings.connection.endpoint = { option: picked };
    localStorage.setItem("settings", JSON.stringify(settings));
  }, option);
  await page.reload();
};

const clusterRow = (page: Page) =>
  nav(page).getByRole("button", { name: /^Change cluster/ });

/** Creates the wallet from the account's menu, without waiting on its label */
const createWallet = async (page: Page) => {
  await account(page).click();
  await page.getByRole("menuitem", { name: "Connect wallet" }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
};

const connectWallet = async (page: Page) => {
  await createWallet(page);
  await expect(account(page)).toContainText(/\w{4}…\w{4}/);
};

// An unreachable cluster leaves `PgConnection.isClusterDown` at `null`, not
// `true`: the dot reads whether the cluster answers at all, not only whether
// its slot moves
test("a cluster that does not answer is down", async ({ seededPage: page }) => {
  await refuseCluster(page);
  await page.reload();

  await expect(
    nav(page).getByRole("button", {
      name: "Change cluster, currently devnet, down",
    })
  ).toBeVisible({ timeout: 15_000 });
});

// The dot follows the cluster back: a stalled slot is read again while it
// stays stalled (5 s, then longer), an unreachable cluster is polled (10 s)
test("a stalled cluster that moves again is not down", async ({
  seededPage: page,
}) => {
  let moving = false;
  let slot = 123;
  await page.route("https://api.devnet.solana.com/**", async (route) => {
    const body = route.request().postDataJSON() as {
      id?: unknown;
      method?: string;
    } | null;
    if (body?.method !== "getSlot") return route.continue();
    if (moving) slot += 10;
    return json(route, { jsonrpc: "2.0", result: slot, id: body.id });
  });
  await page.reload();
  await expect(clusterRow(page)).toHaveAccessibleName(
    "Change cluster, currently devnet, down",
    { timeout: 15_000 }
  );

  moving = true;
  await expect(clusterRow(page)).toHaveAccessibleName(
    "Change cluster, currently devnet",
    { timeout: 20_000 }
  );
});

test("a cluster that answers again is not down", async ({
  seededPage: page,
}) => {
  await refuseCluster(page);
  await page.reload();
  await expect(clusterRow(page)).toHaveAccessibleName(
    "Change cluster, currently devnet, down",
    { timeout: 15_000 }
  );

  await page.unrouteAll();
  await expect(clusterRow(page)).toHaveAccessibleName(
    "Change cluster, currently devnet",
    { timeout: 20_000 }
  );
});

test("the wallet names the endpoint that does not answer", async ({
  seededPage: page,
}) => {
  await refuseCluster(page);
  await page.reload();
  await connectWallet(page);

  await page.locator("#tabs").getByRole("button", { name: "Wallet" }).click();
  await expect(
    page.getByText(
      "Can't reach the RPC endpoint at https://api.devnet.solana.com."
    )
  ).toBeVisible({ timeout: 15_000 });
});

test("the wallet asks about the validator when localnet does not answer", async ({
  seededPage: page,
}) => {
  await refuseCluster(page, "http://localhost:8899");
  await reloadOn(page, "localnet");
  // A wallet starts the check that opens localnet's how-to-connect dialog,
  // and the open dialog hides the page from role queries: the account's
  // label is read once it is closed, never in a race with it
  await createWallet(page);
  const howTo = page.getByRole("dialog", { name: "Connect to localnet" });
  await expect(howTo).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(howTo).toBeHidden();
  await expect(account(page)).toContainText(/\w{4}…\w{4}/);

  await page.locator("#tabs").getByRole("button", { name: "Wallet" }).click();
  await expect(
    page.getByText(
      "Can't reach the RPC endpoint at http://localhost:8899. Is the local validator running?",
      { exact: true }
    )
  ).toBeVisible({ timeout: 15_000 });
});

// Playnet answers only once it has started in the page; a check made before
// that must be made again then, not 10 s later
test("playnet is not down while it starts", async ({ seededPage: page }) => {
  await reloadOn(page, "playnet");
  await expect(clusterRow(page)).toBeVisible({ timeout: 15_000 });
  // Read without retrying: a label that is down for a while and then
  // recovers must fail here, not be waited out
  for (let i = 0; i < 12; i++) {
    expect(await clusterRow(page).getAttribute("aria-label")).toBe(
      "Change cluster, currently playnet"
    );
    await page.waitForTimeout(500);
  }
});

// The tab row's Wallet button carries a 400 px picture; the design system's
// Button sizes only an `svg`, so the picture is sized where it is used
test("the tab row keeps its height with a wallet connected", async ({
  seededPage: page,
}) => {
  await connectWallet(page);

  const row = page.locator("#tabs");
  const icon = row.getByRole("button", { name: "Wallet" }).locator("img");
  await expect(icon).toBeVisible();
  expect((await icon.boundingBox())?.height).toBeLessThanOrEqual(16);
  // The row is 40 px tall (`h-10`), plus its bottom border's rounding
  expect((await row.boundingBox())?.height).toBeLessThanOrEqual(41);
  await expect(row.getByRole("tab").first()).toBeInViewport({ ratio: 1 });
});

// The sign-in lives in the session, not in the footer, so the rail, which
// swaps the full footer for its own, can fold and unfold around it
test("a sign-in outlives the rail folding on a narrow window", async ({
  page,
}) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/auth/sign-in/social", async (route) => {
    await held;
    await route.fulfill({ status: 500, body: "" });
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await seedWorkspace(page);
  await page.setViewportSize({ width: 800, height: 812 });
  await expect(page.locator(".monaco-editor textarea.inputarea")).toBeFocused();
  const navigation = page.locator('[data-slot="sidebar"]');
  const account = navigation.getByRole("button", { name: /^Account/ });

  await page.getByRole("button", { name: "Expand navigation" }).click();
  await account.click();
  await page.getByRole("menuitem", { name: "Sign in with GitHub" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Collapse navigation" }).click();

  await page.getByRole("button", { name: "Expand navigation" }).click();
  await expect(navigation.getByText("Signing in...")).toBeVisible();
  await expect(
    navigation.getByRole("button", { name: "Cancel" })
  ).toBeVisible();
  release();
  await expect(account).toContainText("Couldn't sign in");
});

// The scenarios of "Settings are a page of their own" and "The settings page
// is measured"
const settingsPage = (page: Page) =>
  page.getByRole("region", { name: "Settings" });
const sectionList = (page: Page) =>
  settingsPage(page).getByRole("navigation", { name: "Settings sections" });
const SECTIONS = [
  "Network",
  "Project",
  "Block Explorer",
  "Build",
  "Connection",
  "Editor",
  "Notification",
  "Server",
  "Test UI",
  "UI",
  "Wallet",
  "Experimental",
];

test.describe("the settings page", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("client-v2-layout: A wide window's settings page", async ({
    seededPage: page,
  }) => {
    await page.locator("[data-settings-trigger]").first().click();
    const list = sectionList(page);
    await expect(list.getByRole("button")).toHaveText(SECTIONS);

    // Each setting's control carries its own name: two of one name ("Endpoint"
    // twice, once) cannot be told apart by a screen reader or a test
    const names = await settingsPage(page)
      .locator('[role="combobox"], [role="checkbox"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
    expect(names.length).toBeGreaterThan(5);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);

    const editor = list.getByRole("button", { name: "Editor", exact: true });
    await editor.click();
    await expect(
      settingsPage(page).getByRole("heading", { level: 2, name: "Editor" })
    ).toBeInViewport();
    await expect(editor).toHaveAttribute("aria-current", "true");

    // The last section cannot scroll to the top, and still takes the mark
    const last = list.getByRole("button", { name: "Experimental" });
    await last.click();
    await expect(last).toHaveAttribute("aria-current", "true");
  });

  test("client-v2-layout: Back to the app keeps the work", async ({
    seededPage: page,
  }) => {
    const firstLine = page.locator(".monaco-editor .view-line").first();
    const before = await firstLine.textContent();
    const layout = await savedLayout(page);
    const row = nav(page).getByRole("button", { name: /^Change cluster/ });

    await row.click();
    await expect(settingsPage(page)).toBeVisible();
    await settingsPage(page)
      .getByRole("button", { name: "Back to app" })
      .click();

    await expect(settingsPage(page)).toHaveCount(0);
    await expect(firstLine).toHaveText(before ?? "");
    await expect(row).toBeFocused();
    // Hiding the shell folded no panel and wrote no layout
    expect(await savedLayout(page)).toBe(layout);
  });

  test("client-v2-layout: Opening and closing the settings is counted", async ({
    seededPage: page,
  }) => {
    const lines = linesOn(page);
    await page.keyboard.press("ControlOrMeta+Comma");
    await expect(settingsPage(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(settingsPage(page)).toHaveCount(0);

    await expect
      .poll(() => lineOf(lines, "settings_opened"))
      .toContain("from: key");
    await expect
      .poll(() => lineOf(lines, "settings_closed"))
      .toContain("via: escape");

    // A pick in the list, then "Back to app"
    await page.keyboard.press("ControlOrMeta+Comma");
    await sectionList(page)
      .getByRole("button", { name: "Editor", exact: true })
      .click();
    await settingsPage(page)
      .getByRole("button", { name: "Back to app" })
      .click();
    await expect
      .poll(() => lineOf(lines, "settings_section_picked"))
      .toContain("section: editor");
    await expect
      .poll(() => lines.filter((l) => l.includes("settings_closed")).at(-1))
      .toContain("via: back");
  });

  test("client-v2-layout: A menu open at ⌘, closes as the settings open", async ({
    seededPage: page,
  }) => {
    // The menu portals to `body`, outside the shell the page hides
    await account(page).click();
    const menu = page.getByRole("menu", { name: "Account" });
    await expect(menu).toBeVisible();
    await page.keyboard.press("ControlOrMeta+Comma");
    await expect(settingsPage(page)).toBeVisible();
    await expect(menu).toHaveCount(0);
    await expect(
      settingsPage(page).getByRole("heading", { level: 1, name: "Settings" })
    ).toBeFocused();
    // The item focus was on went with its menu: focus comes back to the menu's
    // trigger
    await page.keyboard.press("Escape");
    await expect(account(page)).toBeFocused();
  });

  test("client-v2-layout: A tooltip open at ⌘, closes as the settings open", async ({
    seededPage: page,
  }) => {
    // The rail's tooltips name its buttons, and portal to `body` too
    await page.setViewportSize({ width: 834, height: 1112 });
    await nav(page)
      .locator('[data-slot="sidebar-footer"]')
      .getByRole("button", { name: /^Cluster: / })
      .hover();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    await page.keyboard.press("ControlOrMeta+Comma");
    await expect(settingsPage(page)).toBeVisible();
    await expect(tooltip).toHaveCount(0);
  });

  test("client-v2-layout: Escape in a dialog opened from the settings closes only the dialog", async ({
    seededPage: page,
  }) => {
    await page.locator("[data-settings-trigger]").first().click();
    await settingsPage(page)
      .getByRole("button", { name: "From GitHub" })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(settingsPage(page)).toBeVisible();

    // ⌘, closes the settings, and the dialog that belongs to them with them
    await settingsPage(page)
      .getByRole("button", { name: "From GitHub" })
      .click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("ControlOrMeta+Comma");
    await expect(settingsPage(page)).toHaveCount(0);
    await expect(dialog).toBeHidden();
  });
});

// HOO-2059 saw the stage tabs' "Interact" draw over the old overlay's title,
// and HOO-2058 a grey block over the editor, both at 1440 by 900
test.describe("the settings page at 1440 by 900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("client-v2-layout: Nothing draws over the settings", async ({
    seededPage: page,
  }) => {
    await page.locator("[data-settings-trigger]").first().click();
    const heading = settingsPage(page).getByRole("heading", {
      level: 1,
      name: "Settings",
    });
    // What the user sees at a point is the page, not the app beneath it
    const onTop = () =>
      heading.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(
          r.x + r.width / 2,
          r.y + r.height / 2
        );
        const middle = document.elementFromPoint(
          window.innerWidth / 2,
          window.innerHeight / 2
        );
        const page = el.closest('[role="region"][aria-label="Settings"]');
        return hit === el && !!page?.contains(middle);
      });

    for (const theme of ["Dark", "Light"]) {
      if (theme === "Light") {
        const row = settingsPage(page)
          .locator("span", { hasText: /^Theme$/ })
          .locator("xpath=../..");
        await row.getByRole("combobox").click();
        await page.getByRole("option", { name: "Light", exact: true }).click();
        await expect
          .poll(() =>
            page.evaluate(() =>
              document.documentElement.classList.contains("dark")
            )
          )
          .toBe(false);
      }
      await expect(page.locator("#flow-stage-tab-interact")).toBeHidden();
      await expect(page.locator(".monaco-editor").first()).toBeHidden();
      // Picking the theme scrolled the page down to the UI section
      await heading.scrollIntoViewIfNeeded();
      expect(await onTop(), theme).toBe(true);
    }
  });
});

test("client-v2-layout: The settings page on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await seedWorkspace(page);
  await page.setViewportSize({ width: 390, height: 844 });
  // The editor focuses itself when it opens the first file; landing after
  // the page opened, it would take focus from it
  await expect(page.locator(".monaco-editor textarea.inputarea")).toBeFocused();
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page
    .getByRole("region", { name: "Navigation" })
    .getByRole("button", { name: /^Change cluster/ })
    .click();

  const bar = page.getByTestId("settings-bar");
  await expect(
    bar.getByRole("heading", { level: 1, name: "Settings" })
  ).toBeVisible();
  await expect(sectionList(page)).toHaveCount(0);
  await bar.getByRole("button", { name: "Back to app" }).click();
  await expect(settingsPage(page)).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Work" })).toBeInViewport();
});
