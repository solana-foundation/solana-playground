/**
 * Where the key page keeps the wallet's keys: base58 public key to the key's
 * 64 secret bytes (private, then public).
 */
export interface KeyStore {
  /** Every stored key */
  all(): Promise<Map<string, Uint8Array>>;
  /** Store keys, replacing any under the same public key */
  put(entries: [string, Uint8Array][]): Promise<void>;
  /** Drop a key; a key that is not there is not an error */
  remove(publicKey: string): Promise<void>;
}

const STORE_NAME = "keys";
const LOCK_NAME = "pg-wallet-keys";

/** The key origin's database of keys */
export const KEY_DB_NAME = "pg-wallet-keys";

/** Resolves on commit, so a write the browser aborts is a failure */
const settled = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
  });

/**
 * A key store over the key origin's own IndexedDB database. Every write runs
 * under the `pg-wallet-keys` Web Lock where the browser has one, so two key
 * page instances cannot interleave.
 *
 * @param name database name
 */
export const indexedDbKeyStore = (name: string): KeyStore => {
  let opened: Promise<IDBDatabase> | undefined;
  const open = () => {
    opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          opened = undefined;
        };
        db.onclose = () => (opened = undefined);
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("indexedDB open is blocked"));
    });
    opened.catch(() => (opened = undefined));
    return opened;
  };

  const exclusive = <T>(task: () => Promise<T>): Promise<T> =>
    typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request(LOCK_NAME, task)
      : task();

  return {
    async all() {
      const db = await open();
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const keys = store.getAllKeys();
      const values = store.getAll();
      await settled(tx);
      const found = new Map<string, Uint8Array>();
      keys.result.forEach((key, i) => {
        const value = values.result[i];
        if (typeof key === "string" && Array.isArray(value)) {
          found.set(key, Uint8Array.from(value));
        }
      });
      return found;
    },
    put(entries) {
      return exclusive(async () => {
        const db = await open();
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        for (const [publicKey, secret] of entries) {
          store.put(Array.from(secret), publicKey);
        }
        await settled(tx);
      });
    },
    remove(publicKey) {
      return exclusive(async () => {
        const db = await open();
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete(publicKey);
        await settled(tx);
      });
    },
  };
};

if (import.meta.vitest) {
  const { describe, it, expect, vi, beforeEach, afterEach } = import.meta
    .vitest;

  describe("utils/wallet/key-origin/frame/store", () => {
    beforeEach(async () => {
      const { IDBFactory } = await import("fake-indexeddb");
      // A fresh, empty IndexedDB per test
      vi.stubGlobal("indexedDB", new IDBFactory());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    const secret = (seed: number) =>
      Uint8Array.from({ length: 64 }, (_, i) => (i + seed) % 256);

    it("starts empty", async () => {
      expect((await indexedDbKeyStore(KEY_DB_NAME).all()).size).toBe(0);
    });

    it("stores keys and reads them back", async () => {
      const store = indexedDbKeyStore(KEY_DB_NAME);
      await store.put([
        ["a", secret(1)],
        ["b", secret(2)],
      ]);

      const all = await store.all();
      expect(Array.from(all.keys()).sort()).toEqual(["a", "b"]);
      expect(all.get("a")).toEqual(secret(1));
    });

    it("keeps keys across store instances on one database", async () => {
      await indexedDbKeyStore("same").put([["a", secret(1)]]);

      expect((await indexedDbKeyStore("same").all()).get("a")).toEqual(
        secret(1)
      );
    });

    it("replaces a key under the same public key and removes keys", async () => {
      const store = indexedDbKeyStore(KEY_DB_NAME);
      await store.put([["a", secret(1)]]);
      await store.put([["a", secret(9)]]);
      expect((await store.all()).get("a")).toEqual(secret(9));

      await store.remove("a");
      await store.remove("missing");
      expect((await store.all()).size).toBe(0);
    });

    it("writes under the pg-wallet-keys lock when there is one", async () => {
      const names: string[] = [];
      vi.stubGlobal("navigator", {
        locks: {
          // eslint-disable-next-line layers/curry-order -- the shape of `navigator.locks.request`, which the store calls
          request: (name: string, task: () => Promise<unknown>) => {
            names.push(name);
            return task();
          },
        },
      });
      const store = indexedDbKeyStore(KEY_DB_NAME);

      await store.put([["a", secret(1)]]);
      await store.remove("a");

      expect(names).toEqual(["pg-wallet-keys", "pg-wallet-keys"]);
    });
  });
}
