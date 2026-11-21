import { describe, expect, it } from "vitest";

import { formatTransactionError } from "./transaction-error";

describe("commands/solana/transaction-error", () => {
  it("prints an instruction's custom program error in lowercase hex", () => {
    expect(
      formatTransactionError({ InstructionError: [5, { Custom: 6072 }] })
    ).toBe("Error processing Instruction 5: custom program error: 0x17b8");
  });

  it("prints a custom program error that arrives as a bigint", () => {
    expect(
      formatTransactionError({ InstructionError: [0, { Custom: 1n }] })
    ).toBe("Error processing Instruction 0: custom program error: 0x1");
  });

  it("prints a named instruction error", () => {
    expect(
      formatTransactionError({ InstructionError: [2, "InvalidAccountData"] })
    ).toBe(
      "Error processing Instruction 2: invalid account data for instruction"
    );
  });

  it("prints a borsh instruction error with its message", () => {
    expect(
      formatTransactionError({ InstructionError: [1, { BorshIoError: "x" }] })
    ).toBe(
      "Error processing Instruction 1: Failed to serialize or deserialize account data: x"
    );
  });

  it.each([
    ["AccountInUse", "Account in use"],
    ["InsufficientFundsForFee", "Insufficient funds for fee"],
    ["BlockhashNotFound", "Blockhash not found"],
    ["AlreadyProcessed", "This transaction has already been processed"],
    [
      "InvalidRentPayingAccount",
      "Transaction leaves an account with a lower balance than rent-exempt minimum",
    ],
    [
      "AccountNotFound",
      "Attempt to debit an account but found no record of a prior credit.",
    ],
  ])("prints the unit variant %s", (variant, text) => {
    expect(formatTransactionError(variant)).toBe(text);
  });

  it("prints a duplicate instruction with its index", () => {
    expect(formatTransactionError({ DuplicateInstruction: 3 })).toBe(
      "Transaction contains a duplicate instruction (3) that is not allowed"
    );
  });

  it("prints insufficient funds for rent with the account index", () => {
    expect(
      formatTransactionError({
        InsufficientFundsForRent: { account_index: 4 },
      })
    ).toBe(
      "Transaction results in an account (4) with insufficient funds for rent"
    );
  });

  it("prints a temporarily restricted program with the account index", () => {
    expect(
      formatTransactionError({
        ProgramExecutionTemporarilyRestricted: { account_index: 2 },
      })
    ).toBe(
      "Execution of the program referenced by account at index 2 is temporarily restricted."
    );
  });

  it("prints an error it does not know as its JSON", () => {
    expect(formatTransactionError({ Future: { a: 1n } })).toBe(
      '{"Future":{"a":"1"}}'
    );
    expect(formatTransactionError("FutureUnit")).toBe("FutureUnit");
  });

  it("does not read a variant from the table's prototype", () => {
    expect(formatTransactionError("toString")).toBe("toString");
    expect(
      formatTransactionError({ InstructionError: [0, "constructor"] })
    ).toBe("Error processing Instruction 0: constructor");
  });
});
