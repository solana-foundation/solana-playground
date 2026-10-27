import type { Locator, Page } from "@playwright/test";

import { expect, home, homeRegion, test } from "./fixtures";

const FIRST = "Define the hello instruction and log a message";

const band = (page: Page) => page.locator('[data-slot="objective-band"]');
/** The band, or on a phone the fold it becomes */
const bandOrFold = (page: Page) =>
  page.locator('[data-slot="objective-band"], [data-slot="objective-fold"]');
const rows = (page: Page) =>
  page.locator('[data-slot="step-rail"] [data-slot="step-rail-item"]');

/**
 * Home -> Open Hello Anchor -> Start, as `lesson-path` does.
 * `Start` creates the workspace and flips the route to the lesson chrome.
 */
const startHelloAnchor = async (page: Page) => {
  // No default backend, whatever the dev server is configured with
  await page.route("**/api/agent", (route) =>
    route.fulfill({ json: { configured: false, model: null } })
  );
  await page.goto("/");
  await expect(home(page)).toBeVisible();
  // A wide Home opens it with the card's "Open" button; a phone's card is
  // the button itself
  await homeRegion(page)
    .getByRole("button", {
      name: /^(Open Hello Anchor|Hello Anchor Beginner tutorial)$/,
    })
    .click();
  await expect(home(page)).toBeHidden();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(bandOrFold(page)).toBeVisible();
};

/** A lesson opens on its code: no page covers the editor until asked */
const landsOnCode = async (page: Page) => {
  await expect(bandOrFold(page)).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: /hello instruction/i })
  ).toHaveCount(0);
};

/** A control's box, which must be on screen */
const boxOf = async (locator: Locator) => {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
};

const skipStep = (page: Page) =>
  page.getByRole("button", { name: "Skip this step", exact: true });

