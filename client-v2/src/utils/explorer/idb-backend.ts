import { uuid } from "@/shared/lib/ids";
import {
  isConnectionLost,
  namedError,
  withCause,
} from "@/shared/lib/indexeddb-retry";
import { createLogger } from "@/shared/lib/logger";

const log = createLogger("explorer:idb-backend");

/**
 * The store lightning-fs's `DefaultBackend` keeps file contents and the
 * folder tree (the superblock) in, given to lightning-fs as its `db` option.
 * Its own `index.d.ts` describes this shape wrongly (`loadFile`, no
 * `unlink`, a `Uint8Array` superblock), so it is declared here from what
 * `DefaultBackend` calls.
 */
export interface IdbBackend {
  /** Save lightning-fs's tree, a `Map` this module treats as opaque */
  saveSuperblock(superblock: unknown): Promise<void>;
  /** The saved tree, `undefined` when none was saved: lightning-fs starts empty */
  loadSuperblock(): Promise<unknown>;
  readFile(inode: number): Promise<Uint8Array | undefined>;
  writeFile(inode: number, data: Uint8Array): Promise<void>;
  unlink(inode: number): Promise<void>;
  wipe(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Starts one request on the object store. A request may run twice, once
 * more on a fresh connection, so it must be a whole put, get, delete or
 * clear: never one that reads what it writes, or that counts.
 */
type MakeRequest<T> = (store: IDBObjectStore) => IDBRequest<T>;

/** The key lightning-fs keeps the superblock under, beside the inodes */
const SUPERBLOCK_KEY = "!root";

/**
 * The key of this database's identity marker: a random id the first backend
 * to open it writes, which lightning-fs never reads. A backend reopening the
 * database checks the marker is still the one it first saw, since another
 * tab can recreate a deleted database before this one reconnects.
 */
const MARKER_KEY = "!pg-database-id";

/** Read the marker, writing `candidate` in the same transaction when there is none */
const claimMarker =
  (candidate: string): MakeRequest<unknown> =>
  (store) => {
    const request = store.get(MARKER_KEY);
    request.addEventListener("success", () => {
      if (request.result === undefined) store.put(candidate, MARKER_KEY);
    });
    return request;
  };

/**
 * How long an open may take before it fails. An open that never answers (a
 * stalled WebKit) would otherwise hold every file operation forever, as the
 * wallet's keystore found.
 */
const OPEN_TIMEOUT_MS = 5000;

/**
 * What an open does when it finds no database: creates what it needs, or
 * returns the error to refuse the open with
 */
type OnMissing = (request: IDBOpenDBRequest) => Error | undefined;

/** Create `storeName` in a database that did not exist: the backend's first open */
const createStore =
  (storeName: string): OnMissing =>
  (request) => {
    request.result.createObjectStore(storeName);
    return undefined;
  };

/**
 * Refuse a database that is gone after the backend opened it once: the
 * browser deleted it (site data cleared) under a filesystem whose tree is
 * still in memory, and recreating it would let lightning-fs save that whole
 * tree over files whose content is gone. Refused, writes fail and the next
 * page load starts from what the account holds.
 */
const refuseDeleted: OnMissing = (request) =>
  namedError(
    "DatabaseDeletedError",
    `${request.result.name} was deleted while the page had it open`
  );

/** Open `dbName`, doing `onMissing` when it finds no database */
const openDatabaseWith = (onMissing: OnMissing) => (dbName: string) =>
  new Promise<IDBDatabase>((resolve, reject) => {
    let isSettled = false;
    const fail = (error: unknown) => {
      clearTimeout(timeout);
      if (isSettled) return;
      isSettled = true;
      reject(error);
    };
    const timeout = setTimeout(
      () => fail(new Error(`Opening ${dbName} timed out`)),
      OPEN_TIMEOUT_MS
    );
    const request = indexedDB.open(dbName);
    request.onupgradeneeded = () => {
      const refusal = onMissing(request);
      if (!refusal) return;
      fail(refusal);
      request.transaction?.abort();
    };
    request.onsuccess = () => {
      clearTimeout(timeout);
      // Opened after a timeout already failed it: close it, so it cannot
      // hold up a later deletion or upgrade
      if (isSettled) return request.result.close();
      isSettled = true;
      resolve(request.result);
    };
    request.onerror = () =>
      fail(request.error ?? new Error(`Opening ${dbName} failed`));
    request.onblocked = () => fail(new Error(`Opening ${dbName} is blocked`));
  });

/**
 * Run one request in a transaction of its own and resolve with its result
 * once the transaction commits. An abort rejects with an `Error` even when
 * the browser gives none: WebKit aborts on a lost connection with `error`
 * null, which reached Sentry as "Error: null".
 */
const transactWith =
  <T>(makeRequest: MakeRequest<T>, mode: IDBTransactionMode) =>
  (db: IDBDatabase, storeName: string) =>
    new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const request = makeRequest(transaction.objectStore(storeName));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () =>
        reject(
          transaction.error ??
            request.error ??
            namedError(
              "AbortError",
              `A transaction on ${db.name} was aborted with no error`
            )
        );
    });

