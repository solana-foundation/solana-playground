import { createLogger, toError } from "../../shared/lib/logger";
import { PgCommon } from "../common";
import { PgWeb3 } from "../web3";
import { isIndexedDbMissing, type WalletStore } from "./keystore";
import { publicKeyOf } from "./signer-provider";
import type {
  SavedWalletState,
  SerializedWalletState,
  WalletAccount,
} from "./types";

const log = createLogger("wallet:storage");

/** The `localStorage` key the wallet lived under before the keystore */
export const WALLET_LOCAL_KEY = "wallet";

/**
 * Where an unreadable `localStorage` wallet is kept, so that a later fallback
 * write cannot overwrite what may be someone's only copy of a key.
 */
const UNREADABLE_KEY = "wallet.unreadable";

/**
 * What reading the wallet found: a wallet, none anywhere, or a store that
 * failed with nothing in `localStorage` to fall back to, which must not be
 * taken for "none" (that would offer to make a new wallet over the old one).
 * `setAside` counts the damaged accounts, or the stored record of the wrong
 * shape, this read moved to the store's set-aside record.
 */
export type WalletRead =
  | { kind: "wallet"; wallet: SerializedWalletState; setAside: number }
  | { kind: "none"; setAside: number }
  | { kind: "unavailable" };

const NONE: WalletRead = { kind: "none", setAside: 0 };
const UNAVAILABLE: WalletRead = { kind: "unavailable" };

/** The read result for a wallet that may not be there */
const foundOrNoneWith =
  (setAside: number) =>
  (wallet: SerializedWalletState | undefined): WalletRead =>
    wallet ? { kind: "wallet", wallet, setAside } : { kind: "none", setAside };

const foundOrNone = foundOrNoneWith(0);

/**
 * Where a write landed: the store; the `localStorage` fallback, with no store
 * behind it (`local`); the fallback while the store, which failed, may still
 * hold an older copy that the next read merges back (`local-store-stale`); or
 * nowhere
 */
export type WriteOutcome = "store" | "local" | "local-store-stale" | "lost";

/**
 * Whether a write is the copy the next read loads as written: `local-store-stale`
 * is in `localStorage`, but the next read merges the store's older copy into
 * it, so an account it drops can come back. Anything new to `WriteOutcome`
 * reads as not saved until it is added here.
 */
export const isSavedForGood = (outcome: WriteOutcome) =>
  outcome === "store" || outcome === "local";

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
const reportFailureFor = (state: { accounts: unknown[] }) =>
  reportFailureWith({ accounts: state.accounts.length });

/** Whether `value` is 64 key bytes */
const isKeypairBytes = (value: unknown): value is number[] =>
  Array.isArray(value) &&
  value.length === 64 &&
  value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte < 256);

/** Whether `value` is a public key in base58, as `toBase58` writes it */
const isPublicKeyText = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  try {
    return new PgWeb3.PublicKey(value).toBase58() === value;
  } catch {
    // web3 throws on text that is not base58 or not 32 bytes: not a public
    // key, so the account reads as damaged and is set aside
    return false;
  }
};

/**
 * The account `value` holds, or `undefined` for a damaged one.
 *
 * An account is a name with a base58 public key, a 64-byte keypair, or
 * both, and then the public key must be the keypair's. An account stored
 * before accounts had a public key gets its keypair's.
 */
const accountOf = (value: unknown): WalletAccount | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const { kp, name, publicKey } = value as Partial<
    Record<keyof WalletAccount, unknown>
  >;
  if (typeof name !== "string") return undefined;
  if (kp === undefined) {
    return isPublicKeyText(publicKey) ? (value as WalletAccount) : undefined;
  }
  if (!isKeypairBytes(kp)) return undefined;
  const own = publicKeyOf(kp).toBase58();
  if (publicKey === undefined) {
    return { ...value, publicKey: own } as WalletAccount;
  }
  return publicKey === own ? (value as WalletAccount) : undefined;
};

/** Whether `value` is an account, not a damaged one */
const isAccount = (value: unknown) => accountOf(value) !== undefined;

/**
 * Every state a stored wallet may have, as a record so that a state added to
 * `SavedWalletState` must be listed here
 */
const SAVED_STATES: Record<SavedWalletState, true> = {
  setup: true,
  disconnected: true,
  pg: true,
  sol: true,
};

/** Whether `value` is a state a stored wallet may have */
const isSavedState = (value: unknown): value is SavedWalletState =>
  typeof value === "string" && Object.hasOwn(SAVED_STATES, value);

/** A stored wallet whose accounts may include damaged ones */
type StoredWallet = Omit<SerializedWalletState, "accounts"> & {
  accounts: unknown[];
};

/**
 * The accounts of a stored wallet that a saved state lacks, by key. A
 * damaged account is always lacked: only the next read sets it aside.
 *
 * @param state the saved state
 * @returns a function of the stored wallet
 */
const lackedBy = (state: SerializedWalletState) => (wallet: StoredWallet) => {
  const held = new Set(state.accounts.map((stored) => stored.publicKey));
  return wallet.accounts.filter((stored) => {
    const account = accountOf(stored);
    return !account || !held.has(account.publicKey);
  });
};

/**
 * Whether `value` has the shape of a stored wallet, with a state a saved
 * wallet can have (never `unavailable`). Some accounts may be damaged, but
 * not all of them: a wallet with accounts and no valid one is unreadable as a
 * whole.
 */
const isStoredWallet = (value: unknown): value is StoredWallet => {
  if (typeof value !== "object" || value === null) return false;
  const { accounts, currentIndex, state } = value as Partial<
    Record<keyof SerializedWalletState, unknown>
  >;
  return (
    Array.isArray(accounts) &&
    (accounts.length === 0 || accounts.some(isAccount)) &&
    typeof currentIndex === "number" &&
    isSavedState(state)
  );
};

/** A stored wallet's valid accounts as the wallet, and the damaged ones */
interface PartitionedWallet {
  wallet: SerializedWalletState;
  damaged: unknown[];
}

/**
 * Split off the damaged accounts, and give each valid one its public key. The
 * current account keeps its place among the valid ones; when it is the
 * damaged one, the first valid one is current.
 */
