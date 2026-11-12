/* eslint-disable unicorn/no-null -- tutorial flow v2 predates this rule; cleanup tracked from SF#94 */
import { ArrowUpRight } from "lucide-react";

import type { LandedCall } from "@/features/tutorial-conversation";
import { CopyButton } from "@/shared/ui/copy-button";

import {
  explorerAddress,
  explorerTx,
  shortKey,
  solOf,
} from "../model/explorer";

/** One row of the receipt: what it is, and the key it shows */
interface Row {
  label: string;
  key: string;
  url: string;
}

/** The rows the receipt has: the signature, the signer, then each account */
const rowsOf = (call: LandedCall): Row[] => {
  const rows: Row[] = [];
  const signature = call.signatures.at(-1);
  if (signature) {
    rows.push({
      label: "Signature",
      key: signature,
      url: explorerTx(signature),
    });
  }
  const { receipt } = call;
  if (receipt?.signer) {
    rows.push({
      label: "Your wallet · signer",
      key: receipt.signer,
      url: explorerAddress(receipt.signer),
    });
  }
  for (const account of receipt?.accounts ?? []) {
    rows.push({
      label: account.name,
      key: account.address,
      url: explorerAddress(account.address),
    });
  }
  return rows;
};

/** The receipt's fee row, the wallet copy of `tutorial-runs` ("Finish receipt") */
const feeLine = (lamports: number) => `Fee ${solOf(lamports)} devnet SOL`;

/** The log the receipt shows: the transaction's, or the line the definition picked */
const logOf = (call: LandedCall): string[] => {
  if (call.receipt?.log?.length) return call.receipt.log;
  return call.line ? [call.line] : [];
};

/** The receipt as text, row by row, for Copy receipt */
export const receiptText = (call: LandedCall): string => {
  const lines = rowsOf(call).map((r) => `${r.label}: ${r.key}`);
  if (call.receipt?.fee !== undefined) {
    lines.push(feeLine(call.receipt.fee));
  }
  return lines.concat(logOf(call)).join("\n");
};

export interface BaseReceiptProps {
  call: LandedCall;
  onCopyError: (error: unknown) => void;
}

/**
 * The last call's receipt, inside the finish card's "Transaction details":
 * every address row with Copy and an Explorer link on devnet, the fee, and
 * the log. Each row shows only when the result has its field; the call
 * runner (task 4.3) fills the fee, the signer, the accounts and the log.
 */
const BaseReceipt = ({ call, onCopyError }: BaseReceiptProps) => {
  const log = logOf(call);
  return (
    <div className="flex flex-col gap-2 text-caption">
      <ul className="flex flex-col gap-1">
        {rowsOf(call).map((row) => (
          <li
            key={`${row.label}:${row.key}`}
            className="flex items-center gap-2"
          >
            {/* Wraps rather than cuts: "Your wallet · signer" is the
                wallet copy, verbatim */}
            <span className="min-w-0 flex-1 text-muted-foreground">
              {row.label}
            </span>
            <span className="font-mono text-foreground">
              {shortKey(row.key)}
            </span>
            <CopyButton
              value={row.key}
              label={`Copy ${row.label}`}
              onError={onCopyError}
            />
            <a
              href={row.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${row.label} in Explorer`}
              className="inline-flex size-6 items-center justify-center rounded-control text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-brand-purple"
            >
              <ArrowUpRight aria-hidden="true" className="size-3.5" />
            </a>
          </li>
        ))}
      </ul>
      {call.receipt?.fee !== undefined && (
        <p className="text-muted-foreground tabular-nums">
          {feeLine(call.receipt.fee)}
        </p>
      )}
      {log.length > 0 && (
        <pre className="overflow-x-auto rounded-control bg-surface-well px-3 py-2 font-mono text-[0.75rem] leading-[1.6] text-foreground">
          {log.join("\n")}
        </pre>
      )}
    </div>
  );
};

export default BaseReceipt;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("widgets/tutorial-conversation/ui/BaseReceipt", () => {
    const bare = (signatures: string[], line: string | null): LandedCall => ({
      act: "call",
      ok: true,
      seconds: 0.9,
      signatures,
      line,
      called: [],
    });

    it("copies the last signature and the picked line while the runner fills nothing", () => {
      expect(
        receiptText(bare(["5igFirst", "5igLast"], "Program log: Hello, Alex!"))
      ).toBe("Signature: 5igLast\nProgram log: Hello, Alex!");
      expect(receiptText(bare([], null))).toBe("");
    });

    it("copies every row, the fee and the whole log once the runner fills them", () => {
      expect(
        receiptText({
          act: "call",
          ok: true,
          seconds: 0.9,
          signatures: ["5ig"],
          line: "Program log: Hello, Alex!",
          called: [],
          receipt: {
            fee: 5000,
            signer: "Wa11et",
            accounts: [{ name: "program", address: "Pr0g" }],
            log: [
              "Program log: Instruction: Hello",
              "Program log: Hello, Alex!",
            ],
          },
        })
      ).toBe(
        [
          "Signature: 5ig",
          "Your wallet · signer: Wa11et",
          "program: Pr0g",
          "Fee 0.000005 devnet SOL",
          "Program log: Instruction: Hello",
          "Program log: Hello, Alex!",
        ].join("\n")
      );
    });
  });
}
