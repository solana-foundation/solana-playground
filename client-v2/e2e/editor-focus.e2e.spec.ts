import { expect } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

import { LONG, seedWorkspace, test } from "./fixtures";

/**
 * The lazy `Monaco` component's chunk. The `monaco-editor` vendor chunk is
 * shared with the app shell and loads with the explorer, so holding it would
 * hold the whole page; this chunk is the editor's own mount.
 */
const MONACO_CHUNK = /\/static\/js\/[^/]*Editor_Monaco_index[^/]*\.js(\?|$)/;

test("client-v2-layout: A late editor mount leaves the new-file field focused", async ({
  page,
}) => {
  await seedWorkspace(page);

  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route(MONACO_CHUNK, async (route: Route) => {
    requested = true;
    await held;
    await route.continue();
  });

  await page.reload();
  await expect(page.locator("#root-dir")).toBeVisible(LONG);
  await expect.poll(() => requested, LONG).toBe(true);
  await expect(page.locator(".monaco-editor")).toHaveCount(0);

  await page.getByRole("button", { name: "New file" }).click();
  const name = page.locator("#root-dir input");
  await expect(name).toBeFocused();
  await page.keyboard.type("late.rs");

  // The editor mounts only now, with the name already typed
  release();

  // The editor sets its model and then focuses in one handler, so once a
  // line of the current file is drawn the focus it would take is taken.
  await expect(page.locator(".monaco-editor .view-line").first()).toBeVisible(
    LONG
  );
  await expect(
    page.locator(".monaco-editor textarea.inputarea")
  ).not.toBeFocused();
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("late.rs");
});

test("client-v2-layout: Opening a file with no tabs focuses the editor", async ({
  seededPage: page,
}) => {
  await expect(page.locator(".monaco-editor").first()).toBeVisible(LONG);

  const tabs = page.locator('#tabs [data-slot="editor-tab"][id^="/"]');
  for (let left = await tabs.count(); left > 0; left--) {
    const tab = tabs.first();
    await tab.hover({ force: true });
    await tab.getByRole("button", { name: /^Close / }).click({ force: true });
    await expect(tabs).toHaveCount(left - 1);
  }
  await expect(page.locator(".monaco-editor")).toHaveCount(0);

  await page
    .locator("#root-dir")
    .getByText("lib.rs", { exact: true })
    .first()
    .click();
  await expect(page.locator(".monaco-editor textarea.inputarea")).toBeFocused(
    LONG
  );
});

test("client-v2-layout: Creating a file with a tab open focuses the editor", async ({
  seededPage: page,
}) => {
  await expect(page.locator(".monaco-editor").first()).toBeVisible(LONG);

  await page.getByRole("button", { name: "New file" }).click();
  const name = page.locator("#root-dir input");
  await expect(name).toBeFocused();
  await page.keyboard.type("x.rs");
  await page.keyboard.press("Enter");

  await expect(name).toHaveCount(0);
  await expect(page.locator(".monaco-editor textarea.inputarea")).toBeFocused(
    LONG
  );
});

test("client-v2-layout: Creating a file with no tabs focuses the editor", async ({
  seededPage: page,
}) => {
  await expect(page.locator(".monaco-editor").first()).toBeVisible(LONG);

  const tabs = page.locator('#tabs [data-slot="editor-tab"][id^="/"]');
  for (let left = await tabs.count(); left > 0; left--) {
    const tab = tabs.first();
    await tab.hover({ force: true });
    await tab.getByRole("button", { name: /^Close / }).click({ force: true });
    await expect(tabs).toHaveCount(left - 1);
  }
  await expect(page.locator(".monaco-editor")).toHaveCount(0);

  await page.getByRole("button", { name: "New file" }).click();
  const name = page.locator("#root-dir input");
  await expect(name).toBeFocused();
  await page.keyboard.type("y.rs");
  await page.keyboard.press("Enter");

  await expect(name).toHaveCount(0);
  await expect(page.locator(".monaco-editor textarea.inputarea")).toBeFocused(
    LONG
  );
});

const KEY_CONNECTION = {
  id: "openai",
  apiKey: "sk-e2e-focus",
  endpoint: { baseUrl: "https://api.example.test/v1", model: "gpt-x" },
};

type AssistantWindow = Window & {
  __pgAssistant?: { connect: (c: unknown) => void };
};

/**
 * Resolves once the page's effects have mounted, `effects/tab-sync` among
 * them. They mount a second after the panels, in one pass, and on load only
 * the session effect asks for the session.
 */
const effectsMounted = (page: Page) =>
  page.waitForRequest("**/api/auth/get-session", LONG);

test("client-v2-layout: A workspace re-open leaves the composer focused", async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);

  const mounted = effectsMounted(page);
  await seedWorkspace(page);
  await mounted;
  await expect(page.locator(".monaco-editor textarea.inputarea")).toBeFocused(
    LONG
  );

  // Connected, so the panel shows the composer rather than its picker
  await page.evaluate(
    (c) => (window as AssistantWindow).__pgAssistant!.connect(c),
    KEY_CONNECTION
  );
  const composer = page.getByRole("textbox", { name: "Message the assistant" });
  await expect(composer).toBeVisible(LONG);

  // A second tab of the same browser on the same project. A file created
  // there changes which files exist, so this tab's `effects/tab-sync`
  // re-opens the workspace through `PgExplorer.switchWorkspace`, the call
  // sync's adopt and merge make, with nobody in this tab asking for it.
  const other = await context.newPage();
  const otherMounted = effectsMounted(other);
  await other.goto("/");
  await expect(other.locator("#root-dir")).toBeVisible(LONG);
  await otherMounted;

  await composer.click();
  await page.keyboard.type("half a thought");

  await other.getByRole("button", { name: "New file" }).click();
  const name = other.locator("#root-dir input");
  await expect(name).toBeFocused();
  await name.fill("notes.rs");
  await name.press("Enter");

  await expect(page.locator("#root-dir")).toContainText("notes.rs", LONG);
  // The re-open sets the model and then decides on focus in one handler,
  // so once the current file is drawn again that decision is made
  await expect(page.locator(".monaco-editor .view-line").first()).toBeVisible(
    LONG
  );
  await expect(
    page.locator(".monaco-editor textarea.inputarea")
  ).not.toBeFocused();
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue("half a thought");
});

// Pins what the rename dialog does with focus, which the rule for opens the
// user did not start must leave as it was: the rename re-opens the file
// while the dialog's field has focus, and the dialog's close drops focus to
// the page, not to the editor.
test("renaming the open file through its dialog leaves focus where it was", async ({
  seededPage: page,
}) => {
  const lib = page.locator("#root-dir").getByText("lib.rs", { exact: true });
  await lib.click({ button: "right" });
  await page.getByRole("menuitem", { name: /Rename/ }).click();
  const dialog = page.getByRole("dialog", { name: "Rename 'lib.rs'" });
  await dialog.getByRole("textbox").fill("renamed.rs");
  await page.keyboard.press("Enter");

  await expect(dialog).toBeHidden();
  await expect(page.locator("#tabs")).toContainText("renamed.rs");
  await expect(
    page.locator(".monaco-editor textarea.inputarea")
  ).not.toBeFocused();
  await expect
    .poll(() => page.evaluate(() => document.activeElement === document.body))
    .toBe(true);
});
