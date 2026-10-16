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
    if (!store) {
      db.close();
      return [];
    }

    // Closed once read: this is polled, and an open handle per tick would
    // pile up for the length of the wait
    const values: any[] = await new Promise((res) => {
      const rq = db.transaction(store, "readonly").objectStore(store).getAll();
      rq.onsuccess = () => {
        db.close();
        res(rq.result);
      };
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
      if (/"kind":"(user|assistant)"/.test(text))
        threads.push(JSON.parse(text));
    }
    return threads;
  });

type AssistantWindow = Window & {
  __pgAssistant?: {
    items: unknown[];
    threadId?: string;
    addUserMessage: (t: string) => void;
  };
};

const threadId = (page: Page) =>
  page.evaluate(
    () => (window as AssistantWindow).__pgAssistant?.threadId ?? null
  );

/**
 * The store's view of the open thread, as one string.
 *
 * Carries the thread id and the persistence failures next to the items, so a
 * poll that times out says which thread was open and whether a read failed,
 * instead of a bare "[]".
 */
const storeState = (page: Page) =>
  page.evaluate(() => {
    const w = window as AssistantWindow & {
      __pgSyncDiagnostics?: { failures: () => unknown };
    };
    return JSON.stringify({
      threadId: w.__pgAssistant?.threadId ?? null,
      items: w.__pgAssistant?.items ?? [],
      failures: w.__pgSyncDiagnostics?.failures() ?? null,
    });
  });

/**
 * Whether the file system's directory tree lists a file whose name holds
 * `needle`.
 *
 * lightning-fs writes a file's bytes at once but saves the directory tree (its
 * "superblock", the `!root` record) half a second after the last write. A
 * reload inside that window keeps the bytes and loses the entry, so the file
 * reads as absent afterwards: `readThreads` still finds the bytes, the store
 * finds nothing. "On disk" therefore means both.
 */
const fileIsListed = (page: Page, needle: string) =>
  page.evaluate(async (needle) => {
    const dbs = await (indexedDB as any).databases();
    const name = dbs
      .map((d: any) => d.name)
      .find((n: string) => n?.includes("solana"));
    if (!name) return false;
    const db: IDBDatabase = await new Promise((res) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => res(r.result);
    });
    const store = Array.from(db.objectStoreNames).find((s) =>
      s.includes("files")
    );
    if (!store) {
      db.close();
      return false;
    }
    const root: unknown = await new Promise((res) => {
      const rq = db
        .transaction(store, "readonly")
        .objectStore(store)
        .get("!root");
      rq.onsuccess = () => {
        db.close();
        res(rq.result);
      };
    });
    const lists = (node: unknown): boolean =>
      node instanceof Map &&
      Array.from(node.entries()).some(
        ([key, child]) =>
          (typeof key === "string" && key.includes(needle)) || lists(child)
      );
    return lists(root);
  }, needle);

/**
 * Put a message in the open thread and wait until it is on disk.
 *
 * Driven through the store rather than the composer: sending for real needs a
 * configured backend, and what is under test is persistence, not the model.
 *
 * The store writes back without awaiting (`_persist`), and declines while no
 * thread is open -- which is the case for a moment after a workspace switch,
 * when `effects/chat-thread` has closed the old thread and not yet resolved
 * the new one. A message added in that gap is adopted by the next thread, but
 * a reload or a read in the meantime would see nothing, and that is a flaky
 * test, not a lost message. So: wait for the thread, add, wait for the file
 * -- its bytes and its directory entry, see `fileIsListed`.
 *
 * Right after a switch the *previous* thread's id is still the open one for
 * a moment, so a caller that switched passes it as `notThread` and the wait
 * is for a different, open thread -- otherwise the message lands in the old
 * project's conversation and the file check still passes.
 */
const addMessage = async (
  page: Page,
  text: string,
  { notThread = null }: { notThread?: string | null } = {}
) => {
  let id: string | null = null;
  await expect
    .poll(
      async () => {
        id = await threadId(page);
        return !!id && id !== notThread;
      },
      { timeout: 15_000 }
    )
    .toBe(true);
  await page.evaluate((text) => {
    const w = window as AssistantWindow;
    if (!w.__pgAssistant) throw new Error("assistant store not exposed");
    w.__pgAssistant.addUserMessage(text);
  }, text);
  await expect
    .poll(async () => JSON.stringify(await readThreads(page)), {
      timeout: 15_000,
    })
    .toContain(text);
  await expect
    .poll(() => fileIsListed(page, encodeURIComponent(id!)), {
      timeout: 15_000,
    })
    .toBe(true);
};

test("a conversation survives a reload", async ({ page }) => {
  await seedWorkspace(page, "alpha");
  await addMessage(page, "remember me");
  // The store's writes are fired and forgotten; a reload landing first cuts
  // this one off, which is not what this test is about
  await page.evaluate(() =>
    (
      window as unknown as {
        __pgAssistant: { whenPersisted: () => Promise<void> };
      }
    ).__pgAssistant.whenPersisted()
  );

  await page.reload();
  await expect(page.locator("#root-dir")).toBeVisible();

  // Back in the store, not just on disk: a thread whose file is intact but
  // cannot be decoded reopens empty and is left alone (`_readOnly`), and a
  // disk check alone would pass through that. Read through the store rather
  // than the transcript, which the panel shows only once it is past its
  // intro; what is asserted is the restore, not the panel's first view.
  await expect
    .poll(() => storeState(page), { timeout: 15_000 })
    .toContain("remember me");
  await expect
    .poll(async () => JSON.stringify(await readThreads(page)), {
      timeout: 15_000,
    })
    .toContain("remember me");
});

test("each project keeps its own conversation", async ({ page }) => {
  await seedWorkspace(page, "alpha");
  await addMessage(page, "about alpha");
  const alpha = await threadId(page);

  await switcher(page).click();
  await page.getByRole("button", { name: "Browse gallery" }).click();
  const gallery = page.locator("[data-gallery-modal]");
  await expect(gallery).toBeVisible();
  await gallery.getByLabel("Project name").fill("beta");
  await gallery.getByRole("button", { name: /^Start/ }).click();
  await expect(gallery).toBeHidden();
  await expect(switcher(page)).toContainText("beta");

  await addMessage(page, "about beta", { notThread: alpha });

  // Two threads, one per project, each holding only its own message
  const threads = (await readThreads(page)).map((t) => JSON.stringify(t));
  expect(threads).toHaveLength(2);
  expect(threads.filter((t) => t.includes("about alpha"))).toHaveLength(1);
  expect(threads.filter((t) => t.includes("about beta"))).toHaveLength(1);
  expect(
    threads.filter((t) => t.includes("about alpha") && t.includes("about beta"))
  ).toHaveLength(0);
});
