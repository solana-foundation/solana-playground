import { STEPPER_FULL_WIDTH_PX } from "../src/views/flow/header/stepper-width";

import { expect, seedWorkspace, test } from "./fixtures";

/** What a check or dot beside a label adds to the list, in px */
const MARK_PX = 18;

test("the full-label stepper fits the width it folds at", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await seedWorkspace(page);
  const list = page.locator('[data-slot="stepper-list"]');
  await expect(list).toHaveAttribute("data-compact", "false");
  // The frame stretches the list across its row (`fill`), so its own width is
  // the row's; measured at its natural width, as the phone's bar lays it out
  const width = await list.evaluate((el) => {
    const list = el as HTMLElement;
    const stretched = list.style.width;
    list.style.width = "fit-content";
    const natural = list.scrollWidth;
    list.style.width = stretched;
    return natural;
  });
  // A test cannot drive all four stages to a mark, so the unmarked list stands
  // in, with room for a mark on each of the four labels.
  expect(width + 4 * MARK_PX).toBeLessThanOrEqual(STEPPER_FULL_WIDTH_PX);
});
