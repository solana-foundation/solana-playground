import type { Page } from "@playwright/test";

import { LONG, expect, test } from "./fixtures";

/**
 * The document never scrolls; only the app's own panes do. On iPad Safari a
 * shell taller than the visible area pushed the header out of view (HOO-2249).
 * Chromium has no Safari toolbar, so this guards the rule, not Safari itself:
 * after load, the page is no taller than the window, and it has not moved.
 */
const SIZES = [
  { width: 1280, height: 800 },
  { width: 834, height: 1112 },
  { width: 393, height: 852 },
] as const;

const documentFits = (page: Page) =>
  page.evaluate(() => {
    const doc = document.scrollingElement ?? document.documentElement;
    return {
      fits: doc.scrollHeight <= window.innerHeight,
      scrollTop: doc.scrollTop,
    };
  });

for (const size of SIZES) {
  test(`the document does not scroll at ${size.width}×${size.height}, on Home and on a tutorial`, async ({
    page,
  }) => {
    await page.setViewportSize(size);

    await page.goto("/");
    await expect(page.getByText("Where should we begin?")).toBeVisible(LONG);
    expect(await documentFits(page)).toEqual({ fits: true, scrollTop: 0 });

    await page.goto("/tutorials/hello-anchor");
    await expect(
      page.getByRole("button", { name: "Start", exact: true })
    ).toBeVisible(LONG);
    expect(await documentFits(page)).toEqual({ fits: true, scrollTop: 0 });
  });
}
