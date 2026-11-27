import { set, Store } from "@isomorphic-git/idb-keyval";
import FS from "@isomorphic-git/lightning-fs";
import {
  forceCloseDatabase,
  IDBDatabase,
  IDBFactory,
  IDBObjectStore,
} from "fake-indexeddb";

import {
  initLogger,
  memoryProvider,
  resetLogger,
} from "../../shared/lib/logger";
import { idbBackend } from "./idb-backend";

// lightning-fs's defaults for `new FS("solana-playground")`
const DB_NAME = "solana-playground";
const STORE_NAME = "solana-playground_files";

/** Every connection the code under test opened, oldest first */
const connections: globalThis.IDBDatabase[] = [];

/** Close the newest connection as the browser does, firing its `close` */
const closeLastConnection = () => {
  const connection = connections.at(-1);
  if (!connection) throw new Error("No connection was opened");
  // fake-indexeddb types the argument as its class, not an instance of it
  forceCloseDatabase(connection as unknown as typeof IDBDatabase);
};

const deleteDatabase = (name: string) =>
  new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`Deleting ${name} is blocked`));
  });

/** What a promise rejected with, or `"resolved"` */
const settled = (promise: Promise<unknown>) =>
  promise.then(
    () => "resolved" as const,
    (e: unknown) => e
  );

/** The bytes `readFile` resolved with, as a plain array */
const bytesOf = async (read: Promise<Uint8Array | undefined>) =>
  Array.from((await read) ?? []);

/** Abort every transaction `transaction()` starts from now on, before its request runs */
const abortEveryTransaction = () => {
  const transaction = IDBDatabase.prototype.transaction;
  return vi
    .spyOn(IDBDatabase.prototype, "transaction")
    .mockImplementation(function (this: IDBDatabase, ...args) {
      const started = transaction.apply(this, args);
      queueMicrotask(() => started.abort());
      return started;
    });
};

