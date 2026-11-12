import { afterEach, describe, expect, it, vi } from "vitest";

import { PgWallet } from "../../utils";
import { addExistingImportedKey, addNewImportedKey } from "./imported-key";

// The utils barrel needs build-time globals the unit runner does not define.
vi.mock("../../utils", () => ({
  PgWallet: {
    accounts: [{ name: "Wallet 1", publicKey: "x" }],
    currentIndex: 0,
    add: vi.fn(),
    forgetKey: vi.fn(() => Promise.resolve()),
  },
}));

const IMPORTED = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

afterEach(() => {
  vi.clearAllMocks();
});

describe("components/Wallet/imported-key", () => {
  it("adds the stored key's account and says so", () => {
    vi.mocked(PgWallet.add).mockReturnValueOnce(true);
    expect(addNewImportedKey(IMPORTED)).toBe("Imported 7xKX…gAsU as Wallet 1.");
    expect(PgWallet.add).toHaveBeenCalledWith({ publicKey: IMPORTED });
    expect(PgWallet.forgetKey).not.toHaveBeenCalled();
  });

  it("drops a key the import newly stored when no account takes it", () => {
    const failure = new Error("Wallet unavailable");
    vi.mocked(PgWallet.add).mockImplementationOnce(() => {
      throw failure;
    });
    expect(() => addNewImportedKey(IMPORTED)).toThrow(failure);
    expect(PgWallet.forgetKey).toHaveBeenCalledWith(IMPORTED);
  });

  it("keeps a key the key page already held when the add fails", () => {
    vi.mocked(PgWallet.add).mockImplementationOnce(() => {
      throw new Error("Wallet unavailable");
    });
    expect(() => addExistingImportedKey(IMPORTED)).toThrow(
      "Wallet unavailable"
    );
    expect(PgWallet.forgetKey).not.toHaveBeenCalled();
  });
});
