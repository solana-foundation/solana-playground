// @vitest-environment node -- noble and web3 check `instanceof Uint8Array`, which jsdom's realm fails

import * as ed25519 from "@noble/ed25519";

import { publicKeyOf } from "../signer-provider";
import type { SerializedWalletState } from "../types";
import type { KeyFrame } from "./client";
import { publicKeysOf } from "./protocol";

/**
 * The key page did not confirm every key it was sent. Its message names the
 * public keys it lacks, never their key bytes.
 */
class MoveIncomplete extends Error {
  constructor(readonly missing: string[]) {
    super(`The key page did not confirm the keys of ${missing.join(", ")}`);
    this.name = "MoveIncomplete";
  }
}

/** What a move did: the record without key bytes, and the keys it moved */
interface Moved {
  record: SerializedWalletState;
  /** How many keys the key page confirmed */
  moved: number;
  /** The keys it confirmed, so their other copies can be cleared */
  keys: number[][];
}

const SECRET_KEY_LENGTH = 64;
const PUBLIC_KEY_LENGTH = 32;

/**
 * Whether `kp` is 64 bytes whose last 32 are the public key of the first
 * 32: a key the key page will take. A damaged copy that is not one stays
 * where it is.
 */
const isValidKey = async (kp: number[]) => {
  if (
    kp.length !== SECRET_KEY_LENGTH ||
    !kp.every((byte) => Number.isInteger(byte) && byte >= 0 && byte < 256)
  ) {
    return false;
  }
  try {
    const own = await ed25519.getPublicKey(
      Uint8Array.from(kp.slice(0, PUBLIC_KEY_LENGTH))
    );
    return own.every((byte, i) => byte === kp[PUBLIC_KEY_LENGTH + i]);
  } catch {
    // noble refuses bytes it cannot read as a seed: not a key, so the stray
    // copy is left out of the move and stays in the set-aside record
    return false;
  }
};

/**
 * Keys other copies of the wallet hold, by how sure they are to be keys.
 * Neither copy's merge may keep them, so each must reach the key page.
 */
interface OtherKeys {
  /**
   * The keys of valid accounts in any copy (`localStorage`, the store): sent
   * as they are, like the record's, so a bad one blocks the move instead of
   * being dropped by the keyless rewrite
   */
  accounts: number[][];
  /**
   * The keys of damaged accounts and set-aside records: these stay intact
   * in the set-aside record, so one that is not a key is left out
   */
  stray: number[][];
}

/**
 * Move the page's keys into the key page: copy, confirm, then drop.
 *
 * Every `kp` of the record, every key of `others.accounts`, and every valid
 * one of `others.stray` is sent in one `adopt`. The key page answers with
 * every public key it holds; each key sent must be among them, or the move
 * throws `MoveIncomplete` and the caller keeps every copy as it was. Only
 * then is the record given back without `kp`. An account's key is sent as it
 * is, so the key page is the one to refuse a bad one and the move fails; a
 * bad stray key is left out instead, since it may be a damaged copy that was
 * never a key, and the set-aside record keeps it.
 *
 * @param frame the connection to the key page
 * @returns for the wallet as the page stores it and the keys other copies of
 * the wallet hold, the record without key bytes and the keys the key page
 * confirmed
 * @throws `MoveIncomplete` when the key page lacks a key it was sent; any
 * error the key page answers with, or a reply that is not a list of public
 * keys
 */
