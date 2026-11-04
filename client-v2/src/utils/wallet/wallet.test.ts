import { afterEach, describe, expect, it, vi } from "vitest";

import { requireFor } from "../../test-utils/require-for";
import { PgCommon } from "../common";
import { PgWeb3 } from "../web3";
import { KeypairFileError } from "./keypair-file";
import { localSignerProviderWith } from "./signer-provider";
import type { Wallet } from "./types";
import { PgWallet } from "./wallet";

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
      const wallet = PgWallet.create({ kp, name: "Wallet 1" });
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
});
