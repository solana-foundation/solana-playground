import { createLogger, toError } from "../../shared/lib/logger";
import { PgCommon } from "../common";
import type { WalletStore } from "./keystore";
import type { SerializedWalletState, WalletAccount } from "./types";

const log = createLogger("wallet:storage");

/** The `localStorage` key the wallet lived under before the keystore */
const LOCAL_KEY = "wallet";

/** The part of `Storage` the wallet uses */
type LocalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * Log a storage failure without anything the failure may carry.
 *
 * An IndexedDB or JSON error is rebuilt from its name and message only, so no
 * property or `cause` holding wallet state can reach a log provider or error
 * tracking. Callers pass counts, never accounts.
 */
const reportFailureWith =
  (context: Record<string, number>) => (what: string, error: unknown) => {
    const original = toError(error);
    const clean = new Error(`${what}: ${original.name}: ${original.message}`);
    log.error(clean, { report: true, context });
  };

const reportFailure = reportFailureWith({});

/** Report a failure with the count of accounts it concerns */
const reportFailureFor = (state: SerializedWalletState) =>
  reportFailureWith({ accounts: state.accounts.length });

/** An account's public key: the last 32 bytes of its keypair */
const publicKeyOf = (account: WalletAccount) => account.kp.slice(32).join(",");

