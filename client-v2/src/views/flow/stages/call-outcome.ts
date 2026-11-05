/** What one Interact call came to, for the result and the history */
export interface CallOutcome {
  instruction: string;
  ok: boolean;
  /** Undefined when the transaction never reached the network */
  signature: string | undefined;
  logs: string[];
  /** The line that explains a failure, never empty then; undefined on success */
  failingLine: string | undefined;
}

/** Log lines a program writes when it fails, as Spec 03 picks them */
const FAILURE = /Error Code:|custom program error|failed:/;

/**
 * The one log line that explains a failed call: the program's own error if a
 * line names one, else the last line; `undefined` with no logs.
 */
export const failingLine = (logs: string[]): string | undefined =>
  logs.find((l) => FAILURE.test(l)) ?? logs.at(-1);

/** `failingLine`, with the error message standing in when the logs say nothing */
export const failingLineWith =
  (message: string) =>
  (logs: string[]): string =>
    failingLine(logs) ?? message;

/** Spec 04's "Explain this failure": the failing line and the logs, quoted */
export const explainPrompt = (outcome: CallOutcome) =>
  [
    `Explain why this call to \`${outcome.instruction}\` failed: name the failing instruction and the likely cause.`,
    ...(outcome.failingLine ? [outcome.failingLine] : []),
    ...(outcome.logs.length
      ? ["Program logs:", "```", ...outcome.logs, "```"]
      : []),
  ].join("\n");

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("views/flow/stages/call-outcome", () => {
    describe("explainPrompt", () => {
      it("quotes the failing line and the logs", () => {
        expect(
          explainPrompt({
            instruction: "increment",
            ok: false,
            signature: undefined,
            logs: ["Program X invoke [1]", "custom program error: 0x1"],
            failingLine: "custom program error: 0x1",
          })
        ).toBe(
          [
            "Explain why this call to `increment` failed: name the failing instruction and the likely cause.",
            "custom program error: 0x1",
            "Program logs:",
            "```",
            "Program X invoke [1]",
            "custom program error: 0x1",
            "```",
          ].join("\n")
        );
      });

      it("leaves the logs out when the cluster sent none", () => {
        expect(
          explainPrompt({
            instruction: "increment",
            ok: false,
            signature: undefined,
            logs: [],
            failingLine: "Wallet not connected",
          })
        ).toBe(
          "Explain why this call to `increment` failed: name the failing instruction and the likely cause.\nWallet not connected"
        );
      });
    });

    describe("failingLine", () => {
      it("picks the line with the program's error code", () => {
        expect(
          failingLine([
            "Program X invoke [1]",
            "Program log: Instruction: Increment",
            "Program log: AnchorError caused by account: counter. Error Code: AccountNotInitialized.",
            "Program X failed: custom program error: 0xbc4",
          ])
        ).toBe(
          "Program log: AnchorError caused by account: counter. Error Code: AccountNotInitialized."
        );
      });

      it("picks a custom program error", () => {
        expect(
          failingLine(["Program X invoke [1]", "custom program error: 0x1"])
        ).toBe("custom program error: 0x1");
      });

      it("falls back to the last line", () => {
        expect(failingLineWith("message")(["a", "b"])).toBe("b");
      });

      it("uses the message when there are no logs", () => {
        expect(failingLineWith("Wallet not connected")([])).toBe(
          "Wallet not connected"
        );
      });

      it("has nothing to say with neither", () => {
        expect(failingLine([])).toBeUndefined();
      });
    });
  });
}
