/**
 * The store lightning-fs's `DefaultBackend` keeps file contents and the
 * folder tree (the superblock) in, given to lightning-fs as its `db` option.
 * Its own `index.d.ts` describes this shape wrongly (`loadFile`, no
 * `unlink`), so it is declared here from what `DefaultBackend` calls.
 */
export interface IdbBackend {
  saveSuperblock(superblock: unknown): Promise<void>;
  loadSuperblock(): Promise<unknown>;
  readFile(inode: number): Promise<Uint8Array | undefined>;
  writeFile(inode: number, data: Uint8Array): Promise<void>;
  unlink(inode: number): Promise<void>;
  wipe(): Promise<void>;
  close(): Promise<void>;
}

/** Starts one request on the object store */
type MakeRequest<T> = (store: IDBObjectStore) => IDBRequest<T>;

/** The key lightning-fs keeps the superblock under, beside the inodes */
const SUPERBLOCK_KEY = "!root";

/** Open `dbName`, creating `storeName` when the database is new */
const openDatabase = (dbName: string, storeName: string) =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error(`Opening ${dbName} failed`));
  });

/**
 * Run one request in a transaction of its own and resolve with its result
 * once the transaction commits. An abort rejects with an `Error` even when
 * the browser gives none: WebKit aborts on a lost connection with `error`
 * null, which reached Sentry as "Error: null".
 */
const transact =
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
            new Error(`A transaction on ${db.name} was aborted with no error`)
        );
    });

/**
 * lightning-fs's own backend (idb-keyval) keeps its first connection for
 * good, so once the browser closes it (a backgrounded iOS tab, the user
 * clearing site data) every read and write fails until a reload. This one
 * forgets a connection the browser closed or that failed a request, opens
 * a new one, and tries each request once more before it rejects.
 */
class ReopeningIdbBackend implements IdbBackend {
  private _connection?: Promise<IDBDatabase>;

  constructor(
    private readonly _dbName: string,
    private readonly _storeName: string
  ) {}

  saveSuperblock(superblock: unknown) {
    return this._write((store) => store.put(superblock, SUPERBLOCK_KEY));
  }

  loadSuperblock() {
    return this._run((store) => store.get(SUPERBLOCK_KEY), "readonly");
  }

  readFile(inode: number): Promise<Uint8Array | undefined> {
    return this._run((store) => store.get(inode), "readonly");
  }

  writeFile(inode: number, data: Uint8Array) {
    return this._write((store) => store.put(data, inode));
  }

  unlink(inode: number) {
    return this._write((store) => store.delete(inode));
  }

  wipe() {
    return this._write((store) => store.clear());
  }

  async close() {
    const connection = this._connection;
    this._connection = undefined;
    // Closing a connection the browser already closed does nothing
    if (connection) (await connection).close();
  }

  private async _write<T>(makeRequest: MakeRequest<T>) {
    await this._run(makeRequest, "readwrite");
  }

  /** Every request is a put, get, delete or clear, so running it twice is safe */
  private async _run<T>(makeRequest: MakeRequest<T>, mode: IDBTransactionMode) {
    try {
      return await this._attempt(makeRequest, mode);
    } catch {
      // `_attempt` dropped the connection; the error of the retry is the one
      // that matters
      return this._attempt(makeRequest, mode);
    }
  }

  private async _attempt<T>(
    makeRequest: MakeRequest<T>,
    mode: IDBTransactionMode
  ) {
    const connection = this._connect();
    const db = await connection;
    try {
      return await transact(makeRequest, mode)(db, this._storeName);
    } catch (e) {
      db.close();
      this._forget(connection);
      throw e;
    }
  }

  private _connect() {
    if (this._connection) return this._connection;

    const connection = openDatabase(this._dbName, this._storeName);
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
