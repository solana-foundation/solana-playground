import { createLogger } from "../../shared/lib/logger";
import type { SerializedWalletState } from "./types";

const log = createLogger("wallet:storage");

/**
 * Where the wallet's serialized state, secret keys included, is kept.
 *
 * The wallet reads and writes its state whole, so the store holds one record
 * for it, and a second one for accounts set aside as damaged.
 */
export interface WalletStore {
  /** The stored wallet, or `undefined` when there is none */
  read(): Promise<SerializedWalletState | undefined>;
  write(state: SerializedWalletState): Promise<void>;
  /**
   * Add damaged accounts to the set-aside record, which no `write` touches,
   * so a later tool can still recover them. An account already there is not
   * added twice.
   */
  setAside(accounts: unknown[]): Promise<void>;
  /**
   * Run `task` while no other tab runs one on the same store, so one tab's
   * move cannot interleave with another tab's move or save. Where the lock
   * cannot be taken (no Web Locks, a sandboxed origin) the task runs
   * unguarded, as every save did before the keystore.
   */
  exclusive<T>(task: () => Promise<T>): Promise<T>;
}

const STORE_NAME = "state";

/** What `read` and `write` reject with where the browser has no IndexedDB */
const INDEXEDDB_MISSING = "indexedDB is not available";

/**
 * Whether a store failure is IndexedDB not existing in this browser, the one
 * failure that means no wallet can have been stored there
 */
export const isIndexedDbMissing = (error: unknown) =>
  error instanceof Error && error.message === INDEXEDDB_MISSING;

/**
 * How long an open may take before it fails. An open that never answers (some
 * private modes, a stalled browser) would otherwise hold the lock and the
 * app's start forever; `walletStorageWith` then falls back for the page.
 */
const OPEN_TIMEOUT_MS = 5000;
const RECORD_KEY = "wallet";
const SET_ASIDE_KEY = "set-aside";

/** Run one request in its own transaction and resolve with its result */
const requestWith =
  (db: IDBDatabase, mode: IDBTransactionMode) =>
  <T>(run: (store: IDBObjectStore) => IDBRequest<T>) =>
    new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const request = run(tx.objectStore(STORE_NAME));
      // Resolve on commit, not on the request's success, so a write that the
      // browser later aborts (quota) is reported as a failure
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error ?? request.error);
      tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
    });

/**
 * A wallet store over its own IndexedDB database.
 *
 * The database is the wallet's alone: project files live in lightning-fs's
 * database, which project sync reads and uploads, and a keypair must never
 * sit where an upload can reach it. The database opens on first use, and
 * again after the browser closes the connection; `read` and `write` reject
 * when IndexedDB is missing or refuses to open.
 *
 * @param name database name
 */
export const indexedDbStoreFor = (name: string): WalletStore => {
  let opened: Promise<IDBDatabase> | undefined;
  const open = () => {
    opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error(INDEXEDDB_MISSING));
        return;
      }
      let isSettled = false;
      const fail = (error: unknown) => {
        isSettled = true;
        reject(error);
      };
      const timeout = setTimeout(
        () => fail(new Error("indexedDB open timed out")),
        OPEN_TIMEOUT_MS
      );
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => {
        clearTimeout(timeout);
        const db = request.result;
        // Opened after a timeout or a block was already reported: close it, so
        // it cannot hold up a later upgrade
        if (isSettled) return db.close();
        // A closed connection (eviction, another tab's upgrade) is dropped so
        // the next call opens a fresh one instead of failing forever
        db.onversionchange = () => {
          db.close();
          opened = undefined;
        };
        db.onclose = () => (opened = undefined);
        isSettled = true;
        resolve(db);
      };
      request.onerror = () => {
        clearTimeout(timeout);
        fail(request.error);
      };
      request.onblocked = () => {
        clearTimeout(timeout);
        fail(new Error("indexedDB open is blocked"));
      };
    });
    // A failed open is retried on the next call rather than cached
    opened.catch(() => (opened = undefined));
    return opened;
  };

  const lockName = `${name}:state`;
  /** Whether a refused lock was reported: once a page, not once a save */
  let hasReportedRefusal = false;

  return {
    async exclusive(task) {
      // Without Web Locks (old browsers, some test environments) the task runs
      // unguarded, as every write did before the keystore
      if (typeof navigator === "undefined" || !navigator.locks) return task();
      let hasStarted = false;
      try {
        return await navigator.locks.request(lockName, () => {
          hasStarted = true;
          return task();
        });
      } catch (error) {
        // The task's own failure is the caller's; a lock that cannot be taken
        // (a sandboxed origin's SecurityError) must not cost the save
        if (hasStarted) throw error;
        // The name only: nothing the lock refused with is worth the risk
        const refusal = error instanceof Error ? error.name : typeof error;
        if (!hasReportedRefusal) {
          hasReportedRefusal = true;
          log.error(
            new Error(`Wallet lock unavailable, running unguarded: ${refusal}`),
            { report: true }
          );
        }
        return task();
      }
    },
    async read() {
      const db = await open();
      const value = await requestWith(
        db,
        "readonly"
      )<SerializedWalletState | undefined>((store) => store.get(RECORD_KEY));
      return value;
    },
    async write(state) {
      const db = await open();
      await requestWith(
        db,
        "readwrite"
      )((store) => store.put(state, RECORD_KEY));
    },
    async setAside(accounts) {
      const db = await open();
      // The read and the append in one transaction, so two tabs setting
      // accounts aside cannot drop each other's
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const kept = store.get(SET_ASIDE_KEY);
        kept.onsuccess = () => {
          const before: unknown[] = Array.isArray(kept.result)
            ? kept.result
            : [];
          const texts = new Set(before.map((item) => JSON.stringify(item)));
          const added = accounts.filter(
            (item) => !texts.has(JSON.stringify(item))
          );
          store.put(before.concat(added), SET_ASIDE_KEY);
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? kept.error);
        tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
      });
    },
  };
};

