/** How wallets word a user's "no": Phantom, Solflare, Backpack, WalletConnect */
const REJECTION = /reject|denied|declin|cancel/i;

/** EIP-1193's "user rejected", which several Solana wallets reuse */
const USER_REJECTED_CODE = 4001;

/** Errors from the cluster, never from the user, whatever their wording */
const CLUSTER_ERRORS = new Set(["SendTransactionError", "TransferFailedError"]);

/** Name, code and message of whatever was thrown: wallets also throw plain objects */
export const errorFieldsOf = (error: unknown) => {
  if (typeof error !== "object" || error === null) {
    return { name: "", code: undefined, message: "" };
  }
  const { name, code, message } = error as Record<string, unknown>;
  return {
    name: typeof name === "string" ? name : "",
    code,
    message: typeof message === "string" ? message : "",
  };
};

/**
 * Whether a wallet threw because the user said no to it: EIP-1193's 4001, or
 * a wallet's wording of a refusal. A cluster error never is, however worded.
 *
 * @param error what the wallet or the send threw
 * @returns whether the user declined
 */
export const isWalletRejection = (error: unknown) => {
  const { name, code, message } = errorFieldsOf(error);
  if (CLUSTER_ERRORS.has(name)) return false;
  return code === USER_REJECTED_CODE || REJECTION.test(message);
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("shared/lib/wallet-rejection", () => {
    it.each([
      ["a 4001 code", Object.assign(new Error("x"), { code: 4001 })],
      ["a plain object with 4001", { code: 4001, message: "Nope" }],
      ["Phantom's wording", new Error("User rejected the request.")],
      ["a cancel", { message: "Transaction cancelled" }],
    ])("reads %s as a rejection", (_, error) => {
      expect(isWalletRejection(error)).toBe(true);
    });

    it.each([
      [
        "a cluster error worded as denied",
        Object.assign(new Error("denied"), { name: "SendTransactionError" }),
      ],
      ["a network failure", new Error("Failed to fetch")],
      ["a string", "rejected"],
      ["nothing", undefined],
    ])("does not read %s as a rejection", (_, error) => {
      expect(isWalletRejection(error)).toBe(false);
    });
  });
}
