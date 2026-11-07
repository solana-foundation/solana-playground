import { expect, type Page } from "@playwright/test";

import {
  consoleTrigger,
  HELP_TAIL,
  home,
  LONG,
  runInTerminal,
  test,
} from "./fixtures";

/** The computed style property of the first element matching `selector` */
const computed = (
  page: Page,
  selector: string,
  prop: "color" | "backgroundColor"
) =>
  page
    .locator(selector)
    .first()
    .evaluate((el, p) => getComputedStyle(el)[p], prop);

const isDark = (page: Page) =>
  page.evaluate(() => document.documentElement.classList.contains("dark"));

/** The theme select on the Settings page, opened */
const openThemeSelect = async (page: Page) => {
  await page.locator("[data-settings-trigger]").first().click();
  await page
    .getByRole("region", { name: "Settings" })
    .getByRole("combobox", { name: "Theme" })
    .focus();
  await page.keyboard.press("ArrowDown");
};

/** Pick Dark in Settings, the one theme offered (HOO-2695), and go back to the app */
const pickDark = async (page: Page) => {
  await openThemeSelect(page);
  await page.getByRole("option", { name: "Dark", exact: true }).click();
  // Back to the app, which the page covers, to read its colours
  await page.getByRole("button", { name: "Back to app" }).click();
};

/**
 * Reload on the Light theme, as a user who picked it before it was taken
 * off the select (HOO-2695): the theme still applies, so its colours are
 * still checked, and switching away from it is the in-place switch
 */
const reloadOnLight = async (page: Page) => {
  await page.evaluate(() => localStorage.setItem("theme", "Light"));
  await page.reload();
  await expect.poll(() => isDark(page)).toBe(false);
  // The editor focuses itself once it reopens the file; wait, so it does not
  // take keys meant for the terminal or the select
  await expect(page.locator(".monaco-editor textarea.inputarea")).toBeFocused();
};

/**
 * Open the console drawer and run `help`, so the terminal holds output.
 *
 * Takes a `seededPage`: the editor focuses itself when it opens the first
 * file, and the fixture waits for that, so it cannot land after the click on
 * the terminal and take the typing.
 */
const runHelp = async (page: Page) => {
  const drawer = consoleTrigger(page);
  if ((await drawer.getAttribute("aria-expanded")) !== "true") {
    await drawer.click();
  }
  await runInTerminal(page, "help");
  const terminal = page.locator(".xterm-rows").first();
  await expect(terminal).toContainText(HELP_TAIL);
  return terminal;
};

const EDITOR_TEXT = ".monaco-editor .view-lines";
const TERMINAL_TEXT = ".xterm-rows";

/** Effects run a second after mount; wait past that before asserting none */
const EFFECTS_SETTLE_MS = 2500;