export const moveKeysWith =
  (frame: KeyFrame) =>
  async (record: SerializedWalletState, others: OtherKeys): Promise<Moved> => {
    const fromRecord = record.accounts.flatMap(({ kp }) => (kp ? [kp] : []));
    const valid = await Promise.all(others.stray.map(isValidKey));
    // An account key that does not derive its public half is sent anyway: the
    // key page refuses it and the move fails on every load, by design, since
    // the move never drops a key
    const candidates = fromRecord
      .concat(others.accounts)
      .concat(others.stray.filter((_, i) => valid[i]));
    const byPublicKey = new Map<string, number[]>();
    for (const kp of candidates) {
      const publicKey = publicKeyOf(kp).toBase58();
      if (!byPublicKey.has(publicKey)) byPublicKey.set(publicKey, kp);
    }
    if (byPublicKey.size === 0) return { record, moved: 0, keys: [] };

    const keys = [...byPublicKey.values()];
    const confirmed = new Set(
      publicKeysOf(await frame.request({ type: "adopt", keys }))
    );
    const missing = [...byPublicKey.keys()].filter(
      (publicKey) => !confirmed.has(publicKey)
    );
    if (missing.length > 0) throw new MoveIncomplete(missing);

    return {
      record: {
        ...record,
        accounts: record.accounts.map(({ kp: _kp, ...account }) => account),
      },
      moved: keys.length,
      keys,
    };
  };

