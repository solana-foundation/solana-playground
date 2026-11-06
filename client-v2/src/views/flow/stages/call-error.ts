/**
 * A failed call's error as the result card names it, when the program wrote
 * no log line that explains it: `<ErrorName> · error <code>` for a program's
 * own error, and the cluster's sentence alone for a transaction the runtime
 * refused, which has no code (Design alignment's decision for HOO-2666,
 * 6 Nov). web3's own wording (its advice to catch the exception and call
 * `getLogs()`) never reaches the card.
 */

/** A program error the IDL declares */
export interface IdlError {
  code: number;
  name: string;
}

const CUSTOM = /custom program error: 0x([0-9a-f]+)/i;

/**
 * The terminal's label for a program error code, against one program's
 * errors: the IDL's name, or Custom, then the code
 */
const programErrorWith = (idlErrors: IdlError[]) => (code: number) =>
  `${idlErrors.find((e) => e.code === code)?.name ?? "Custom"} · error ${code}`;

/**
 * The cluster's sentence, without the RPC's preamble, the instruction index
 * and the closing period
 */
const sentenceOf = (message: string) =>
  message
    .replace(/^Transaction simulation failed:\s*/, "")
    .replace(/^Error processing Instruction \d+:\s*/, "")
    .trim()
    .replace(/\.+$/, "");

/**
 * Names a refusal the RPC sent as text (web3's `SendTransactionError`
 * carries it as `transactionMessage`); `undefined` for any other error.
 */
export const nameSendErrorWith =
  (idlErrors: IdlError[]) =>
  (e: unknown): string | undefined => {
    const message = (e as { transactionMessage?: unknown } | null)
      ?.transactionMessage;
    if (typeof message !== "string" || !message.trim()) return undefined;

    const custom = CUSTOM.exec(message);
    if (custom)
      return programErrorWith(idlErrors)(Number.parseInt(custom[1], 16));

    return sentenceOf(message);
  };

/**
 * Names a confirmed transaction's error, as the RPC returns it in `err`:
 * `"AccountNotFound"`, `{ InstructionError: [0, { Custom: 6000 }] }`, or
 * `{ InstructionError: [0, { BorshIoError: "…" }] }`.
 */
export const nameTxErrorWith =
  (idlErrors: IdlError[]) =>
  (err: unknown): string | undefined => {
    if (typeof err === "string") return err;
    if (!err || typeof err !== "object") return undefined;
    const [name, detail] = Object.entries(err)[0] ?? [];
    if (!name) return undefined;
    if (name !== "InstructionError" || !Array.isArray(detail)) return name;

    const inner: unknown = detail[1];
    if (typeof inner === "string") return inner;
    if (!inner || typeof inner !== "object") return name;
    const [innerName, innerDetail] = Object.entries(inner)[0] ?? [];
    if (innerName === "Custom" && Number.isInteger(innerDetail))
      return programErrorWith(idlErrors)(innerDetail as number);
    return innerName ?? name;
  };

/**
 * The terminal's line for a failed call: `Failed · ` and the failing line,
 * with a plain sentence ("Attempt to debit…") in lower case after the dot,
 * as Design alignment drew it. A line that starts with a name keeps its
 * case: a log line ("Program log: …"), an error's name
 * ("NotEnoughEnergy · error 6000"), a capitalised term ("Anchor…").
 */
