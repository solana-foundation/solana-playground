import type { Page } from "@playwright/test";

/**
 * Whether a file lightning-fs keeps in IndexedDB holds `needle`: the editor's
 * autosave, or any other write, has reached the store a reload reads. A test
 * polls it before it reloads or before it judges what the save changed.
 */
export const hasSavedText = (page: Page, needle: string) =>
  page.evaluate(async (wanted) => {
    const dbs = await indexedDB.databases();
    const name = dbs.map((d) => d.name).find((n) => n?.includes("solana"));
    if (!name) return false;
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      const open = indexedDB.open(name);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const store = Array.from(db.objectStoreNames).find((s) =>
      s.includes("files")
    );
    if (!store) {
      db.close();
      return false;
    }
    const values: unknown[] = await new Promise((resolve, reject) => {
      const all = db.transaction(store, "readonly").objectStore(store).getAll();
      all.onsuccess = () => resolve(all.result);
      all.onerror = () => reject(all.error);
    });
    db.close();
    const decoder = new TextDecoder();
    return values.some(
      (value) =>
        value instanceof Uint8Array && decoder.decode(value).includes(wanted)
    );
  }, needle);
