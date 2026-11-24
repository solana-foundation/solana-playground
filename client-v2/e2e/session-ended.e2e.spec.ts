import type { Page, Route } from "@playwright/test";

import {
  expect,
  json,
  LONG,
  projectRow,
  seedWorkspace,
  settled,
  stubAiStatus,
  stubSignedIn,
  test,
  TEST_USER,
} from "./fixtures";

/**
 * A session that ends without a sign-out: the server starts answering 401
 * while the tab still holds the user. The session read and the sync routes are
 * stubbed to say so from `expire()` on; `/api/auth-complete` is the real route,
 * so "Sign in again" runs the real popup flow.
 */

const PROJECT = "session-ended";
const EDIT = "// typed after the session ended";

const account = (page: Page) =>
  page
    .locator('[data-slot="sidebar"] [data-slot="sidebar-footer"]')
    .getByRole("button", { name: /^Account/ });

const signedInThenExpires = async (page: Page) => {
  let expired = false;
  await stubSignedIn(page.context());
  // eslint-disable-next-line unicorn/no-null -- the auth route's wire JSON answers `null` for nobody
  const user = () => (expired ? null : TEST_USER);
  await page.route("**/api/auth/get-session", (r) => json(r, { user: user() }));
  const refuseOnceExpired = (r: Route) =>
    expired ? r.fulfill({ status: 401, body: "" }) : r.fallback();
  await page.route("**/api/projects*", refuseOnceExpired);
  await page.route("**/api/conversations*", refuseOnceExpired);
  // Answers with the callback itself: GitHub's part of the flow, approved
  await page.route("**/api/auth/sign-in/social", (r) => {
    expired = false;
    return json(r, { url: r.request().postDataJSON().callbackURL });
  });

  /** Every upload's body, as it left the browser */
  const uploads: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "PUT" && request.url().includes("/api/projects")) {
      uploads.push(request.postData() ?? "");
    }
  });

  await seedWorkspace(page, PROJECT);
  await expect(account(page)).toHaveAccessibleName("Account: t", LONG);
  await expect.poll(() => uploads.length, LONG).toBeGreaterThanOrEqual(1);
  await settled(page, uploads);

  return {
    uploads,
    expire: () => {
      expired = true;
    },
  };
};

const typeAnEdit = async (page: Page) => {
  await page.locator(".monaco-editor .view-lines").first().click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(`\n${EDIT}`);
};

test("client-v2-account: A session ended", async ({ page }) => {
  test.setTimeout(180_000);
  const { expire } = await signedInThenExpires(page);

  expire();
  await typeAnEdit(page);

  // Within one upload attempt, with no reload
  await expect(account(page)).toHaveAccessibleName(
    "Account: t, session ended",
    LONG
  );
  await expect(account(page)).toContainText("Tester");
  await expect(account(page)).toContainText("Your session ended");

  // The work stayed, and the row says it waits
  await expect(
    page.locator(".monaco-editor .view-lines").first()
  ).toContainText("typed after the session ended");
  await expect(projectRow(page, PROJECT)).toHaveAccessibleDescription(
    "Not synced",
    LONG
  );
  // A name truncates before its marker, on the row with its menu in view
  const name = projectRow(page, PROJECT).getByText(PROJECT, { exact: true });
  const marker = page.locator("[data-sync-marker]");
  const right = await name.evaluate((el) => el.getBoundingClientRect().right);
  const left = await marker.evaluate((el) => el.getBoundingClientRect().left);
  expect(right).toBeLessThanOrEqual(left);
});

test("client-v2-account: Signing in again", async ({ page }) => {
  test.setTimeout(180_000);
  const { expire, uploads } = await signedInThenExpires(page);

  expire();
  await typeAnEdit(page);
  await expect(account(page)).toContainText("Your session ended", LONG);
  uploads.length = 0;

  await account(page).click();
  await page.getByRole("menuitem", { name: "Sign in again" }).click();

  await expect(account(page)).toHaveAccessibleName("Account: t", LONG);
  await expect(account(page)).toContainText("@t");

  // The edit goes up with no question, and the project stays open
  await expect
    .poll(() => uploads.filter((body) => body.includes(EDIT)).length, LONG)
    .toBeGreaterThanOrEqual(1);
  await expect(page.getByText("changed on another device")).toHaveCount(0);
  await expect(
    page.locator(".monaco-editor .view-lines").first()
  ).toContainText("typed after the session ended");
  await expect(projectRow(page, PROJECT)).toHaveAccessibleDescription("", LONG);
});