export const terminalFailure = (failingLine: string) => {
  const isSentence =
    /^[A-Z][a-z]+ [a-z]/.test(failingLine) &&
    !/^(Program|Anchor|Solana) /.test(failingLine);
  return `Failed · ${
    isSentence
      ? failingLine[0].toLowerCase() + failingLine.slice(1)
      : failingLine
  }`;
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  /** web3 1.98's `SendTransactionError`, as a preflight refusal throws it */
  const preflight = (transactionMessage: string) =>
    Object.assign(
      new Error(
        `Simulation failed. \nMessage: ${transactionMessage}. \nLogs: \n[]. \nCatch the \`SendTransactionError\` and call \`getLogs()\` on it for full details.`
      ),
      { transactionMessage }
    );

  const IDL_ERRORS = [{ code: 6000, name: "NotEnoughEnergy" }];
  const namedSendError = nameSendErrorWith([]);
  const namedTxError = nameTxErrorWith([]);

  describe("views/flow/stages/call-error", () => {
    describe("namedSendError", () => {
      it("shows a refusal with no code in the cluster's words alone", () => {
        expect(
          namedSendError(
            preflight(
              "Transaction simulation failed: Attempt to debit an account but found no record of a prior credit."
            )
          )
        ).toBe(
          "Attempt to debit an account but found no record of a prior credit"
        );
      });

      it("names a program's error from the IDL, with its code", () => {
        expect(
          nameSendErrorWith(IDL_ERRORS)(
            preflight(
              "Transaction simulation failed: Error processing Instruction 0: custom program error: 0x1770"
            )
          )
        ).toBe("NotEnoughEnergy · error 6000");
      });

      it("calls an error the IDL does not declare Custom", () => {
        expect(
          namedSendError(
            preflight(
              "Transaction simulation failed: Error processing Instruction 0: custom program error: 0x1"
            )
          )
        ).toBe("Custom · error 1");
      });

      it("drops the instruction index from a runtime error", () => {
        expect(
          namedSendError(
            preflight(
              "Transaction simulation failed: Error processing Instruction 0: invalid account data for instruction"
            )
          )
        ).toBe("invalid account data for instruction");
      });

      it("drops the RPC's preamble from any sentence", () => {
        expect(
          namedSendError(
            preflight("Transaction simulation failed: Something new")
          )
        ).toBe("Something new");
      });

      it("never passes web3's advice through", () => {
        expect(
          namedSendError(
            preflight(
              "Transaction simulation failed: Attempt to debit an account but found no record of a prior credit."
            )
          )
        ).not.toMatch(/SendTransactionError|getLogs/);
      });

      it("has nothing to say about an error the RPC did not send", () => {
        expect(
          namedSendError(new Error("Wallet not connected"))
        ).toBeUndefined();
        expect(namedSendError({})).toBeUndefined();
      });
    });

    describe("terminalFailure", () => {
      it("writes a sentence in lower case after the dot", () => {
        expect(
          terminalFailure(
            "Attempt to debit an account but found no record of a prior credit"
          )
        ).toBe(
          "Failed · attempt to debit an account but found no record of a prior credit"
        );
      });

      it("keeps a sentence that starts with a name as it is", () => {
        expect(terminalFailure("Program failed to complete")).toBe(
          "Failed · Program failed to complete"
        );
        expect(terminalFailure("Anchor error thrown")).toBe(
          "Failed · Anchor error thrown"
        );
      });

      it("keeps an error's name and a log line as they are", () => {
        expect(terminalFailure("NotEnoughEnergy · error 6000")).toBe(
          "Failed · NotEnoughEnergy · error 6000"
        );
        expect(terminalFailure("Program log: Error Code: X.")).toBe(
          "Failed · Program log: Error Code: X."
        );
      });
    });

    describe("namedTxError", () => {
      it("names a transaction error", () => {
        expect(namedTxError("AccountNotFound")).toBe("AccountNotFound");
      });

      it("names a program's error from the IDL, with its code", () => {
        expect(
          nameTxErrorWith(IDL_ERRORS)({
            InstructionError: [0, { Custom: 6000 }],
          })
        ).toBe("NotEnoughEnergy · error 6000");
      });

      it("names a runtime instruction error", () => {
        expect(
          namedTxError({ InstructionError: [0, "InvalidAccountData"] })
        ).toBe("InvalidAccountData");
      });

      it("names an error with a payload by its variant", () => {
        expect(
          namedTxError({ InsufficientFundsForRent: { account_index: 1 } })
        ).toBe("InsufficientFundsForRent");
      });

      it("names a runtime instruction error given with a payload", () => {
        expect(
          namedTxError({ InstructionError: [0, { BorshIoError: "x" }] })
        ).toBe("BorshIoError");
      });

      it("never reads a code it cannot parse", () => {
        expect(namedTxError({ InstructionError: [0, { Custom: "abc" }] })).toBe(
          "Custom"
        );
      });

      it("has nothing to say without an error", () => {
        expect(namedTxError(undefined)).toBeUndefined();
      });
    });
  });
}
