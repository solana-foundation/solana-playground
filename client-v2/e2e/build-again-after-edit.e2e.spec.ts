import type { Page } from "@playwright/test";

import { expect, LONG, openFiles, test } from "./fixtures";
import { DOCK_DESK } from "./viewports";

// These tests drive the project tree as its docked column, which needs a code
// area of 1100 px or more; the default window is too narrow and shows the
// dropdown instead
test.use({ viewport: DOCK_DESK });

const CHANGED =
  "Your code changed after the last build. Build again before you deploy.";

/** Longer than the editor's autosave debounce */
const AUTOSAVE_MS = 3000;

/** Every build answered with success, counted */
const answerBuilds = async (page: Page) => {
  const builds: string[] = [];
  await page.route("**/build", (route) => {
    builds.push(route.request().url());
    return route.fulfill({
      contentType: "application/json",
      // eslint-disable-next-line unicorn/no-null -- the stubbed build response is wire JSON, where `null` means no IDL
      body: JSON.stringify({ stderr: "", uuid: "e2e-build", idl: null }),
    });
  });
  return builds;
};

const button = (page: Page, name: string) =>
  page.locator("#flow-stage-panel-build").getByRole("button", { name });

const expectLeader = async (
  page: Page,
  order: { lead: string; other: string }
) => {
  await expect(button(page, order.lead)).toHaveAttribute(
    "data-slot",
    "brand-button",
    LONG
  );
  await expect(button(page, order.other)).toHaveAttribute(
    "data-variant",
    "outline"
  );
};

const DEPLOY_LEADS = { lead: "Continue to Deploy", other: "Build again" };
const BUILD_LEADS = { lead: "Build again", other: "Continue to Deploy" };

const builtPage = async (page: Page) => {
  const builds = await answerBuilds(page);
  await page.locator("#flow-stage-tab-build").click();
  await page
    .locator("#flow-stage-panel-build")
    .getByRole("button", { name: "Build", exact: true })
    .click();
  await expectLeader(page, DEPLOY_LEADS);
  await expect(page.getByText(CHANGED)).toHaveCount(0);
  return builds;
};

/** Build's stage takes the editor's place, so an edit goes through Write */
const edit = (keys: (page: Page) => Promise<void>) => async (page: Page) => {
  await page.locator("#flow-stage-tab-write").click();
  await page.locator(".monaco-editor .view-lines").first().click();
  await page.keyboard.press("ControlOrMeta+End");
  await keys(page);
  await page.locator("#flow-stage-tab-build").click();
};

const typeEdit = edit((page) =>
  page.keyboard.type("\n// an edit after the build")
);

test.describe("Build succeeded after an edit", () => {
  test.setTimeout(120_000);

  test("client-v2-program-build: The code changed after the build", async ({
    seededPage: page,
  }) => {
    await builtPage(page);

    await typeEdit(page);
    await expectLeader(page, BUILD_LEADS);
    await expect(page.getByText(CHANGED)).toBeVisible();

    await button(page, "Continue to Deploy").click();
    await expect(page.locator("#flow-stage-panel-deploy")).toBeVisible();
  });

  test("client-v2-program-build: The program id a build writes is not a change", async ({
    seededPage: page,
  }) => {
    await builtPage(page);

    // The id is in the editor by now, and autosave stores it soon after
    await page.locator("#flow-stage-tab-write").click();
    await expect(page.locator(".monaco-editor .view-lines")).not.toContainText(
      "1111111111",
      LONG
    );
    await page.waitForTimeout(AUTOSAVE_MS);
    await page.locator("#flow-stage-tab-build").click();

    await expectLeader(page, DEPLOY_LEADS);
    await expect(page.getByText(CHANGED)).toHaveCount(0);
  });

  test("client-v2-program-build: A rename is not a change", async ({
    seededPage: page,
  }) => {
    await builtPage(page);

    await openFiles(page);
    await page
      .locator('#root-dir [data-path$="/src/lib.rs"]')
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: /^Rename/ }).click();
    const rename = page.getByRole("dialog", { name: "Rename 'lib.rs'" });
    await rename.getByRole("textbox").fill("renamed.rs");
    await rename.getByRole("button", { name: "Rename" }).click();
    await expect(
      page.locator('#root-dir [data-path$="/src/renamed.rs"]')
    ).toBeVisible();

    await expectLeader(page, DEPLOY_LEADS);
    await expect(page.getByText(CHANGED)).toHaveCount(0);
  });

  test("client-v2-program-build: An undone edit is not a change", async ({
    seededPage: page,
  }) => {
    await builtPage(page);

    await edit((p) => p.keyboard.type("x"))(page);
    await expectLeader(page, BUILD_LEADS);

    await edit((p) => p.keyboard.press("Backspace"))(page);
    await expectLeader(page, DEPLOY_LEADS);
  });

  test("client-v2-program-build: A rebuild settles it", async ({
    seededPage: page,
  }) => {
    const builds = await builtPage(page);

    await typeEdit(page);
    await expectLeader(page, BUILD_LEADS);

    await button(page, "Build again").click();
    await expect.poll(() => builds.length).toBe(2);
    await expectLeader(page, DEPLOY_LEADS);
    await expect(page.getByText(CHANGED)).toHaveCount(0);
  });
});
