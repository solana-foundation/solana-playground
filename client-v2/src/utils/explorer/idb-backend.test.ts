import { forceCloseDatabase, IDBDatabase, IDBFactory } from "fake-indexeddb";

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

describe("utils/explorer/idb-backend", () => {
  beforeEach(() => {
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("writes a file after the browser closes the connection under it", async () => {
    const backend = idbBackend(DB_NAME, STORE_NAME);
    await backend.writeFile(1, Uint8Array.of(1));
    closeLastConnection();

    await backend.writeFile(2, Uint8Array.of(2));

    expect(Array.from((await backend.readFile(2)) ?? [])).toEqual([2]);
  });

  it("reads a file after the browser closes the connection under it", async () => {
    const backend = idbBackend(DB_NAME, STORE_NAME);
    await backend.writeFile(1, Uint8Array.of(1));
    closeLastConnection();

    expect(Array.from((await backend.readFile(1)) ?? [])).toEqual([1]);
  });

  it("writes a file after the connection closes without a `close` event", async () => {
    const backend = idbBackend(DB_NAME, STORE_NAME);
    await backend.writeFile(1, Uint8Array.of(1));
    // `close()` fires no `close` event, so only the failed write tells
    connections.at(-1)?.close();

    await backend.writeFile(2, Uint8Array.of(2));

    expect(Array.from((await backend.readFile(2)) ?? [])).toEqual([2]);
  });

  it("writes a file after the browser deletes the database under it", async () => {
    const backend = idbBackend(DB_NAME, STORE_NAME);
    await backend.writeFile(1, Uint8Array.of(1));
    closeLastConnection();
    await deleteDatabase(DB_NAME);

    await backend.writeFile(2, Uint8Array.of(2));

    expect(Array.from((await backend.readFile(2)) ?? [])).toEqual([2]);
  });

  it("rejects an aborted write with the reason, never null", async () => {
    const backend = idbBackend(DB_NAME, STORE_NAME);
    await backend.writeFile(1, Uint8Array.of(1));
    // WebKit aborts a transaction on a lost connection with no `error`; an
    // explicit `abort()` leaves `error` null the same way
    const transaction = IDBDatabase.prototype.transaction;
    vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(function (
      this: IDBDatabase,
      ...args
    ) {
      const started = transaction.apply(this, args);
      queueMicrotask(() => started.abort());
      return started;
    });

    // A `DOMException` of fake-indexeddb's realm, not jsdom's `Error`
    expect(
      await settled(backend.writeFile(2, Uint8Array.of(2)))
    ).toHaveProperty("name", "AbortError");
  });
});