if (import.meta.vitest) {
  const { describe, it, expect, vi, beforeAll, beforeEach, afterEach } =
    import.meta.vitest;

  describe("utils/wallet/key-origin/move", () => {
    let PgWeb3: typeof import("../../web3").PgWeb3;
    let handlerWith: typeof import("./frame/handler").handlerWith;
    type WalletStorage = typeof import("../wallet-storage");
    let walletStorageWith: WalletStorage["walletStorageWith"];
    let WALLET_LOCAL_KEY: WalletStorage["WALLET_LOCAL_KEY"];
    type Logger = typeof import("../../../shared/lib/logger");
    let initLogger: Logger["initLogger"];
    let memoryProvider: Logger["memoryProvider"];
    let resetLogger: Logger["resetLogger"];
    let logged: ReturnType<Logger["memoryProvider"]>;

    beforeAll(async () => {
      ({ PgWeb3 } = await import("../../web3"));
      ({ handlerWith } = await import("./frame/handler"));
      ({ walletStorageWith, WALLET_LOCAL_KEY } = await import(
        "../wallet-storage"
      ));
      ({ initLogger, memoryProvider, resetLogger } = await import(
        "../../../shared/lib/logger"
      ));
    });

    beforeEach(() => {
      logged = memoryProvider();
      initLogger({ providers: [logged] });
    });

    afterEach(() => {
      resetLogger();
    });

    /** No Wallet Standard wallet: `WalletState.standardName` stores `null` */
    // eslint-disable-next-line unicorn/no-null -- the stored shape's own "none"
    const NO_STANDARD = null;

    /** A real ed25519 key, as the record stores it */
    const realKey = () => {
      const keypair = PgWeb3.Keypair.generate();
      return {
        kp: Array.from(keypair.secretKey),
        publicKey: keypair.publicKey.toBase58(),
      };
    };

    const accountsOf = (count: number) =>
      Array.from({ length: count }, (_, i) => {
        const { kp, publicKey } = realKey();
        return { name: `Wallet ${i + 1}`, kp, publicKey };
      });

    /** A connected wallet on the account at `currentIndex` */
    const walletAt =
      (currentIndex: number) =>
      (accounts: SerializedWalletState["accounts"]): SerializedWalletState => ({
        state: "pg",
        accounts,
        currentIndex,
        standardName: NO_STANDARD,
      });

    const walletOf = walletAt(0);

    const keyless = (record: SerializedWalletState): SerializedWalletState => ({
      state: record.state,
      accounts: record.accounts.map(({ name, publicKey }) => ({
        name,
        publicKey,
      })),
      currentIndex: record.currentIndex,
      standardName: record.standardName,
    });

    /**
     * A key page over an in-memory store, reached as a `KeyFrame`. `answer`
     * may rewrite an `adopt` reply, standing in for a key page that lost one.
     */
    const fakeKeyPageAnswering = (
      answer: (publicKeys: string[]) => string[]
    ) => {
      const kept = new Map<string, Uint8Array>();
      const handle = handlerWith({
        all: async () => new Map(kept),
        put: async (entries) => {
          for (const [publicKey, secret] of entries)
            kept.set(publicKey, secret);
        },
        remove: async (publicKey) => {
          kept.delete(publicKey);
        },
      });
      let id = 0;
      const adopts: number[][][] = [];
      const request = vi.fn(
        async <T>(body: Parameters<KeyFrame["request"]>[0]) => {
          if (body.type === "adopt") adopts.push(body.keys);
          const reply = await handle(
            Object.assign({ id: ++id }, body) as Parameters<typeof handle>[0]
          );
          if (!reply.ok) throw new Error(reply.error);
          return (
            body.type === "adopt"
              ? answer(reply.result as string[])
              : reply.result
          ) as T;
        }
      );
      const frame: KeyFrame = {
        request: request as KeyFrame["request"],
        close: () => {},
      };
      return { adopts, frame, kept, request };
    };

    const fakeKeyPage = () => fakeKeyPageAnswering((keys) => keys);

    /**
     * The page's wallet store in memory. `exclusive` runs one task at a time,
     * as the Web Lock does across tabs.
     */
    const memoryStoreWith =
      (aside: unknown[]) => (initial: SerializedWalletState | undefined) => {
        let value = initial && structuredClone(initial);
        let setAside = structuredClone(aside);
        let tail: Promise<unknown> = Promise.resolve();
        return {
          read: vi.fn(async () => value && structuredClone(value)),
          write: vi.fn(async (state: SerializedWalletState) => {
            value = structuredClone(state);
          }),
          exclusive: <T>(task: () => Promise<T>): Promise<T> => {
            const run = tail.then(task);
            tail = run.catch(() => undefined);
            return run;
          },
          setAside: vi.fn(async (accounts: unknown[]) => {
            setAside = setAside.concat(structuredClone(accounts));
          }),
          readAside: vi.fn(async () => structuredClone(setAside)),
          updateAside: vi.fn(
            async (update: (items: unknown[]) => unknown[]) => {
              setAside = update(structuredClone(setAside));
            }
          ),
          held: () => value,
          heldAside: () => setAside,
        };
      };

    const memoryStore = memoryStoreWith([]);

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

    const NO_OTHERS: OtherKeys = { accounts: [], stray: [] };

    /** Every encoding a key could be logged in */
    const encodingsOf = (kp: number[]) => {
      const bytes = Uint8Array.from(kp);
      return [
        kp.join(","),
        Buffer.from(bytes).toString("hex"),
        Buffer.from(bytes).toString("base64"),
        PgWeb3.Keypair.fromSecretKey(bytes).secretKey.join(","),
      ];
    };

    describe("moveKeysWith", () => {
      it("three accounts move", async () => {
        const record = walletAt(2)(accountsOf(3));
        const { frame, kept } = fakeKeyPage();

        const result = await moveKeysWith(frame)(record, NO_OTHERS);

        expect(result.record).toEqual(keyless(record));
        expect(result.record.currentIndex).toBe(2);
        expect(result.moved).toBe(3);
        expect(Array.from(kept.keys()).sort()).toEqual(
          record.accounts.map((account) => account.publicKey).sort()
        );
      });

      it("the key page does not confirm one key", async () => {
        const record = walletOf(accountsOf(3));
        const lost = record.accounts[1].publicKey;
        const { frame } = fakeKeyPageAnswering((keys) =>
          keys.filter((key) => key !== lost)
        );

        const moving = moveKeysWith(frame)(record, NO_OTHERS);

        await expect(moving).rejects.toBeInstanceOf(MoveIncomplete);
        await expect(moving).rejects.toThrow(lost);
        const error = await moving.then(
          () => undefined,
          (e: unknown) => e as Error
        );
        for (const account of record.accounts) {
          for (const encoded of encodingsOf(account.kp as number[])) {
            expect(error?.message).not.toContain(encoded);
          }
        }
      });

      it("sends nothing for a record with no key bytes", async () => {
        const record = keyless(walletOf(accountsOf(2)));
        const { frame, request } = fakeKeyPage();

        const result = await moveKeysWith(frame)(record, NO_OTHERS);

        expect(result).toEqual({ record, moved: 0, keys: [] });
        expect(request).not.toHaveBeenCalled();
      });

      it("fails on an adopt reply that is not a list of public keys", async () => {
        const record = walletOf(accountsOf(1));
        const frame: KeyFrame = {
          request: async <T>() => record.accounts[0].publicKey as T,
          close: () => {},
        };

        await expect(moveKeysWith(frame)(record, NO_OTHERS)).rejects.toThrow(
          "answered adopt with a reply of the wrong shape"
        );
      });

      it("completes a move a reload cut short: the key page holds the keys, the record still has them", async () => {
        const record = walletOf(accountsOf(2));
        const { frame, kept } = fakeKeyPage();
        await moveKeysWith(frame)(record, NO_OTHERS);

        const again = await moveKeysWith(frame)(record, NO_OTHERS);

        expect(again.record).toEqual(keyless(record));
        expect(kept.size).toBe(2);
      });

      it("adopts the stray keys that are valid, and skips the others", async () => {
        const record = keyless(walletOf(accountsOf(1)));
        const extra = realKey();
        const junk = Array.from({ length: 64 }, (_, i) => i);
        const { adopts, frame, kept } = fakeKeyPage();

        const result = await moveKeysWith(frame)(record, {
          accounts: [],
          stray: [extra.kp, junk, [1, 2, 3], extra.kp],
        });

        expect(adopts).toEqual([[extra.kp]]);
        expect(result.keys).toEqual([extra.kp]);
        expect(Array.from(kept.keys())).toEqual([extra.publicKey]);
      });

      it("sends another copy's account key that is not ed25519, and fails", async () => {
        const record = keyless(walletOf(accountsOf(1)));
        const { kp } = realKey();
        const bad = realKey().kp.slice(0, 32).concat(kp.slice(32));
        const { adopts, frame } = fakeKeyPage();

        const moving = moveKeysWith(frame)(record, {
          accounts: [bad],
          stray: [],
        });

        await expect(moving).rejects.toThrow();
        expect(adopts).toEqual([[bad]]);
      });
    });

    describe("through the wallet's storage", () => {
      it("three accounts move: the store keeps names and public keys, the key page the keys", async () => {
        const record = walletAt(1)(accountsOf(3));
        const store = memoryStore(record);
        const { frame, kept } = fakeKeyPage();

        const read = await walletStorageWith(store)(
          memoryLocal(undefined)
        ).readMovingKeys(moveKeysWith(frame));

        expect(read).toEqual({
          kind: "wallet",
          wallet: keyless(record),
          setAside: 0,
        });
        expect(store.held()).toEqual(keyless(record));
        expect(kept.size).toBe(3);
      });

      it("the key page does not confirm one key: nothing is written, the wallet is unavailable, the log holds no key", async () => {
        const record = walletOf(accountsOf(3));
        const lost = record.accounts[2].publicKey;
        const store = memoryStore(record);
        const text = JSON.stringify(walletOf(accountsOf(1)));
        const local = memoryLocal(text);
        const { frame } = fakeKeyPageAnswering((keys) =>
          keys.filter((key) => key !== lost)
        );

        const read = await walletStorageWith(store)(local).readMovingKeys(
          moveKeysWith(frame)
        );

        expect(read).toEqual({ kind: "unavailable" });
        expect(store.write).not.toHaveBeenCalled();
        expect(store.setAside).not.toHaveBeenCalled();
        expect(store.updateAside).not.toHaveBeenCalled();
        expect(store.held()).toEqual(record);
        expect(local.items.get(WALLET_LOCAL_KEY)).toBe(text);
        expect(logged.entries).toHaveLength(1);
        const log = JSON.stringify(logged.entries, (_, value: unknown) =>
          value instanceof Error ? `${value.name}: ${value.message}` : value
        );
        for (const account of record.accounts) {
          for (const encoded of encodingsOf(account.kp as number[])) {
            expect(log).not.toContain(encoded);
          }
        }
      });

      it("an unreachable key page leaves everything as it was", async () => {
        const record = walletOf(accountsOf(1));
        const store = memoryStore(record);
        const failing: KeyFrame = {
          request: () => Promise.reject(new Error("closed")),
          close: () => {},
        };

        const read = await walletStorageWith(store)(
          memoryLocal(undefined)
        ).readMovingKeys(moveKeysWith(failing));

        expect(read).toEqual({ kind: "unavailable" });
        expect(store.write).not.toHaveBeenCalled();
        expect(store.held()).toEqual(record);
      });

      it("sends nothing when no copy holds key bytes", async () => {
        const record = keyless(walletOf(accountsOf(2)));
        const store = memoryStore(record);
        const { request, frame } = fakeKeyPage();

        const read = await walletStorageWith(store)(
          memoryLocal(undefined)
        ).readMovingKeys(moveKeysWith(frame));

        expect(read).toEqual({ kind: "wallet", wallet: record, setAside: 0 });
        expect(request).not.toHaveBeenCalled();
        expect(store.write).not.toHaveBeenCalled();
      });

      it("two tabs load at once: the keys move once, both load the same accounts", async () => {
        const record = walletOf(accountsOf(2));
        const store = memoryStore(record);
        const local = memoryLocal(undefined);
        const { adopts, frame } = fakeKeyPage();

        const [first, second] = await Promise.all([
          walletStorageWith(store)(local).readMovingKeys(moveKeysWith(frame)),
          walletStorageWith(store)(local).readMovingKeys(moveKeysWith(frame)),
        ]);

        expect(adopts).toEqual([record.accounts.map((a) => a.kp)]);
        expect(first).toEqual(second);
        expect(second).toEqual({
          kind: "wallet",
          wallet: keyless(record),
          setAside: 0,
        });
      });

      it("moves a key that only another copy holds, before a merge can drop it", async () => {
        // A keyless copy in localStorage (this tab's unsaved save) names the
        // account the store still holds the key of
        const [account] = accountsOf(1);
        const store = memoryStore(walletOf([account]));
        const local = memoryLocal(JSON.stringify(keyless(walletOf([account]))));
        const { frame, kept } = fakeKeyPage();

        const read = await walletStorageWith(store)(local).readMovingKeys(
          moveKeysWith(frame)
        );

        expect(Array.from(kept.keys())).toEqual([account.publicKey]);
        expect(read).toEqual({
          kind: "wallet",
          wallet: keyless(walletOf([account])),
          setAside: 0,
        });
        expect(store.held()).toEqual(keyless(walletOf([account])));
        expect(local.items.has(WALLET_LOCAL_KEY)).toBe(false);
      });

      /**
       * An account whose `kp` ends in its public key, so it reads as valid,
       * but starts with another key's seed: not a key the key page takes
       */
      const notEd25519 = () => {
        const { kp, publicKey } = realKey();
        const bad = realKey().kp.slice(0, 32).concat(kp.slice(32));
        return { name: "Wallet 1", kp: bad, publicKey };
      };

      it("a key that is not ed25519, held only by the store under a keyless localStorage copy, blocks the move", async () => {
        const account = notEd25519();
        const record = walletOf([account]);
        const store = memoryStore(record);
        const text = JSON.stringify(keyless(record));
        const local = memoryLocal(text);
        const { frame } = fakeKeyPage();

        const read = await walletStorageWith(store)(local).readMovingKeys(
          moveKeysWith(frame)
        );

        expect(read).toEqual({ kind: "unavailable" });
        expect(store.write).not.toHaveBeenCalled();
        expect(store.held()).toEqual(record);
        expect(local.items.get(WALLET_LOCAL_KEY)).toBe(text);
      });

      it("a key that is not ed25519, held only by localStorage over a keyless store copy, blocks the move", async () => {
        const account = notEd25519();
        const record = walletOf([account]);
        const store = memoryStore(keyless(record));
        const text = JSON.stringify(record);
        const local = memoryLocal(text);
        const { frame } = fakeKeyPage();

        const read = await walletStorageWith(store)(local).readMovingKeys(
          moveKeysWith(frame)
        );

        expect(read).toEqual({ kind: "unavailable" });
        expect(store.write).not.toHaveBeenCalled();
        expect(store.held()).toEqual(keyless(record));
        expect(local.items.get(WALLET_LOCAL_KEY)).toBe(text);
      });

      it("moves a localStorage wallet's keys and clears the copy", async () => {
        const record = walletAt(1)(accountsOf(2));
        const store = memoryStore(undefined);
        const local = memoryLocal(JSON.stringify(record));
        const { frame, kept } = fakeKeyPage();

        await walletStorageWith(store)(local).readMovingKeys(
          moveKeysWith(frame)
        );

        expect(kept.size).toBe(2);
        expect(store.held()).toEqual(keyless(record));
        expect(local.items.has(WALLET_LOCAL_KEY)).toBe(false);
      });

      it("moves the valid keys of set-aside accounts, clears their bytes, and keeps the rest as it was", async () => {
        const [account] = accountsOf(1);
        const { kp: damagedKp, publicKey: damagedKey } = realKey();
        const damaged = { name: 7, kp: damagedKp, publicKey: damagedKey };
        const junk = { name: "Junk", kp: Array.from({ length: 64 }, () => 1) };
        const store = memoryStoreWith([damaged, junk])(walletOf([account]));
        const { frame, kept } = fakeKeyPage();

        await walletStorageWith(store)(memoryLocal(undefined)).readMovingKeys(
          moveKeysWith(frame)
        );

        expect(Array.from(kept.keys()).sort()).toEqual(
          [account.publicKey, damaged.publicKey].sort()
        );
        expect(store.heldAside()).toEqual([
          { name: 7, publicKey: damaged.publicKey },
          junk,
        ]);
      });

      it("moves the keys of damaged accounts it sets aside, then clears their bytes", async () => {
        const [account] = accountsOf(1);
        const other = realKey();
        const damaged = { name: "Bad", kp: other.kp, publicKey: "nope" };
        const stored = {
          state: "pg",
          accounts: [account, damaged],
          currentIndex: 0,
          standardName: NO_STANDARD,
        };
        const store = memoryStore(stored as SerializedWalletState);
        const { frame, kept } = fakeKeyPage();

        const read = await walletStorageWith(store)(
          memoryLocal(undefined)
        ).readMovingKeys(moveKeysWith(frame));

        expect(kept.has(other.publicKey)).toBe(true);
        expect(read).toEqual({
          kind: "wallet",
          wallet: keyless(walletOf([account])),
          setAside: 1,
        });
        expect(store.heldAside()).toEqual([{ name: "Bad", publicKey: "nope" }]);
        expect(store.held()).toEqual(keyless(walletOf([account])));
      });

      it("leaves a wallet with keys unavailable while the store cannot be read", async () => {
        const record = walletOf(accountsOf(1));
        const store = memoryStore(undefined);
        store.read.mockRejectedValue(new DOMException("gone", "UnknownError"));
        const text = JSON.stringify(record);
        const local = memoryLocal(text);
        const { request, frame } = fakeKeyPage();

        const read = await walletStorageWith(store)(local).readMovingKeys(
          moveKeysWith(frame)
        );

        expect(read).toEqual({ kind: "unavailable" });
        expect(request).not.toHaveBeenCalled();
        expect(local.items.get(WALLET_LOCAL_KEY)).toBe(text);
      });
    });
  });
}
