import type { Page, Route } from "@playwright/test";

import {
  applyWrite,
  expect,
  isStored,
  json,
  LONG,
  openGallery,
  seedWorkspace,
  test,
  TEST_USER,
} from "./fixtures";

/**
 * Deleting the account from the account menu (`account-deletion`).
 *
 * The account is stubbed: a project store that keeps what it accepts, and
 * refuses every upload of one project, which so never reaches the account.
 * The deletion keeps that one and removes the one the account held, as a
 * sign-out would, without uploading anything first.
 */

test.describe.configure({ timeout: 180_000 });

const SYNCED = "synced-project";
const KEPT = "kept-here";

/** The footer's account row, or the rail's "Account", whatever the session */
const account = (page: Page) =>
  page
    .locator('[data-slot="sidebar"] [data-slot="sidebar-footer"]')
    .getByRole("button", { name: /^Account/ });

/**
 * A project's row in the navigation's list. Not `projectRow`, whose exact
 * name misses a project the account lacks: its row also says "This browser"
 */
const projectRow = (page: Page, name: string) =>
  page
    .locator('[data-sidebar="group"]')
    .getByRole("button", { name: new RegExp(`^${name}\\b`) });

/** The open project's row, whatever badge it carries */
const currentRow = (page: Page) =>
  page.locator(
    '[data-sidebar="group"] [data-sidebar="menu-button"][aria-current="page"]'
  );

/**
 * Starts another project from the New project page. Not `startAnotherProject`,
 * which reads the open row's text exactly, for the same reason
 */
const startAnotherProject = async (page: Page, name: string) => {
  await openGallery(page);
  const gallery = page.locator("[data-new-project]");
  await expect(gallery).toBeVisible(LONG);
  await gallery.getByLabel("Project name").fill(name);
  await gallery.getByRole("button", { name: /^Start/ }).click();
  await expect(gallery).toBeHidden(LONG);
  await expect(currentRow(page)).toContainText(name, LONG);
};

type Files = Record<string, string>;

/**
 * A signed-in account whose `DELETE /api/account` answers `answer`; once it
 * answers 200 the session reads as signed out. Every request the browser
 * makes of the account is recorded, the deletion's included.
 */
const stubAccountWith =
  (answer: () => { status: number; body: unknown }) => async (page: Page) => {
    let signedIn = true;
    const rows = new Map<string, { name: string; files: Files }>();
    // The threads the account holds, by id; any other reads as never seen
    const threads = new Map<string, unknown[]>();
    const requests: string[] = [];

    await page.route("**/api/auth/get-session", (r) =>
      // eslint-disable-next-line unicorn/no-null -- the session endpoint answers `user: null` for nobody
      json(r, { user: signedIn ? TEST_USER : null })
    );
    await page.route("**/api/sync", (r) =>
      json(r, { enabled: true, db: "ok" })
    );
    await page.route("**/api/conversations*", (r) => {
      requests.push(`${r.request().method()} conversations`);
      const threadId = new URL(r.request().url()).searchParams.get("threadId");
      if (r.request().method() === "GET" && threadId) {
        const items = threads.get(threadId);
        return items
          ? json(r, { thread: { id: threadId }, items })
          : r.fulfill({ status: 404, body: "" });
      }
      return json(r, { items: [], threads: [] });
    });
    await page.route("**/api/projects*", (r: Route) => {
      const req = r.request();
      const id = new URL(req.url()).searchParams.get("id");
      if (req.method() === "PUT") {
        const body = req.postDataJSON();
        requests.push(`PUT ${body.name}`);
        // Never reaches the account: no mark is written for it
        if (body.name === KEPT) return r.fulfill({ status: 500, body: "" });
        if (!body.files && !rows.has(body.id)) {
          return r.fulfill({
            status: 409,
            contentType: "application/json",
            // eslint-disable-next-line unicorn/no-null -- the endpoint's conflict answer carries `updatedAt: null` for a missing row
            body: JSON.stringify({ conflict: true, updatedAt: null }),
          });
        }
        rows.set(body.id, {
          name: body.name,
          files: applyWrite(rows.get(body.id), body).files,
        });
        return json(r, { updatedAt: new Date().toISOString() });
      }
      if (req.method() !== "GET") {
        return r.fulfill({ status: 405, body: "" });
      }
      if (!id) {
        return json(r, {
          projects: Array.from(rows, ([rowId, row]) => ({
            id: rowId,
            name: row.name,
            kind: "project",
            updatedAt: new Date(0).toISOString(),
          })),
        });
      }
      const row = rows.get(id);
      return row
        ? json(r, {
            project: {
              id,
              name: row.name,
              kind: "project",
              updatedAt: new Date(0).toISOString(),
              snapshot: { files: row.files },
            },
          })
        : r.fulfill({ status: 404, body: "" });
    });
    await page.route("**/api/account", (r) => {
      requests.push(`${r.request().method()} account`);
      const { status, body } = answer();
      if (status === 200) signedIn = false;
      return r.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });

    return { rows, threads, requests };
  };

