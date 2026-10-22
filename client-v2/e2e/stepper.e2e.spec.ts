import { STEPPER_FULL_WIDTH_PX } from "../src/views/flow/header/stepper-width";

import { expect, seedWorkspace, test } from "./fixtures";

/** What a check or dot beside a label adds to the list, in px */
const MARK_PX = 18;

test("the full-label stepper fits the width it folds at", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await seedWorkspace(page);
  const list = page.locator('[data-slot="stepper-list"]');
  await expect(list).toHaveAttribute("data-compact", "false");
  // Measured in the fallback font, the list is narrower and the check passes
  // whatever the constant says, so the labels' webfont must be in first
  const textFont = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].some(
      (face) =>
        face.family.replace(/"/g, "") === "Stack Sans Text" &&
        face.status === "loaded"
    );
  });
  expect(textFont, "Stack Sans Text did not load").toBe(true);
  // The frame stretches the list across its row (`fill`), so its own width is
  // the row's; measured at its natural width, as the phone's bar lays it out,
  // border included, since `Stepper` compares its room with the border box
  const width = await list.evaluate((el) => {
    const list = el as HTMLElement;
    const stretched = list.style.width;
    list.style.width = "fit-content";
    const natural = list.getBoundingClientRect().width;
    list.style.width = stretched;
    return natural;
  });
  // A test cannot drive all four stages to a mark, so the unmarked list stands
  // in, with room for a mark on each of the four labels.
  expect(width + 4 * MARK_PX).toBeLessThanOrEqual(STEPPER_FULL_WIDTH_PX);
});