if (import.meta.vitest) {
  const { describe, it, expect, vi, beforeAll, beforeEach, afterEach } =
    import.meta.vitest;

  describe("utils/wallet/keystore", () => {
    type Logger = typeof import("../../shared/lib/logger");
    let initLogger: Logger["initLogger"];
    let memoryProvider: Logger["memoryProvider"];
    let resetLogger: Logger["resetLogger"];
    let logged: ReturnType<Logger["memoryProvider"]>;
    type Fake = typeof import("fake-indexeddb");
    let FakeFactory: Fake["IDBFactory"];
    let FakeObjectStore: Fake["IDBObjectStore"];

    beforeAll(async () => {
      ({ initLogger, memoryProvider, resetLogger } = await import(
        "../../shared/lib/logger"
      ));
      ({ IDBFactory: FakeFactory, IDBObjectStore: FakeObjectStore } =
        await import("fake-indexeddb"));
    });

    beforeEach(() => {
      logged = memoryProvider();
      initLogger({ providers: [logged] });
      // A fresh, empty IndexedDB per test
      vi.stubGlobal("indexedDB", new FakeFactory());
    });

    afterEach(() => {
      resetLogger();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    });

    /** No Wallet Standard wallet: `WalletState.standardName` stores `null` */
    // eslint-disable-next-line unicorn/no-null -- the stored shape's own "none"
    const NO_STANDARD = null;

    const walletOf = (name: string): SerializedWalletState => ({
      state: "pg",
      accounts: [{ kp: Array.from({ length: 64 }, (_, i) => i), name }],
      currentIndex: 0,
      standardName: NO_STANDARD,
    });

    /** An `indexedDB` whose open request never answers, or answers `blocked` */
    const stalledFactoryWith = (answer: "never" | "blocked") => ({
      open: () => {
        const request = {} as IDBOpenDBRequest;
        if (answer === "blocked") {
          setTimeout(() => request.onblocked?.({} as IDBVersionChangeEvent));
        }
        return request;
      },
    });

    /** A `navigator.locks` that grants every request, recording the names */
    const grantingLocks = () => {
      const names: string[] = [];
      let tail = Promise.resolve();
      // eslint-disable-next-line layers/curry-order -- `LockManager.request`'s own order
      const request = (name: string, task: () => Promise<unknown>) => {
        names.push(name);
        const run = tail.then(task);
        tail = run.then(
          () => undefined,
          () => undefined
        );
        return run;
      };
      return { names, request };
    };

    it("reads nothing from a new database", async () => {
      const store = indexedDbStoreFor("pg-wallet");

      expect(await store.read()).toBeUndefined();
    });

    it("creates the database with its one object store", async () => {
      await indexedDbStoreFor("pg-wallet").read();

      const names = await new Promise<string[]>((resolve, reject) => {
        const request = indexedDB.open("pg-wallet");
        request.onsuccess = () => {
          resolve(Array.from(request.result.objectStoreNames));
          request.result.close();
        };
        request.onerror = () => reject(request.error);
      });
      expect(names).toEqual(["state"]);
    });

    it("reads back what it wrote, in a new connection too", async () => {
      const wallet = walletOf("Wallet 1");
      const store = indexedDbStoreFor("pg-wallet");

      await store.write(wallet);

      expect(await store.read()).toEqual(wallet);
      expect(await indexedDbStoreFor("pg-wallet").read()).toEqual(wallet);
    });

    it("replaces the record on a second write", async () => {
      const store = indexedDbStoreFor("pg-wallet");

      await store.write(walletOf("Wallet 1"));
      await store.write(walletOf("Wallet 2"));

      expect((await store.read())?.accounts[0].name).toBe("Wallet 2");
    });

    it("appends set-aside accounts to its own record, not the wallet's", async () => {
      const store = indexedDbStoreFor("pg-wallet");
      await store.write(walletOf("Wallet 1"));

      await store.setAside([{ kp: [1, 2], name: "A" }]);
      await store.setAside([{ kp: [3], name: "B" }]);
      // The same account twice is kept once
      await store.setAside([{ kp: [1, 2], name: "A" }]);

      expect(await store.read()).toEqual(walletOf("Wallet 1"));
      const aside = await new Promise<unknown>((resolve, reject) => {
        const request = indexedDB.open("pg-wallet");
        request.onsuccess = () => {
          const get = request.result
            .transaction("state", "readonly")
            .objectStore("state")
            .get("set-aside");
          get.onsuccess = () => resolve(get.result);
          get.onerror = () => reject(get.error);
        };
        request.onerror = () => reject(request.error);
      });
      expect(aside).toEqual([
        { kp: [1, 2], name: "A" },
        { kp: [3], name: "B" },
      ]);
    });

    it("keeps databases of different names apart", async () => {
      await indexedDbStoreFor("pg-wallet").write(walletOf("Wallet 1"));

      expect(await indexedDbStoreFor("other").read()).toBeUndefined();
    });

    it("rejects when IndexedDB is not available, and retries on the next call", async () => {
      const store = indexedDbStoreFor("pg-wallet");
      vi.stubGlobal("indexedDB", undefined);

      await expect(store.read()).rejects.toThrow("indexedDB is not available");

      vi.stubGlobal("indexedDB", new FakeFactory());
      expect(await store.read()).toBeUndefined();
    });

    it("rejects a write that the database refuses", async () => {
      const store = indexedDbStoreFor("pg-wallet");
      await store.read();
      const put = vi
        .spyOn(FakeObjectStore.prototype, "put")
        .mockImplementation(() => {
          throw new DOMException("refused", "QuotaExceededError");
        });

      await expect(store.write(walletOf("Wallet 1"))).rejects.toThrow(
        "refused"
      );
      put.mockRestore();
    });

    it("rejects an open that does not answer within 5 seconds", async () => {
      vi.useFakeTimers();
      vi.stubGlobal("indexedDB", stalledFactoryWith("never"));
      const read = indexedDbStoreFor("pg-wallet").read();
      const settled = expect(read).rejects.toThrow("indexedDB open timed out");

      await vi.advanceTimersByTimeAsync(5000);

      await settled;
    });

    it("rejects an open that is blocked", async () => {
      vi.stubGlobal("indexedDB", stalledFactoryWith("blocked"));

      await expect(indexedDbStoreFor("pg-wallet").read()).rejects.toThrow(
        "indexedDB open is blocked"
      );
    });

    it("runs a task under the store's own lock", async () => {
      const locks = grantingLocks();
      vi.stubGlobal("navigator", { locks });

      const result = await indexedDbStoreFor("pg-wallet").exclusive(
        async () => "done"
      );

      expect(result).toBe("done");
      expect(locks.names).toEqual(["pg-wallet:state"]);
    });

    it("runs tasks under the lock one at a time", async () => {
      vi.stubGlobal("navigator", { locks: grantingLocks() });
      const store = indexedDbStoreFor("pg-wallet");
      const order: string[] = [];
      let release = () => {};
      const held = new Promise<void>((resolve) => (release = resolve));

      const first = store.exclusive(async () => {
        await held;
        order.push("first");
      });
      const second = store.exclusive(async () => {
        order.push("second");
      });
      release();
      await Promise.all([first, second]);

      expect(order).toEqual(["first", "second"]);
    });

    it("runs the task unguarded where there are no Web Locks", async () => {
      vi.stubGlobal("navigator", {});

      expect(
        await indexedDbStoreFor("pg-wallet").exclusive(async () => 1)
      ).toBe(1);
      expect(logged.entries).toHaveLength(0);
    });

    it("runs the task when the lock is refused, and logs that once", async () => {
      vi.stubGlobal("navigator", {
        locks: {
          // A browser's `DOMException` is an `Error`; jsdom's is not
          request: () =>
            Promise.reject(
              Object.assign(new Error("denied"), { name: "SecurityError" })
            ),
        },
      });
      const store = indexedDbStoreFor("pg-wallet");

      expect(await store.exclusive(async () => 1)).toBe(1);
      expect(await store.exclusive(async () => 2)).toBe(2);

      expect(logged.entries).toHaveLength(1);
      expect(logged.entries[0].ns).toBe("wallet:storage");
      expect(logged.entries[0].report).toBe(true);
      expect(String(logged.entries[0].error)).toContain("SecurityError");
    });

    it("rethrows the task's own failure, not as a refused lock", async () => {
      vi.stubGlobal("navigator", { locks: grantingLocks() });
      const task = vi.fn(async () => {
        throw new Error("task failed");
      });

      await expect(
        indexedDbStoreFor("pg-wallet").exclusive(task)
      ).rejects.toThrow("task failed");
      expect(task).toHaveBeenCalledTimes(1);
      expect(logged.entries).toHaveLength(0);
    });
  });
}
