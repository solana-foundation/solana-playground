import { afterEach, describe, expect, it, vi } from "vitest";

import { requireFor } from "../../test-utils/require-for";
import { PgCommon } from "../common";
import { PgWeb3 } from "../web3";
import { type KeyFrame, KeyFrameUnavailable } from "./key-origin/client";
import { handlerWith } from "./key-origin/frame/handler";
import { CLI_KEY_ERROR, keyOriginSignerProvider } from "./key-origin/provider";
import { KeypairFileError } from "./keypair-file";
import { localSignerProviderWith, publicKeyOf } from "./signer-provider";
import type { Wallet, WalletAccount, WalletState } from "./types";
import { PgWallet, readWith } from "./wallet";

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
      const updates: Partial<WalletState>[] = [];
      vi.spyOn(PgWallet, "update").mockImplementation((update) => {
        updates.push(update);
      });
      return { accounts, updates };
    };

    afterEach(() => {
      for (const prop of ["accounts", "state", "current"]) {
        Reflect.deleteProperty(PgWallet, prop);
      }
    });

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

      it("remove drops the account's key from the key page", async () => {
        const { kept, provider } = fakeKeyPage();
        PgWallet.setSignerProvider(provider);
        holdState([]);
        await PgWallet.addNew();

        PgWallet.remove(0);

        await vi.waitFor(() => expect(kept.size).toBe(0));
      });

      it("addFirst shares one attempt between callers, and tries again after a failure", async () => {
        const { kept, provider } = fakeKeyPage();
        let failNext = true;
        const make = provider.makeKey;
        vi.spyOn(provider, "makeKey").mockImplementation(() =>
          failNext ? Promise.reject(new KeyFrameUnavailable("timeout")) : make()
        );
        PgWallet.setSignerProvider(provider);
        const { accounts } = holdState([]);

        const first = PgWallet.addFirst();
        expect(PgWallet.addFirst()).toBe(first);
        await expect(first).rejects.toBeInstanceOf(KeyFrameUnavailable);
        expect(accounts).toHaveLength(0);

        failNext = false;
        const retry = PgWallet.addFirst();
        expect(retry).not.toBe(first);
        const shared = PgWallet.addFirst();
        expect(await retry).toBe(true);
        expect(await shared).toBe(true);
        expect(accounts).toHaveLength(1);
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

    it("reads unavailable, reading nothing, while the key page cannot be reached", async () => {
      const read = vi.fn(async () => stored);
      const wallet = await readWith(() =>
        Promise.reject(new KeyFrameUnavailable("timeout"))
      )(read);
      expect(wallet.state).toBe("unavailable");
      expect(read).not.toHaveBeenCalled();
    });

    it("reads the stored wallet once the key page answers", async () => {
      const read = vi.fn(async () => stored);
      const wallet = await readWith(async () => ({} as KeyFrame))(read);
      expect(wallet).toBe(stored);
    });
  });
});
