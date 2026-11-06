import type { WalletNoticeKind } from "../../entities/wallet";
import { createLogger, toError } from "../../shared/lib/logger";
import { PgCommon } from "../common";
import { PgConnection } from "../connection";
import {
  createDerivable,
  declareDecorator,
  derivable,
  updatable,
} from "../decorators";
import { PgView } from "../view";
import { PgWeb3 } from "../web3";
import { parseKeypairFile } from "./keypair-file";
import { indexedDbStoreFor } from "./keystore";
import {
  localSignerProviderWith,
  publicKeyOf,
  type WalletSignerProvider,
} from "./signer-provider";
import type {
  SerializedWalletState,
  StandardWallet,
  Wallet,
  WalletAccount,
  WalletState,
} from "./types";
import { WALLET_LOCAL_KEY, walletStorageWith } from "./wallet-storage";

const defaultState: WalletState = {
  state: "setup",
  accounts: [],
  currentIndex: -1,
  show: false,
  standardWallets: [],
  standardName: null,
};

/**
 * Holds the accounts' keys and signs with them (`signer-provider.ts`). Every
 * use of an account's key goes through it; `local` keeps the keys in the page
 * as the wallet always has.
 */
let signerProvider: WalletSignerProvider = localSignerProviderWith(
  (publicKey) =>
    PgWallet.accounts.find((account) =>
      publicKeyOf(account.kp).equals(publicKey)
    )?.kp
);

let walletStorageInstance:
  | ReturnType<ReturnType<typeof walletStorageWith>>
  | undefined;

/**
 * The wallet's storage (`wallet-storage.ts`): its own IndexedDB database,
 * `pg-wallet`, with `localStorage` as what it moves from and falls back to.
 *
 * Made on first use, not at import: the build imports this module under Node
 * (`src/settings`), where `localStorage` does not exist. A save still waiting
 * for the lock when the page hides is kept in `localStorage`
 * (`keepUnsaved`), so closing the tab cannot lose a new account's key.
 */
const walletStorage = () => {
  if (walletStorageInstance) return walletStorageInstance;
  const instance = walletStorageWith(indexedDbStoreFor("pg-wallet"))(
    localStorageOrRefusal()
  );
  window.addEventListener("pagehide", instance.keepUnsaved);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") instance.keepUnsaved();
  });
  walletStorageInstance = instance;
  return instance;
};

/**
 * `localStorage`, or, where reading the global itself throws (a sandboxed or
 * storage-blocked origin), a stand-in that throws the same error on every
 * call, so `wallet-storage.ts` handles the refusal and reads IndexedDB.
 */
const localStorageOrRefusal = (): Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
> => {
  try {
    return localStorage;
  } catch (error) {
    const refuse = () => {
      throw error;
    };
    return { getItem: refuse, setItem: refuse, removeItem: refuse };
  }
};

const log = createLogger("wallet:notice");

const migrateLog = createLogger("wallet:migrate");

/** The notices this page load has already raised, each at most once */
const toldNotices = new Set<WalletNoticeKind>();

/**
 * Notices raised before the toast host listens (the wallet is read before
 * the app mounts); `PgWallet.releaseNotices` shows them and ends the hold
 */
let heldNotices: WalletNoticeKind[] | undefined = [];

/** Show a wallet storage notice until the user closes it */
const show = async (notice: WalletNoticeKind) => {
  const { WalletNotice } = await import("../../entities/wallet");
  PgView.setToast(WalletNotice, {
    componentProps: { notice },
    options: { name: `wallet-${notice}`, duration: "persistent" },
  });
};

const showOrLog = (notice: WalletNoticeKind) => {
  show(notice).catch((error: unknown) => {
    // The failure it tells of is logged already; this is the notice's own
    log.error(error, { report: true, context: { notice } });
  });
};

/**
 * Tell the user of a wallet storage failure, once a page load: every failure
 * is logged, and a toast per save would bury the page
 */
const tell = (notice: WalletNoticeKind) => {
  if (toldNotices.has(notice)) return;
  toldNotices.add(notice);
  if (heldNotices) heldNotices.push(notice);
  else showOrLog(notice);
};

const persistenceLog = createLogger("wallet:persistence");

/** Whether this page load has asked the browser to keep storage persistent */
let hasRequestedPersistence = false;

/**
 * Ask the browser, once a page load, not to evict the origin's storage, the
 * wallet's database with it. Asked after a save landed in the store, so it
 * is asked only where the store works. The answer is the browser's to give
 * (Chrome grants by engagement, Firefox may prompt), so it is logged, not
 * reported.
 */
const requestPersistence = async () => {
  if (hasRequestedPersistence) return;
  hasRequestedPersistence = true;
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return;
  try {
    const isPersisted = await navigator.storage.persist();
    persistenceLog.info("storage persistence requested", {
      context: { isPersisted },
    });
  } catch (error) {
    persistenceLog.info("storage persistence request failed", {
      context: { error: String(error) },
    });
  }
};

