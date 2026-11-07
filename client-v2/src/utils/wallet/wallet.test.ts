import { afterEach, describe, expect, it, vi } from "vitest";

import {
  initLogger,
  memoryProvider,
  resetLogger,
} from "../../shared/lib/logger";
import { requireFor } from "../../test-utils/require-for";
import { PgCommon } from "../common";
import { PgView } from "../view";
import { PgWeb3 } from "../web3";
import { type KeyFrame, KeyFrameUnavailable } from "./key-origin/client";
import { handlerWith } from "./key-origin/frame/handler";
import { CLI_KEY_ERROR, keyOriginSignerProvider } from "./key-origin/provider";
import { KeypairFileError } from "./keypair-file";
import { localSignerProviderWith, publicKeyOf } from "./signer-provider";
import type { Wallet, WalletAccount, WalletState } from "./types";
import { PgWallet, readWith, refuseKeylessRecord } from "./wallet";
import { WALLET_LOCAL_KEY, type WalletRead } from "./wallet-storage";

// The connection module reads build-time globals the unit runner does not
// define; `PgWallet.import` never touches it.
vi.mock("../connection", () => ({ PgConnection: {} }));

/**
 * Runs `PgWallet.import` against the real file picker of `PgCommon.import`,
 * with the input the picker clicks handed back so a test can choose a file or
 * close it.
 */
