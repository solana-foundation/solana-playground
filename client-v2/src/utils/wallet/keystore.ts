import type { SerializedWalletState } from "./types";

/**
 * Where the wallet's serialized state, secret keys included, is kept.
 *
 * The wallet reads and writes its state whole, so the store holds one record.
 */
export interface WalletStore {
  /** The stored wallet, or `undefined` when there is none */
  read(): Promise<SerializedWalletState | undefined>;
  write(state: SerializedWalletState): Promise<void>;
}

const STORE_NAME = "state";
const RECORD_KEY = "wallet";

/** Run one request in its own transaction and resolve with its result */
const requestIn =
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
 * sit where an upload can reach it. The database opens on first use, once;
 * every method rejects when IndexedDB is missing or refuses to open.
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
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("indexedDB open is blocked"));
    });
    // A failed open is retried on the next call rather than cached
    opened.catch(() => (opened = undefined));
    return opened;
  };

  return {
    async read() {
      const db = await open();
      const value = await requestIn(
        db,
        "readonly"
      )<SerializedWalletState | undefined>((store) => store.get(RECORD_KEY));
      return value;
    },
    async write(state) {
      const db = await open();
      await requestIn(db, "readwrite")((store) => store.put(state, RECORD_KEY));
    },
  };
};