const storage = {
  /** Read from storage and deserialize the data. */
  async read(): Promise<WalletState> {
    const read = await walletStorage().read();
    switch (read.kind) {
      case "wallet":
        if (read.setAside > 0) tell("set-aside");
        return { ...defaultState, ...read.wallet };
      case "none":
        // A stored record that could not be read was set aside
        if (read.setAside > 0) tell("set-aside");
        return defaultState;
      case "unavailable":
        return { ...defaultState, state: "unavailable" };
    }
  },

  /** Serialize the data and write to storage. */
  async write(wallet: WalletState) {
    // Saving it would replace the stored wallet that could not be read
    if (wallet.state === "unavailable") return;

    // Don't use spread operator(...) because of the extra state
    const serializedState: SerializedWalletState = {
      accounts: wallet.accounts,
      currentIndex: wallet.currentIndex,
      state: wallet.state,
      standardName: wallet.standardName,
    };

    const outcome = await walletStorage().write(serializedState);
    // Before there is an account, a lost save costs nothing to be told about
    if (outcome === "lost" && wallet.accounts.length) tell("save-failed");
    if (outcome === "store") await requestPersistence();
  },
};

const derive = () => ({
  /**
   * The current active wallet.
   *
   * It will be one of the following:
   *
   * - A Playground wallet
   * - A Wallet Standard wallet
   * - `null` if not connected.
   */
  current: createDerivable({
    derive: async (): Promise<Wallet | null> => {
      switch (PgWallet.state) {
        case "pg": {
          // Check whether the current account exists
          const currentAccount = PgWallet.accounts[PgWallet.currentIndex];
          if (!currentAccount) {
            if (!PgWallet.accounts.length) PgWallet.add();
            else PgWallet.switch(0);

            return null;
          }

          return PgWallet.create(currentAccount);
        }

        case "sol": {
          const standard = PgWallet.standardWallets.find(
            (wallet) => wallet.name === PgWallet.standardName
          );
          if (!standard || standard.connecting) return null;
          if (!standard.connected) await standard.connect();
          return standard as StandardWallet<true>;
        }

        case "disconnected":
        case "setup":
        case "unavailable":
          return null;
      }
    },
    onChange: [
      "state",
      "accounts",
      "currentIndex",
      "standardWallets",
      "standardName",
    ],
    // Do not cache because changing standard wallets accounts inside extensions
    // keeps the same object in memory, and thus making the value stale when
    // comparing cached object values by reference.
    //
    // TODO: Should we allow customizing the logic? For example:
    // `cache: (value: Wallet | null) => !value || value.isPg`
    noCache: true,
  }),

  // TODO: Use the raw lamports value?
  /** Balance of the current wallet in SOL */
  balance: createDerivable({
    derive: async (value): Promise<number | null> => {
      // Direct value from `connection.onAccountChange`
      if (typeof value === "number") return PgWeb3.lamportsToSol(value);

      // Check wallet status
      if (!PgWallet.current) return null;

      // Check connection status (it can be `undefined` at the start of the app)
      if (!PgConnection.isConnected) return null;

      const lamports = await PgConnection.current.getBalance(
        PgWallet.current.publicKey
      );
      return PgWeb3.lamportsToSol(lamports);
    },
    onChange: [
      "current",
      PgConnection.onDidChangeCurrent,
      PgConnection.onDidChangeIsConnected,
      // Listen to account changes via WS to re-derive as necessary
      (cb) => {
        const disposables = [
          PgCommon.batchChanges(() => {
            if (disposables[1]) disposables.pop()!.dispose();

            if (!PgWallet.current || !PgConnection.isConnected) return;

            // Declare the connection here because if the connection changes,
            // using `PgConnection.current.removeAccountChangeListener` in
            // `dispose` doesn't remove the existing subscription (since a new
            // `Connection` object that doesn't have access to the previous
            // subscriptions gets created)
            const conn = PgConnection.current;

            // Listen for balance changes
            const id = PgConnection.current.onAccountChange(
              PgWallet.current.publicKey,
              (acc) => cb(acc.lamports)
            );
            disposables.push({
              dispose: () => conn.removeAccountChangeListener(id),
            });
          }, [
            PgWallet.onDidChangeCurrent,
            PgConnection.onDidChangeCurrent,
            PgConnection.onDidChangeIsConnected,
          ]),
        ];

        return {
          dispose: () => {
            disposables.forEach(({ dispose }) => dispose());
          },
        };
      },
    ],
  }),
});

/**
 * Upgrade the pre-accounts format (`sk`) in place in `localStorage`.
 *
 * `updatable` runs this before `storage.read`, so in this tab
 * `walletStorage().read` finds the accounts format. A legacy copy it does see
 * belongs to another tab mid-upgrade and is left alone; any other shape is
 * set aside as unreadable.
 */