const partitionWallet = (stored: StoredWallet): PartitionedWallet => {
  const read = stored.accounts.map(accountOf);
  const damaged = stored.accounts.filter((_, i) => read[i] === undefined);
  const accounts = read.filter(
    (account): account is WalletAccount => account !== undefined
  );
  if (damaged.length === 0) {
    return { wallet: { ...stored, accounts }, damaged };
  }
  const current = accounts.indexOf(read[stored.currentIndex] as WalletAccount);
  return {
    wallet: {
      state: stored.state,
      accounts,
      currentIndex: current === -1 ? 0 : current,
      standardName: stored.standardName,
    },
    damaged,
  };
};

/**
 * What the store holds: nothing, a wallet (some accounts possibly damaged),
 * or a record of the wrong shape, which is set aside whole
 */
type StoreRead =
  | { kind: "none" }
  | { kind: "wallet"; partitioned: PartitionedWallet; record: unknown }
  | { kind: "misshapen"; record: unknown };

/** Whether `value` is the pre-accounts format, a single `sk` keypair */
const isLegacyWallet = (value: unknown) =>
  typeof value === "object" &&
  value !== null &&
  Array.isArray((value as { sk?: unknown }).sk);

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
  const keys = new Set(primary.accounts.map((account) => account.publicKey));
  const names = new Set(primary.accounts.map((account) => account.name));
  const freeName = freeNameFor(names);
  const accounts = [...primary.accounts];
  for (const account of other.accounts) {
    if (keys.has(account.publicKey)) continue;
    const name = freeName(account.name);
    names.add(name);
    keys.add(account.publicKey);
    accounts.push({ ...account, name });
  }

  return {
    state: primary.state,
    accounts,
    currentIndex: primary.currentIndex,
    standardName: primary.standardName,
  };
};

/**
 * Moves keys into the key page (`key-origin/move.ts`'s `moveKeysWith`, bound
 * to the frame): given the record and every other copy's keys, it gives the
 * record back without key bytes and the keys the key page confirmed, or
 * throws, and then nothing may be dropped. `others.accounts` must all be
 * confirmed; a `others.stray` key that is not a key is left out.
 */
export type MoveKeys = (
  record: SerializedWalletState,
  others: { accounts: number[][]; stray: number[][] }
) => Promise<{ record: SerializedWalletState; keys: number[][] }>;

/** What a move is handed when no copy holds a wallet, only stray keys */
const NO_RECORD: SerializedWalletState = {
  state: "setup",
  accounts: [],
  currentIndex: -1,
  // eslint-disable-next-line unicorn/no-null -- the stored shape's own "none"
  standardName: null,
};

/**
 * The key bytes in stored items: an account's `kp`, or those of the accounts
 * of a whole record set aside. Anything 64 bytes long counts; the move skips
 * the ones that are not keys only among damaged and set-aside items.
 */
const keysIn = (items: unknown[]): number[][] =>
  items.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const { kp, accounts } = item as { kp?: unknown; accounts?: unknown };
    const own = isKeypairBytes(kp) ? [kp] : [];
    return Array.isArray(accounts) ? own.concat(keysIn(accounts)) : own;
  });

/** Whether any copy read holds key bytes */
const hasKeys = (items: unknown[]) => keysIn(items).length > 0;

/**
 * The item without the key bytes of `moved`, the keys the key page
 * confirmed. Everything else, other key bytes included, stays as it was.
 */