test("client-v2-account: A sign-out in another tab", async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  let signedOut = false;
  await stubSignedIn(context);
  await context.route("**/api/auth/get-session", (r) =>
    // eslint-disable-next-line unicorn/no-null -- the auth route's wire JSON answers `null` for nobody
    json(r, { user: signedOut ? null : TEST_USER })
  );
  await context.route("**/api/auth/sign-out", (r) => {
    signedOut = true;
    return json(r, { success: true });
  });
  await seedWorkspace(page, PROJECT);
  await expect(account(page)).toHaveAccessibleName("Account: t", LONG);

  await account(page).click();
  const menu = page.getByRole("menu", { name: "Account" });
  await menu.getByRole("menuitem", { name: "Sign out" }).click();
  await menu.getByRole("menuitem", { name: /^Sign out/ }).click();
  await expect.poll(() => signedOut, LONG).toBe(true);
  // The menu stays open, signed out; the page behind it is read once it closes
  await expect(menu.getByText("Sign out of Playground?")).toBeHidden(LONG);
  await page.keyboard.press("Escape");
  await expect(account(page)).toHaveAccessibleName("Account, signed out", LONG);

  const other = await context.newPage();
  await other.goto("/");
  await expect(account(other)).toHaveAccessibleName(
    "Account, signed out",
    LONG
  );
  await expect(account(other)).toContainText("Saved in this browser");
});

test("client-v2-account: Another account after a session ended", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const other = { id: "u2", name: "Other", image: TEST_USER.image, login: "o" };
  /** Who the session read answers with once a sign-in completes */
  let next = TEST_USER;
  let expired = false;
  await stubSignedIn(page.context());
  await page.route("**/api/auth/get-session", (r) =>
    // eslint-disable-next-line unicorn/no-null -- the auth route's wire JSON answers `null` for nobody
    json(r, { user: expired ? null : next })
  );
  const refuseOnceExpired = (r: Route) =>
    expired ? r.fulfill({ status: 401, body: "" }) : r.fallback();
  await page.route("**/api/projects*", refuseOnceExpired);
  await page.route("**/api/conversations*", refuseOnceExpired);
  await page.route("**/api/auth/sign-in/social", (r) => {
    expired = false;
    return json(r, { url: r.request().postDataJSON().callbackURL });
  });
  await stubAiStatus(page, "z-ai/glm-5.3-flash:US");
  await page.route("**/api/agent", (r) =>
    r.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: 'data: {"choices":[{"delta":{"content":"An answer for t"}}]}\n\ndata: [DONE]\n\n',
    })
  );

  /** The thread id of every conversation upload, with who was signed in */
  const posts: { threadId: string; as: string }[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/api/conversations")
    ) {
      posts.push({
        threadId: request.postDataJSON()?.threadId,
        as: expired ? "nobody" : next.id,
      });
    }
  });

  await seedWorkspace(page, PROJECT);
  await expect(account(page)).toHaveAccessibleName("Account: t", LONG);

  // The first account asks something, and its thread reaches its account
  const input = page.getByRole("textbox", { name: "Message the assistant" });
  await input.fill("A question only t should see");
  await input.press("Enter");
  await expect(page.getByText("An answer for t")).toBeVisible(LONG);
  await expect.poll(() => posts.length, LONG).toBeGreaterThanOrEqual(1);
  const firstAccountThreads = new Set(posts.map(({ threadId }) => threadId));

  // Its session ends without a sign-out, and another account signs in
  expired = true;
  await typeAnEdit(page);
  await expect(account(page)).toContainText("Your session ended", LONG);
  next = other;
  posts.length = 0;
  await account(page).click();
  await page.getByRole("menuitem", { name: "Sign in again" }).click();
  await expect(account(page)).toHaveAccessibleName("Account: o", LONG);

  // The panel moved off the first account's conversation
  await expect(page.getByText("A question only t should see")).toHaveCount(
    0,
    LONG
  );
  await settled(page, posts);
  expect(
    posts.filter(({ threadId }) => firstAccountThreads.has(threadId))
  ).toEqual([]);
});
