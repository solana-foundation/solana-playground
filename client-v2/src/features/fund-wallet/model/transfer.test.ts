// @vitest-environment node
// The transfer builds a web3.js instruction, whose byte checks fail under
// jsdom (another realm's `Uint8Array`); `PgTx` itself is mocked.
import { afterEach, describe, expect, it, vi } from "vitest";
import { Keypair, SystemInstruction, SystemProgram } from "@solana/web3.js";

const tx = vi.hoisted(() => ({ send: vi.fn(), confirm: vi.fn() }));
vi.mock("@/utils", async () => {
  const web3 = await import("@solana/web3.js");
  return { PgTx: tx, PgWeb3: web3 };
});

import { sendFunds } from "./transfer";

const payerKey = Keypair.generate().publicKey;
const payer = { publicKey: payerKey } as unknown as Parameters<
  typeof sendFunds
>[0]["payer"];
const to = Keypair.generate().publicKey.toBase58();

afterEach(() => {
  tx.send.mockReset();
  tx.confirm.mockReset();
});

describe("features/fund-wallet/model/transfer", () => {
  it("sends one transfer from the payer, signed by the payer, and returns its signature", async () => {
    tx.send.mockResolvedValue("sig");
    tx.confirm.mockResolvedValue(undefined);

    await expect(sendFunds({ payer, to, lamports: 250_000_000 })).resolves.toBe(
      "sig"
    );

    const [ix, opts] = tx.send.mock.calls[0];
    expect(ix.programId.equals(SystemProgram.programId)).toBe(true);
    const transfer = SystemInstruction.decodeTransfer(ix);
    expect(transfer.fromPubkey.equals(payerKey)).toBe(true);
    expect(transfer.toPubkey.toBase58()).toBe(to);
    expect(Number(transfer.lamports)).toBe(250_000_000);
    expect(opts).toEqual({ wallet: payer });
  });

  it("names a transfer the cluster refused as failed, with nothing moved", async () => {
    tx.send.mockResolvedValue("sig");
    tx.confirm.mockResolvedValue({ err: { InstructionError: [0, "x"] } });

    await expect(sendFunds({ payer, to, lamports: 1 })).rejects.toMatchObject({
      name: "TransferFailedError",
    });
  });

  it("keeps the signature of a transfer sent but not confirmed", async () => {
    tx.send.mockResolvedValue("sig");
    tx.confirm.mockRejectedValue(new Error("timed out"));

    await expect(sendFunds({ payer, to, lamports: 1 })).rejects.toMatchObject({
      name: "TransferNotConfirmedError",
      signature: "sig",
    });
  });

  it("lets a send that never left the wallet fail as it is", async () => {
    tx.send.mockRejectedValue(new Error("User rejected the request."));

    await expect(sendFunds({ payer, to, lamports: 1 })).rejects.toThrow(
      "User rejected the request."
    );
    expect(tx.confirm).not.toHaveBeenCalled();
  });
});
