import { useEffect, useState } from "react";
import type { PublicKey } from "@solana/web3.js";

import { Emoji } from "../../../constants";
import {
  PgCommon,
  PgConnection,
  PgTerminal,
  PgTx,
  PgWallet,
} from "../../../utils/pg";

export const useAirdrop = () => {
  const [airdropAmount, setAirdropAmount] =
    useState<ReturnType<typeof PgConnection["getAirdropAmount"]>>(null);

  useEffect(() => {
    const { dispose } = PgConnection.onDidChangeCurrent(() => {
      setAirdropAmount(PgConnection.getAirdropAmount());
    });
    return dispose;
  }, []);

  const airdrop = async () => {
    await PgTerminal.process(async () => {
      if (!airdropAmount) return;

      if (!PgWallet.current) {
        throw new Error("Wallet is not connected.");
      }

      let msg;
      try {
        PgTerminal.println(PgTerminal.info("Sending an airdrop request..."));

        const conn = PgConnection.current;
        const walletPk = PgWallet.current.publicKey;

        // Airdrop tx is sometimes successful even when the balance hasn't
        // changed. To solve this, we check before and after balance instead
        // of confirming the tx.
        const beforeBalance = await conn.getBalance(walletPk, "processed");

        // Send the airdrop request
        const txHash = await conn.requestAirdrop(
          walletPk,
          PgCommon.solToLamports(airdropAmount)
        );

        // Allow enough time for balance to update by waiting for confirmation
        await PgTx.confirm(txHash, conn);

        const afterBalance = await conn.getBalance(walletPk, "processed");
        if (afterBalance > beforeBalance) {
          msg = `${Emoji.CHECKMARK} ${PgTerminal.success(
            "Success."
          )} Received ${PgTerminal.bold(airdropAmount.toString())} SOL.`;
        } else {
          msg = `${Emoji.CROSS} ${PgTerminal.error(
            "Error receiving airdrop."
          )}`;
        }
      } catch (error: unknown) {
        const convertedError = convertAirdropErrorMessage(error, {
          walletPublicKey: PgWallet.current.publicKey,
          airdropAmount: airdropAmount,
        });
        msg = `${Emoji.CROSS} ${PgTerminal.error(
          "Error receiving airdrop:"
        )}: ${convertedError}`;
      } finally {
        PgTerminal.println(msg + "\n");
      }
    });
  };

  return { airdrop, airdropCondition: !!airdropAmount };
};

function convertAirdropErrorMessage(
  error: unknown,
  params: { walletPublicKey: PublicKey; airdropAmount: number }
): string {
  // Case 0: Not expected, return something debuggable.
  if (!(error instanceof Error)) return String(error);

  const { message } = error;
  const { walletPublicKey, airdropAmount } = params;

  // Case 1: Internal error is clean, but not user-friendly;
  // so enhance the message with instructions, keeping the original message.
  if (message.toLowerCase().includes("internal error")) {
    return createUserFriendlyErrorMessage(message, {
      walletPublicKey,
      airdropAmount,
    });
  }

  // Case 2: User friendly message is presented, but the format is ugly and contains technical details.
  // Use the cleaned message instead of the original message, enhanced with instructions.
  const helpfulErrorMessages = [
    "You've either reached your airdrop limit today or the airdrop faucet has run dry.",
  ];
  const helpfulMessage = helpfulErrorMessages.find((helpfulMessage) =>
    message.includes(helpfulMessage)
  );
  if (helpfulMessage) {
    return createUserFriendlyErrorMessage(helpfulMessage, {
      walletPublicKey,
      airdropAmount,
    });
  }

  // Case 3: Use more generic message converter
  return PgTerminal.convertErrorMessage(message);
}

function createUserFriendlyErrorMessage(
  originalMessage: string,
  params: { walletPublicKey: PublicKey; airdropAmount: number }
) {
  const { walletPublicKey, airdropAmount } = params;
  const link = `https://faucet.solana.com/?walletAddress=${walletPublicKey.toBase58()}&amount=${airdropAmount}`;
  const instruction = `Try requesting devnet SOL from Faucet (pre-filled with your wallet):\n${link}`;
  return `${originalMessage}\n${instruction}`;
}
