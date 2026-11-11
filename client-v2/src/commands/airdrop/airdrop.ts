import { checkSignedIn } from "../../features/auth";
import { isFaucetCluster } from "../../shared/lib/faucet";
import {
  PgCommon,
  PgConnection,
  PgTerminal,
  PgTx,
  PgWallet,
  PgWeb3,
} from "../../utils";
import { askAgain } from "../../utils/ask-again";
import { checkWallet } from "../checks";
import { createArgs, createCmd } from "../create";
import { COULD_NOT_READ_NETWORK, NO_FAUCET } from "./no-faucet";
import { AirdropRefusedError, receivedLine, refusedNote } from "./report";
import { isAirdropSignInGated } from "./sign-in-gate";

/**
 * Command pre-check: a public faucet asks for a sign-in, a local one does not.
 * Before the cluster is read, or while it is the previous endpoint's, it asks
 * nothing, so `handle` can say the network is still loading instead of asking a
 * local user to sign in.
 */
const checkSignedInWhereGated = () => {
  if (PgConnection.cluster === null || PgConnection.clusterIsStale) return;
  if (isAirdropSignInGated(PgConnection.cluster)) checkSignedIn();
};

export const airdrop = createCmd({
  name: "airdrop",
  description: "Airdrop SOL",
  needsConnection: true,
  args: createArgs([
    // TODO: Add `default` value
    {
      name: "amount",
      description: "Airdrop amount (in SOL)",
      optional: true,
      parse: (token) => {
        if (PgCommon.isFloat(token)) return parseFloat(token);
        throw new Error("Amount must be a number");
      },
    },
  ]),
  preChecks: [checkWallet, checkSignedInWhereGated],
  handle: async (input) => {
    let cluster = PgConnection.cluster;
    let isStale = PgConnection.clusterIsStale;
    // A read that failed will not finish by waiting; it is tried once more,
    // since the endpoint may be back
    if (PgConnection.hasClusterReadFailed) {
      try {
        cluster = await PgConnection.readCluster();
        isStale = false;
      } catch {
        // `readCluster` logs its own failure
        throw new Error(COULD_NOT_READ_NETWORK);
      }
      // The derivable still holds the failed read; the rest of the app
      // catches up through it
      askAgain();
      // The pre-check skipped the sign-in while the cluster was unknown
      if (isAirdropSignInGated(cluster)) checkSignedIn();
    }
    // Until the endpoint is read every cluster looks faucet-less; saying so
    // then would be wrong
    if (!cluster || isStale) {
      throw new Error("The network is still loading. Try again in a moment.");
    }
    const defaultAmount = PgConnection.getAirdropAmountOn(cluster);
    if (typeof defaultAmount !== "number") {
      throw new Error(NO_FAUCET);
    }

    const amount = input.args.amount ?? defaultAmount;
    PgTerminal.println(PgTerminal.info(`Airdropping ${amount} SOL...`));

    const connection = PgConnection.current;
    const walletPk = PgWallet.current!.publicKey;

    // No answer here is the end of the road: the web faucet keeps a limit of
    // its own and asks nothing of this RPC. Point to it on any refusal, then
    // fail as before, with the same message, marked as a refusal so the wallet
    // chip and the wallet menu show the same steps
    let received: number;
    try {
      // Airdrop tx is sometimes successful even when the balance hasn't changed.
      // Check the balance before and after instead of only confirming the tx
      // to mitigate.
      const beforeBalance = await connection.getBalance(walletPk, "processed");

      // Request an airdrop from the RPC.
      //
      // The `requestAirdrop` method sometimes returns the same tx hash for
      // multiple requests, even after considerable amount of time has passed.
      // Retry until it returns a different hash to mitigate.
      while (1) {
        const txHash = await connection.requestAirdrop(
          walletPk,
          PgWeb3.solToLamports(amount)
        );
        if (txHash !== cachedTxHash) {
          cachedTxHash = txHash;
          break;
        }

        await PgCommon.sleep(5000);
      }

      // Allow enough time for balance to update by waiting for confirmation
      const txResult = await PgTx.confirm(cachedTxHash);
      if (txResult?.err) {
        throw new Error(`Airdrop transaction failed: ${txResult.err}`);
      }

      // Even though we waited for the transaction to confirm, `getBalance` can
      // sometimes return a stale balance. Try a couple times to mitigate.
      const MAX_RETRIES = 3;
      let afterBalance = beforeBalance;
      for (let i = 0; i < MAX_RETRIES; i++) {
        afterBalance = await connection.getBalance(walletPk, "processed");
        if (afterBalance !== beforeBalance) break;
        if (i === MAX_RETRIES - 1) throw new Error("Balance did not change");

        const confirmations = connection.commitment === "finalized" ? 32 : 1;
        await PgCommon.sleep(confirmations * PgWeb3.DEFAULT_MS_PER_SLOT);
      }

      received = afterBalance - beforeBalance;
    } catch (error) {
      // A local validator has no web faucet to point to; its own error says
      // what went wrong
      if (!isFaucetCluster(cluster)) throw error;
      PgTerminal.println(
        PgTerminal.info(
          refusedNote(error, {
            walletAddress: walletPk.toBase58(),
            amount,
            cluster,
          })
        )
      );
      throw new AirdropRefusedError(error);
    }

    // What arrived, not what was asked: the RPC may grant less
    PgTerminal.println(PgTerminal.success(receivedLine(amount, received)));
  },
});

let cachedTxHash: string;