const migrate = () => {
  let walletStr: string | null;
  try {
    walletStr = localStorage.getItem(WALLET_LOCAL_KEY);
  } catch (error) {
    // Nothing to upgrade where storage is refused: `walletStorage().read`
    // meets the same refusal, reports it and reads IndexedDB
    migrateLog.warn(
      `legacy wallet upgrade skipped, localStorage refused: ${
        toError(error).name
      }`
    );
    return;
  }
  if (!walletStr) return;

  interface OldWalletState {
    setupCompleted: boolean;
    connected: boolean;
    sk: Array<number>;
  }

  let oldOrNewWallet: OldWalletState | WalletState;
  try {
    oldOrNewWallet = JSON.parse(walletStr);
  } catch (error) {
    // The name only: the `SyntaxError`'s message quotes the text, and so key
    // bytes. `walletStorage().read` reports the unreadable wallet itself.
    migrateLog.warn(
      `legacy wallet upgrade skipped, unreadable JSON: ${toError(error).name}`
    );
    return;
  }
  if (typeof oldOrNewWallet !== "object" || oldOrNewWallet === null) return;
  if ((oldOrNewWallet as WalletState).accounts) return;

  const oldWallet = oldOrNewWallet as OldWalletState;
  const newWallet: WalletState = {
    ...defaultState,
    state: oldWallet.setupCompleted
      ? oldWallet.connected
        ? "pg"
        : "disconnected"
      : "setup",
    accounts: [{ kp: oldWallet.sk, name: "Wallet 1" }],
  };

  // Set the new wallet format
  localStorage.setItem(WALLET_LOCAL_KEY, JSON.stringify(newWallet));

  // Remove wallet adapter key
  localStorage.removeItem("walletName");
};

/**
 * Refuse a new account while the wallet is unavailable: it is never saved
 * then, so the account would live only in memory and be lost on reload
 */
const refuseWhileUnavailable = () => {
  if (PgWallet.state === "unavailable") {
    throw new Error(
      "Wallet unavailable: it could not be read, so no account can be added. Run connect to try again."
    );
  }
};

@derivable(derive)
@updatable({ defaultState, storage, migrate })
class _PgWallet {
  /**
   * Add a new account.
   *
   * @param name name of the account
   * @param keypair optional keypair, default to a random keypair
   * @returns `false` when an account with the name or keypair already existed
   * and it switched to that account instead
   * @throws while the wallet is unavailable
   */
  static add(params?: { name?: string; keypair?: PgWeb3.Keypair }) {
    refuseWhileUnavailable();
    const { name, keypair } = PgCommon.setDefault(params, {
      name: PgWallet.getNextAvailableAccountName(),
      keypair: PgWeb3.Keypair.generate(),
    });

    // Validate name
    PgWallet.validateAccountName(name);

    // Check if account exists
    const accountIndex = PgWallet.accounts.findIndex((acc) => {
      return (
        (name && acc.name === name) ||
        publicKeyOf(acc.kp).equals(keypair.publicKey)
      );
    });
    if (accountIndex !== -1) {
      // Account exists, switch to the account
      PgWallet.switch(accountIndex);
      return false;
    }

    // Add the account
    PgWallet.accounts.push({
      kp: Array.from(keypair.secretKey),
      name,
    });

    // Update the accounts
    PgWallet.update({
      state: "pg",
      accounts: PgWallet.accounts,
      currentIndex: PgWallet.accounts.length - 1,
    });

    return true;
  }

  /**
   * Remove the account at the given index.
   *
   * @param index account index
   */
  static remove(index: number = PgWallet.currentIndex) {
    PgWallet.accounts.splice(index, 1);

    // Update the accounts
    PgWallet.update({
      accounts: PgWallet.accounts,
      currentIndex: PgWallet.accounts.length - 1,
    });
  }

  /**
   * Rename the account.
   *
   * @param name new name of the account
   * @param index account index
   */
  static rename(name: string, index: number = PgWallet.currentIndex) {
    PgWallet.validateAccountName(name);
    const accounts = structuredClone(PgWallet.accounts);
    accounts[index].name = name;
    PgWallet.update({ accounts });
  }

  /**
   * Import a keypair from the user's file system.
   *
   * @param name name of the account
   * @returns the imported keypair and whether it was added (`false`: the
   * wallet already held it and switched to it), or `undefined` when no file
   * was chosen
   * @throws {KeypairFileError} when the file is not a keypair; any other
   * failure, such as an unreadable file, propagates as it is
   * @throws while the wallet is unavailable, before the file picker opens
   */
  static async import(name?: string) {
    refuseWhileUnavailable();
    try {
      return await PgCommon.import(
        async (ev) => {
          const files = ev.target.files;
          if (!files?.length) return;

          const keypair = parseKeypairFile(await files[0].text());
          const added = PgWallet.add({ name, keypair });

          return { keypair, added };
        },
        { accept: ".json" }
      );
    } catch (err) {
      // Closing the picker imports nothing; it is not a failure
      if (PgCommon.isImportCancelled(err)) return;
      throw err;
    }
  }

