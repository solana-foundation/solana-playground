import type { Page } from "@playwright/test";

import { expect, LONG, test } from "./fixtures";

// HOO-2732: the frame and the phone layout show one chat, moved between them,
// so what the composer holds survives the window crossing the frame's width

/** The frame's chat column, at the frame's width */
const frameChat = (page: Page) =>
  page.getByRole("complementary", { name: "Tutorial chat" });
/** The phone layout's Chat space, below the frame's width */
const phoneChat = (page: Page) => page.getByRole("region", { name: "Chat" });
const composer = (scope: ReturnType<typeof frameChat>) =>
  scope.locator('textarea[enterkeyhint="send"]');

const DRAFT = "what does the space constraint count?";

test.beforeEach(async ({ page }) => {
  // No default backend, whatever the dev server is configured with
  await page.route("**/api/agent", (route) =>
    // eslint-disable-next-line unicorn/no-null -- the endpoint's JSON says null
    route.fulfill({ json: { configured: false, model: null } })
  );
});

test("keeps the composer's draft when the window crosses the frame's width", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tutorials/hello-anchor");
  await frameChat(page)
    .getByRole("button", { name: /Start step 1/ })
    .click(LONG);
  await expect(frameChat(page).getByText("Step 1 of 4")).toBeVisible(LONG);
  await composer(frameChat(page)).fill(DRAFT);

  // Narrower than the frame: the phone layout's Chat holds the same draft
  await page.setViewportSize({ width: 900, height: 800 });
  await expect(phoneChat(page)).toBeVisible(LONG);
  await expect(composer(phoneChat(page))).toHaveValue(DRAFT);

  // And back
  await composer(phoneChat(page)).fill(`${DRAFT} again`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(composer(frameChat(page))).toHaveValue(`${DRAFT} again`);
});