/** The name, or the first `<name> (n)` that `taken` does not hold */
const freeNameFor = (taken: Set<string>) => (name: string) => {
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name} (${n})`;
    if (!taken.has(candidate)) return candidate;
  }
};

/**
 * Merge two wallets so that no key is lost.
 *
 * `primary`'s accounts come first, with their names, and its current index,
 * connection state and Wallet Standard name win. Each of `other`'s accounts
 * whose public key `primary` lacks is appended, its name suffixed when
 * `primary` already uses it. Keys are compared, not whole accounts, so an
 * account renamed in one copy does not become two.
 */
const mergeWallets = (
  primary: SerializedWalletState,
  other: SerializedWalletState
): SerializedWalletState => {
  const keys = new Set(primary.accounts.map(publicKeyOf));
  const names = new Set(primary.accounts.map((account) => account.name));
  const freeName = freeNameFor(names);
  const accounts = [...primary.accounts];
  for (const account of other.accounts) {
    if (keys.has(publicKeyOf(account))) continue;
    const name = freeName(account.name);
    names.add(name);
    keys.add(publicKeyOf(account));
    accounts.push({ kp: account.kp, name });
  }

  return {
    state: primary.state,
    accounts,
    currentIndex: primary.currentIndex,
    standardName: primary.standardName,
  };
};

/**
 * The wallet's persistence: IndexedDB, with `localStorage` as what it moves
 * from and what it falls back to.
 *
 * `read` moves a wallet found in `localStorage` into the store: it writes it
 * (merged with what the store holds), reads it back, and removes the
 * `localStorage` entry only when the copy reads back equal. Any store failure
 * leaves `localStorage` as it was and switches this instance to
 * `localStorage` for the rest of the page's life, because losing a key is
 * worse than leaving one where it was. The next load tries the store again.
 *
 * `write` calls run one after another, in call order: `updatable` does not
 * await them, and two quick changes must not land out of order.
 *
 * @param store the keystore
 * @param local the `localStorage` to migrate from and fall back to
 */
export const walletStorageWith = (store: WalletStore, local: LocalStorage) => {
  let isDegraded = false;
  let writes = Promise.resolve();

  const readLocal = (): SerializedWalletState | undefined => {
    const text = local.getItem(LOCAL_KEY);
    if (text === null) return undefined;
    try {
      return JSON.parse(text) as SerializedWalletState;
    } catch (error) {
      // Left in place: it may be the only copy of a key someone can recover
      reportFailure("Unreadable wallet in localStorage", error);
      return undefined;
    }
  };

  const writeLocal = (state: SerializedWalletState) => {
    try {
      local.setItem(LOCAL_KEY, JSON.stringify(state));
    } catch (error) {
      reportFailureFor(state)("Wallet not saved to localStorage", error);
    }
  };

  /** Copy `state` into the store and confirm it reads back the same */
  const copyToStore = async (state: SerializedWalletState) => {
    await store.write(state);
    const back = await store.read();
    if (!PgCommon.isEqual(back, state)) {
      throw new Error("The stored wallet reads back different");
    }
  };

  return {
    /** Read the wallet, moving a `localStorage` copy into the store */
    async read(): Promise<SerializedWalletState | undefined> {
      const fromLocal = readLocal();
      if (isDegraded) return fromLocal;

      let stored: SerializedWalletState | undefined;
      try {
        stored = await store.read();
      } catch (error) {
        isDegraded = true;
        reportFailure("Wallet store unavailable", error);
        return fromLocal;
      }
      if (!fromLocal) return stored;

      const merged = stored ? mergeWallets(stored, fromLocal) : fromLocal;
      try {
        await copyToStore(merged);
      } catch (error) {
        isDegraded = true;
        reportFailureFor(merged)("Wallet not moved out of localStorage", error);
        return merged;
      }

      local.removeItem(LOCAL_KEY);
      return merged;
    },

    /** Write the wallet; falls back to `localStorage` if the store fails */
    write(state: SerializedWalletState): Promise<void> {
      writes = writes.then(async () => {
        if (isDegraded) return writeLocal(state);
        try {
          await store.write(state);
        } catch (error) {
          isDegraded = true;
          reportFailureFor(state)("Wallet not saved to the store", error);
          writeLocal(state);
        }
      });
      return writes;
    },
  };
};

if (import.meta.vitest) {
  const { describe, it, expect, vi, beforeAll, beforeEach, afterEach } =
    import.meta.vitest;

  describe("utils/wallet/wallet-storage", () => {
    type Logger = typeof import("../../shared/lib/logger");
    let initLogger: Logger["initLogger"];
    let memoryProvider: Logger["memoryProvider"];
    let resetLogger: Logger["resetLogger"];
    let logged: ReturnType<Logger["memoryProvider"]>;

    beforeAll(async () => {
      ({ initLogger, memoryProvider, resetLogger } = await import(
        "../../shared/lib/logger"
      ));
    });

    beforeEach(() => {
      logged = memoryProvider();
      initLogger({ providers: [logged] });
    });

    afterEach(() => {
      resetLogger();
    });

    /** A keypair-shaped array: 32 "secret" bytes, then 32 "public" bytes */
    const kp = (seed: number) =>
      Array.from({ length: 64 }, (_, i) => (seed * 7 + i * 13) % 256);

    const account = (seed: number, name: string) => ({ kp: kp(seed), name });

    /** No Wallet Standard wallet: `WalletState.standardName` stores `null` */
    // eslint-disable-next-line unicorn/no-null -- the stored shape's own "none"
    const NO_STANDARD = null;

    /** A connected wallet on its first account */
    const walletOf = (accounts: WalletAccount[]): SerializedWalletState => ({
      state: "pg",
      accounts,
      currentIndex: 0,
      standardName: NO_STANDARD,
    });

    const memoryStore = (initial: SerializedWalletState | undefined) => {
      let value = initial && structuredClone(initial);
      return {
        read: vi.fn(async () => value && structuredClone(value)),
        write: vi.fn(async (state: SerializedWalletState) => {
          value = structuredClone(state);
        }),
        held: () => value,
      };
    };

    const memoryLocal = (wallet: string | undefined) => {
      const items = new Map<string, string>();
      if (wallet !== undefined) items.set(LOCAL_KEY, wallet);
      return {
        // eslint-disable-next-line unicorn/no-null -- `Storage.getItem` returns null
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => void items.set(key, value),
        removeItem: (key: string) => void items.delete(key),
        items,
      };
    };

    it("reads nothing when nothing is stored", async () => {
      const storage = walletStorageWith(
        memoryStore(undefined),
        memoryLocal(undefined)
      );
      expect(await storage.read()).toBeUndefined();
    });

    it("reads a wallet the store holds", async () => {
      const stored = walletOf([account(1, "Wallet 1")]);
      const storage = walletStorageWith(
        memoryStore(stored),
        memoryLocal(undefined)
      );
      expect(await storage.read()).toEqual(stored);
    });

    it("moves a localStorage wallet into the store and removes the key", async () => {
      const old: SerializedWalletState = {
        state: "pg",
        accounts: [account(1, "Wallet 1"), account(2, "Wallet 2")],
        currentIndex: 1,
        standardName: NO_STANDARD,
      };
      const store = memoryStore(undefined);
      const local = memoryLocal(JSON.stringify(old));

      const read = await walletStorageWith(store, local).read();

      expect(store.held()).toEqual(old);
      expect(local.items.has(LOCAL_KEY)).toBe(false);
      expect(read).toEqual(old);
    });

    it("keeps localStorage when the store write fails", async () => {
      const old = walletOf([account(1, "Wallet 1")]);
      const store = memoryStore(undefined);
      store.write.mockRejectedValueOnce(new Error("quota"));
      const local = memoryLocal(JSON.stringify(old));

      const read = await walletStorageWith(store, local).read();

      expect(local.items.get(LOCAL_KEY)).toBe(JSON.stringify(old));
      expect(read).toEqual(old);
      expect(logged.entries).toHaveLength(1);
      expect(logged.entries[0].ns).toBe("wallet:storage");
      expect(logged.entries[0].report).toBe(true);
    });

    it("keeps localStorage when the read-back differs", async () => {
      const old = walletOf([account(1, "Wallet 1")]);
      const store = memoryStore(undefined);
      store.write.mockImplementationOnce(async () => {});
      const local = memoryLocal(JSON.stringify(old));

      const read = await walletStorageWith(store, local).read();

      expect(local.items.get(LOCAL_KEY)).toBe(JSON.stringify(old));
      expect(read).toEqual(old);
      expect(logged.entries).toHaveLength(1);
    });

    it("merges both by public key, the store's first, and renames a clash", async () => {
      const inStore: SerializedWalletState = {
        state: "pg",
        accounts: [account(1, "Wallet 1"), account(2, "Main")],
        currentIndex: 1,
        standardName: NO_STANDARD,
      };
      const inLocal: SerializedWalletState = {
        state: "disconnected",
        accounts: [
          // The same key, renamed in an older tab: one account, the store's name
          account(2, "Renamed"),
          // Another key under a name the store already uses
          account(3, "Wallet 1"),
          account(4, "Spare"),
        ],
        currentIndex: 2,
        standardName: "Phantom",
      };
      const store = memoryStore(inStore);
      const local = memoryLocal(JSON.stringify(inLocal));

      const read = await walletStorageWith(store, local).read();

      const expected: SerializedWalletState = {
        state: "pg",
        accounts: [
          account(1, "Wallet 1"),
          account(2, "Main"),
          account(3, "Wallet 1 (2)"),
          account(4, "Spare"),
        ],
        currentIndex: 1,
        standardName: NO_STANDARD,
      };
      expect(read).toEqual(expected);
      expect(store.held()).toEqual(expected);
      expect(local.items.has(LOCAL_KEY)).toBe(false);
    });

    it("leaves unreadable localStorage JSON in place", async () => {
      const store = memoryStore(undefined);
      const local = memoryLocal("{not json");

      const read = await walletStorageWith(store, local).read();

      expect(read).toBeUndefined();
      expect(local.items.get(LOCAL_KEY)).toBe("{not json");
      expect(store.write).not.toHaveBeenCalled();
      expect(logged.entries).toHaveLength(1);
    });

    it("uses localStorage and logs once when the store cannot open", async () => {
      const old = walletOf([account(1, "Wallet 1")]);
      const store = memoryStore(undefined);
      store.read.mockRejectedValue(new Error("indexedDB is not available"));
      const local = memoryLocal(JSON.stringify(old));
      const storage = walletStorageWith(store, local);

      const read = await storage.read();
      await storage.write({
        state: "disconnected",
        accounts: [account(1, "Wallet 1")],
        currentIndex: 0,
        standardName: NO_STANDARD,
      });

      expect(read).toEqual(old);
      expect(JSON.parse(local.items.get(LOCAL_KEY) ?? "{}").state).toBe(
        "disconnected"
      );
      expect(store.write).not.toHaveBeenCalled();
      expect(logged.entries).toHaveLength(1);
    });

    it("writes to the store, not localStorage", async () => {
      const store = memoryStore(undefined);
      const local = memoryLocal(undefined);
      const storage = walletStorageWith(store, local);
      await storage.read();

      const next = walletOf([account(1, "Wallet 1")]);
      await storage.write(next);

      expect(store.held()).toEqual(next);
      expect(local.items.has(LOCAL_KEY)).toBe(false);
    });

    it("writes to localStorage when a store write fails", async () => {
      const store = memoryStore(undefined);
      const local = memoryLocal(undefined);
      const storage = walletStorageWith(store, local);
      await storage.read();
      store.write.mockRejectedValueOnce(new Error("unknown"));

      const next = walletOf([account(1, "Wallet 1")]);
      await storage.write(next);

      expect(local.items.get(LOCAL_KEY)).toBe(JSON.stringify(next));
      expect(logged.entries).toHaveLength(1);
    });

    it("applies two quick writes in call order", async () => {
      const store = memoryStore(undefined);
      const storage = walletStorageWith(store, memoryLocal(undefined));
      await storage.read();
      let release = () => {};
      const held = new Promise<void>((resolve) => (release = resolve));
      const write = store.write.getMockImplementation();
      store.write.mockImplementationOnce(async (state) => {
        await held;
        await write?.(state);
      });

      const first = storage.write(walletOf([account(1, "A")]));
      const second = storage.write(walletOf([account(2, "B")]));
      release();
      await Promise.all([first, second]);

      expect(store.held()?.accounts[0].name).toBe("B");
    });

    it("logs no keypair bytes and no account names", async () => {
      const secret = walletOf([account(9, "Secret name")]);
      const failing = memoryStore(undefined);
      failing.write.mockRejectedValue(new Error("quota"));
      const storage = walletStorageWith(
        failing,
        memoryLocal(JSON.stringify(secret))
      );
      await storage.read();
      await storage.write(secret);

      const unopened = memoryStore(undefined);
      unopened.read.mockRejectedValue(new Error("blocked"));
      await walletStorageWith(
        unopened,
        memoryLocal(JSON.stringify(secret))
      ).read();

      expect(logged.entries.length).toBeGreaterThan(1);
      const text = JSON.stringify(
        logged.entries.map((entry) => ({
          ns: entry.ns,
          message: entry.message,
          error: String(entry.error),
          cause: String(entry.error?.cause),
          context: entry.context,
        }))
      );
      const bytes = kp(9);
      expect(text).not.toContain(bytes.slice(0, 32).join(","));
      expect(text).not.toContain(Buffer.from(bytes).toString("base64"));
      expect(text).not.toContain("Secret name");
    });
  });
}