/** One request: what it does, in which mode */
interface Step<T> {
  makeRequest: MakeRequest<T>;
  mode: IDBTransactionMode;
}

/**
 * lightning-fs's own backend (idb-keyval) never notices the browser closing
 * its connection, so every request on it fails until lightning-fs goes idle
 * and closes it. But the tree save that going idle runs first fails too,
 * and lightning-fs keeps that failed deactivation and rethrows it on every
 * later call: the filesystem fails until a reload.
 *
 * This backend forgets a connection the browser closed, and runs a request
 * that failed for a lost connection once more on a fresh one, so that save
 * goes through. Requests for one key run in the order they were made, the
 * retry included, so a retried write never lands over a newer one. What
 * stays: a save that fails on both connections still leaves lightning-fs
 * failing until a reload.
 */
class ReopeningIdbBackend implements IdbBackend {
  private _connection?: Promise<IDBDatabase>;
  /**
   * The database's identity marker, read on the first open. Once it is set,
   * no open may create the database, and a reopen must find the same marker.
   */
  private _marker?: unknown;
  /** The last request of each key, which the next request for it waits for */
  private readonly _tails = new Map<IDBValidKey, Promise<unknown>>();

  constructor(
    private readonly _dbName: string,
    private readonly _storeName: string
  ) {}

  saveSuperblock(superblock: unknown) {
    return this._write(SUPERBLOCK_KEY, (store) =>
      store.put(superblock, SUPERBLOCK_KEY)
    );
  }

  loadSuperblock() {
    return this._read(SUPERBLOCK_KEY);
  }

  readFile(inode: number): Promise<Uint8Array | undefined> {
    return this._read(inode);
  }

  writeFile(inode: number, data: Uint8Array) {
    return this._write(inode, (store) => store.put(data, inode));
  }

  unlink(inode: number) {
    return this._write(inode, (store) => store.delete(inode));
  }

  /**
   * Clear the store, keeping the identity marker, which a reopen checks. Not
   * ordered against requests in flight: lightning-fs wipes before it loads
   * anything.
   */
  async wipe() {
    await this._run({
      makeRequest: (store) => {
        store.clear();
        return store.put(this._marker, MARKER_KEY);
      },
      mode: "readwrite",
    });
  }

  async close() {
    const connection = this._connection;
    this._connection = undefined;
    if (!connection) return;
    try {
      // Closing a connection the browser already closed does nothing
      (await connection).close();
    } catch (error) {
      // A failed open leaves nothing to close; its error already reached the
      // request that started it. Rejecting here would fail lightning-fs's
      // deactivation, which it then rethrows on every later call.
      log.debug(`nothing to close: opening ${this._dbName} had failed`, {
        context: { error: String(error) },
      });
    }
  }

