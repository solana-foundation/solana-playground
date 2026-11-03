import { createLogger } from "../../shared/lib/logger";
import type { SerializedWalletState } from "./types";

const log = createLogger("wallet:storage");

/**
 * Where the wallet's serialized state, secret keys included, is kept.
 *
 * The wallet reads and writes its state whole, so the store holds one record.
 */
export interface WalletStore {
  /** The stored wallet, or `undefined` when there is none */
  read(): Promise<SerializedWalletState | undefined>;
  write(state: SerializedWalletState): Promise<void>;
  /**
   * Run `task` while no other tab runs one on the same store, so one tab's
   * move cannot interleave with another tab's move or save. Where the lock
   * cannot be taken (no Web Locks, a sandboxed origin) the task runs
   * unguarded, as every save did before the keystore.
   */
  exclusive<T>(task: () => Promise<T>): Promise<T>;
}

const STORE_NAME = "state";

/**
 * How long an open may take before it fails. An open that never answers (some
 * private modes, a stalled browser) would otherwise hold the lock and the
 * app's start forever; `walletStorageWith` then falls back for the page.
 */
const OPEN_TIMEOUT_MS = 5000;
const RECORD_KEY = "wallet";

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
        reject(new Error("indexedDB is not available"));
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
  };
};
