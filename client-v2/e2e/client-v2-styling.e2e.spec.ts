import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures";

const openMenu = async (page: Page) => {
  const file = page.locator("#root-dir").getByText("lib.rs", { exact: true });
  await expect(file).toBeVisible();
  await file.click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
};

const openDialog = async (page: Page) => {
  await openMenu(page);
  await page.getByRole("menuitem", { name: /Rename/ }).click();
  const dialog = page.getByRole("dialog", { name: "Rename 'lib.rs'" });
  await expect(dialog).toBeVisible();
  return dialog;
};

/** The longest animation or transition the element runs, in ms */
const longestMotion = (locator: Locator) =>
  locator.evaluate((el) => {
    const style = getComputedStyle(el);
    const ms = (list: string) =>
      Math.max(
        ...list.split(",").map((v) => {
          const n = parseFloat(v);
          return v.trim().endsWith("ms") ? n : n * 1000;
        })
      );
    return Math.max(ms(style.animationDuration), ms(style.transitionDuration));
  });

test("client-v2-styling: Opening a dialog with reduced motion", async ({
  seededPage: page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });

  const dialog = await openDialog(page);
  expect(await longestMotion(dialog)).toBeLessThanOrEqual(0.01);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await openMenu(page);
  expect(await longestMotion(page.getByRole("menu"))).toBeLessThanOrEqual(0.01);
});

test("client-v2-styling: Without reduced motion", async ({
  seededPage: page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });

  const dialog = await openDialog(page);
  expect(await longestMotion(dialog)).toBeGreaterThan(1);
});

test("client-v2-styling: A plain form control", async ({
  seededPage: page,
}) => {
  const control = await page.evaluate(() => {
    const wrap = document.createElement("div");
    wrap.style.font = "15px serif";
    const button = document.createElement("button");
    button.textContent = "plain";
    wrap.appendChild(button);
    document.body.appendChild(wrap);
    const style = getComputedStyle(button);
    const result = {
      border: style.borderTopWidth,
      background: style.backgroundColor,
      font: style.fontFamily,
      size: style.fontSize,
    };
    wrap.remove();
    return result;
  });

  expect(control).toEqual({
    border: "0px",
    background: "rgba(0, 0, 0, 0)",
    font: "serif",
    size: "15px",
  });
});

test("client-v2-styling: Editor and terminal under the reset", async ({
  seededPage: page,
}) => {
  // The code font the user picked reaches CSS through `--pg-font-code`
  const codeFont = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue(
      "--pg-font-code"
    )
  );
  expect(codeFont).toContain("JetBrains Mono");

  const terminal = page.locator(".xterm-rows");
  await expect(terminal).toBeVisible();
  await expect(terminal).toHaveCSS("font-family", /JetBrains Mono/);
});
