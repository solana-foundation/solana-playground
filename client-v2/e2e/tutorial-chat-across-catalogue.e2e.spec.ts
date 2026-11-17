import type { Locator, Page } from "@playwright/test";

import { expect, LONG, stubAiStatus, stubSession, test } from "./fixtures";
import { PHONE, WIDE_DESK } from "./viewports";

// HOO-2739: Back to tutorials closes the tutorial and unmounts its chat; the
// composer's draft and a running reply's Stop are still there on the way back

const DRAFT = "what does the space constraint count?";

/** The frame's chat column, at the frame's width */
const frameChat = (page: Page) =>
  page.getByRole("complementary", { name: "Tutorial chat" });
/** The phone layout's Chat space, below the frame's width */
const phoneChat = (page: Page) => page.getByRole("region", { name: "Chat" });
const composer = (scope: Locator) =>
  scope.locator('textarea[enterkeyhint="send"]');

const widths = [
  {
    name: "desktop",
    size: WIDE_DESK,
    chat: frameChat,
    back: (page: Page) =>
      frameChat(page).getByRole("button", { name: "Tutorials" }).click(),
  },
  {
    name: "phone",
    size: PHONE,
    chat: phoneChat,
    back: (page: Page) =>
      page.getByRole("button", { name: "Back to tutorials" }).click(),
  },
];

for (const width of widths) {
  test(`keeps the draft and Stop across Back to tutorials (${width.name})`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // A hosted default that holds every turn open until the test ends
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await stubSession(page);
    await stubAiStatus(page, "z-ai/glm-5.3-flash:US");
    await page.route("**/api/agent", async (route) => {
      await held;
      // May reject when the page has already closed: nothing left to answer
      await route.abort().catch((error: unknown) => {
        // eslint-disable-next-line no-console -- e2e has no app logger; the rejection is expected once the page is gone
        console.info("route.abort rejected after the page closed:", error);
      });
    });

    await page.setViewportSize(WIDE_DESK);
    await page.goto("/tutorials/hello-anchor");
    await frameChat(page)
      .getByRole("button", { name: /Start step 1/ })
      .click(LONG);
    await expect(frameChat(page).getByText("Step 1 of 4")).toBeVisible(LONG);
    await page.setViewportSize(width.size);
    const chat = width.chat(page);
    await expect(chat).toBeVisible(LONG);

    // A question whose answer is still streaming, and the next one drafted
    await composer(chat).fill("Say hello");
    await composer(chat).press("Enter");
    const stop = chat.getByRole("button", { name: "Stop", exact: true });
    await expect(stop).toBeVisible(LONG);
    await composer(chat).fill(DRAFT);

    await width.back(page);
    await expect(page).toHaveURL(/\/tutorials$/);
    await expect(chat).toHaveCount(0);

    await page.goBack();
    await expect(composer(chat)).toHaveValue(DRAFT, LONG);
    await expect(stop).toBeVisible();
    await stop.click();
    await expect(chat.getByText("Stopped.")).toBeVisible(LONG);

    release();
  });
}