test.describe("client-v2-lessons", () => {
  test.setTimeout(120_000);

  test("client-v2-lessons: The objective band over the editor", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await startHelloAnchor(page);

    const b = band(page);
    await expect(b.getByText("Step 1 of 4", { exact: true })).toBeVisible();
    await expect(b.getByText(FIRST)).toBeVisible();
    await expect(b.getByRole("progressbar")).toBeVisible();
    await expect(
      b.getByRole("button", { name: "Previous step" })
    ).toBeVisible();
    await expect(b.getByRole("button", { name: "Next step" })).toBeVisible();
    await expect(
      b.getByRole("button", { name: "Read the page" })
    ).toBeVisible();
    await expect(b.getByRole("button", { name: "I'm stuck" })).toBeVisible();

    // One row: the ask and its actions share a line, as the prototype draws
    // the band; the buttons differ in height, so their middles are compared
    const middle = (box: { y: number; height: number }) =>
      box.y + box.height / 2;
    const back = await boxOf(b.getByRole("button", { name: "Previous step" }));
    const stuck = await boxOf(b.getByRole("button", { name: "I'm stuck" }));
    const objective = await boxOf(b.getByText(FIRST));
    expect(Math.abs(middle(back) - middle(stuck))).toBeLessThanOrEqual(1);
    expect(Math.abs(middle(back) - middle(objective))).toBeLessThanOrEqual(2);
    await expect(b.getByRole("button", { name: /to prove this/ })).toHaveCount(
      0
    );

    // Above the editor, not beside it
    const bandBox = await b.boundingBox();
    const editorBox = await page.locator("#tabs").boundingBox();
    expect(bandBox).not.toBeNull();
    expect(editorBox).not.toBeNull();
    expect(bandBox!.y + bandBox!.height).toBeLessThanOrEqual(editorBox!.y + 1);
  });

  test("client-v2-lessons: Steps beside the files", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await startHelloAnchor(page);

    await expect(page.getByRole("radio", { name: "Steps" })).toHaveAttribute(
      "data-state",
      "on"
    );
    await expect(page.getByRole("radio", { name: "Files" })).toBeVisible();

    await expect(rows(page)).toHaveCount(4);
    await expect(rows(page).nth(0)).toHaveAttribute("data-status", "current");
    for (const i of [1, 2, 3]) {
      await expect(rows(page).nth(i)).toHaveAttribute("data-status", "locked");
    }
  });

  test("client-v2-lessons: Skipping marks the step skipped", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await startHelloAnchor(page);
    await landsOnCode(page);

    await skipStep(page).click();

    await expect(rows(page).nth(0)).toHaveAttribute("data-status", "skipped");
    await expect(rows(page).nth(1)).toHaveAttribute("data-status", "current");
  });

  test("client-v2-lessons: Re-entering lands on the same step", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await startHelloAnchor(page);
    await landsOnCode(page);
    await skipStep(page).click();
    await expect(
      band(page).getByText("Step 2 of 4", { exact: true })
    ).toBeVisible();

    // Leaves as soon as the band shows Step 2, then comes back. Every write
    // since Start lands within lightning-fs's 500 ms tree-save window, so
    // without the flush on the record file's first write (`writeWorkspaceFile`)
    // the file itself is lost; it failed that way before the flush existed.
    // Step 1 coming back means one of two things: the flush regressed, or the
    // skip's own write had not landed before the navigation on a slow runner.
    await page.goto("/");
    await page.goto("/tutorials/hello-anchor");

    await expect(
      band(page).getByText("Step 2 of 4", { exact: true })
    ).toBeVisible();
    await expect(rows(page).nth(1)).toHaveAttribute("data-status", "current");
  });

  test("client-v2-lessons: The page opens beside the band, not over it", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await startHelloAnchor(page);
    await landsOnCode(page);

    // Next step is offered only behind the furthest step reached: skip one
    // and step back, so there is something for it to do
    await skipStep(page).click();
    await band(page).getByRole("button", { name: "Previous step" }).click();

    const read = band(page).getByRole("button", { name: "Read the page" });
    await read.click();

    const reader = page.getByRole("dialog", { name: /hello instruction/i });
    await expect(reader).toBeVisible();

    // The page sits inside the stage under the band, over the editor
    const readerBox = await reader.boundingBox();
    const bandBox = await band(page).boundingBox();
    const editorBox = await page.locator("#tabs").boundingBox();
    expect(readerBox).not.toBeNull();
    expect(bandBox).not.toBeNull();
    expect(editorBox).not.toBeNull();
    expect(readerBox!.y).toBeGreaterThanOrEqual(
      bandBox!.y + bandBox!.height - 1
    );
    expect(readerBox!.y).toBeLessThanOrEqual(editorBox!.y + 1);
    expect(readerBox!.width).toBeGreaterThanOrEqual(editorBox!.width - 1);
    await expect(
      band(page).getByText("Step 1 of 4", { exact: true })
    ).toBeVisible();

    // Non-modal: Next step is not covered, so a click would land
    const next = band(page).getByRole("button", { name: "Next step" });
    await expect(next).toBeEnabled();
    await next.click({ trial: true });

    await page.keyboard.press("Escape");
    await expect(reader).toHaveCount(0);
    await expect(read).toBeFocused();

    // And the press works with the page open: the band moves on, and the
    // page closes with the step it belonged to (`Flow`'s step-change effect)
    await read.click();
    await expect(reader).toBeVisible();
    await next.click();
    await expect(
      band(page).getByText("Step 2 of 4", { exact: true })
    ).toBeVisible();
    await expect(reader).toHaveCount(0);
  });

  test("client-v2-lessons: Starting a tutorial lands on the code", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await startHelloAnchor(page);
    await landsOnCode(page);
    await expect(page.locator(".monaco-editor")).toBeVisible();
    await expect(
      band(page).getByRole("button", { name: "Read the page" })
    ).toBeVisible();
  });

  test("client-v2-lessons: The page has no footer", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await startHelloAnchor(page);
    await band(page).getByRole("button", { name: "Read the page" }).click();
    const reader = page.getByRole("dialog", { name: /hello instruction/i });
    await expect(reader).toBeVisible();
    await expect(
      reader.getByRole("button", { name: "Close the page" })
    ).toBeVisible();
    await expect(
      reader.getByRole("button", { name: "Back to the code" })
    ).toHaveCount(0);
    await expect(
      reader.getByRole("button", { name: "Mark as read" })
    ).toHaveCount(0);
  });

  for (const [width, height] of [
    [1440, 900],
    [834, 1194],
  ] as const) {
    test(`client-v2-lessons: One row at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await startHelloAnchor(page);
      const b = band(page);
      const middle = (box: { y: number; height: number }) =>
        box.y + box.height / 2;
      const objective = await boxOf(b.getByText(FIRST));
      for (const name of ["Read the page", "I'm stuck"]) {
        const box = await boxOf(b.getByRole("button", { name }));
        expect(Math.abs(middle(box) - middle(objective))).toBeLessThanOrEqual(
          2
        );
      }
      await expect(page.getByText("Before you can deploy:")).toHaveCount(0);
      await expect(
        b.getByRole("button", { name: /to prove this/ })
      ).toHaveCount(0);
    });
  }

  test("client-v2-lessons: How the step is checked", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await startHelloAnchor(page);
    const check = band(page).getByRole("button", {
      name: "How this step is checked",
    });
    await expect(check).toHaveAttribute("aria-expanded", "false");
    await check.click();
    await expect(check).toHaveAttribute("aria-expanded", "true");
    await expect(
      band(page).getByText(
        "Verified when the built interface shows a hello instruction."
      )
    ).toBeVisible();
  });

  test("client-v2-lessons: Statuses on entry", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await startHelloAnchor(page);
    await expect(rows(page).nth(0)).toContainText("aiming at build");
    for (const i of [1, 2, 3]) {
      await expect(rows(page).nth(i)).toContainText("locked");
    }
  });

  test("client-v2-lessons: Suggestions in a lesson", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await startHelloAnchor(page);
    for (const name of [
      "Explain this step",
      "Give me a hint",
      "Why did my build fail?",
    ]) {
      await expect(page.getByRole("button", { name })).toBeVisible();
    }
    // Each chip is its tooltip's trigger, which takes over its data-slot
    const chips = page.locator('[data-slot="composer-context"] > *');
    await expect(chips).toHaveText(["Step 1 of 4", "lib.rs", "1 file"]);
  });

  test("client-v2-lessons: The band and the bar on a phone", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 393, height: 852 });
    await startHelloAnchor(page);
    await landsOnCode(page);

    // The band is the ask alone, folded to one row that opens in place
    const fold = page.locator('[data-slot="objective-fold"]');
    await expect(fold.getByText("1/4", { exact: true })).toBeVisible();
    const toggle = fold.getByRole("button", { name: new RegExp(FIRST) });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(fold.getByRole("button")).toHaveCount(1);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(fold.getByText(/Verified when/)).toBeVisible();

    // The step's controls sit in the bar at the foot, at the thumb's size
    const bar = page.getByRole("toolbar", { name: "This step" });
    for (const name of [
      "Previous step",
      "Next step",
      "Read the page",
      "I'm stuck",
    ]) {
      const box = await boxOf(bar.getByRole("button", { name }));
      expect(box.height).toBeGreaterThanOrEqual(48);
    }
    const barBox = await boxOf(bar);
    expect(barBox.y + barBox.height).toBeGreaterThan(852 - 100);

    // The files row opens the sheet on Files, Steps one tap away
    await page.getByRole("button", { name: /^Files, .* open$/ }).click();
    const sheet = page.getByRole("dialog", { name: "Files" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("radio", { name: "Files" })).toHaveAttribute(
      "data-state",
      "on"
    );
    // In the product's text face, not the code's
    const font = await sheet
      .getByRole("radio", { name: "Steps" })
      .evaluate((el) => getComputedStyle(el).fontFamily);
    expect(font).not.toMatch(/JetBrains/);
  });
});
