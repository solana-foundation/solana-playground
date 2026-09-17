import { expect, test } from "./fixtures";
import { seedWorkspace } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * The upgrade path: a config written before workspaces had ids.
 *
 * `workspace-ids.e2e.spec.ts` starts from a clean profile, so it only ever
 * sees the new shape. Every *existing* user has the old one on disk, and the
 * failure mode there is silent -- the project list comes back empty and the
 * app greets them as new. That is the case worth holding.
 *
 * There is no way to seed the old shape through the UI, since the app only
 * writes the new one. So a project is created normally and its config file is
 * then rewritten in place, in the backing store, to what the previous version
 * would have left behind.
 */

const CONFIG_MARKER = "workspaces.json";

/** The file store keys by inode, so the config is found by its content */
const rewriteConfig = (page: Page, next: unknown) =>
  page.evaluate(
    async ({ next, marker }) => {
      const dbs = await (indexedDB as any).databases();
      const name = dbs.map((d: any) => d.name).find((n: string) => n?.includes("solana"));
      if (!name) throw new Error("no filesystem database");

      const db: IDBDatabase = await new Promise((res, rej) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      const store = Array.from(db.objectStoreNames).find((s) => s.includes("files"));
      if (!store) throw new Error("no file store");

      const read = <T>(fn: (s: IDBObjectStore) => IDBRequest): Promise<T> =>
        new Promise((res) => {
          const rq = fn(db.transaction(store, "readonly").objectStore(store));
          rq.onsuccess = () => res(rq.result as T);
        });

      const keys = await read<IDBValidKey[]>((s) => s.getAllKeys());
      const values = await read<any[]>((s) => s.getAll());

      // The config is the only file whose content names the workspaces
      let target: IDBValidKey | undefined;
      values.forEach((v, i) => {
        let text = "";
        try {
          text = new TextDecoder().decode(v);
        } catch {
          return;
        }
        if (/"workspaces"|"allNames"/.test(text)) target = keys[i];
      });
      if (target === undefined) throw new Error(`no file matching ${marker}`);

      await new Promise<void>((res, rej) => {
        const tx = db.transaction(store, "readwrite");
        tx.objectStore(store).put(new TextEncoder().encode(JSON.stringify(next)), target!);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
    },
    { next, marker: CONFIG_MARKER }
  );

const readConfig = (page: Page) =>
  page.evaluate(async () => {
    const dbs = await (indexedDB as any).databases();
    const name = dbs.map((d: any) => d.name).find((n: string) => n?.includes("solana"));
    const db: IDBDatabase = await new Promise((res) => {
      const r = indexedDB.open(name!);
      r.onsuccess = () => res(r.result);
    });
    const store = Array.from(db.objectStoreNames).find((s) => s.includes("files"))!;
    const values: any[] = await new Promise((res) => {
      const rq = db.transaction(store, "readonly").objectStore(store).getAll();
      rq.onsuccess = () => res(rq.result);
    });
    for (const v of values) {
      let text = "";
      try {
        text = new TextDecoder().decode(v);
      } catch {
        continue;
      }
      if (/"workspaces"|"allNames"/.test(text)) return text;
    }
    return "";
  });

const switcher = (page: Page) => page.locator('[aria-haspopup="true"]').first();

/**
 * Add a project to a profile that already has one.
 *
 * `seedWorkspace` goes through the gallery that only greets an empty profile,
 * so a second project has to be reached through the switcher.
 */
const addWorkspace = async (page: Page, name: string) => {
  await switcher(page).click();
  await page.getByLabel("Projects and lessons").getByText("Browse gallery").click();

  const gallery = page.locator("[data-gallery-modal]");
  await expect(gallery).toBeVisible();
  await gallery.getByLabel("Project name").fill(name);
  await gallery.getByRole("button", { name: /^Start/ }).click();

  await expect(gallery).toBeHidden();
  await expect(page.locator("#root-dir")).toBeVisible();
  await expect(switcher(page)).toContainText(name);
};

test("a pre-id config still opens its project", async ({ page }) => {
  await seedWorkspace(page, "alpha");

  // What the previous version left on disk
  await rewriteConfig(page, { allNames: ["alpha"], currentName: "alpha" });

  await page.reload();

  await expect(page.locator("#root-dir")).toBeVisible();
  await expect(switcher(page)).toContainText("alpha");
});

test("a pre-id config is rewritten with ids", async ({ page }) => {
  await seedWorkspace(page, "alpha");
  await rewriteConfig(page, { allNames: ["alpha"], currentName: "alpha" });

  await page.reload();
  await expect(page.locator("#root-dir")).toBeVisible();

  const config = JSON.parse(await readConfig(page));
  expect(config.workspaces).toEqual([
    { id: expect.any(String), name: "alpha" },
  ]);
  // The pointer moved from a name to the id it now resolves through
  expect(config.currentId).toBe(config.workspaces[0].id);
  expect(config.allNames).toBeUndefined();
});

test("a pre-id config naming no current workspace keeps the workspace", async ({
  page,
}) => {
  await seedWorkspace(page, "alpha");
  // The old shape made `currentName` optional, so a config could name
  // workspaces without pointing at one
  await rewriteConfig(page, { allNames: ["alpha"] });

  await page.reload();

  // What the app shows with nothing current is unchanged by this work and not
  // what is under test; the invariant is that the workspace is not lost.
  // Polled rather than waiting on a load state: the dev server holds a
  // hot-reload socket open, so `networkidle` never settles.
  await expect
    .poll(async () => JSON.parse((await readConfig(page)) || "{}").workspaces, {
      timeout: 15_000,
    })
    .toEqual([{ id: expect.any(String), name: "alpha" }]);

  const config = JSON.parse(await readConfig(page));
  expect(config.currentId).toBeUndefined();
  expect(config.allNames).toBeUndefined();
});

test("a pre-id config with several projects migrates all of them", async ({
  page,
}) => {
  await seedWorkspace(page, "alpha");
  await addWorkspace(page, "beta");
  await addWorkspace(page, "gamma");

  // What a real existing profile looks like: several projects, and the one
  // the user was last in is not the one created most recently
  await rewriteConfig(page, {
    allNames: ["alpha", "beta", "gamma"],
    currentName: "beta",
  });

  await page.reload();

  await expect(page.locator("#root-dir")).toBeVisible();
  await expect(switcher(page)).toContainText("beta");

  const config = JSON.parse(await readConfig(page));
  expect(config.workspaces.map((w: { name: string }) => w.name)).toEqual([
    "alpha",
    "beta",
    "gamma",
  ]);

  // Every project keeps an id of its own -- one shared id would collapse
  // their conversations into each other once sync lands
  const ids = config.workspaces.map((w: { id: string }) => w.id);
  expect(new Set(ids).size).toBe(3);

  // The pointer has to survive as the same project, not merely as some project
  const beta = config.workspaces.find(
    (w: { name: string }) => w.name === "beta"
  );
  expect(config.currentId).toBe(beta.id);
  expect(config.allNames).toBeUndefined();
});

test("every project in a migrated config still opens", async ({ page }) => {
  await seedWorkspace(page, "alpha");
  await addWorkspace(page, "beta");

  await rewriteConfig(page, {
    allNames: ["alpha", "beta"],
    currentName: "alpha",
  });
  await page.reload();
  await expect(page.locator("#root-dir")).toBeVisible();

  // Switching is what proves the migrated ids actually resolve to directories
  for (const name of ["beta", "alpha"]) {
    await switcher(page).click();
    await page
      .getByLabel("Projects and lessons")
      .getByText(name, { exact: true })
      .click();

    await expect(switcher(page)).toContainText(name);
    await expect(page.locator("#root-dir")).not.toBeEmpty();
  }
});

/**
 * Start the Hello Anchor tutorial, creating its workspace.
 *
 * A tutorial workspace is named after the tutorial, and `PgTutorial.start()`
 * is what calls `PgExplorer.createWorkspace()` -- opening the card alone only
 * reaches upstream's About screen.
 */
const startTutorial = async (page: Page) => {
  const gallery = page.getByText("What do you want to build?");

  // On an empty profile the gallery opens by itself, but not instantly -- so
  // wait for it rather than sampling visibility, which races the first render
  const openedItself = await gallery
    .waitFor({ state: "visible", timeout: 20_000 })
    .then(() => true)
    .catch(() => false);

  if (!openedItself) {
    await switcher(page).click();
    await page.getByRole("button", { name: "Browse gallery" }).click();
    await expect(gallery).toBeVisible();
  }

  await page.getByRole("tab", { name: /tutorials/i }).click();
  const card = page
    .getByText("Hello Anchor", { exact: true })
    .locator("xpath=../..");
  await card.getByRole("button", { name: "Open" }).click();

  // `exact` matters: the assistant panel has its own "Start" button, and
  // Playwright's default name match is a case-insensitive substring
  await page.getByRole("button", { name: "START", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Steps" })).toBeVisible();
};

test("a migrated tutorial gets a derived id, not a random one", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await startTutorial(page);

  await rewriteConfig(page, {
    allNames: ["Hello Anchor"],
    currentName: "Hello Anchor",
  });

  await page.reload();

  // Derived from the name rather than minted, so the same tutorial resolves
  // to the same id on every device and stays one conversation -- a uuid here
  // would fork it per machine
  await expect
    .poll(async () => JSON.parse((await readConfig(page)) || "{}").workspaces, {
      timeout: 30_000,
    })
    .toEqual([{ id: "tut:hello-anchor", name: "Hello Anchor" }]);
});

test("a migrated mix of project and tutorial ids each keep their kind", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await seedWorkspace(page, "alpha");
  await startTutorial(page);

  await rewriteConfig(page, {
    allNames: ["alpha", "Hello Anchor"],
    currentName: "alpha",
  });

  await page.reload();

  await expect
    .poll(async () => JSON.parse((await readConfig(page)) || "{}").workspaces, {
      timeout: 30_000,
    })
    .toEqual([
      // A personal project is minted: two projects sharing a name are not the
      // same project, so they must not share an id
      { id: expect.stringMatching(/^[0-9a-f-]{36}$/), name: "alpha" },
      { id: "tut:hello-anchor", name: "Hello Anchor" },
    ]);
});
