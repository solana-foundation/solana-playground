import { afterEach, describe, expect, it, vi } from "vitest";

import { PgWeb3 } from "../web3";
import { KeypairFileError } from "./keypair-file";
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
  const choose = (text: () => Promise<string>) => {
    Object.defineProperty(input!, "files", { value: [{ text }] });
    input!.dispatchEvent(new Event("change"));
  };
  const close = () => input!.dispatchEvent(new Event("cancel"));
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
});
