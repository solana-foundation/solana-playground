import { test as base, expect } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import { isUuid } from "../src/shared/lib/ids";

/** For a step that waits on the explorer, sync or a reload */
export const LONG = { timeout: 60_000 };

/**
 * A browser with one project already created.
 *
 * On a fresh profile the Flow canvas has no workspace, so it opens the
 * "What do you want to build?" gallery over everything and that modal
 * intercepts pointer events -- any test that clicks the canvas needs a
 * project first.
 *
 * Seeds through the gallery's own "Start from scratch" row rather than
 * writing to `indexedDB`: the explorer's on-disk layout is an internal
 * detail, and the default framework files are bundled, so this needs no
 * network.
 */
export const seedWorkspace = async (page: Page, name = "e2e-project") => {
  await page.goto("/");

  const gallery = page.locator("[data-gallery-modal]");
  await expect(gallery).toBeVisible();

  await gallery.getByLabel("Project name").fill(name);
  await gallery.getByRole("button", { name: /^Start/ }).click();

  // `PgExplorer.createWorkspace` closes the modal, then the explorer
  // re-initializes -- wait for the tree, not just the modal.
  await expect(gallery).toBeHidden();
  await expect(page.locator("#root-dir")).toBeVisible();
};

/**
 * The last line `help` prints in the terminal (`test`'s description), so it
 * is in view however narrow the console is. An entry above it scrolls out of
 * the terminal's rows once the stage column is narrow enough to wrap the
 * longer descriptions, and xterm keeps only the rows in view in the page.
 */
export const HELP_TAIL = "Run test(s)";

/**
 * Waits for the editor to take focus, then moves focus out of it.
 *
 * The editor focuses itself when it opens a file, at a moment that varies
 * with the machine, and on macOS Monaco keeps ⌘E (find with selection)
 * while it has focus. A key the shell binds globally, such as ⌘E for the
 * files column, reaches the shell there only from outside the editor, so a
 * test pressing it first settles where focus is.
 */
export const leaveEditor = async (page: Page) => {
  const editor = page.locator(".monaco-editor textarea.inputarea");
  await expect(editor).toBeFocused();
  await editor.blur();
  await expect(editor).not.toBeFocused();
};

export const test = base.extend<{ seededPage: Page }>({
  seededPage: async ({ page }, use) => {
    await seedWorkspace(page);
    // The tree shows before the editor: Monaco is a lazy chunk, and when it
    // mounts it opens the current file and focuses itself, unless the user
    // is typing in a field (`createMountOpen` in `Monaco.tsx`). On a loaded
    // machine that lands after a test has already put the focus somewhere
    // else -- a right-clicked file -- and takes it away. Hand the page over
    // once the editor holds the focus, so it has nothing left to take.
    await expect(page.locator(".monaco-editor textarea.inputarea")).toBeFocused(
      LONG
    );
    await use(page);
  },
});

type WriteBody = {
  files?: Record<string, string>;
  changed?: Record<string, string>;
  removed?: string[];
};

/**
 * What `/api/projects` stores for a write: the whole file set, or a patch on
 * what it already holds. Route stubs use it so a patch does not quietly
 * become a project holding only the files that changed.
 */
export const applyWrite = (
  held: { files: Record<string, string> } | undefined,
  body: WriteBody
) => {
  const files = body.files
    ? { ...body.files }
    : { ...(held?.files ?? {}), ...(body.changed ?? {}) };
  for (const path of body.removed ?? []) delete files[path];
  return { files };
};

export { expect };

export const json = (r: Route, body: unknown) =>
  r.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });

/**
 * Wait until the browser has stopped uploading.
 *
 * A first sign-in is not one write. `program-info.json` is written after the
 * workspace opens, asynchronously and by something other than the editor, so
 * it lands after the first push and schedules its own -- and until that one
 * has been accepted the sync mark describes a snapshot without it. Reloading
 * inside that window is a race, and the losing side looks exactly like a real
 * divergence.
 */
