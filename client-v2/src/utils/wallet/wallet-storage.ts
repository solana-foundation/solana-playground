import { createLogger, toError } from "../../shared/lib/logger";
import { PgCommon } from "../common";
import type { WalletStore } from "./keystore";
import { publicKeyOf } from "./signer-provider";
import type { SerializedWalletState, WalletAccount } from "./types";

const log = createLogger("wallet:storage");

/** The `localStorage` key the wallet lived under before the keystore */
export const WALLET_LOCAL_KEY = "wallet";

/**
 * Where an unreadable `localStorage` wallet is kept, so that a later fallback
 * write cannot overwrite what may be someone's only copy of a key.
 */
const UNREADABLE_KEY = "wallet.unreadable";

/** The part of `Storage` the wallet uses */
type LocalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * Whether an error's message is safe to log next to wallet state.
 *
 * IndexedDB and `Storage` fail with `DOMException`s whose messages are fixed
 * by the browser, and the errors this module throws are plain `Error`s. Any
 * other error's message may quote its input: V8's `JSON.parse` `SyntaxError`
 * includes a slice of the text it failed on, which for a wallet is key bytes.
 * A thrown value that is not an `Error` at all may be anything, so only an
 * `Error` object itself qualifies, never one built around another value.
 */
const isMessageSafe = (error: unknown) =>
  error instanceof DOMException ||
  (error instanceof Error && error.name === "Error");

/**
 * Log a storage failure without anything the failure may carry.
 *
 * The error is rebuilt from its name, and its message only where
 * `isMessageSafe` allows, so no property, `cause` or quoted input holding
 * wallet state can reach a log provider or error tracking. Callers pass
 * counts, never accounts.
 */
const reportFailureWith =
  (context: Record<string, number>) => (what: string, error: unknown) => {
    const original = toError(error);
    const detail = isMessageSafe(error)
      ? `${original.name}: ${original.message}`
      : original.name;
    log.error(new Error(`${what}: ${detail}`), { report: true, context });
  };

const reportFailure = reportFailureWith({});

/** Report a failure with the count of accounts it concerns */
const reportFailureFor = (state: SerializedWalletState) =>
  reportFailureWith({ accounts: state.accounts.length });

/** Whether `value` is an account with a 64-byte keypair */
const isAccount = (value: unknown): value is WalletAccount => {
  if (typeof value !== "object" || value === null) return false;
  const { kp, name } = value as Partial<WalletAccount>;
  return (
    typeof name === "string" &&
    Array.isArray(kp) &&
    kp.length === 64 &&
    kp.every((byte) => Number.isInteger(byte) && byte >= 0 && byte < 256)
  );
};

/** Whether `value` has the shape of a stored wallet */
const isStoredWallet = (value: unknown): value is SerializedWalletState => {
  if (typeof value !== "object" || value === null) return false;
  const { accounts, currentIndex, state } = value as Partial<
    Record<keyof SerializedWalletState, unknown>
  >;
  return (
    Array.isArray(accounts) &&
    accounts.every(isAccount) &&
    typeof currentIndex === "number" &&
    typeof state === "string"
  );
};

/** Whether `value` is the pre-accounts format, a single `sk` keypair */
const isLegacyWallet = (value: unknown) =>
  typeof value === "object" &&
  value !== null &&
  Array.isArray((value as { sk?: unknown }).sk);