  private _read<T>(key: IDBValidKey) {
    return this._inOrder<T>(key, {
      makeRequest: (store) => store.get(key),
      mode: "readonly",
    });
  }

  private async _write<T>(key: IDBValidKey, makeRequest: MakeRequest<T>) {
    await this._inOrder(key, { makeRequest, mode: "readwrite" });
  }

  /** Run `step` on `key` after every earlier request for `key` has settled */
  private _inOrder<T>(key: IDBValidKey, step: Step<T>) {
    const previous = this._tails.get(key) ?? Promise.resolve();
    const task = () => this._run(step);
    // The earlier request's failure is its caller's; this one runs either way
    const run = previous.then(task, task);
    const tail = run.then(
      () => undefined,
      () => undefined
    );
    this._tails.set(key, tail);
    void tail.then(() => {
      if (this._tails.get(key) === tail) this._tails.delete(key);
    });
    return run;
  }

  /**
   * Run `step`, and once more on a fresh connection when it failed for a
   * lost connection. A request's own failure (quota, a value that cannot be
   * stored) would fail again anywhere, and a failed open has already waited
   * for its timeout or been refused, so neither is retried.
   */
  private async _run<T>(step: Step<T>) {
    try {
      return await this._attempt(step);
    } catch (first) {
      if (!isConnectionLost(first)) throw first;
      log.warn(`retrying on a new connection to ${this._dbName}`, {
        context: {
          name: (first as { name?: unknown }).name,
          message: (first as { message?: unknown }).message,
        },
      });
      try {
        return await this._attempt(step);
      } catch (second) {
        throw withCause(second, first);
      }
    }
  }

  private async _attempt<T>({ makeRequest, mode }: Step<T>) {
    const connection = this._connect();
    const db = await connection;
    try {
      return await transactWith(makeRequest, mode)(db, this._storeName);
    } catch (error) {
      // Only a lost connection is dropped: closing it on a request's own
      // failure would fail every other request still about to use it
      if (isConnectionLost(error)) {
        db.close();
        this._forget(connection);
      }
      throw error;
    }
  }

  /**
   * Open the database and check it is the one this backend first opened.
   * The first open records the marker, writing one into a database that has
   * none; a reopen refuses a database whose marker differs or is missing,
   * which is a database another tab recreated after a deletion.
   */
  private async _open() {
    const isFirst = this._marker === undefined;
    const onMissing = isFirst ? createStore(this._storeName) : refuseDeleted;
    const db = await openDatabaseWith(onMissing)(this._dbName);
    try {
      const candidate = uuid();
      const found = await transactWith(
        isFirst
          ? claimMarker(candidate)
          : (store: IDBObjectStore) => store.get(MARKER_KEY),
        isFirst ? "readwrite" : "readonly"
      )(db, this._storeName);
      if (isFirst) {
        this._marker = found ?? candidate;
        return db;
      }
      if (found !== this._marker) {
        throw namedError(
          "DatabaseReplacedError",
          `${this._dbName} was deleted and recreated while the page had it open`
        );
      }
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  }

  private _connect() {
    if (this._connection) return this._connection;

    const connection = this._open();
    this._connection = connection;
    connection.then(
      (db) => {
        db.addEventListener("close", () => this._forget(connection));
        // Let a deletion or an upgrade elsewhere through instead of blocking it
        db.addEventListener("versionchange", () => {
          db.close();
          this._forget(connection);
        });
      },
      () => this._forget(connection)
    );
    return connection;
  }

  private _forget(connection: Promise<IDBDatabase>) {
    if (this._connection === connection) this._connection = undefined;
  }
}

/** The backend for the object store `storeName` of the database `dbName` */
export const idbBackend = (dbName: string, storeName: string): IdbBackend =>
  new ReopeningIdbBackend(dbName, storeName);
