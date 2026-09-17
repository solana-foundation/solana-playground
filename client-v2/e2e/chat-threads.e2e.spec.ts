import { expect, test } from "./fixtures";
import { seedWorkspace } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * Chat is keyed by workspace and survives a reload.
 *
 * The panel used to keep its conversation in memory only, so a reload started
 * fresh and every project shared one thread. This covers both halves in a real
 * browser: the thread is written to the same IndexedDB volume as the code, and
 * switching project swaps it.
 *
 * No backend is involved -- these pass with sync disabled and nobody signed in,
 * which is the point of doing the local half first.
 */

const switcher = (page: Page) => page.locator('[aria-haspopup="true"]').first();

/** Chat files live beside the code, keyed by the stable workspace id */
const readThreads = (page: Page) =>
  page.evaluate(async () => {
    const dbs = await (indexedDB as any).databases();
    const name = dbs
      .map((d: any) => d.name)
      .find((n: string) => n?.includes("solana"));
    if (!name) return [];

    const db: IDBDatabase = await new Promise((res) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => res(r.result);
    });
    const store = Array.from(db.objectStoreNames).find((s) =>
      s.includes("files")
    );
    if (!store) return [];

    const values: any[] = await new Promise((res) => {
      const rq = db.transaction(store, "readonly").objectStore(store).getAll();
      rq.onsuccess = () => res(rq.result);
    });

    const threads: unknown[] = [];
    for (const v of values) {
      let text = "";
      try {
        text = new TextDecoder().decode(v);
      } catch {
        continue;
      }
      // A stored thread is an array of chat items
      if (/"kind":"(user|assistant)"/.test(text)) threads.push(JSON.parse(text));
    }
    return threads;
  });

/**
 * Put a message in the open thread.
 *
 * Driven through the store rather than the composer: sending for real needs a
 * configured backend, and what is under test is persistence, not the model.
 */
const addMessage = (page: Page, text: string) =>
  page.evaluate((text) => {
    const w = window as unknown as { __pgAssistant?: { addUserMessage: (t: string) => void } };
    if (!w.__pgAssistant) throw new Error("assistant store not exposed");
    w.__pgAssistant.addUserMessage(text);
  }, text);

test("a conversation survives a reload", async ({ page }) => {
  await seedWorkspace(page, "alpha");
  await addMessage(page, "remember me");

  await page.reload();
  await expect(page.locator("#root-dir")).toBeVisible();

  await expect
    .poll(async () => JSON.stringify(await readThreads(page)), {
      timeout: 15_000,
    })
    .toContain("remember me");
});

test("each project keeps its own conversation", async ({ page }) => {
  await seedWorkspace(page, "alpha");
  await addMessage(page, "about alpha");

  await switcher(page).click();
  await page.getByRole("button", { name: "Browse gallery" }).click();
  const gallery = page.locator("[data-gallery-modal]");
  await expect(gallery).toBeVisible();
  await gallery.getByLabel("Project name").fill("beta");
  await gallery.getByRole("button", { name: /^Start/ }).click();
  await expect(gallery).toBeHidden();
  await expect(switcher(page)).toContainText("beta");

  await addMessage(page, "about beta");

  // Two threads, one per project, each holding only its own message
  const threads = await readThreads(page);
  const texts = JSON.stringify(threads);
  expect(texts).toContain("about alpha");
  expect(texts).toContain("about beta");
  expect(threads).toHaveLength(2);
});
