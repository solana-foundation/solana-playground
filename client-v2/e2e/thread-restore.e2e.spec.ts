import { expect, test } from "@playwright/test";
import { isUuid } from "../src/shared/lib/ids";
import type { Page } from "@playwright/test";

/**
 * A stored thread actually reaches the panel after a reload.
 *
 * `chat-threads.e2e.spec.ts` covers the storage layer by opening IndexedDB and
 * reading the file back. That proves the write landed, but not that the app
 * restores it -- a thread can be on disk and still never be loaded, which
 * looks identical to "nothing was saved" from the user's side. This asks the
 * store what it came back with instead.
 *
 * Reading through the store rather than the database also means no
 * `indexedDB.databases()`, which WebKit does not implement, so this one can
 * run on any engine:
 *
 *   npx playwright test thread-restore --browser=webkit
 *
 * The tutorial case is separate from the project case on purpose: a tutorial's
 * workspace id is derived (`tut:hello-anchor`) where a project's is a minted
 * uuid, and the tutorial reaches its workspace by a different route.
 */

const LONG = { timeout: 60_000 };

type AssistantWindow = Window & {
  __pgAssistant?: {
    items: unknown[];
    threadId?: string;
    addUserMessage: (t: string) => void;
    connect: (c: { id: string; apiKey: string }) => void;
  };
};

const items = (page: Page) =>
  page.evaluate(() =>
    JSON.stringify((window as AssistantWindow).__pgAssistant?.items ?? [])
  );

const threadId = (page: Page) =>
  page.evaluate(
    () => (window as AssistantWindow).__pgAssistant?.threadId ?? null
  );

/** `expect.poll` needs a value to compare, and `validate` is the check */
const threadIdIsUuid = async (page: Page) =>
  isUuid((await threadId(page)) ?? "");

/** Waits for the panel to mount, then writes one message through the store */
const remember = async (page: Page) => {
  await expect
    .poll(
      () => page.evaluate(() => !!(window as AssistantWindow).__pgAssistant),
      LONG
    )
    .toBe(true);
  await expect.poll(() => threadId(page), LONG).toBeTruthy();

  await page.evaluate(() =>
    (window as AssistantWindow).__pgAssistant!.addUserMessage("remember me")
  );
  // The store writes back asynchronously; reloading straight away races it
  await expect.poll(() => items(page), LONG).toContain("remember me");
  await page.waitForTimeout(1000);
};

const stillRemembers = async (page: Page) => {
  await page.reload();
  await expect
    .poll(
      () => page.evaluate(() => !!(window as AssistantWindow).__pgAssistant),
      LONG
    )
    .toBe(true);
  await expect.poll(() => items(page), LONG).toContain("remember me");

  // Restoring it is only half the job. A reload starts with no live connection
  // (a key-based backend comes back from sessionStorage, the default after its
  // probe), so connecting from nothing is the first thing that happens after
  // every reload -- and that used to be taken for a backend *switch*, which
  // resets the panel and then wrote the emptied list back over the stored
  // thread. Restored and then immediately thrown away is indistinguishable
  // from never saved.
  await page.evaluate(() =>
    (window as AssistantWindow).__pgAssistant!.connect({
      id: "anthropic",
      apiKey: "not-used-here",
    })
  );
  await expect.poll(() => items(page), LONG).toContain("remember me");
};

test("a project conversation is restored after a reload", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/");

  const gallery = page.locator("[data-gallery-modal]");
  await expect(gallery).toBeVisible(LONG);
  await gallery.getByLabel("Project name").fill("alpha");
  await gallery.getByRole("button", { name: /^Start/ }).click();
  await expect(gallery).toBeHidden(LONG);

  await remember(page);
  await stillRemembers(page);
});

test("a tutorial conversation is restored after a reload", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/");

  await expect(page.getByText("What do you want to build?")).toBeVisible(LONG);
  await page.getByRole("tab", { name: /tutorials/i }).click();
  await page
    .getByText("Hello Anchor", { exact: true })
    .locator("xpath=../..")
    .getByRole("button", { name: "Open" })
    .click();
  await expect(page).toHaveURL(/\/tutorials\/hello-anchor/, LONG);

  // Opening only routes there -- START is what creates the workspace, and
  // without one there is no id to key a conversation on
  await page.getByRole("button", { name: "START", exact: true }).click();
  // The thread id is the conversation's own, not the workspace's: a project
  // may hold several. What matters here is that opening the lesson opened a
  // conversation at all.
  await expect.poll(() => threadIdIsUuid(page), LONG).toBe(true);

  await remember(page);
  await stillRemembers(page);
});
