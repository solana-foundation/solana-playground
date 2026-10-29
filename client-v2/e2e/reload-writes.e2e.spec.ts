import type { Locator, Page } from "@playwright/test";

import { expect, LONG, startProject, test } from "./fixtures";

// lightning-fs writes a file's content at once and saves its folder tree (the
// superblock) 500 ms after the last write. A page load inside that window
// comes back to the tree as it was last saved: a file created in the window
// is gone, a rename is undone, and a deleted file is listed again with no
// content. Each case below leaves the page right after one such change (or,
// for a file the app writes on its own, right after its content is stored)
// and checks the tree the store kept.

/** Same origin as the app, so the store is readable, without booting it */
const PROBE = "/__reload-writes-probe";

/**
 * Leaves the app for a page that does not run it, which drops whatever the
 * store had not saved yet, as a reload does, and reads the saved tree before
 * a new copy of the app could write anything of its own.
 *
 * @returns whether the store's saved tree reaches each path
 */
const leaveAndRead = async (page: Page, paths: string[]) => {
  await page.route(`**${PROBE}`, (route) =>
    route.fulfill({ contentType: "text/html", body: "<html></html>" })
  );
  await page.goto(PROBE);

  return page.evaluate(async (paths) => {
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const request = indexedDB.open("solana-playground");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const root: unknown = await new Promise((resolve, reject) => {
      const request = db
        .transaction(db.objectStoreNames[0], "readonly")
        .objectStore(db.objectStoreNames[0])
        .get("!root");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();

    // lightning-fs keeps the tree as nested maps, one per folder, keyed by
    // name, under the root folder "/"
    const reaches = (path: string) => {
      let node = (root as Map<string, unknown>).get("/");
      for (const name of path.split("/").filter(Boolean)) {
        if (!(node instanceof Map)) return false;
        node = node.get(name);
      }
      return node !== undefined;
    };
    return paths.map(reaches);
  }, paths);
};

/**
 * Waits until the store holds a file's content with every one of `parts` in
 * it. Content lands at once and apart from the tree, so this says the write
 * happened, not that a reload would find it -- the gap the cases measure.
 */
const waitForStored = (page: Page, parts: string[]) =>
  expect
    .poll(
      () =>
        page.evaluate(async (parts) => {
          const db: IDBDatabase = await new Promise((resolve, reject) => {
            const request = indexedDB.open("solana-playground");
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          const values: unknown[] = await new Promise((resolve, reject) => {
            const request = db
              .transaction(db.objectStoreNames[0], "readonly")
              .objectStore(db.objectStoreNames[0])
              .getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          db.close();

          return values.some((value) => {
            if (!(value instanceof Uint8Array)) return false;
            const text = new TextDecoder().decode(value);
            return parts.every((part) => text.includes(part));
          });
        }, parts),
      LONG
    )
    .toBe(true);

const tree = (page: Page) => page.locator("#root-dir");
const item = (page: Page, name: string): Locator =>
  tree(page).getByText(name, { exact: true });

const PROJECT = "reload-writes";

/** Creates a file in `src` through the explorer's menu */
const createFile = async (page: Page, name: string) => {
  await item(page, "src").click({ button: "right" });
  await page.getByRole("menuitem", { name: /New File/ }).click();
  const input = tree(page).getByRole("textbox");
  await expect(input).toBeFocused();
  await input.fill(name);
  await page.keyboard.press("Enter");
  await expect(item(page, name)).toBeVisible();
};

/**
 * A project whose own creation has long been saved, and whose metadata has
 * been written once since: every explorer change ends in `saveMeta`, whose
 * first write after a project is created saves the whole tree too. Without
 * this, that save would keep a case's change whether or not the change saves
 * the tree itself.
 */
const settledProject = async (page: Page) => {
  await page.goto("/");
  await startProject(page, PROJECT, LONG);
  await expect(item(page, "lib.rs")).toBeVisible(LONG);
  await createFile(page, "warm.rs");
  // Past the store's own 500 ms save, so only what the case writes is at stake
  await page.waitForTimeout(1000);
};

const path = (...names: string[]) => ["", PROJECT, ...names].join("/");

test("a file created just before a reload is still there", async ({ page }) => {
  await settledProject(page);

  await createFile(page, "fresh.rs");

  expect(await leaveAndRead(page, [path("src", "fresh.rs")])).toEqual([true]);
});

test("a file renamed just before a reload keeps its new name", async ({
  page,
}) => {
  await settledProject(page);

  await item(page, "lib.rs").click({ button: "right" });
  await page.getByRole("menuitem", { name: /Rename/ }).click();
  const dialog = page.getByRole("dialog", { name: "Rename 'lib.rs'" });
  await dialog.getByRole("textbox").fill("renamed.rs");
  await page.keyboard.press("Enter");
  await expect(item(page, "renamed.rs")).toBeVisible();

  expect(
    await leaveAndRead(page, [path("src", "renamed.rs"), path("src", "lib.rs")])
  ).toEqual([true, false]);
});

test("a file deleted just before a reload stays deleted", async ({ page }) => {
  await settledProject(page);

  await item(page, "lib.rs").click({ button: "right" });
  await page.getByRole("menuitem", { name: /Delete/ }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(item(page, "lib.rs")).toHaveCount(0);

  // `warm.rs` is the control: a tree that cannot be read reaches nothing
  expect(
    await leaveAndRead(page, [path("src", "lib.rs"), path("src", "warm.rs")])
  ).toEqual([false, true]);
});

test("a new project's open tabs survive a reload right after it is made", async ({
  page,
}) => {
  await page.goto("/");
  await startProject(page, PROJECT, LONG);
  // The metadata names the open tab; once its content is stored, only the
  // tree that reaches it is at stake
  await waitForStored(page, ['"path":"src/lib.rs"', '"isCurrent":true']);

  expect(
    await leaveAndRead(page, [path(".workspace", "metadata.json")])
  ).toEqual([true]);
});

// A tutorial without a lesson path: a lesson's own progress file is written
// through `writeWorkspaceFile`, whose flush would save this one's tree too
test("a tutorial's progress file survives a reload right after START", async ({
  page,
}) => {
  await page.goto("/tutorials/bank-simulator");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page).toHaveURL(/\/tutorials\/bank-simulator\/1$/, LONG);
  await waitForStored(page, ['"pageNumber":1', '"completed":false']);

  expect(await leaveAndRead(page, ["/Bank Simulator/.tutorial.json"])).toEqual([
    true,
  ]);
});