test.describe("client-v2-themes", () => {
  // The product does not follow the OS: a light OS still starts on Dark
  test.use({ colorScheme: "light" });

  test("client-v2-themes: First visit", async ({ seededPage: page }) => {
    await expect.poll(() => isDark(page)).toBe(true);

    // The editor focuses itself when it opens the first file, at a moment
    // that varies with the machine; landing after the select took focus, it
    // takes the ArrowDown that opens the select
    await expect(
      page.locator(".monaco-editor textarea.inputarea")
    ).toBeFocused();
    await openThemeSelect(page);
    await expect(page.getByRole("option")).toHaveText(["Dark", /^Light/]);
    // Light was never designed: listed, marked, not offered (HOO-2695)
    const light = page.getByRole("option", { name: /^Light/ });
    await expect(light).toContainText("Coming soon");
    await expect(light).toHaveAttribute("aria-disabled", "true");
  });

  test("client-v2-themes: Switching from a saved light to dark", async ({
    seededPage: page,
  }) => {
    await reloadOnLight(page);
    await runHelp(page);
    const lightEditor = await computed(page, EDITOR_TEXT, "color");
    const lightTerminal = await computed(page, TERMINAL_TEXT, "color");

    await pickDark(page);

    await expect.poll(() => isDark(page)).toBe(true);
    await expect
      .poll(() => computed(page, EDITOR_TEXT, "color"))
      .not.toBe(lightEditor);
    await expect
      .poll(() => computed(page, TERMINAL_TEXT, "color"))
      .not.toBe(lightTerminal);

    await page.reload();
    await expect.poll(() => isDark(page)).toBe(true);
  });

  test("client-v2-themes: A saved Dracula theme", async ({
    seededPage: page,
  }) => {
    // A returning user: a project open, so Home does not cover the notice, and
    // the removed theme still in storage from before the token bridge
    await page.evaluate(() => localStorage.setItem("theme", "Dracula"));
    await page.reload();

    await expect.poll(() => isDark(page)).toBe(true);
    const notice = page.getByText(
      "The Dracula theme was removed. Playground now uses Dark."
    );
    await expect(notice).toBeVisible();
    await expect(home(page)).toBeHidden();

    await page.reload();
    await expect.poll(() => isDark(page)).toBe(true);
    await page.waitForTimeout(EFFECTS_SETTLE_MS);
    await expect(notice).toHaveCount(0);
  });

  test("a saved Light theme stays light, unannounced", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("theme", "Light"));
    await page.goto("/");

    await expect.poll(() => isDark(page)).toBe(false);
    await page.waitForTimeout(EFFECTS_SETTLE_MS);
    await expect(page.getByText(/theme was removed/)).toHaveCount(0);
  });

  test("the editor's brackets and active line follow the theme, not Monaco", async ({
    seededPage: page,
  }) => {
    // What a token computes to now, in the same form as a computed colour
    const token = (name: string) =>
      page.evaluate((n) => {
        const probe = document.createElement("span");
        probe.style.color = `var(${n})`;
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      }, name);

    const expectOnTokens = async () => {
      const expected: [string, string][] = [
        [".bracket-highlighting-0", "--text-secondary"],
        [".bracket-highlighting-1", "--syntax-number"],
        [".bracket-highlighting-2", "--syntax-type"],
        [".active-line-number", "--text-secondary"],
      ];
      for (const [selector, name] of expected) {
        await expect
          .poll(() => computed(page, `.monaco-editor ${selector}`, "color"))
          .toBe(await token(name));
      }
    };

    await expectOnTokens();

    // Monaco's own find match is orange, in both themes
    await page.keyboard.press("ControlOrMeta+f");
    await page.keyboard.type("data");
    await expect
      .poll(() =>
        computed(page, ".monaco-editor .findMatch", "backgroundColor")
      )
      .not.toBe("rgba(234, 92, 0, 0.33)");
    await page.keyboard.press("Escape");

    await reloadOnLight(page);
    await expectOnTokens();
  });

  test("code blocks in Markdown keep their syntax colours", async ({
    page,
  }) => {
    // A tutorial page renders Markdown through the same CodeBlock as the
    // assistant's answers, and needs no backend. Upstream's pages stay;
    // Hello Seahorse's first one holds code
    await page.goto("/tutorials/hello-seahorse");
    await page.getByRole("button", { name: "Start", exact: true }).click(LONG);
    const code = page.locator("pre.shiki").first();
    await expect(code).toBeVisible(LONG);

    const colours = () =>
      code.evaluate(
        (pre) =>
          new Set(
            Array.from(
              pre.querySelectorAll<HTMLElement>("span[style]"),
              (span) => span.style.color
            )
          ).size
      );
    // One colour means the grammar got no theme colours at all
    await expect.poll(colours).toBeGreaterThan(1);
  });

  test("client-v2-themes: Theme change with a file open", async ({
    seededPage: page,
  }) => {
    await reloadOnLight(page);
    const terminal = await runHelp(page);
    const editorBefore = await computed(page, EDITOR_TEXT, "color");
    const terminalBefore = await computed(page, TERMINAL_TEXT, "color");

    await pickDark(page);

    await expect
      .poll(() => computed(page, EDITOR_TEXT, "color"))
      .not.toBe(editorBefore);
    await expect
      .poll(() => computed(page, TERMINAL_TEXT, "color"))
      .not.toBe(terminalBefore);
    // The terminal re-coloured in place: what `help` printed is still there,
    // where a rebuilt terminal would show only its welcome text
    await expect(terminal).toContainText(HELP_TAIL);
  });
});
