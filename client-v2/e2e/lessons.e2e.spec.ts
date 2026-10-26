import type { Locator, Page } from "@playwright/test";

import { expect, home, homeRegion, test } from "./fixtures";

const FIRST = "Define the hello instruction and log a message";

const band = (page: Page) => page.locator('[data-slot="objective-band"]');
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
  await expect(band(page)).toBeVisible();
};

/** Entering a lesson opens its page once; most scenarios start from the code */
const closePage = async (page: Page) => {
  const reader = page.getByRole("dialog", { name: /hello instruction/i });
  await expect(reader).toBeVisible();
  // The record learns the page was opened only once its content has loaded;
  // an Escape that outruns the load leaves the page unread on purpose.
  await expect(
    band(page).getByRole("button", { name: "Read the page" })
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(reader).toHaveCount(0);
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
    await page.setViewportSize({ width: 1280, height: 800 });
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

    // Row two holds back and on beside the actions (design.md, "Lessons
    // (5.19)"); the buttons differ in height, so their middles are compared
    const middle = (box: { y: number; height: number }) =>
      box.y + box.height / 2;
    const back = await boxOf(b.getByRole("button", { name: "Previous step" }));
    const stuck = await boxOf(b.getByRole("button", { name: "I'm stuck" }));
    const objective = await boxOf(b.getByText(FIRST));
    expect(Math.abs(middle(back) - middle(stuck))).toBeLessThanOrEqual(1);
    expect(back.y).toBeGreaterThanOrEqual(objective.y + objective.height - 1);

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
    await closePage(page);

    await skipStep(page).click();

    await expect(rows(page).nth(0)).toHaveAttribute("data-status", "skipped");
    await expect(rows(page).nth(1)).toHaveAttribute("data-status", "current");
  });

  test("client-v2-lessons: Re-entering lands on the same step", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await startHelloAnchor(page);
    await closePage(page);
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
    await closePage(page);

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

  test("client-v2-lessons: The band on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await startHelloAnchor(page);
    await closePage(page);

    const b = band(page);
    await expect(b.getByText("1/4", { exact: true })).toBeVisible();
    await expect(b.getByText(FIRST)).toBeVisible();

    // Position and objective share a row; the actions sit in a row under it
    const position = await b.getByText("1/4", { exact: true }).boundingBox();
    const objective = await b.getByText(FIRST).boundingBox();
    const actions = await b
      .locator('[data-slot="objective-actions-row"]')
      .boundingBox();
    expect(position).not.toBeNull();
    expect(objective).not.toBeNull();
    expect(actions).not.toBeNull();
    expect(Math.abs(position!.y - objective!.y)).toBeLessThan(
      objective!.height
    );
    expect(actions!.y).toBeGreaterThanOrEqual(
      objective!.y + objective!.height - 1
    );
    await expect(
      b.getByRole("button", { name: "Read the page" })
    ).toBeVisible();
    await expect(b.getByRole("button", { name: "I'm stuck" })).toBeVisible();

    // One line of actions that scrolls, never a third line for the proof
    const stuck = await boxOf(b.getByRole("button", { name: "I'm stuck" }));
    const prove = await boxOf(
      b.getByRole("button", { name: "Build to prove this" })
    );
    expect(Math.abs(prove.y - stuck.y)).toBeLessThanOrEqual(1);

    // And the proving action can be reached: scrolled into view, it lies
    // inside the row's visible box
    const proveButton = b.getByRole("button", { name: "Build to prove this" });
    await proveButton.scrollIntoViewIfNeeded();
    const row = await boxOf(b.locator('[data-slot="objective-actions-row"]'));
    const reached = await boxOf(proveButton);
    expect(reached.x).toBeGreaterThanOrEqual(row.x - 1);
    expect(reached.x + reached.width).toBeLessThanOrEqual(
      row.x + row.width + 1
    );
    expect(reached.y).toBeGreaterThanOrEqual(row.y - 1);
    expect(reached.y + reached.height).toBeLessThanOrEqual(
      row.y + row.height + 1
    );

    // Leave the sheet on Files first, so the chevron has to switch it back
    await page.getByRole("button", { name: /^Files, .* open$/ }).click();
    const sheet = page.getByRole("dialog", { name: "Files" });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("radio", { name: "Files" }).click();
    await expect(sheet.getByRole("radio", { name: "Files" })).toHaveAttribute(
      "data-state",
      "on"
    );
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);

    await b.getByRole("button", { name: "Show the steps" }).click();
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("radio", { name: "Steps" })).toHaveAttribute(
      "data-state",
      "on"
    );
  });
});