  /**
   * Export the given or the existing keypair to the user's file system.
   *
   * @param params optional parameters
   * @param params.name optional name, defaults to the current wallet's name
   * @param params.keypair optional keypair, defaults to the current wallet
   */
  static export(params?: { name?: string; keypair?: PgWeb3.Keypair }) {
    params ??= {};
    if (!params.name || !params.keypair) {
      if (!PgWallet.current) throw new Error("Not connected");
      if (!PgWallet.current.isPg) throw new Error("Not Playground Wallet");

      params.name ??= PgWallet.current.name;
      params.keypair ??= PgWeb3.Keypair.fromSecretKey(
        signerProvider.secretKeyFor(PgWallet.current.publicKey)
      );
    }

    return PgCommon.export(
      `${PgCommon.toKebabFromTitle(params.name)}-keypair.json`,
      Array.from(params.keypair.secretKey)
    );
  }

  /**
   * Switch to the given account index.
   *
   * @param index account index to switch to
   */
  static switch(index: number) {
    if (!PgWallet.accounts[index]) {
      throw new Error(`Account index '${index}' not found`);
    }

    PgWallet.update({ state: "pg", currentIndex: index });
  }

  /**
   * Get the next available default account name.
   *
   * This method recurses until it founds an available wallet account name.
   *
   * @param index account index
   * @returns the next available default account name
   */
  static getNextAvailableAccountName(
    index: number = PgWallet.accounts.length
  ): string {
    try {
      const name = this._getDefaultAccountName(index);
      PgWallet.validateAccountName(name);
      return name;
    } catch {
      return PgWallet.getNextAvailableAccountName(index + 1);
    }
  }

  /**
   * Get all of the connected standard wallet adapters.
   *
   * @returns the connected standard wallet adapters
   */
  static getConnectedStandardWallets() {
    return PgWallet.standardWallets.filter(
      (w) => w.connected
    ) as StandardWallet<true>[];
  }

  /**
   * Get all of the connected wallets (both playground and standard).
   *
   * @returns all connected wallets
   */
  static getConnectedWallets() {
    return PgWallet.accounts
      .map(PgWallet.create)
      .concat(PgWallet.getConnectedStandardWallets());
  }

  /**
   * Create a Playground Wallet instance from the given account.
   *
   * @param account wallet account to derive the instance from
   * @returns a Playground Wallet instance
   */
  static create(account: WalletAccount): Wallet {
    return signerProvider.walletFor({
      name: account.name,
      publicKey: publicKeyOf(account.kp),
    });
  }

  /**
   * Show the storage notices raised before the toast host listened, and show
   * later ones at once. The `wallet-notice` effect calls it after mount.
   */
  static releaseNotices() {
    const held = heldNotices ?? [];
    heldNotices = undefined;
    held.forEach(showOrLog);
  }

  /**
   * Replace the provider that holds the accounts' keys and signs with them.
   *
   * The local provider is the default. Set another before the wallet loads:
   * a wallet already derived keeps the provider it was made with.
   *
   * @param provider signer provider for every Playground Wallet account
   */
  static setSignerProvider(provider: WalletSignerProvider) {
    signerProvider = provider;
  }

  /**
   * Check whether the given wallet account name is valid.
   *
   * @param name wallet account name
   * @throws if the name is not valid
   */
  static validateAccountName(name: string) {
    name = name.trim();

    // Empty check
    if (!name) throw new Error("Account name can't be empty");

    // Check whether the name exists
    const nameExists = PgWallet.accounts.some((acc) => acc.name === name);
    if (nameExists) throw new Error(`Account '${name}' already exists`);
  }

  /**
   * Get the keypair bytes of the current wallet.
   *
   * NOTE: It looks like this method is not being used, but it's being used by
   * WASM packages.
   */
  static getKeypairBytes() {
    if (!PgWallet.current) throw new Error("Not connected");
    if (!PgWallet.current.isPg) throw new Error("Not Playground Wallet");

    return Array.from(signerProvider.secretKeyFor(PgWallet.current.publicKey));
  }

  /**
   * Get the default name of the wallet account.
   *
   * @param index account index
   * @returns the wallet account name
   */
  private static _getDefaultAccountName(index: number = PgWallet.currentIndex) {
    return `Wallet ${index + 1}`;
  }
}

export const PgWallet = declareDecorator(_PgWallet, {
  derivable: derive,
  updatable: { defaultState },
});