/** Both projects in the browser, the account holding only `SYNCED` */
const twoProjects = async (
  page: Page,
  stub: Awaited<ReturnType<ReturnType<typeof stubAccountWith>>>
) => {
  await seedWorkspace(page, SYNCED);
  await expect(account(page)).toHaveAccessibleName("Account: t", LONG);
  await expect
    .poll(
      () => Array.from(stub.rows.values()).some((row) => row.name === SYNCED),
      LONG
    )
    .toBe(true);
  await startAnotherProject(page, KEPT);
  await expect
    .poll(() => stub.requests.includes(`PUT ${KEPT}`), LONG)
    .toBe(true);
  await expect(projectRow(page, SYNCED)).toBeVisible();
  await expect(projectRow(page, KEPT)).toBeVisible();
};

type AssistantWindow = Window & {
  __pgAssistant?: {
    threadId: string | null;
    addUserMessage: (text: string) => void;
  };
};

/**
 * Writes `text` into the open project's thread, once one is open, and
 * returns the thread's id and its items as stored
 */
const writeToThread = async (page: Page, text: string) => {
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window as AssistantWindow).__pgAssistant?.threadId ?? ""
        ),
      LONG
    )
    .not.toBe("");
  const threadId = await page.evaluate((message) => {
    const assistant = (window as AssistantWindow).__pgAssistant;
    if (!assistant?.threadId) throw new Error("no thread is open");
    assistant.addUserMessage(message);
    return assistant.threadId;
  }, text);
  await expect.poll(() => isStored(page, text), LONG).toBe(true);
  const items = await page.evaluate(
    () =>
      (window as AssistantWindow & { __pgAssistant?: { items: unknown[] } })
        .__pgAssistant?.items ?? []
  );
  return { threadId, items };
};

/** Opens the account menu and asks to delete, in place */
const askToDelete = async (page: Page) => {
  const menu = page.getByRole("menu", { name: "Account" });
  await account(page).click();
  // From the keyboard: a click leaves the pointer over the question's items,
  // and a pointer that moves there takes the focus Cancel holds
  await menu.getByRole("menuitem", { name: "Delete account" }).focus();
  await page.keyboard.press("Enter");
  await expect(menu.getByText("Delete your Playground account?")).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Cancel" })).toBeFocused();
  return menu;
};

const closeMenu = async (page: Page) => {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu", { name: "Account" })).toBeHidden();
};

test("account-deletion: Deleting from the menu", async ({ page }) => {
  const stub = await stubAccountWith(() => ({
    status: 200,
    body: { githubRevoked: false },
  }))(page);
  await twoProjects(page, stub);
  // A thread the account lacks an item of, on the open project
  await writeToThread(page, "said only here");
  // And one the account holds whole, on the other
  await projectRow(page, SYNCED).click();
  await expect(currentRow(page)).toContainText(SYNCED, LONG);
  const held = await writeToThread(page, "held by the account");
  stub.threads.set(held.threadId, held.items);

  const menu = await askToDelete(page);
  await expect(menu).toContainText(
    "Your projects and chats saved to the account are deleted, here and on every device. This cannot be undone."
  );
  await expect(
    menu.getByRole("menuitem", { name: "Export this project" })
  ).toBeVisible();
  // Nothing goes up between the confirmation and the deletion
  const before = stub.requests.length;
  await menu.getByRole("menuitem", { name: /^Delete account/ }).click();

  await expect(menu.getByText("Your account was deleted.")).toBeVisible(LONG);
  const github = menu.getByRole("link", {
    name: "Remove Playground from your GitHub settings too.",
  });
  await expect(github).toHaveAttribute(
    "href",
    "https://github.com/settings/applications"
  );
  // Reads of what the account holds, then the deletion: nothing uploaded
  const after = stub.requests.slice(before);
  expect(after.filter((r) => !r.startsWith("GET "))).toEqual([
    "DELETE account",
  ]);

  await closeMenu(page);
  await expect(account(page)).toHaveAccessibleName("Account, signed out", LONG);
  await expect(account(page)).toContainText("Sign in");
  await expect(projectRow(page, SYNCED)).toHaveCount(0, LONG);
  await expect(projectRow(page, KEPT)).toBeVisible();
  await expect
    .poll(() => isStored(page, "held by the account"), LONG)
    .toBe(false);
  expect(await isStored(page, "said only here")).toBe(true);
});

test("account-deletion: Deletion refused", async ({ page }) => {
  const stub = await stubAccountWith(() => ({
    status: 500,
    body: { error: "Could not delete the account" },
  }))(page);
  await twoProjects(page, stub);

  const menu = await askToDelete(page);
  await menu.getByRole("menuitem", { name: /^Delete account/ }).click();

  await expect(menu.getByRole("alert")).toHaveText(
    "Couldn't delete your account. Try again.",
    LONG
  );
  await expect(menu.getByText("Delete your Playground account?")).toBeVisible();

  await closeMenu(page);
  await expect(account(page)).toHaveAccessibleName("Account: t");
  await expect(projectRow(page, SYNCED)).toBeVisible();
  await expect(projectRow(page, KEPT)).toBeVisible();
});
