import type { Page } from "@playwright/test";

import { expect, LONG, seedWorkspace, test } from "./fixtures";
import { DESK, PHONE, TABLET, WIDE_DESK } from "./viewports";

/**
 * A load raises no ResizeObserver loop notice. The browser raises one when an
 * observer's callback resizes what it observes within the same frame;
 * `installGlobalHandlers` drops the notice before it reaches Sentry, so a loop
 * added later would show nowhere but here. The count listens on `window` in
 * the capture phase, apart from the app's filter, and starts over with every
 * document.
 */

const NOTICE = "ResizeObserver loop";

const countNotices = (page: Page) =>
  page.addInitScript((notice) => {
    const w = window as unknown as { roNotices: number };
    w.roNotices = 0;
    window.addEventListener(
      "error",
      (event) => {
        if (event.message.includes(notice)) w.roNotices++;
      },
      true
    );
  }, NOTICE);

const noticesOf = (page: Page) =>
  page.evaluate(() => (window as unknown as { roNotices: number }).roNotices);

/**
 * The page has drawn what it loaded: its fonts are in, and two frames have
 * passed, so an observer that resizes on its first callback has had a frame
 * to report it. The extra second covers layout that settles late.
 */
const settle = async (page: Page) => {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((done) =>
      requestAnimationFrame(() => requestAnimationFrame(done))
    );
  });
  await page.waitForTimeout(1_000);
};

/** What a loaded project shows first: the editor, or on a phone the stages */
const projectReady = (page: Page, phone: boolean) =>
  phone
    ? expect(page.locator("#flow-stage-tab-build")).toBeVisible(LONG)
    : expect(page.locator(".monaco-editor textarea.inputarea")).toBeAttached(
        LONG
      );

test("counts a ResizeObserver loop", async ({ page }) => {
  await countNotices(page);
  await page.goto("/");
  await page.evaluate(() => {
    const box = document.createElement("div");
    box.style.width = "10px";
    document.body.append(box);
    let width = 10;
    new ResizeObserver(() => {
      width += 1;
      box.style.width = `${width}px`;
    }).observe(box);
  });
  await expect.poll(() => noticesOf(page)).toBeGreaterThan(0);
});

for (const [name, viewport] of Object.entries({
  PHONE,
  TABLET,
  DESK,
  WIDE_DESK,
})) {
  test.describe(name, () => {
    test.use({ viewport });

    test("raises no ResizeObserver loop notice on Home, a project opened from it, and a project loaded", async ({
      page,
    }) => {
      await countNotices(page);
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible(LONG);
      await settle(page);
      expect(await noticesOf(page), "Home").toBe(0);

      // Made on a desk: the phone's Home names its tile "New <framework>
      // project", not the "New project" `seedWorkspace` clicks. The project
      // opens from Home without a load, so its first mount counts here.
      await page.setViewportSize(DESK);
      await seedWorkspace(page);
      await projectReady(page, false);
      await settle(page);
      expect(await noticesOf(page), "project opened from Home").toBe(0);

      // A load straight into the project, at this width
      await page.setViewportSize(viewport);
      await page.reload();
      await projectReady(page, viewport === PHONE);
      await settle(page);
      expect(await noticesOf(page), "project loaded").toBe(0);
    });
  });
}
