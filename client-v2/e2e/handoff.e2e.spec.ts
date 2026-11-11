import type { Page } from "@playwright/test";

import {
  expect,
  grantClipboard,
  home,
  LONG,
  stubSession,
  test,
} from "./fixtures";
import { lineOf, linesOn } from "./telemetry";
import { DESK, PHONE } from "./viewports";

const TITLE = "Continue on a computer";

/** The phone's menu page, reached from the work page's Menu */
const openMenu = async (page: Page) => {
  await page.goto("/");
  await expect(home(page)).toBeVisible(LONG);
  await page
    .getByRole("region", { name: "Work" })
    .getByRole("button", { name: "Menu" })
    .click();
  return page.getByRole("region", { name: "Navigation" });
};

const sheet = (page: Page) => page.getByRole("dialog", { name: TITLE });

const ADA = { id: "u1", name: "Ada", image: null, login: "ada" };

test.describe("on a phone", () => {
  test.use({ viewport: PHONE });

  test("client-v2-handoff: The phone's menu page offers it", async ({
    page,
  }) => {
    const menu = await openMenu(page);
    await expect(menu.getByRole("button", { name: TITLE })).toBeVisible();
  });

  test("client-v2-handoff: The link names this app and page", async ({
    page,
    context,
  }) => {
    await grantClipboard(context);
    // The link and its buttons show signed in only
    await stubSession(page, ADA);
    const lines = linesOn(page);
    const menu = await openMenu(page);
    await menu.getByRole("button", { name: TITLE }).click();
    await expect(sheet(page)).toBeVisible();

    const { origin, pathname } = new URL(page.url());
    const link = `${origin}${pathname}`;
    await expect(page.getByTestId("handoff-link")).toHaveText(link);
    await sheet(page).getByRole("button", { name: "Copy link" }).click();
    await expect(
      sheet(page).getByRole("button", { name: "Copied" })
    ).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      link
    );
    await expect
      .poll(() => lineOf(lines, "nav_handoff_link_copied"))
      .toBeTruthy();

    // The sheet fits the phone: nothing on the page scrolls sideways
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(PHONE.width);

    await sheet(page)
      .getByRole("button", { name: "Stay on the phone" })
      .click();
    await expect(sheet(page)).toBeHidden();
  });

  test("client-v2-handoff: Signed in", async ({ page }) => {
    await stubSession(page, ADA);
    const menu = await openMenu(page);
    await menu.getByRole("button", { name: TITLE }).click();
    await expect(sheet(page)).toContainText(
      "Your files and this conversation go with you"
    );
    await expect(sheet(page)).toContainText("@ada");
    await expect(
      sheet(page).getByRole("button", { name: "Sign in with GitHub" })
    ).toHaveCount(0);
  });

  test("client-v2-handoff: Signed out", async ({ page }) => {
    await stubSession(page, null);
    const menu = await openMenu(page);
    await menu.getByRole("button", { name: TITLE }).click();
    await expect(sheet(page)).toContainText("This project stays on this phone");
    await expect(
      sheet(page).getByRole("button", { name: "Sign in with GitHub" })
    ).toBeVisible();
    // No link before the sign-in: the computer would find nothing at it
    await expect(page.getByTestId("handoff-link")).toHaveCount(0);
    await expect(
      sheet(page).getByRole("button", { name: "Copy link" })
    ).toHaveCount(0);
  });

  test("client-v2-handoff: Opening is counted", async ({ page }) => {
    await stubSession(page, null);
    const lines = linesOn(page);
    const menu = await openMenu(page);
    await menu.getByRole("button", { name: TITLE }).click();
    await expect
      .poll(() => lineOf(lines, "nav_handoff_opened"))
      .toContain("signedIn: false");
  });
});

test("client-v2-handoff: The frame does not", async ({ page }) => {
  await page.setViewportSize(DESK);
  await page.goto("/");
  await expect(home(page)).toBeVisible(LONG);
  await expect(page.getByRole("button", { name: TITLE })).toHaveCount(0);
});