const pick = () => {
  let input: HTMLInputElement | undefined;
  vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
    this: HTMLInputElement
  ) {
    input = this;
  });
  const result = PgWallet.import();
  const picker = () => requireFor("the file input import() clicked")(input);
  const choose = (text: () => Promise<string>) => {
    Object.defineProperty(picker(), "files", { value: [{ text }] });
    picker().dispatchEvent(new Event("change"));
  };
  const close = () => picker().dispatchEvent(new Event("cancel"));
  return { result, choose, close };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("utils/wallet/wallet", () => {
  it("import adds the keypair a keypair file holds", async () => {
    const add = vi.spyOn(PgWallet, "add").mockImplementation(() => false);
    const keypair = PgWeb3.Keypair.generate();
    const { result, choose } = pick();

    choose(async () => JSON.stringify(Array.from(keypair.secretKey)));

    const imported = await result;
    expect(imported?.keypair.publicKey.equals(keypair.publicKey)).toBe(true);
    // What `add` answered: here, that the wallet already held the keypair
    expect(imported?.added).toBe(false);
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("import resolves with nothing when the picker is closed", async () => {
    const add = vi.spyOn(PgWallet, "add").mockImplementation(() => true);
    const { result, close } = pick();

    close();

    await expect(result).resolves.toBeUndefined();
    expect(add).not.toHaveBeenCalled();
  });

  it("import rejects a file that is not a keypair, adding nothing", async () => {
    const add = vi.spyOn(PgWallet, "add").mockImplementation(() => true);
    const { result, choose } = pick();

    choose(async () => '{"hello":"world"}');

    await expect(result).rejects.toBeInstanceOf(KeypairFileError);
    expect(add).not.toHaveBeenCalled();
  });

  it("import passes on a failure to read the file", async () => {
    vi.spyOn(PgWallet, "add").mockImplementation(() => true);
    const failure = new Error("could not read the file");
    const { result, choose } = pick();

    choose(async () => {
      throw failure;
    });

    await expect(result).rejects.toBe(failure);
  });

  describe("while the wallet is unavailable", () => {
    // `updatable` defines `state` only once the wallet initializes
    const makeUnavailable = () =>
      Object.defineProperty(PgWallet, "state", {
        get: () => "unavailable",
        configurable: true,
      });

    afterEach(() => {
      Reflect.deleteProperty(PgWallet, "state");
    });

    it("add refuses, so no account lives only in memory", () => {
      makeUnavailable();
      const update = vi.spyOn(PgWallet, "update");

      expect(() => PgWallet.add()).toThrow("Wallet unavailable");
      expect(update).not.toHaveBeenCalled();
    });

    it("import refuses before the file picker opens", async () => {
      makeUnavailable();
      const click = vi.spyOn(HTMLInputElement.prototype, "click");

      await expect(PgWallet.import()).rejects.toThrow("Wallet unavailable");
      expect(click).not.toHaveBeenCalled();
    });
  });

  describe("the signer provider", () => {
    const keypair = PgWeb3.Keypair.generate();
    const kp = Array.from(keypair.secretKey);
    /** The current wallet as `derive` builds it, reached through the provider */
    const connect = () => {
      const provider = localSignerProviderWith((publicKey) =>
        publicKey.equals(keypair.publicKey) ? kp : undefined
      );
      const secretKeyFor = vi.spyOn(provider, "secretKeyFor");
      const walletFor = vi.spyOn(provider, "walletFor");
      PgWallet.setSignerProvider(provider);
      const wallet = PgWallet.create({
        kp,
        name: "Wallet 1",
        publicKey: keypair.publicKey.toBase58(),
      });
      // `derivable` defines `current` only once the wallet initializes
      Object.defineProperty(PgWallet, "current", {
        get: (): Wallet => wallet,
        configurable: true,
      });
      return { wallet, secretKeyFor, walletFor };
    };

    afterEach(() => {
      Reflect.deleteProperty(PgWallet, "current");
    });

    it("create hands the provider's keypair to pg.wallet.keypair", () => {
      const { wallet, walletFor } = connect();
      expect(wallet.isPg && Array.from(wallet.keypair.secretKey)).toEqual(kp);
      expect(walletFor).toHaveBeenCalledWith({
        name: "Wallet 1",
        publicKey: keypair.publicKey,
      });
    });

    it("create names the account by its public key, not its key bytes", () => {
      const provider = localSignerProviderWith((publicKey) =>
        publicKey.equals(keypair.publicKey) ? kp : undefined
      );
      const walletFor = vi.spyOn(provider, "walletFor");
      PgWallet.setSignerProvider(provider);

      PgWallet.create({
        name: "Wallet 1",
        publicKey: keypair.publicKey.toBase58(),
      });

      expect(walletFor).toHaveBeenCalledWith({
        name: "Wallet 1",
        publicKey: keypair.publicKey,
      });
    });

    it("getKeypairBytes gives the WASM CLIs the current account's key", () => {
      const { secretKeyFor } = connect();
      expect(PgWallet.getKeypairBytes()).toEqual(kp);
      expect(secretKeyFor).toHaveBeenCalledWith(keypair.publicKey);
    });

    it("export writes the current account's key file", () => {
      const { secretKeyFor } = connect();
      const exported = vi.spyOn(PgCommon, "export").mockReturnValue(undefined);
      PgWallet.export();
      expect(exported).toHaveBeenCalledWith("wallet-1-keypair.json", kp);
      expect(secretKeyFor).toHaveBeenCalledWith(keypair.publicKey);
    });
  });

  describe("adding and removing accounts", () => {
    /** A key page over an in-memory store, reached as a `KeyFrame` */
    const fakeKeyPage = () => {
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
      const link: KeyFrame = {
        request: async <T>(body: Parameters<KeyFrame["request"]>[0]) => {
          const reply = await handle(
            Object.assign({ id: ++id }, body) as Parameters<typeof handle>[0]
          );
          if (!reply.ok) throw new Error(reply.error);
          return reply.result as T;
        },
        close: () => {},
      };
      return { kept, provider: keyOriginSignerProvider(async () => link) };
    };

    /** The wallet's state, which `updatable` would hold once initialized */
    const holdState = (accounts: WalletAccount[]) => {
      Object.defineProperty(PgWallet, "accounts", {
        get: () => accounts,
        configurable: true,
      });
      Object.defineProperty(PgWallet, "state", {
        get: () => "pg",
        configurable: true,
      });
      Object.defineProperty(PgWallet, "currentIndex", {
        get: () => accounts.length - 1,
        configurable: true,
      });
      Object.defineProperty(PgWallet, "standardName", {
        // eslint-disable-next-line unicorn/no-null -- the stored shape: no standard wallet
        get: () => null,
        configurable: true,
      });
      const updates: Partial<WalletState>[] = [];
      vi.spyOn(PgWallet, "update").mockImplementation((update) => {
        updates.push(update);
      });
      return { accounts, updates };
    };

    afterEach(() => {
      for (const prop of [
        "accounts",
        "state",
        "current",
        "currentIndex",
        "standardName",
      ]) {
        Reflect.deleteProperty(PgWallet, prop);
      }
      localStorage.clear();
    });

    /** The notices shown from here on: none is held for the toast host */
    const shownNotices = () => {
      PgWallet.releaseNotices();
      const shown: unknown[] = [];
      vi.spyOn(PgView, "setToast").mockImplementation(((
        ...[, props]: [unknown, { componentProps: { notice: unknown } }]
      ) => {
        shown.push(props.componentProps.notice);
      }) as never);
      return shown;
    };

    /** The accounts the stored record lists, by public key */
    const storedAccounts = () => {
      const stored = localStorage.getItem(WALLET_LOCAL_KEY);
      if (!stored) return undefined;
      const record = JSON.parse(stored) as { accounts: WalletAccount[] };
      return record.accounts.map((account) => account.publicKey);
    };

    describe("under the key-origin provider", () => {
      it("addNew stores the account by public key, and its key in the key page", async () => {
        const { kept, provider } = fakeKeyPage();
        PgWallet.setSignerProvider(provider);
        const { accounts } = holdState([]);

        expect(await PgWallet.addNew()).toBe(true);

        expect(accounts).toHaveLength(1);
        const [account] = accounts;
        expect(account).toEqual({
          name: "Wallet 1",
          publicKey: Array.from(kept.keys())[0],
        });
        expect("kp" in account).toBe(false);
      });

      it("add refuses a keypair, so no key bytes reach the record", () => {
        const { provider } = fakeKeyPage();
        PgWallet.setSignerProvider(provider);
        const { accounts } = holdState([]);

        expect(() =>
          PgWallet.add({ keypair: PgWeb3.Keypair.generate() })
        ).toThrow("Import the key file from the key panel.");
        expect(accounts).toHaveLength(0);
      });

      it("import refuses before the file picker opens, so no key file is read into the page", async () => {
        const { provider } = fakeKeyPage();
        PgWallet.setSignerProvider(provider);
        holdState([]);
        const click = vi.spyOn(HTMLInputElement.prototype, "click");

        await expect(PgWallet.import()).rejects.toThrow(
          "Import the key file from the key panel."
        );
        expect(click).not.toHaveBeenCalled();
      });

      it("remove drops the account's key from the key page", async () => {
        const { kept, provider } = fakeKeyPage();
        PgWallet.setSignerProvider(provider);
        holdState([]);
        await PgWallet.addNew();

        await PgWallet.remove(0);

        expect(kept.size).toBe(0);
      });

      it("remove stores the record without the account before it drops the key", async () => {
        const { provider } = fakeKeyPage();
        PgWallet.setSignerProvider(provider);
        holdState([]);
        await PgWallet.addNew();
        const [publicKey] = PgWallet.accounts.map((a) => a.publicKey);
        const storedAtForget: Array<string[] | undefined> = [];
        const forget = provider.forgetKey;
        vi.spyOn(provider, "forgetKey").mockImplementation((key) => {
          storedAtForget.push(storedAccounts());
          return forget(key);
        });

        await PgWallet.remove(0);

        expect(storedAtForget).toEqual([[]]);
        expect(storedAccounts()).not.toContain(publicKey);
      });

      it("remove keeps the key when the record could not be stored", async () => {
        const { kept, provider } = fakeKeyPage();
        PgWallet.setSignerProvider(provider);
        holdState([]);
        await PgWallet.addNew();
        const shown = shownNotices();
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
          throw new Error("QuotaExceededError");
        });

        await PgWallet.remove(0);

        expect(kept.size).toBe(1);
        await vi.waitFor(() => expect(shown).toContain("save-failed"));
      });

      it("remove tells the user when the key page could not drop the key", async () => {
        const { kept, provider } = fakeKeyPage();
        PgWallet.setSignerProvider(provider);
        holdState([]);
        await PgWallet.addNew();
        const shown = shownNotices();
        vi.spyOn(provider, "forgetKey").mockRejectedValue(
          new KeyFrameUnavailable("timeout")
        );

        await PgWallet.remove(0);

        expect(kept.size).toBe(1);
        await vi.waitFor(() => expect(shown).toEqual(["forget-failed"]));
      });

      it("addFirst shares one attempt between callers", async () => {
        const { kept, provider } = fakeKeyPage();
        PgWallet.setSignerProvider(provider);
        const { accounts } = holdState([]);

        const first = PgWallet.addFirst();
        const shared = PgWallet.addFirst();
        expect(shared).toBe(first);
        expect(await first).toBe(true);
        expect(await shared).toBe(true);
        expect(accounts).toHaveLength(1);
        expect(kept.size).toBe(1);
      });

      it("addFirst keeps a failure for the page load, reported once, until the provider changes", async () => {
        const logged = memoryProvider();
        initLogger({ providers: [logged] });
        const { kept, provider } = fakeKeyPage();
        let failNext = true;
        const make = provider.makeKey;
        const makeKey = vi
          .spyOn(provider, "makeKey")
          .mockImplementation(() =>
            failNext
              ? Promise.reject(new KeyFrameUnavailable("timeout"))
              : make()
          );
        PgWallet.setSignerProvider(provider);
        const { accounts } = holdState([]);

        const first = PgWallet.addFirst();
        await expect(first).rejects.toBeInstanceOf(KeyFrameUnavailable);
        failNext = false;
        await expect(PgWallet.addFirst()).rejects.toBeInstanceOf(
          KeyFrameUnavailable
        );
        expect(makeKey).toHaveBeenCalledOnce();
        expect(accounts).toHaveLength(0);
        expect(
          logged.entries.filter((entry) => entry.ns === "wallet:account")
        ).toEqual([expect.objectContaining({ level: "error", report: true })]);
        resetLogger();

        PgWallet.setSignerProvider(provider);
        expect(await PgWallet.addFirst()).toBe(true);
        expect(kept.size).toBe(1);
      });

      it("makeKey stores a key, and forgetKey drops it unless an account holds it", async () => {
        const { kept, provider } = fakeKeyPage();
        PgWallet.setSignerProvider(provider);
        holdState([]);
        expect(PgWallet.holdsKeysInPage()).toBe(false);

        const dropped = await PgWallet.makeKey();
        const added = await PgWallet.makeKey();
        expect(kept.size).toBe(2);
        PgWallet.add({ publicKey: added });

        await PgWallet.forgetKey(dropped);
        await PgWallet.forgetKey(added);
        expect(Array.from(kept.keys())).toEqual([added]);
      });

      it("getKeypairBytes refuses with the CLI message, export with the key panel's", async () => {
        const { provider } = fakeKeyPage();
        PgWallet.setSignerProvider(provider);
        const publicKey = new PgWeb3.PublicKey(await provider.makeKey());
        const wallet = provider.walletFor({ name: "Wallet 1", publicKey });
        Object.defineProperty(PgWallet, "current", {
          get: (): Wallet => wallet,
          configurable: true,
        });
        const exported = vi.spyOn(PgCommon, "export");

        expect(() => PgWallet.getKeypairBytes()).toThrow(CLI_KEY_ERROR);
        expect(() => PgWallet.export()).toThrow(
          "Export the key file from the key panel."
        );
        expect(exported).not.toHaveBeenCalled();
      });
    });

    describe("under the local provider", () => {
      it("addNew stores the new key in the record", async () => {
        PgWallet.setSignerProvider(localSignerProviderWith(() => undefined));
        const { accounts } = holdState([]);

        expect(await PgWallet.addNew("Mine")).toBe(true);

        const [account] = accounts;
        expect(account.name).toBe("Mine");
        expect(account.kp).toHaveLength(64);
        expect(publicKeyOf(account.kp as number[]).toBase58()).toBe(
          account.publicKey
        );
      });
    });
  });

  describe("refuseKeylessRecord, the read under the local provider", () => {
    const keypair = PgWeb3.Keypair.generate();
    const withKey: WalletAccount = {
      name: "Kept",
      publicKey: keypair.publicKey.toBase58(),
      kp: Array.from(keypair.secretKey),
    };
    const moved: WalletAccount = {
      name: "Moved",
      publicKey: PgWeb3.Keypair.generate().publicKey.toBase58(),
    };
    const recordOf = (accounts: WalletAccount[]): WalletRead => ({
      kind: "wallet",
      wallet: {
        state: "pg",
        accounts,
        currentIndex: 0,
        // eslint-disable-next-line unicorn/no-null -- the stored shape: no standard wallet
        standardName: null,
      },
      setAside: 0,
    });

    // A build that lost the key-origin variable after a move: the keys are in
    // the key origin, and the record keeps only names and public keys
    it("reads unavailable when an account's key is not in the record, leaving the record as it is", () => {
      const read = recordOf([withKey, moved]);
      const before = structuredClone(read);

      expect(refuseKeylessRecord(read)).toEqual({ kind: "unavailable" });
      expect(read).toEqual(before);
    });

    it("passes a record holding every key through", () => {
      const read = recordOf([withKey]);
      expect(refuseKeylessRecord(read)).toBe(read);
    });

    it("passes no record and an unavailable read through", () => {
      const none: WalletRead = { kind: "none", setAside: 0 };
      const unavailable: WalletRead = { kind: "unavailable" };
      expect(refuseKeylessRecord(none)).toBe(none);
      expect(refuseKeylessRecord(unavailable)).toBe(unavailable);
    });
  });

  describe("readWith, the read under the key-origin provider", () => {
    const stored: WalletState = {
      state: "pg",
      accounts: [],
      currentIndex: -1,
      show: false,
      standardWallets: [],
      // eslint-disable-next-line unicorn/no-null -- the stored shape: no standard wallet
      standardName: null,
    };

    const ORIGIN = "https://wallet-keys.example";

    afterEach(() => resetLogger());

    it("reads unavailable, reading nothing, while the key page cannot be reached", async () => {
      const read = vi.fn(async () => stored);
      const wallet = await readWith(ORIGIN)(() =>
        Promise.reject(new KeyFrameUnavailable("timeout"))
      )(read);
      expect(wallet.state).toBe("unavailable");
      expect(read).not.toHaveBeenCalled();
    });

    it("reports an unreachable key page by its reason and origin only", async () => {
      const logged = memoryProvider();
      initLogger({ providers: [logged] });
      await readWith(ORIGIN)(() =>
        Promise.reject(new KeyFrameUnavailable("version"))
      )(async () => stored);
      await readWith(ORIGIN)(() =>
        Promise.reject(new Error("key bytes 1,2,3 in a message"))
      )(async () => stored);

      expect(logged.entries).toEqual([
        expect.objectContaining({
          ns: "wallet:key-origin",
          level: "error",
          report: true,
          context: {
            what: "reach the wallet key page failed",
            reason: "version",
            origin: ORIGIN,
          },
        }),
        expect.objectContaining({
          level: "error",
          report: true,
          context: {
            what: "reach the wallet key page failed",
            reason: undefined,
            origin: ORIGIN,
          },
        }),
      ]);
      expect(JSON.stringify(logged.entries)).not.toContain("1,2,3");
      expect(String(logged.entries[1].error)).not.toContain("1,2,3");
    });

    it("reads the stored wallet once the key page answers", async () => {
      const read = vi.fn(async () => stored);
      const wallet = await readWith(ORIGIN)(async () => ({} as KeyFrame))(read);
      expect(wallet).toBe(stored);
    });
  });
});