export const settled = async (page: Page, writes: unknown[]) => {
  let last = -1;
  while (last !== writes.length) {
    last = writes.length;
    await page.waitForTimeout(4000);
  }
};

/**
 * The id the explorer gave a workspace, read off its config in IndexedDB.
 *
 * From the store rather than from a handle on the page, which has none for
 * it: the assistant's is the conversation's id, which has not been the
 * workspace's since a project could hold several conversations. Every value
 * is tried, because the volume keeps file contents by inode and the config
 * is simply the one that parses as a workspace list naming this project.
 */
export const workspaceIdOf = (page: Page, name: string) =>
  page.evaluate(async (name) => {
    const dbs: Array<{ name?: string }> = await (
      indexedDB as unknown as {
        databases: () => Promise<Array<{ name?: string }>>;
      }
    ).databases();

    for (const { name: dbName } of dbs) {
      if (!dbName) continue;
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      for (const store of Array.from(db.objectStoreNames)) {
        const values: unknown[] = await new Promise((resolve) => {
          const request = db
            .transaction(store, "readonly")
            .objectStore(store)
            .getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve([]);
        });

        for (const value of values) {
          try {
            const text =
              typeof value === "string"
                ? value
                : new TextDecoder().decode(value as ArrayBuffer);
            const parsed = JSON.parse(text);
            const found = (
              parsed?.workspaces as Array<{ id: string; name: string }>
            )?.find?.((w) => w.name === name);
            if (found) {
              db.close();
              return found.id;
            }
          } catch {
            // Not text, or not JSON: some other file, or the superblock
          }
        }
      }
      db.close();
    }
    return null;
  }, name);

/**
 * A project of this browser's own, to hand over and then reload against.
 *
 * @returns the workspace's id, which is what the account has to list it under
 * for the reload to be about this project. A different id is a project the
 * browser has never seen: it is imported beside this one as "<name>
 * imported", and everything the stub records is about the wrong project.
 */
export const makeLocalProject = async (page: Page, name: string) => {
  await page.goto("/");
  const gallery = page.locator("[data-gallery-modal]");
  await expect(gallery).toBeVisible(LONG);
  await gallery.getByLabel("Project name").fill(name);
  await gallery.getByRole("button", { name: /^Start/ }).click();
  await expect(gallery).toBeHidden(LONG);

  let id: string | null = null;
  await expect
    .poll(async () => (id = await workspaceIdOf(page, name)), LONG)
    .toBeTruthy();
  expect(isUuid(id!)).toBe(true);
  return id!;
};

/**
 * A project's row in the navigation's list: inside its groups, which are
 * where the list is drawn both in the stock Sidebar and on a phone's menu
 * page
 */
export const projectRow = (page: Page, name: string) =>
  page
    .locator('[data-sidebar="group"]')
    .getByRole("button", { name, exact: true });

/** The open project's row (`aria-current="page"`) in the navigation's list */
export const currentProject = (page: Page) =>
  page.locator(
    '[data-sidebar="group"] [data-sidebar="menu-button"][aria-current="page"]'
  );

/** Opens a project's menu in the navigation's list and returns it */
export const projectMenu = async (page: Page, name: string) => {
  await page.getByRole("button", { name: `Actions for ${name}` }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
};

/** Opens the gallery through the navigation's New project item */
export const openGallery = async (page: Page) => {
  await page
    .locator('[data-slot="sidebar"]')
    .getByRole("button", { name: "New project" })
    .click();
};

/**
 * Starts another project from the gallery, opened from the navigation; the
 * gallery opens by itself only on a fresh profile
 */
export const startProject = async (page: Page, name: string) => {
  await openGallery(page);
  const gallery = page.locator("[data-gallery-modal]");
  await expect(gallery).toBeVisible(LONG);
  await gallery.getByLabel("Project name").fill(name);
  await gallery.getByRole("button", { name: /^Start/ }).click();
  await expect(gallery).toBeHidden(LONG);
  await expect(currentProject(page)).toHaveText(name, LONG);
};
