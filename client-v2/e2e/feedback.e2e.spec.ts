import type { Page } from "@playwright/test";

import { expect, seedWorkspace, test } from "./fixtures";

const ISSUES = "https://github.com/solana-foundation/solana-playground/issues";

/** The telemetry event lines the page logs from now on, as `[telemetry:event] <name> {<params>}` */
const linesOn = (page: Page) => {
  const lines: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (text.startsWith("[telemetry:event]")) lines.push(text);
  });
  return lines;
};

const openMenu = (page: Page) =>
  page.getByRole("button", { name: "Feedback" }).click();

// A GitHub link opens a tab; answering it here keeps the suite off the network
test.beforeEach(async ({ context }) => {
  await context.route("https://github.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "" })
  );
});

test("client-v2-feedback: The menu opens", async ({ seededPage: page }) => {
  await openMenu(page);

  await expect(
    page.getByRole("menuitem", { name: "Suggest an idea" })
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Report a bug" })
  ).toBeVisible();
});

// The dev server has no VERCEL_ENV, so it carries no Sentry whatever its DSN
test("client-v2-feedback: A local build", async ({ seededPage: page }) => {
  await openMenu(page);

  await expect(
    page.getByRole("menuitem", { name: "Report a bug" })
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Share feedback" })
  ).toHaveCount(0);
});

test("client-v2-feedback: Suggest an idea from the menu", async ({
  seededPage: page,
}) => {
  await openMenu(page);
  const popup = page.waitForEvent("popup");
  await page.getByRole("menuitem", { name: "Suggest an idea" }).click();

  expect((await popup).url()).toBe(ISSUES);
});

test("client-v2-feedback: A link from the menu", async ({
  seededPage: page,
}) => {
  const lines = linesOn(page);
  await openMenu(page);
  const popup = page.waitForEvent("popup");
  await page.getByRole("menuitem", { name: "Report a bug" }).click();
  await popup;

  await expect
    .poll(() =>
      lines.find((line) =>
        line.startsWith("[telemetry:event] feedback_github_clicked ")
      )
    )
    .toBeTruthy();
  const line = lines.find((l) => l.includes("feedback_github_clicked"));
  expect(line).toContain("link: bug");
  expect(line).toContain("from: menu");
});

// The form is out of reach here (no Sentry on the dev server), so a draft
// outliving the Sheet is covered by `FeedbackWidget.integration.test.tsx`
test("the trigger opens its menu from the navigation's Sheet on a phone", async ({
  page,
}) => {
  // The fixture waits on the project tree, which a phone keeps in the closed
  // Sheet, so seed on a desktop-sized page and narrow it afterwards
  await page.setViewportSize({ width: 1280, height: 800 });
  await seedWorkspace(page);
  await page.setViewportSize({ width: 375, height: 812 });
  // The editor focuses itself when it opens the first file; landing after the
  // menu opened, it would close the menu
  await expect(page.locator(".monaco-editor textarea.inputarea")).toBeFocused();
  await page.getByRole("button", { name: "Expand project panel" }).click();
  const sheet = page.locator('[data-slot="sidebar"][data-mobile="true"]');

  await sheet.getByRole("button", { name: "Feedback" }).click();

  await expect(
    page.getByRole("menuitem", { name: "Report a bug" })
  ).toBeVisible();
});