describe("utils/explorer/idb-backend", () => {
  let logged: ReturnType<typeof memoryProvider>;

  beforeEach(() => {
    logged = memoryProvider();
    initLogger({ providers: [logged] });
    connections.length = 0;
    const factory = new IDBFactory();
    const open = factory.open.bind(factory);
    vi.spyOn(factory, "open").mockImplementation((name, version) => {
      const request = open(name, version);
      request.addEventListener("success", () =>
        connections.push(request.result)
      );
      return request;
    });
    vi.stubGlobal("indexedDB", factory);
  });

  afterEach(() => {
    resetLogger();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reads the tree and the files lightning-fs's own backend wrote", async () => {
    const old = new Store(DB_NAME, STORE_NAME);
    const root = new Map([["/", new Map()]]);
    await set("!root", root, old);
    await set(1, Uint8Array.of(7), old);

    const backend = idbBackend(DB_NAME, STORE_NAME);

    expect(await backend.loadSuperblock()).toEqual(root);
    expect(await bytesOf(backend.readFile(1))).toEqual([7]);
  });

  it("saves the tree, and unlinks and wipes files", async () => {
    const backend = idbBackend(DB_NAME, STORE_NAME);
    const root = new Map([["/", new Map([["a", 1]])]]);
    await backend.saveSuperblock(root);
    await backend.writeFile(1, Uint8Array.of(1));
    await backend.writeFile(2, Uint8Array.of(2));

    await backend.unlink(1);

    expect(await backend.loadSuperblock()).toEqual(root);
    expect(await backend.readFile(1)).toBeUndefined();
    expect(await bytesOf(backend.readFile(2))).toEqual([2]);

    await backend.wipe();

    expect(await backend.loadSuperblock()).toBeUndefined();
    expect(await backend.readFile(2)).toBeUndefined();
  });

  it("reopens cleanly after lightning-fs closes it when idle", async () => {
    const backend = idbBackend(DB_NAME, STORE_NAME);
    await backend.writeFile(1, Uint8Array.of(1));

    await backend.close();
    await backend.writeFile(2, Uint8Array.of(2));

    expect(await bytesOf(backend.readFile(2))).toEqual([2]);
    expect(connections).toHaveLength(2);
    expect(logged.entries).toHaveLength(0);
  });

  it("closes a backend that never opened", async () => {
    expect(await settled(idbBackend(DB_NAME, STORE_NAME).close())).toBe(
      "resolved"
    );
  });

  it("closes while its open is still pending and then fails", async () => {
    vi.stubGlobal("indexedDB", {
      open: () => {
        const request = {} as IDBOpenDBRequest;
        setTimeout(() => request.onerror?.({} as Event));
        return request;
      },
    });
    const backend = idbBackend(DB_NAME, STORE_NAME);
    const write = settled(backend.writeFile(1, Uint8Array.of(1)));

    expect(await settled(backend.close())).toBe("resolved");
    expect(await write).toBeInstanceOf(Object);
  });

  it("writes a file after the browser closes the connection under it", async () => {
    const backend = idbBackend(DB_NAME, STORE_NAME);
    await backend.writeFile(1, Uint8Array.of(1));
    closeLastConnection();

    await backend.writeFile(2, Uint8Array.of(2));

    expect(await bytesOf(backend.readFile(2))).toEqual([2]);
  });

  it("reads a file after the browser closes the connection under it", async () => {
    const backend = idbBackend(DB_NAME, STORE_NAME);
    await backend.writeFile(1, Uint8Array.of(1));
    closeLastConnection();

    expect(await bytesOf(backend.readFile(1))).toEqual([1]);
  });

  it("writes a file after the connection closes without a `close` event, and logs the lost attempt", async () => {
    const backend = idbBackend(DB_NAME, STORE_NAME);
    await backend.writeFile(1, Uint8Array.of(1));
    // `close()` fires no `close` event, so only the failed write tells
    connections.at(-1)?.close();

    await backend.writeFile(2, Uint8Array.of(2));

    expect(await bytesOf(backend.readFile(2))).toEqual([2]);
    expect(logged.entries).toMatchObject([
      {
        level: "warn",
        ns: "explorer:idb-backend",
        context: { name: "InvalidStateError" },
      },
    ]);
    expect(logged.entries[0].report).toBeFalsy();
  });

  it("lets a deletion through, then refuses to recreate the deleted database", async () => {
    const backend = idbBackend(DB_NAME, STORE_NAME);
    await backend.writeFile(1, Uint8Array.of(1));

    // Blocked, the helper would reject: the open connection must give way
    await deleteDatabase(DB_NAME);

    expect(
      await settled(backend.writeFile(2, Uint8Array.of(2)))
    ).toHaveProperty("name", "DatabaseDeletedError");
    const names = await new Promise<string[]>((resolve) => {
      const request = indexedDB.open(DB_NAME);
      request.onsuccess = () => {
        resolve(Array.from(request.result.objectStoreNames));
        request.result.close();
      };
    });
    expect(names).toEqual([]);
  });

  it("keeps a newer write when an older one to the same file is retried", async () => {
    const backend = idbBackend(DB_NAME, STORE_NAME);
    await backend.writeFile(1, Uint8Array.of(0));
    // The older write's first transaction aborts, and its abort arrives after
    // the newer write was made, as when the connection dies under both
    const transaction = IDBDatabase.prototype.transaction;
    vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementationOnce(
      function (this: IDBDatabase, ...args) {
        const started = transaction.apply(this, args);
        queueMicrotask(() => started.abort());
        return started;
      }
    );

    const older = backend.writeFile(1, Uint8Array.of(1));
    const newer = backend.writeFile(1, Uint8Array.of(2));
    await Promise.all([older, newer]);

    expect(await bytesOf(backend.readFile(1))).toEqual([2]);
  });

  it("rejects a request's own failure at once, keeping the connection", async () => {
    const backend = idbBackend(DB_NAME, STORE_NAME);
    await backend.writeFile(1, Uint8Array.of(1));
    const put = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementationOnce(() => {
        throw new DOMException("full", "QuotaExceededError");
      });

    expect(
      await settled(backend.writeFile(2, Uint8Array.of(2)))
    ).toHaveProperty("name", "QuotaExceededError");
    expect(put).toHaveBeenCalledTimes(1);
    expect(await bytesOf(backend.readFile(1))).toEqual([1]);
    expect(connections).toHaveLength(1);
  });

  it("rejects an aborted write with the reason, never null, after one retry", async () => {
    const backend = idbBackend(DB_NAME, STORE_NAME);
    await backend.writeFile(1, Uint8Array.of(1));
    // WebKit aborts a transaction on a lost connection with no `error`; an
    // explicit `abort()` leaves `transaction.error` null the same way, and
    // gives the pending request an `AbortError`
    const aborts = abortEveryTransaction();

    const rejection = await settled(backend.writeFile(2, Uint8Array.of(2)));

    // A `DOMException` of fake-indexeddb's realm, not jsdom's `Error`
    expect(rejection).toHaveProperty("name", "AbortError");
    expect(rejection).toHaveProperty("cause.name", "AbortError");
    expect(aborts).toHaveBeenCalledTimes(2);
  });

  it("rejects with an Error when the browser gives neither the transaction nor the request one", async () => {
    const backend = idbBackend(DB_NAME, STORE_NAME);
    await backend.writeFile(1, Uint8Array.of(1));
    // Abort once the request succeeded, so neither carries an error
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore,
      ...args
    ) {
      const request = put.apply(this, args);
      request.addEventListener("success", () => this.transaction.abort());
      return request;
    });

    const rejection = await settled(backend.writeFile(2, Uint8Array.of(2)));

    expect(rejection).toMatchObject({ name: "AbortError" });
    expect(String((rejection as Error).message)).toContain(DB_NAME);
  });

  it("works again after a request failed twice", async () => {
    const backend = idbBackend(DB_NAME, STORE_NAME);
    await backend.writeFile(1, Uint8Array.of(1));
    const aborts = abortEveryTransaction();
    await settled(backend.writeFile(2, Uint8Array.of(2)));
    aborts.mockRestore();

    await backend.writeFile(2, Uint8Array.of(2));

    expect(await bytesOf(backend.readFile(2))).toEqual([2]);
  });

  it("serves lightning-fs, which keeps working after the connection closes", async () => {
    const fs = new FS(DB_NAME, {
      db: idbBackend(DB_NAME, STORE_NAME) as unknown as FS.IDB,
    }).promises;
    await fs.mkdir("/w");
    await fs.writeFile("/w/a.rs", "one");
    for (const connection of connections.filter((c) => c.name === DB_NAME)) {
      connection.close();
    }

    await fs.writeFile("/w/b.rs", "two");
    await fs.unlink("/w/a.rs");
    await fs.flush();

    const again = new FS(DB_NAME, {
      db: idbBackend(DB_NAME, STORE_NAME) as unknown as FS.IDB,
    }).promises;
    expect(await again.readdir("/w")).toEqual(["b.rs"]);
    expect(await again.readFile("/w/b.rs", "utf8")).toBe("two");
  });
});