/** An account's public key, as the merge compares it */
const keyIdOf = (account: WalletAccount) => publicKeyOf(account.kp).toBase58();

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
  const keys = new Set(primary.accounts.map(keyIdOf));
  const names = new Set(primary.accounts.map((account) => account.name));
  const freeName = freeNameFor(names);
  const accounts = [...primary.accounts];
  for (const account of other.accounts) {
    if (keys.has(keyIdOf(account))) continue;
    const name = freeName(account.name);
    names.add(name);
    keys.add(keyIdOf(account));
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
 * `read` and every `write` run under the store's lock, so one tab's move
 * never interleaves with another tab's move or save. `read` moves a wallet
 * found in `localStorage` into the store: it merges it with what the
 * store holds, writes the result, reads it back, and removes the
 * `localStorage` entry only when the copy reads back equal and nobody wrote
 * the entry meanwhile. `localStorage` is the merge's primary: once a wallet
 * has moved, a copy there is newer than the store's, written by a session
 * that fell back or by a tab still on the previous version.
 *
 * A failed move leaves `localStorage` as it was. Any store failure switches
 * this instance to `localStorage` for the rest of the page's life, and its
 * saves then overwrite the entry there, because losing a key is worse than
 * leaving one where it was. The next load tries the
 * store again and merges. An account removed while falling back comes back
 * from the store on that merge: a removed key returns, none is lost.
 *
 * `write` calls run one after another, in call order: `updatable` does not
 * await them, and two quick changes must not land out of order.
 *
 * A save waits for the lock, so a tab closed while another tab holds it would
 * drop the queued save, and with it a key that exists only in memory (a new
 * account). `keepUnsaved`, called when the page is hidden, writes the newest
 * save that has not landed to `localStorage`, where the next load moves it
 * into the store; if the save lands after all, the copy is removed again.
 *
 * @param store the keystore
 * @param local the `localStorage` to migrate from and fall back to
 */
export const walletStorageWith =
  (store: WalletStore) => (local: LocalStorage) => {
    let isDegraded = false;
    let writes = Promise.resolve();
    /** The newest save that has not landed in either store */
    let unsaved: SerializedWalletState | undefined;
    /** The text `keepUnsaved` put in `localStorage`, removed once the save lands */
    let keptText: string | undefined;

    /** The `localStorage` wallet and its text, or `undefined` for none */
    const readLocal = () => {
      let text: string | null;
      try {
        text = local.getItem(WALLET_LOCAL_KEY);
      } catch (error) {
        // Storage refused (a sandboxed or blocked origin): the store may still
        // hold the wallet, so go on to it
        reportFailure("localStorage unavailable", error);
        return undefined;
      }
      if (text === null) return undefined;
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch (error) {
        keepUnreadable(text);
        reportFailure("Unreadable wallet in localStorage", error);
        return undefined;
      }
      // The pre-accounts format: `wallet.ts`'s `migrate` upgrades it in place
      // before this runs in its own tab, so here it is another tab mid-upgrade
      if (isLegacyWallet(value)) return undefined;
      if (!isStoredWallet(value)) {
        keepUnreadable(text);
        reportFailure("Unreadable wallet in localStorage", new Error("shape"));
        return undefined;
      }
      return { wallet: value, text };
    };

    /** Keep the first unreadable copy aside; a later one never replaces it */
    const keepUnreadable = (text: string) => {
      try {
        if (local.getItem(UNREADABLE_KEY) === null) {
          local.setItem(UNREADABLE_KEY, text);
        }
      } catch (error) {
        reportFailure("Unreadable wallet not kept aside", error);
      }
    };

    const writeLocal = (state: SerializedWalletState) => {
      try {
        local.setItem(WALLET_LOCAL_KEY, JSON.stringify(state));
      } catch (error) {
        reportFailureFor(state)("Wallet not saved to localStorage", error);
      }
    };

    /** Read the store, treating a record of the wrong shape as a failure */
    const readStore = async () => {
      const value = await store.read();
      if (value === undefined || isStoredWallet(value)) return value;
      throw new Error("The stored wallet has the wrong shape");
    };

    /** Copy `state` into the store and confirm it reads back the same */
    const copyToStore = async (state: SerializedWalletState) => {
      await store.write(state);
      const back = await store.read();
      if (!PgCommon.isEqual(back, state)) {
        throw new Error("The stored wallet reads back different");
      }
    };

    /** Remove the `localStorage` copy unless someone rewrote it meanwhile */
    const removeLocal = (text: string) => {
      try {
        if (local.getItem(WALLET_LOCAL_KEY) === text) {
          local.removeItem(WALLET_LOCAL_KEY);
        }
      } catch (error) {
        // The store holds the wallet; the next load merges and retries this
        reportFailure("Wallet left in localStorage", error);
      }
    };

    const migrate = async (): Promise<SerializedWalletState | undefined> => {
      const fromLocal = readLocal();
      if (isDegraded) return fromLocal?.wallet;

      let stored: SerializedWalletState | undefined;
      try {
        stored = await readStore();
      } catch (error) {
        isDegraded = true;
        reportFailure("Wallet store unavailable", error);
        return fromLocal?.wallet;
      }
      if (!fromLocal) return stored;

      const merged = stored
        ? mergeWallets(fromLocal.wallet, stored)
        : fromLocal.wallet;
      try {
        await copyToStore(merged);
      } catch (error) {
        isDegraded = true;
        reportFailureFor(merged)("Wallet not moved out of localStorage", error);
        return merged;
      }

      removeLocal(fromLocal.text);
      return merged;
    };

    return {
      /** Read the wallet, moving a `localStorage` copy into the store */
      read(): Promise<SerializedWalletState | undefined> {
        return store.exclusive(migrate);
      },

      /** Write the wallet; falls back to `localStorage` if the store fails */
      write(state: SerializedWalletState): Promise<void> {
        unsaved = state;
        writes = writes
          .then(() =>
            // Under the lock, so another tab's move cannot land on top of it
            store.exclusive(async () => {
              if (isDegraded) return writeLocal(state);
              try {
                await store.write(state);
                if (keptText !== undefined && unsaved === state) {
                  removeLocal(keptText);
                  keptText = undefined;
                }
              } catch (error) {
                isDegraded = true;
                reportFailureFor(state)("Wallet not saved to the store", error);
                writeLocal(state);
              }
            })
          )
          .then(() => {
            if (unsaved === state) unsaved = undefined;
          })
          .catch((error: unknown) => {
            // Nothing above should throw; if it does, the next write still runs
            reportFailureFor(state)("Wallet write failed", error);
          });
        return writes;
      },

      /**
       * Put the newest save that has not landed in `localStorage`, so a tab
       * closed while it waits for the lock does not lose it. Synchronous: the
       * page may be gone before anything awaited would run.
       */
      keepUnsaved(): void {
        if (unsaved === undefined) return;
        writeLocal(unsaved);
        keptText = JSON.stringify(unsaved);
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
        // A spy with the store's generic signature: `vi.fn` drops the `<T>`
        exclusive: vi.fn((task: () => Promise<unknown>) =>
          task()
        ) as unknown as WalletStore["exclusive"] & ReturnType<typeof vi.fn>,
        held: () => value,
      };
    };

    const memoryLocal = (wallet: string | undefined) => {
      const items = new Map<string, string>();
      if (wallet !== undefined) items.set(WALLET_LOCAL_KEY, wallet);
      return {
        // eslint-disable-next-line unicorn/no-null -- `Storage.getItem` returns null
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => void items.set(key, value),
        removeItem: (key: string) => void items.delete(key),
        items,
      };
    };

    it("reads nothing when nothing is stored", async () => {
      const storage = walletStorageWith(memoryStore(undefined))(
        memoryLocal(undefined)
      );
      expect(await storage.read()).toBeUndefined();
    });

    it("reads a wallet the store holds", async () => {
      const stored = walletOf([account(1, "Wallet 1")]);
      const storage = walletStorageWith(memoryStore(stored))(
        memoryLocal(undefined)
      );
      expect(await storage.read()).toEqual(stored);
    });

    it("reads the store and logs when localStorage refuses to be read", async () => {
      const stored = walletOf([account(1, "Wallet 1")]);
      const local = memoryLocal(undefined);
      const refused = {
        getItem: () => {
          throw new DOMException("denied", "SecurityError");
        },
        setItem: local.setItem,
        removeItem: local.removeItem,
      };
      const storage = walletStorageWith(memoryStore(stored))(refused);

      expect(await storage.read()).toEqual(stored);
      expect(logged.entries).toHaveLength(1);
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

      const read = await walletStorageWith(store)(local).read();

      expect(store.held()).toEqual(old);
      expect(local.items.has(WALLET_LOCAL_KEY)).toBe(false);
      expect(read).toEqual(old);
    });

    it("keeps localStorage when the store write fails", async () => {
      const old = walletOf([account(1, "Wallet 1")]);
      const store = memoryStore(undefined);
      store.write.mockRejectedValueOnce(new Error("quota"));
      const local = memoryLocal(JSON.stringify(old));

      const read = await walletStorageWith(store)(local).read();

      expect(local.items.get(WALLET_LOCAL_KEY)).toBe(JSON.stringify(old));
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

      const read = await walletStorageWith(store)(local).read();

      expect(local.items.get(WALLET_LOCAL_KEY)).toBe(JSON.stringify(old));
      expect(read).toEqual(old);
      expect(logged.entries).toHaveLength(1);
    });

    it("merges both by public key, localStorage's first, and renames a clash", async () => {
      const inStore: SerializedWalletState = {
        state: "disconnected",
        accounts: [account(1, "Wallet 1"), account(2, "Main")],
        currentIndex: 1,
        standardName: "Phantom",
      };
      const inLocal: SerializedWalletState = {
        state: "pg",
        accounts: [
          // The same key, renamed since: one account, the newer name
          account(2, "Renamed"),
          // Another key under a name the other copy also uses
          account(3, "Wallet 1"),
        ],
        currentIndex: 0,
        standardName: NO_STANDARD,
      };
      const store = memoryStore(inStore);
      const local = memoryLocal(JSON.stringify(inLocal));

      const read = await walletStorageWith(store)(local).read();

      const expected: SerializedWalletState = {
        state: "pg",
        accounts: [
          account(2, "Renamed"),
          account(3, "Wallet 1"),
          account(1, "Wallet 1 (2)"),
        ],
        currentIndex: 0,
        standardName: NO_STANDARD,
      };
      expect(read).toEqual(expected);
      expect(store.held()).toEqual(expected);
      expect(local.items.has(WALLET_LOCAL_KEY)).toBe(false);
    });

    it("moves the wallet under the store's lock", async () => {
      const store = memoryStore(undefined);
      const storage = walletStorageWith(store)(
        memoryLocal(JSON.stringify(walletOf([account(1, "Wallet 1")])))
      );

      await storage.read();

      expect(store.exclusive).toHaveBeenCalledTimes(1);
    });

    it("keeps a localStorage copy rewritten while the move ran", async () => {
      const first = JSON.stringify(walletOf([account(1, "Wallet 1")]));
      const rewritten = JSON.stringify(walletOf([account(2, "Wallet 2")]));
      const local = memoryLocal(first);
      const store = memoryStore(undefined);
      const write = store.write.getMockImplementation();
      store.write.mockImplementationOnce(async (state) => {
        // A tab on the previous version saves while this one copies
        local.items.set(WALLET_LOCAL_KEY, rewritten);
        await write?.(state);
      });

      await walletStorageWith(store)(local).read();

      expect(local.items.get(WALLET_LOCAL_KEY)).toBe(rewritten);
    });

    it("sets aside a localStorage wallet of the wrong shape and reads the store", async () => {
      const stored = walletOf([account(1, "Wallet 1")]);
      const store = memoryStore(stored);
      const local = memoryLocal(JSON.stringify({ accounts: [{ kp: [1, 2] }] }));

      const read = await walletStorageWith(store)(local).read();

      expect(read).toEqual(stored);
      expect(local.items.get("wallet.unreadable")).toBe(
        JSON.stringify({ accounts: [{ kp: [1, 2] }] })
      );
      expect(logged.entries).toHaveLength(1);
    });

    it("falls back to localStorage when the stored record has the wrong shape", async () => {
      const old = walletOf([account(1, "Wallet 1")]);
      const store = memoryStore(undefined);
      store.read.mockResolvedValue({ accounts: "corrupt" } as never);
      const local = memoryLocal(JSON.stringify(old));

      const read = await walletStorageWith(store)(local).read();

      expect(read).toEqual(old);
      expect(local.items.get(WALLET_LOCAL_KEY)).toBe(JSON.stringify(old));
      expect(logged.entries).toHaveLength(1);
    });

    it("leaves unreadable localStorage JSON in place", async () => {
      const store = memoryStore(undefined);
      const local = memoryLocal("{not json");

      const read = await walletStorageWith(store)(local).read();

      expect(read).toBeUndefined();
      expect(local.items.get(WALLET_LOCAL_KEY)).toBe("{not json");
      expect(local.items.get("wallet.unreadable")).toBe("{not json");
      expect(store.write).not.toHaveBeenCalled();
      expect(logged.entries).toHaveLength(1);
    });

    it("keeps the unreadable copy when a fallback write replaces it", async () => {
      const store = memoryStore(undefined);
      store.read.mockRejectedValue(new Error("blocked"));
      const local = memoryLocal("{not json");
      const storage = walletStorageWith(store)(local);

      await storage.read();
      await storage.write(walletOf([account(1, "Wallet 1")]));

      expect(local.items.get("wallet.unreadable")).toBe("{not json");
    });

    it("uses localStorage and logs once when the store cannot open", async () => {
      const old = walletOf([account(1, "Wallet 1")]);
      const store = memoryStore(undefined);
      store.read.mockRejectedValue(new Error("indexedDB is not available"));
      const local = memoryLocal(JSON.stringify(old));
      const storage = walletStorageWith(store)(local);

      const read = await storage.read();
      await storage.write({
        state: "disconnected",
        accounts: [account(1, "Wallet 1")],
        currentIndex: 0,
        standardName: NO_STANDARD,
      });

      expect(read).toEqual(old);
      expect(JSON.parse(local.items.get(WALLET_LOCAL_KEY) ?? "{}").state).toBe(
        "disconnected"
      );
      expect(store.write).not.toHaveBeenCalled();
      expect(logged.entries).toHaveLength(1);
    });

    it("writes to the store, not localStorage", async () => {
      const store = memoryStore(undefined);
      const local = memoryLocal(undefined);
      const storage = walletStorageWith(store)(local);
      await storage.read();

      const next = walletOf([account(1, "Wallet 1")]);
      await storage.write(next);

      expect(store.held()).toEqual(next);
      expect(local.items.has(WALLET_LOCAL_KEY)).toBe(false);
    });

    it("writes to localStorage when a store write fails", async () => {
      const store = memoryStore(undefined);
      const local = memoryLocal(undefined);
      const storage = walletStorageWith(store)(local);
      await storage.read();
      store.write.mockRejectedValueOnce(new Error("unknown"));

      const next = walletOf([account(1, "Wallet 1")]);
      await storage.write(next);

      expect(local.items.get(WALLET_LOCAL_KEY)).toBe(JSON.stringify(next));
      expect(logged.entries).toHaveLength(1);
    });

    it("applies two quick writes in call order", async () => {
      const store = memoryStore(undefined);
      const storage = walletStorageWith(store)(memoryLocal(undefined));
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

    /** A store whose lock is held by another tab until `release` is called */
    const heldLock = () => {
      const store = memoryStore(undefined);
      let release = () => {};
      const held = new Promise<void>((resolve) => (release = resolve));
      store.exclusive.mockImplementation(
        async (task: () => Promise<unknown>) => {
          await held;
          return task();
        }
      );
      return { store, release };
    };

    it("keeps a save that waits for the lock in localStorage when the page hides", async () => {
      const { store } = heldLock();
      const local = memoryLocal(undefined);
      const storage = walletStorageWith(store)(local);

      const next = walletOf([account(1, "Wallet 1")]);
      void storage.write(next);
      storage.keepUnsaved();

      expect(local.items.get(WALLET_LOCAL_KEY)).toBe(JSON.stringify(next));
      expect(store.held()).toBeUndefined();
    });

    it("removes the kept copy once the save lands in the store", async () => {
      const { store, release } = heldLock();
      const local = memoryLocal(undefined);
      const storage = walletStorageWith(store)(local);

      const next = walletOf([account(1, "Wallet 1")]);
      const saved = storage.write(next);
      storage.keepUnsaved();
      release();
      await saved;

      expect(store.held()).toEqual(next);
      expect(local.items.has(WALLET_LOCAL_KEY)).toBe(false);
    });

    it("keeps nothing when every save has landed", async () => {
      const store = memoryStore(undefined);
      const local = memoryLocal(undefined);
      const storage = walletStorageWith(store)(local);

      await storage.write(walletOf([account(1, "Wallet 1")]));
      storage.keepUnsaved();

      expect(local.items.has(WALLET_LOCAL_KEY)).toBe(false);
    });

    it("keeps the first unreadable copy when a later one turns up", async () => {
      const local = memoryLocal("{first");
      await walletStorageWith(memoryStore(undefined))(local).read();
      local.items.set(WALLET_LOCAL_KEY, "{second");

      await walletStorageWith(memoryStore(undefined))(local).read();

      expect(local.items.get("wallet.unreadable")).toBe("{first");
    });

    it("moves a fallback write back into the store on the next load", async () => {
      const store = memoryStore(walletOf([account(1, "Wallet 1")]));
      const local = memoryLocal(undefined);
      const failing = walletStorageWith(store)(local);
      await failing.read();
      store.write.mockRejectedValueOnce(new Error("quota"));
      const next: SerializedWalletState = {
        state: "pg",
        accounts: [account(1, "Wallet 1"), account(2, "Wallet 2")],
        currentIndex: 1,
        standardName: NO_STANDARD,
      };
      await failing.write(next);
      expect(local.items.get(WALLET_LOCAL_KEY)).toBe(JSON.stringify(next));

      const read = await walletStorageWith(store)(local).read();

      expect(read).toEqual(next);
      expect(store.held()).toEqual(next);
      expect(local.items.has(WALLET_LOCAL_KEY)).toBe(false);
    });

    it("reads nothing and logs when the stored record has the wrong shape", async () => {
      const store = memoryStore(undefined);
      store.read.mockResolvedValue({ accounts: "corrupt" } as never);

      const read = await walletStorageWith(store)(
        memoryLocal(undefined)
      ).read();

      expect(read).toBeUndefined();
      expect(logged.entries).toHaveLength(1);
    });

    it("sets aside every localStorage wallet that is not a wallet's shape", async () => {
      const good = account(1, "Wallet 1");
      const shapes: unknown[] = [
        [],
        { state: "pg", currentIndex: 0 },
        { state: "pg", accounts: [good] },
        { currentIndex: 0, accounts: [good] },
        {
          state: "pg",
          currentIndex: 0,
          accounts: [{ kp: kp(1).slice(1), name: "a" }],
        },
        {
          state: "pg",
          currentIndex: 0,
          accounts: [{ kp: kp(1).concat(0), name: "a" }],
        },
        {
          state: "pg",
          currentIndex: 0,
          accounts: [{ kp: kp(1).fill(256, 0, 1), name: "a" }],
        },
        {
          state: "pg",
          currentIndex: 0,
          accounts: [{ kp: kp(1).fill(-1, 0, 1), name: "a" }],
        },
        {
          state: "pg",
          currentIndex: 0,
          accounts: [{ kp: kp(1).fill(1.5, 0, 1), name: "a" }],
        },
        { state: "pg", currentIndex: 0, accounts: [{ kp: kp(1) }] },
      ];
      for (const shape of shapes) {
        const store = memoryStore(undefined);
        const local = memoryLocal(JSON.stringify(shape));

        expect(await walletStorageWith(store)(local).read()).toBeUndefined();
        expect(store.write).not.toHaveBeenCalled();
        expect(local.items.get(WALLET_LOCAL_KEY)).toBe(JSON.stringify(shape));
      }
    });

    it("saves under the store's lock", async () => {
      const store = memoryStore(undefined);
      const storage = walletStorageWith(store)(memoryLocal(undefined));
      await storage.read();

      await storage.write(walletOf([account(1, "Wallet 1")]));

      expect(store.exclusive).toHaveBeenCalledTimes(2);
    });

    it("leaves a legacy single-key wallet for its upgrade", async () => {
      const legacy = JSON.stringify({ setupCompleted: true, sk: kp(1) });
      const store = memoryStore(undefined);
      const local = memoryLocal(legacy);

      expect(await walletStorageWith(store)(local).read()).toBeUndefined();
      expect(local.items.get(WALLET_LOCAL_KEY)).toBe(legacy);
      expect(local.items.has("wallet.unreadable")).toBe(false);
      expect(logged.entries).toHaveLength(0);
    });

    it("logs no keypair bytes and no account names", async () => {
      const secret = walletOf([account(9, "Secret name")]);
      const failing = memoryStore(undefined);
      failing.write.mockRejectedValue(new Error("quota"));
      const storage = walletStorageWith(failing)(
        memoryLocal(JSON.stringify(secret))
      );
      await storage.read();
      await storage.write(secret);

      const unopened = memoryStore(undefined);
      unopened.read.mockRejectedValue(new Error("blocked"));

      // A rejection that is not an `Error` carries whatever its thrower put
      // in it, here the whole wallet
      const throwsText = memoryStore(undefined);
      throwsText.read.mockRejectedValue(JSON.stringify(secret));
      await walletStorageWith(throwsText)(memoryLocal(undefined)).read();
      await walletStorageWith(unopened)(
        memoryLocal(JSON.stringify(secret))
      ).read();

      // A wallet corrupted mid-keypair: V8's "Unexpected token" `SyntaxError`
      // quotes the text around it, here secret bytes
      const stored = JSON.stringify(secret);
      const at = stored.indexOf("[", stored.indexOf('"kp"')) + 12;
      const truncated = `${stored.slice(0, at)},,${stored.slice(at)}`;
      await walletStorageWith(memoryStore(undefined))(
        memoryLocal(truncated)
      ).read();

      // One per failure above: the save, the open, the non-Error, the parse
      expect(logged.entries).toHaveLength(4);
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
      // Any two consecutive secret bytes, as JSON writes them: V8 quotes
      // about ten characters either side of the bad token
      for (let i = 0; i + 2 <= 32; i++) {
        expect(text).not.toContain(bytes.slice(i, i + 2).join(","));
      }
      expect(text).not.toContain(Buffer.from(bytes).toString("base64"));
      expect(text).not.toContain("Secret name");
    });
  });
}