const withoutMovedWith =
  (moved: Set<string>) =>
  (item: unknown): unknown => {
    if (typeof item !== "object" || item === null) return item;
    let next = item as Record<string, unknown>;
    const { kp, accounts } = next;
    if (isKeypairBytes(kp) && moved.has(kp.join(","))) {
      const { kp: _moved, ...rest } = next;
      next = rest;
    }
    if (Array.isArray(accounts)) {
      next = { ...next, accounts: accounts.map(withoutMovedWith(moved)) };
    }
    return next;
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
 * from the store on that merge: a removed key returns, none is lost. The one
 * exception is a failed read with no `localStorage` wallet: that read is
 * `unavailable`, and the instance stays on the store so a later read retries.
 *
 * Damaged accounts (not a name with a public key, a 64-byte keypair or both
 * agreeing; see `accountOf`) in either copy are split off: the wallet loads
 * with the valid ones, and the damaged ones go to
 * the store's set-aside record before any copy is rewritten without them. A
 * store record of the wrong shape (no valid account among them) goes there
 * whole, and the store reads as holding no wallet.
 * Where the store cannot take them, nothing is moved or rewritten that read,
 * and the text that held them is kept aside in `localStorage` instead, like
 * an unreadable copy: the first one kept, never replaced.
 *
 * `write` calls run one after another, in call order: `updatable` does not
 * await them, and two quick changes must not land out of order.
 *
 * A save waits for the lock, so a tab closed while another tab holds it would
 * drop the queued save, and with it a key that exists only in memory (a new
 * account). `keepUnsaved`, called when the page is hidden, writes the newest
 * save that has not landed to `localStorage`, where the next load moves it
 * into the store; if the save lands after all, the copy is removed again,
 * or, while it holds accounts the save lacks, kept up to date (`kept`).
 *
 * @param store the keystore
 * @param local the `localStorage` to migrate from and fall back to
 */
export const walletStorageWith =
  (store: WalletStore) => (local: LocalStorage) => {
    /**
     * Where writes go: the store, or `localStorage` for the rest of this
     * page's life, either because IndexedDB is absent (`store-gone`) or
     * because the store failed after IndexedDB answered, so it may still hold
     * an older copy the next read merges back (`store-stale`)
     */
    let target: "store" | "store-gone" | "store-stale" = "store";
    const isDegraded = () => target !== "store";
    /**
     * Fall back to `localStorage` for good. A stale store stays stale: once
     * degraded, no write reaches the store again to bring it up to date.
     */
    const degrade = (error: unknown) => {
      if (target === "store-stale") return;
      target = isIndexedDbMissing(error) ? "store-gone" : "store-stale";
    };
    /** Fall back for good after the store answered a read: it may hold a copy */
    const degradeAfterRead = () => {
      target = "store-stale";
    };
    let writes = Promise.resolve();
    /** The newest save that has not landed in either store */
    let unsaved: SerializedWalletState | undefined;
    /**
     * What `keepUnsaved` put in `localStorage`, and its text. Once this tab's
     * newest save lands, it is removed, or, while it holds accounts the save
     * lacks (another tab's, or damaged ones), rewritten as that save plus
     * those accounts: `localStorage` is the primary copy of the next read's
     * merge, so a stale copy would undo every later rename or switch.
     */
    let kept: { text: string; wallet: StoredWallet } | undefined;

    /** Brings the kept copy up to a landed save, or removes it */
    const settleKept = (state: SerializedWalletState) => {
      if (!kept) return;
      const lacked = lackedBy(state)(kept.wallet);
      if (lacked.length === 0) {
        removeLocal(kept.text);
        kept = undefined;
        return;
      }
      // Another tab's write since then is not this tab's to replace
      try {
        if (local.getItem(WALLET_LOCAL_KEY) !== kept.text) return;
      } catch (error) {
        reportFailure("Kept wallet copy not read", error);
        return;
      }
      const next: StoredWallet = {
        state: state.state,
        accounts: [...state.accounts, ...lacked],
        currentIndex: state.currentIndex,
        standardName: state.standardName,
      };
      if (writeLocal(next)) kept = { text: JSON.stringify(next), wallet: next };
    };

    /**
     * The `localStorage` wallet and its text, or `undefined` for none
     *
     * @param onLegacy what to do with the text of a pre-accounts wallet,
     * which is read as none
     */
    const readLocalWith = (onLegacy: (text: string) => void) => () => {
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
      if (isLegacyWallet(value)) {
        onLegacy(text);
        return undefined;
      }
      if (!isStoredWallet(value)) {
        keepUnreadable(text);
        reportFailure("Unreadable wallet in localStorage", new Error("shape"));
        return undefined;
      }
      return { ...partitionWallet(value), text };
    };

    const readLocal = readLocalWith(() => undefined);

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

    /**
     * The store refused the set-aside record: keep the text that held the
     * damaged accounts in `localStorage` instead, the `localStorage` copy
     * first, since a save while falling back rewrites it without them
     */
    const keepAsideLocally = (
      fromLocal: { damaged: unknown[]; text: string } | undefined,
      fromStore: StoreRead
    ) => {
      if (fromLocal && fromLocal.damaged.length > 0) {
        keepUnreadable(fromLocal.text);
        return;
      }
      if (fromStore.kind === "none") return;
      let text: string;
      try {
        text = JSON.stringify(fromStore.record);
      } catch (error) {
        reportFailure("Unreadable wallet not kept aside", error);
        return;
      }
      keepUnreadable(text);
    };

    /** Whether `localStorage` took the wallet */
    const writeLocal = (state: StoredWallet) => {
      try {
        local.setItem(WALLET_LOCAL_KEY, JSON.stringify(state));
        return true;
      } catch (error) {
        reportFailureFor(state)("Wallet not saved to localStorage", error);
        return false;
      }
    };

    /**
     * Replace the `localStorage` copy read as `text` with `state`, unless
     * someone rewrote it meanwhile (`keepUnsaved` writes outside the lock, and
     * may hold another tab's only copy of a key)
     *
     * @returns whether `localStorage` now holds `state`
     */
    const rewriteLocal = (text: string) => (state: StoredWallet) => {
      try {
        if (local.getItem(WALLET_LOCAL_KEY) !== text) return false;
      } catch (error) {
        reportFailure("Wallet in localStorage not read", error);
        return false;
      }
      return writeLocal(state);
    };

    const fallBack = (state: SerializedWalletState): WriteOutcome => {
      if (!writeLocal(state)) return "lost";
      return target === "store-stale" ? "local-store-stale" : "local";
    };

    /** Read the store, telling a record of the wrong shape from a wallet */
    const readStore = async (): Promise<StoreRead> => {
      const value: unknown = await store.read();
      if (value === undefined) return { kind: "none" };
      if (isStoredWallet(value)) {
        return {
          kind: "wallet",
          partitioned: partitionWallet(value),
          record: value,
        };
      }
      return { kind: "misshapen", record: value };
    };

    /** Copy `state` into the store and confirm it reads back the same */
    const copyToStore = async (state: SerializedWalletState) => {
      await store.write(state);
      const back = await store.read();
      if (!PgCommon.isEqual(back, state)) {
        throw new Error("The stored wallet reads back different");
      }
    };

    /**
     * Remove the `localStorage` copy unless someone rewrote it meanwhile
     *
     * @returns whether `localStorage` no longer holds `text`
     */
    const removeLocal = (text: string) => {
      try {
        if (local.getItem(WALLET_LOCAL_KEY) === text) {
          local.removeItem(WALLET_LOCAL_KEY);
        }
        return true;
      } catch (error) {
        // The store holds the wallet; the next load merges and retries this
        reportFailure("Wallet left in localStorage", error);
        return false;
      }
    };

    /**
     * Whether a move must wait for the store: keys in `localStorage` move
     * only together with the store's copy, never from `localStorage` alone,
     * so the read is `unavailable` and the next one tries again
     */
    const isMoveBlocked = (
      move: MoveKeys | undefined,
      fromLocal:
        | { wallet: SerializedWalletState; damaged: unknown[] }
        | undefined
    ) =>
      move !== undefined &&
      fromLocal !== undefined &&
      hasKeys([...fromLocal.wallet.accounts, ...fromLocal.damaged]);

    /** Take the moved keys' bytes out of the set-aside record */
    const clearMovedAside = async (keys: number[][]) => {
      if (keys.length === 0) return;
      const moved = new Set(keys.map((kp) => kp.join(",")));
      try {
        await store.updateAside((items) => items.map(withoutMovedWith(moved)));
      } catch (error) {
        // The key page holds them; the next load moves them again, which
        // adds no copy, and clears them then
        reportFailure("Moved keys left in the set-aside record", error);
      }
    };

    const migrate = async (move: MoveKeys | undefined): Promise<WalletRead> => {
      const fromLocal = readLocal();
      if (isDegraded()) {
        if (isMoveBlocked(move, fromLocal)) return UNAVAILABLE;
        return foundOrNone(fromLocal?.wallet);
      }

      let fromStore: StoreRead;
      try {
        fromStore = await readStore();
      } catch (error) {
        reportFailure("Wallet store unavailable", error);
        // A store that may hold a wallet, and no copy to fall back to: not
        // degraded, so the next read (Try again) asks the store again
        if (!fromLocal && !isIndexedDbMissing(error)) return UNAVAILABLE;
        // TODO(HOO-2680 follow-up): with IndexedDB absent this holds for
        // good, so keys in `localStorage` never move; moving them needs a
        // path that skips the store's set-aside record
        if (isMoveBlocked(move, fromLocal)) return UNAVAILABLE;
        // A save while falling back rewrites `localStorage` without its
        // damaged accounts, which may still hold key bytes: their text goes
        // aside first, as when the store refuses the set-aside record
        if (fromLocal && fromLocal.damaged.length > 0) {
          keepUnreadable(fromLocal.text);
        }
        degrade(error);
        return foundOrNone(fromLocal?.wallet);
      }
      const stored =
        fromStore.kind === "wallet" ? fromStore.partitioned : undefined;
      // A record of the wrong shape may still hold key bytes: it is set
      // aside whole, like a damaged account, and the wallet reads as none
      const misshapen =
        fromStore.kind === "misshapen" ? [fromStore.record] : [];

      let merged =
        fromLocal && stored
          ? mergeWallets(fromLocal.wallet, stored.wallet)
          : (fromLocal ?? stored)?.wallet;

      // Under the key-origin provider: copy every key into the key page and
      // have it confirm them before anything is written. The merge above may
      // keep a keyless account over another copy's `kp`, so every copy's keys
      // go along, the set-aside record's too.
      let movedKeys: number[][] = [];
      if (move) {
        try {
          const aside = await store.readAside();
          // A valid account's key is kept nowhere once the merge drops it,
          // so it must be confirmed; a damaged one stays set aside intact
          const accounts = keysIn([
            ...(fromLocal?.wallet.accounts ?? []),
            ...(stored?.wallet.accounts ?? []),
          ]);
          const stray = keysIn([
            ...(fromLocal?.damaged ?? []),
            ...(stored?.damaged ?? []),
            ...misshapen,
            ...aside,
          ]);
          const moved = await move(merged ?? NO_RECORD, { accounts, stray });
          if (merged) merged = moved.record;
          movedKeys = moved.keys;
        } catch (error) {
          // Nothing was written: every copy keeps its keys, and the next
          // read tries again
          reportFailureWith({ accounts: merged?.accounts.length ?? 0 })(
            "Wallet keys not moved to the key page",
            error
          );
          return UNAVAILABLE;
        }
      }
      // Before anything is rewritten without them, into the store's
      // set-aside record: a damaged account may still hold key bytes
      const damaged = (fromLocal?.damaged ?? [])
        .concat(stored?.damaged ?? [])
        .concat(misshapen);
      if (damaged.length > 0) {
        const reportDamaged = reportFailureWith({ accounts: damaged.length });
        try {
          await store.setAside(damaged);
        } catch (error) {
          reportDamaged("Damaged wallet accounts not set aside", error);
          keepAsideLocally(fromLocal, fromStore);
          // A store record that could not be set aside, and no copy to fall
          // back to: not degraded, so Try again asks the store again
          if (!fromLocal && misshapen.length > 0) return UNAVAILABLE;
          // Under the key-origin provider the moved keys are still in the
          // copies nothing rewrites: the move is not done, so the wallet does
          // not load, and the next read tries again
          if (movedKeys.length > 0) return UNAVAILABLE;
          // Nothing moves and nothing is rewritten, so the damaged accounts
          // stay where they were
          degradeAfterRead();
          return foundOrNone(merged);
        }
        reportDamaged("Damaged wallet accounts set aside", new Error("shape"));
      }
      const found = foundOrNoneWith(damaged.length);

      if (!fromLocal) {
        // TODO(HOO-2680 follow-up): a misshapen store record and no wallet
        // anywhere leaves `merged` undefined, so nothing rewrites the record
        // and its key bytes stay in the store after the move; it needs a
        // decision on what a keyless "no wallet" record is
        const isMoved = movedKeys.length > 0;
        if (merged && (isMoved || (stored && stored.damaged.length > 0))) {
          try {
            await store.write(merged);
          } catch (error) {
            // The next load sets them aside again, which adds no copy, and
            // moves the keys again, which the key page already holds
            reportFailureFor(merged)(
              "Wallet not rewritten without its damaged accounts or keys",
              error
            );
            // The store still holds key bytes on the app's origin: the move
            // is not done, so the wallet does not load until a read finishes it
            if (isMoved) return UNAVAILABLE;
          }
        }
        await clearMovedAside(movedKeys);
        return found(merged);
      }

      const moved = merged ?? fromLocal.wallet;
      // Under the key-origin provider, `localStorage` may hold key bytes on
      // the app's origin, which the key page now holds too
      const isLocalHoldingKeys = isMoveBlocked(move, fromLocal);
      // The store's own record keeps its key bytes when it refuses the write,
      // and nothing here can clear them
      const isStoreHoldingKeys =
        move !== undefined &&
        hasKeys([
          ...(stored?.wallet.accounts ?? []),
          ...(stored?.damaged ?? []),
          ...misshapen,
        ]);
      try {
        await copyToStore(moved);
      } catch (error) {
        reportFailureFor(moved)("Wallet not moved out of localStorage", error);
        // The record without key bytes replaces the copy that held them, so
        // the wallet loads from `localStorage` with no key left on the app's
        // origin. If even that fails, the move is not done: the wallet does
        // not load, nothing degrades, and the next read asks the store again.
        if (isStoreHoldingKeys) return UNAVAILABLE;
        if (isLocalHoldingKeys && !rewriteLocal(fromLocal.text)(moved)) {
          return UNAVAILABLE;
        }
        degradeAfterRead();
        await clearMovedAside(movedKeys);
        return found(moved);
      }

      if (!removeLocal(fromLocal.text) && isLocalHoldingKeys) {
        return UNAVAILABLE;
      }
      await clearMovedAside(movedKeys);
      return found(moved);
    };

    return {
      /**
       * Read the wallet, moving a `localStorage` copy into the store.
       * `unavailable` when the store fails for any reason but IndexedDB being
       * absent and `localStorage` holds no wallet; the store is asked again
       * on the next read.
       */
      read(): Promise<WalletRead> {
        return store.exclusive(() => migrate(undefined));
      },

      /**
       * Read the wallet as `read` does, under the key-origin provider: every
       * key in every copy is moved into the key page first, under the same
       * lock, and the copies are written without key bytes only once it
       * confirmed them all. The wallet reads `unavailable`, and the next read
       * tries again, while key bytes would stay on the app's origin: a move
       * that fails, a store that cannot be read while `localStorage` holds
       * keys, a store that refuses its record without key bytes, damaged
       * accounts that cannot be set aside, or a `localStorage` copy that can
       * be neither moved, rewritten without its keys, nor removed. A
       * `localStorage` wallet the store refuses is rewritten without key
       * bytes and loads from there.
       *
       * @param move moves keys into the key page
       */
      readMovingKeys(move: MoveKeys): Promise<WalletRead> {
        return store.exclusive(() => migrate(move));
      },

      /**
       * Write the wallet; falls back to `localStorage` if the store fails.
       * Resolves with where it landed, `lost` when neither store took it.
       */
      write(state: SerializedWalletState): Promise<WriteOutcome> {
        unsaved = state;
        const landed = writes
          .then(() =>
            // Under the lock, so another tab's move cannot land on top of it
            store.exclusive(async (): Promise<WriteOutcome> => {
              if (isDegraded()) return fallBack(state);
              try {
                await store.write(state);
                if (unsaved === state) settleKept(state);
                return "store";
              } catch (error) {
                degrade(error);
                reportFailureFor(state)("Wallet not saved to the store", error);
                return fallBack(state);
              }
            })
          )
          .then((outcome) => {
            if (unsaved === state) unsaved = undefined;
            return outcome;
          })
          .catch((error: unknown): WriteOutcome => {
            // Nothing above should throw; if it does, the next write still
            // runs, and this one counts as lost since nothing says it landed
            reportFailureFor(state)("Wallet write failed", error);
            return "lost";
          });
        writes = landed.then(() => undefined);
        return landed;
      },

      /**
       * Put the newest save that has not landed in `localStorage`, so a tab
       * closed while it waits for the lock does not lose it. Synchronous: the
       * page may be gone before anything awaited would run.
       */
      keepUnsaved(): void {
        if (unsaved === undefined) return;
        // The entry may hold the only copy of a key: another tab, on this
        // version or the previous one, may have written it since this tab
        // read it. So it is merged, the pending save first; its damaged
        // accounts ride along for the next read to set aside, and an entry
        // that cannot be merged is kept aside before it is overwritten.
        const existing = readLocalWith(keepUnreadable)();
        const merged: StoredWallet = existing
          ? mergeWallets(unsaved, existing.wallet)
          : unsaved;
        const withDamaged: StoredWallet = {
          state: merged.state,
          accounts: merged.accounts.concat(existing?.damaged ?? []),
          currentIndex: merged.currentIndex,
          standardName: merged.standardName,
        };
        writeLocal(withDamaged);
        kept = { text: JSON.stringify(withDamaged), wallet: withDamaged };
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

    const account = (seed: number, name: string) => ({
      kp: kp(seed),
      name,
      publicKey: publicKeyOf(kp(seed)).toBase58(),
    });

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

    const found = (wallet: SerializedWalletState): WalletRead => ({
      kind: "wallet",
      wallet,
      setAside: 0,
    });
    const memoryStore = (initial: SerializedWalletState | undefined) => {
      let value = initial && structuredClone(initial);
      let setAside: unknown[] = [];
      return {
        read: vi.fn(async () => value && structuredClone(value)),
        write: vi.fn(async (state: SerializedWalletState) => {
          value = structuredClone(state);
        }),
        // A spy with the store's generic signature: `vi.fn` drops the `<T>`
        exclusive: vi.fn((task: () => Promise<unknown>) =>
          task()
        ) as unknown as WalletStore["exclusive"] & ReturnType<typeof vi.fn>,
        setAside: vi.fn(async (accounts: unknown[]) => {
          setAside = setAside.concat(structuredClone(accounts));
        }),
        readAside: vi.fn(async () => structuredClone(setAside)),
        updateAside: vi.fn(async (update: (items: unknown[]) => unknown[]) => {
          setAside = update(structuredClone(setAside));
        }),
        held: () => value,
        heldAside: () => setAside,
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
      expect(await storage.read()).toEqual(NONE);
    });

    it("reads a wallet the store holds", async () => {
      const stored = walletOf([account(1, "Wallet 1")]);
      const storage = walletStorageWith(memoryStore(stored))(
        memoryLocal(undefined)
      );
      expect(await storage.read()).toEqual(found(stored));
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

      expect(await storage.read()).toEqual(found(stored));
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
      expect(read).toEqual(found(old));
    });

    it("keeps localStorage when the store write fails", async () => {
      const old = walletOf([account(1, "Wallet 1")]);
      const store = memoryStore(undefined);
      store.write.mockRejectedValueOnce(new Error("quota"));
      const local = memoryLocal(JSON.stringify(old));

      const read = await walletStorageWith(store)(local).read();

      expect(local.items.get(WALLET_LOCAL_KEY)).toBe(JSON.stringify(old));
      expect(read).toEqual(found(old));
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
      expect(read).toEqual(found(old));
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
      expect(read).toEqual(found(expected));
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

      expect(read).toEqual(found(stored));
      expect(local.items.get("wallet.unreadable")).toBe(
        JSON.stringify({ accounts: [{ kp: [1, 2] }] })
      );
      expect(logged.entries).toHaveLength(1);
    });

    it("keeps the localStorage wallet when the store keeps reading a record of the wrong shape", async () => {
      const old = walletOf([account(1, "Wallet 1")]);
      const store = memoryStore(undefined);
      const record = { accounts: "corrupt" };
      store.read.mockResolvedValue(record as never);
      const local = memoryLocal(JSON.stringify(old));

      const read = await walletStorageWith(store)(local).read();

      expect(read).toEqual({ kind: "wallet", wallet: old, setAside: 1 });
      expect(store.heldAside()).toEqual([record]);
      // The copy read back different, so localStorage keeps the wallet
      expect(local.items.get(WALLET_LOCAL_KEY)).toBe(JSON.stringify(old));
    });

    it("leaves unreadable localStorage JSON in place", async () => {
      const store = memoryStore(undefined);
      const local = memoryLocal("{not json");

      const read = await walletStorageWith(store)(local).read();

      expect(read).toEqual(NONE);
      expect(local.items.get(WALLET_LOCAL_KEY)).toBe("{not json");
      expect(local.items.get("wallet.unreadable")).toBe("{not json");
      expect(store.write).not.toHaveBeenCalled();
      expect(logged.entries).toHaveLength(1);
    });

    it("keeps the unreadable copy when a fallback write replaces it", async () => {
      const store = memoryStore(undefined);
      store.read.mockRejectedValue(new Error("indexedDB is not available"));
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

      expect(read).toEqual(found(old));
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

    /** A `localStorage` that refuses every write, as a full one does */
    const fullLocal = () => {
      const local = memoryLocal(undefined);
      return {
        getItem: local.getItem,
        setItem: () => {
          throw new DOMException("full", "QuotaExceededError");
        },
        removeItem: local.removeItem,
      };
    };

    it("answers store for a write the store took", async () => {
      const storage = walletStorageWith(memoryStore(undefined))(
        memoryLocal(undefined)
      );
      await storage.read();

      expect(await storage.write(walletOf([account(1, "Wallet 1")]))).toBe(
        "store"
      );
    });

    it("answers local-store-stale for a write that fell back after the store failed", async () => {
      const store = memoryStore(undefined);
      const storage = walletStorageWith(store)(memoryLocal(undefined));
      await storage.read();
      store.write.mockRejectedValueOnce(new Error("quota"));

      expect(await storage.write(walletOf([account(1, "Wallet 1")]))).toBe(
        "local-store-stale"
      );
    });

    it("counts only store and local writes as saved for good", () => {
      expect(isSavedForGood("store")).toBe(true);
      expect(isSavedForGood("local")).toBe(true);
      expect(isSavedForGood("local-store-stale")).toBe(false);
      expect(isSavedForGood("lost")).toBe(false);
    });

    it("answers local for a write that fell back because IndexedDB is missing", async () => {
      const store = memoryStore(undefined);
      store.read.mockRejectedValue(new Error("indexedDB is not available"));
      const storage = walletStorageWith(store)(memoryLocal(undefined));
      await storage.read();

      expect(await storage.write(walletOf([account(1, "Wallet 1")]))).toBe(
        "local"
      );
    });

    it("answers lost for a write neither store took", async () => {
      const store = memoryStore(undefined);
      const storage = walletStorageWith(store)(fullLocal());
      await storage.read();
      store.write.mockRejectedValue(new Error("quota"));

      expect(await storage.write(walletOf([account(1, "Wallet 1")]))).toBe(
        "lost"
      );
      // Degraded now: the next write goes to localStorage alone, and fails
      expect(await storage.write(walletOf([account(2, "Wallet 2")]))).toBe(
        "lost"
      );
      expect(store.write).toHaveBeenCalledTimes(1);
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

    it("keeps the accounts another tab put in localStorage when the page hides", async () => {
      const { store } = heldLock();
      const other = walletOf([account(2, "Wallet 2")]);
      const local = memoryLocal(JSON.stringify(other));
      const storage = walletStorageWith(store)(local);

      const next = walletOf([account(1, "Wallet 1")]);
      void storage.write(next);
      storage.keepUnsaved();

      const kept = JSON.parse(local.items.get(WALLET_LOCAL_KEY) ?? "{}");
      // The pending save first: its accounts, names and current index win
      expect(kept).toEqual(
        walletOf([account(1, "Wallet 1"), account(2, "Wallet 2")])
      );
    });

    it("keeps an unreadable localStorage entry aside before the page hides over it", () => {
      const { store } = heldLock();
      const local = memoryLocal("{not json");
      const storage = walletStorageWith(store)(local);

      void storage.write(walletOf([account(1, "Wallet 1")]));
      storage.keepUnsaved();

      expect(local.items.get("wallet.unreadable")).toBe("{not json");
    });

    it("keeps a pre-accounts localStorage wallet aside before the page hides over it", () => {
      const { store } = heldLock();
      const legacy = JSON.stringify({ sk: kp(3) });
      const local = memoryLocal(legacy);
      const storage = walletStorageWith(store)(local);

      void storage.write(walletOf([account(1, "Wallet 1")]));
      storage.keepUnsaved();

      expect(local.items.get("wallet.unreadable")).toBe(legacy);
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

    it("keeps the kept copy when it holds an account the landed save lacks", async () => {
      const { store, release } = heldLock();
      const other = walletOf([account(2, "Wallet 2")]);
      const local = memoryLocal(JSON.stringify(other));
      const storage = walletStorageWith(store)(local);

      const next = walletOf([account(1, "Wallet 1")]);
      const saved = storage.write(next);
      storage.keepUnsaved();
      release();
      await saved;

      // Wallet 2's key is only in the kept copy: the next read moves it in
      const kept = JSON.parse(local.items.get(WALLET_LOCAL_KEY) ?? "{}");
      expect(kept).toEqual(
        walletOf([account(1, "Wallet 1"), account(2, "Wallet 2")])
      );
    });

    it("brings a retained copy up to each later save, so the next read takes nothing stale", async () => {
      const { store, release } = heldLock();
      const other = walletOf([account(2, "Wallet 2")]);
      const local = memoryLocal(JSON.stringify(other));
      const storage = walletStorageWith(store)(local);

      const saved = storage.write(walletOf([account(1, "Wallet 1")]));
      storage.keepUnsaved();
      release();
      await saved;
      await storage.write(walletOf([account(1, "Renamed")]));

      const kept = JSON.parse(local.items.get(WALLET_LOCAL_KEY) ?? "{}");
      expect(kept).toEqual(
        walletOf([account(1, "Renamed"), account(2, "Wallet 2")])
      );
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

      expect(read).toEqual(found(next));
      expect(store.held()).toEqual(next);
      expect(local.items.has(WALLET_LOCAL_KEY)).toBe(false);
    });

    it("sets a stored record of the wrong shape aside whole and reads no wallet", async () => {
      const store = memoryStore(undefined);
      const record = { accounts: "corrupt" };
      store.read.mockResolvedValue(record as never);
      const local = memoryLocal(undefined);

      const read = await walletStorageWith(store)(local).read();

      expect(read).toEqual({ kind: "none", setAside: 1 });
      expect(store.heldAside()).toEqual([record]);
      expect(local.items.size).toBe(0);
      expect(logged.entries).toHaveLength(1);
    });

    it("sets a stored record with no valid account aside and moves the localStorage wallet over it", async () => {
      const store = memoryStore(undefined);
      const record = {
        state: "pg",
        accounts: [{ kp: [1, 2], name: "A" }],
        currentIndex: 0,
        standardName: NO_STANDARD,
      };
      store.read.mockResolvedValueOnce(record as never);
      const wallet = walletOf([account(1, "Wallet 1")]);
      const local = memoryLocal(JSON.stringify(wallet));

      const read = await walletStorageWith(store)(local).read();

      expect(read).toEqual({ kind: "wallet", wallet, setAside: 1 });
      expect(store.heldAside()).toEqual([record]);
      expect(store.held()).toEqual(wallet);
      expect(local.items.has(WALLET_LOCAL_KEY)).toBe(false);
    });

    it("does not load a stored state that is not a saved wallet's", async () => {
      for (const state of ["unavailable", "junk"]) {
        const store = memoryStore(undefined);
        const record = {
          state,
          accounts: [account(1, "Wallet 1")],
          currentIndex: 0,
          standardName: NO_STANDARD,
        };
        store.read.mockResolvedValue(record as never);

        const read = await walletStorageWith(store)(
          memoryLocal(undefined)
        ).read();

        expect(read).toEqual({ kind: "none", setAside: 1 });
        expect(store.heldAside()).toEqual([record]);
      }
    });

    it("reads unavailable when a stored record of the wrong shape cannot be set aside", async () => {
      const store = memoryStore(undefined);
      store.read.mockResolvedValue({ accounts: "corrupt" } as never);
      store.setAside.mockRejectedValueOnce(new Error("quota"));
      const storage = walletStorageWith(store)(memoryLocal(undefined));

      expect(await storage.read()).toEqual(UNAVAILABLE);
      expect(store.write).not.toHaveBeenCalled();

      // Not degraded: Try again asks the store again
      expect(await storage.read()).toEqual({ kind: "none", setAside: 1 });
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

        expect(await walletStorageWith(store)(local).read()).toEqual(NONE);
        expect(store.write).not.toHaveBeenCalled();
        expect(local.items.get(WALLET_LOCAL_KEY)).toBe(JSON.stringify(shape));
      }
    });

    it("reads unavailable when the store fails and localStorage holds no wallet", async () => {
      const store = memoryStore(undefined);
      store.read.mockRejectedValue(
        new DOMException("blocked", "SecurityError")
      );

      const read = await walletStorageWith(store)(
        memoryLocal(undefined)
      ).read();

      expect(read).toEqual(UNAVAILABLE);
      expect(logged.entries).toHaveLength(1);
    });

    it("reads none when IndexedDB is missing and localStorage holds no wallet", async () => {
      const store = memoryStore(undefined);
      store.read.mockRejectedValue(new Error("indexedDB is not available"));
      const local = memoryLocal(undefined);
      const storage = walletStorageWith(store)(local);

      expect(await storage.read()).toEqual(NONE);

      // Setup's new wallet then goes to localStorage
      const next = walletOf([account(1, "Wallet 1")]);
      await storage.write(next);
      expect(local.items.get(WALLET_LOCAL_KEY)).toBe(JSON.stringify(next));
      expect(store.write).not.toHaveBeenCalled();
    });

    it("reads the store again after it was unavailable", async () => {
      const stored = walletOf([account(1, "Wallet 1")]);
      const store = memoryStore(stored);
      store.read.mockRejectedValueOnce(
        new DOMException("blocked", "SecurityError")
      );
      const storage = walletStorageWith(store)(memoryLocal(undefined));
      expect(await storage.read()).toEqual(UNAVAILABLE);

      expect(await storage.read()).toEqual(found(stored));
    });

    describe("accounts by public key", () => {
      /** The base58 public key of `kp(seed)` */
      const pk = (seed: number) => publicKeyOf(kp(seed)).toBase58();

      const storedWith = (accounts: unknown[]) => ({
        state: "pg",
        accounts,
        currentIndex: 0,
        standardName: NO_STANDARD,
      });

      it("fills the public key of an account stored before it had one", async () => {
        const store = memoryStore(undefined);
        store.read.mockResolvedValueOnce(
          storedWith([{ kp: kp(1), name: "A" }]) as never
        );

        const read = await walletStorageWith(store)(
          memoryLocal(undefined)
        ).read();

        expect(read).toEqual(
          found(walletOf([{ kp: kp(1), name: "A", publicKey: pk(1) }]))
        );
      });

      it("moves an old localStorage account into the store with its public key", async () => {
        const store = memoryStore(undefined);
        const local = memoryLocal(
          JSON.stringify(storedWith([{ kp: kp(1), name: "A" }]))
        );

        await walletStorageWith(store)(local).read();

        expect(store.held()).toEqual(
          walletOf([{ kp: kp(1), name: "A", publicKey: pk(1) }])
        );
        expect(local.items.has(WALLET_LOCAL_KEY)).toBe(false);
      });

      it("reads an account with a public key and no keypair", async () => {
        const stored = walletOf([{ name: "A", publicKey: pk(1) }]);
        const store = memoryStore(stored);

        const read = await walletStorageWith(store)(
          memoryLocal(undefined)
        ).read();

        expect(read).toEqual(found(stored));
        expect(store.setAside).not.toHaveBeenCalled();
      });

      it("sets aside an account whose public key disagrees with its keypair", async () => {
        const wrong = { kp: kp(2), name: "B", publicKey: pk(3) };
        const store = memoryStore(undefined);
        store.read.mockResolvedValueOnce(
          storedWith([{ kp: kp(1), name: "A" }, wrong]) as never
        );

        const read = await walletStorageWith(store)(
          memoryLocal(undefined)
        ).read();

        expect(read).toEqual({
          kind: "wallet",
          wallet: walletOf([{ kp: kp(1), name: "A", publicKey: pk(1) }]),
          setAside: 1,
        });
        expect(store.heldAside()).toEqual([wrong]);
      });

      it("sets aside an account with no usable public key", async () => {
        // A 31-byte key: the base58 of 31 zero bytes, one "1" per zero byte
        const thirtyOneBytes = "1".repeat(31);
        const accounts: unknown[] = [
          { name: "neither" },
          { name: "not base58", publicKey: "0OIl" },
          { name: "short", publicKey: thirtyOneBytes },
          { name: "not text", publicKey: kp(1).slice(32) },
          { name: "keypair not bytes", kp: "abc", publicKey: pk(1) },
        ];
        for (const bad of accounts) {
          const store = memoryStore(undefined);
          store.read.mockResolvedValueOnce(
            storedWith([{ name: "A", publicKey: pk(2) }, bad]) as never
          );

          const read = await walletStorageWith(store)(
            memoryLocal(undefined)
          ).read();

          expect(read).toEqual({
            kind: "wallet",
            wallet: walletOf([{ name: "A", publicKey: pk(2) }]),
            setAside: 1,
          });
          expect(store.heldAside()).toEqual([bad]);
        }
      });

      it("merges an account with no keypair with the same key's keypair", async () => {
        const store = memoryStore(walletOf([{ name: "A", publicKey: pk(1) }]));
        const local = memoryLocal(
          JSON.stringify(storedWith([{ kp: kp(1), name: "Renamed" }]))
        );

        const read = await walletStorageWith(store)(local).read();

        expect(read).toEqual(
          found(walletOf([{ kp: kp(1), name: "Renamed", publicKey: pk(1) }]))
        );
      });
    });

    /** An account whose keypair is 10 bytes: damaged */
    const damaged = (name: string) => ({ kp: kp(9).slice(0, 10), name });

    it("loads the valid accounts and sets the damaged one aside in the store", async () => {
      const store = memoryStore(undefined);
      const local = memoryLocal(
        JSON.stringify({
          state: "pg",
          accounts: [account(1, "A"), damaged("B"), account(3, "C")],
          currentIndex: 2,
          standardName: NO_STANDARD,
        })
      );

      const read = await walletStorageWith(store)(local).read();

      const wallet: SerializedWalletState = {
        state: "pg",
        accounts: [account(1, "A"), account(3, "C")],
        currentIndex: 1,
        standardName: NO_STANDARD,
      };
      expect(read).toEqual({ kind: "wallet", wallet, setAside: 1 });
      expect(store.held()).toEqual(wallet);
      expect(store.heldAside()).toEqual([damaged("B")]);
      expect(local.items.has(WALLET_LOCAL_KEY)).toBe(false);
      expect(local.items.has("wallet.unreadable")).toBe(false);
    });

    it("makes the first valid account current when the current one is damaged", async () => {
      const store = memoryStore(undefined);
      const local = memoryLocal(
        JSON.stringify({
          state: "pg",
          accounts: [damaged("A"), account(2, "B"), account(3, "C")],
          currentIndex: 0,
          standardName: NO_STANDARD,
        })
      );

      const read = await walletStorageWith(store)(local).read();

      expect(read.kind === "wallet" && read.wallet.currentIndex).toBe(0);
      expect(read.kind === "wallet" && read.wallet.accounts[0].name).toBe("B");
    });

    it("sets damaged accounts in the store's own record aside and rewrites it", async () => {
      const store = memoryStore(undefined);
      store.read.mockResolvedValueOnce({
        state: "pg",
        accounts: [account(1, "A"), damaged("B")],
        currentIndex: 0,
        standardName: NO_STANDARD,
      } as never);

      const read = await walletStorageWith(store)(
        memoryLocal(undefined)
      ).read();

      const wallet = walletOf([account(1, "A")]);
      expect(read).toEqual({ kind: "wallet", wallet, setAside: 1 });
      expect(store.heldAside()).toEqual([damaged("B")]);
      expect(store.held()).toEqual(wallet);
    });

    it("keeps a localStorage wallet with damaged accounts in place when they cannot be set aside", async () => {
      const store = memoryStore(undefined);
      store.setAside.mockRejectedValueOnce(new Error("quota"));
      const text = JSON.stringify({
        state: "pg",
        accounts: [account(1, "A"), damaged("B")],
        currentIndex: 0,
        standardName: NO_STANDARD,
      });
      const local = memoryLocal(text);

      const read = await walletStorageWith(store)(local).read();

      expect(read).toEqual(found(walletOf([account(1, "A")])));
      expect(local.items.get(WALLET_LOCAL_KEY)).toBe(text);
      expect(store.write).not.toHaveBeenCalled();
    });

    it("keeps the localStorage text aside when its damaged accounts cannot be set aside", async () => {
      const store = memoryStore(undefined);
      store.setAside.mockRejectedValueOnce(new Error("quota"));
      const text = JSON.stringify({
        state: "pg",
        accounts: [account(1, "A"), damaged("B")],
        currentIndex: 0,
        standardName: NO_STANDARD,
      });
      const local = memoryLocal(text);
      const storage = walletStorageWith(store)(local);

      await storage.read();
      // A save while falling back rewrites the wallet without them
      await storage.write(walletOf([account(1, "A")]));

      expect(local.items.get("wallet.unreadable")).toBe(text);
    });

    it("keeps the localStorage text aside when the store cannot be read and it has damaged accounts", async () => {
      const store = memoryStore(undefined);
      store.read.mockRejectedValue(new Error("blocked"));
      const text = JSON.stringify({
        state: "pg",
        accounts: [account(1, "A"), damaged("B")],
        currentIndex: 0,
        standardName: NO_STANDARD,
      });
      const local = memoryLocal(text);
      const storage = walletStorageWith(store)(local);

      await storage.read();
      // A save while falling back rewrites the wallet without them
      await storage.write(walletOf([account(1, "A")]));

      expect(local.items.get("wallet.unreadable")).toBe(text);
    });

    it("keeps the store's record aside in localStorage when its damaged accounts cannot be set aside", async () => {
      const store = memoryStore(undefined);
      const record = {
        state: "pg",
        accounts: [account(1, "A"), damaged("B")],
        currentIndex: 0,
        standardName: NO_STANDARD,
      };
      store.read.mockResolvedValueOnce(record as never);
      store.setAside.mockRejectedValueOnce(new Error("quota"));
      const local = memoryLocal(undefined);

      const read = await walletStorageWith(store)(local).read();

      expect(read).toEqual(found(walletOf([account(1, "A")])));
      expect(local.items.get("wallet.unreadable")).toBe(JSON.stringify(record));
    });

    it("keeps a stored record of the wrong shape aside in localStorage when the store refuses it", async () => {
      const store = memoryStore(undefined);
      const record = { accounts: "corrupt" };
      store.read.mockResolvedValue(record as never);
      store.setAside.mockRejectedValue(new Error("quota"));
      const local = memoryLocal(undefined);
      const storage = walletStorageWith(store)(local);

      expect(await storage.read()).toEqual(UNAVAILABLE);
      expect(local.items.get("wallet.unreadable")).toBe(JSON.stringify(record));
    });

    it("keeps the first copy aside when the store refuses a damaged record later", async () => {
      const store = memoryStore(undefined);
      store.read.mockResolvedValue({ accounts: "corrupt" } as never);
      store.setAside.mockRejectedValue(new Error("quota"));
      const local = memoryLocal(undefined);
      local.items.set("wallet.unreadable", "{first");

      await walletStorageWith(store)(local).read();

      expect(local.items.get("wallet.unreadable")).toBe("{first");
    });

    it("reads an empty wallet, with no account, as a wallet", async () => {
      const empty = walletOf([]);
      const read = await walletStorageWith(memoryStore(empty))(
        memoryLocal(undefined)
      ).read();

      expect(read).toEqual(found(empty));
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

      expect(await walletStorageWith(store)(local).read()).toEqual(NONE);
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
