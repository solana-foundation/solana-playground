import { isAirdropSignInGated } from "../../commands/airdrop/sign-in-gate";
import { PgSession } from "../../features/auth";
import { createLogger } from "../../shared/lib/logger";
import {
  Cluster,
  isTerminalUnmounted,
  PgCommand,
  PgCommon,
  PgConnection,
  PgSettings,
  PgTerminal,
  PgWallet,
} from "../../utils";

const log = createLogger("wallet:automatic-airdrop");

export const automaticAirdrop = () => {
  return PgCommon.batchChanges(
    PgCommon.executeInOrder(async () => {
      if (!PgSettings.wallet.automaticAirdrop) return;

      // If there was an error, disable the effect
      const cluster = PgConnection.cluster;
      if (!cluster || errorCache.has(cluster)) return;

      // The name is the previous endpoint's until this one answers: its amount
      // and its sign-in rule are not this RPC's. The next balance change tries
      if (PgConnection.clusterIsStale) return;

      // A signed-out user can't airdrop from a public faucet; skip rather
      // than throw from the airdrop's pre-check. A local one needs no sign-in
      if (isAirdropSignInGated(cluster) && !PgSession.get()) return;

      // Get airdrop amount based on network (in SOL)
      const airdropAmount = PgConnection.getAirdropAmount();
      if (!airdropAmount) return;

      // Need the current account balance to decide the airdrop
      const initialBalance = PgWallet.balance;
      if (typeof initialBalance !== "number") return;

      // Only airdrop if the balance is less than the airdrop amount
      if (initialBalance >= airdropAmount) return;

      // Execute the `airdrop` command (handles the default amount)
      try {
        await PgCommand.airdrop.execute();
      } catch (e) {
        // Under Home no terminal is mounted to run the command in. That says
        // nothing about the cluster: the next balance change tries again
        if (isTerminalUnmounted(e)) {
          log.info("no terminal mounted, airdrop deferred");
          return;
        }
        errorCache.add(cluster);
        PgTerminal.println(
          [
            "Note: This was an automatic airdrop request.",
            `To disable, run \`${PgCommand.setting.name} set wallet.automaticAirdrop false\`.`,
          ].join(" ")
        );
      }
    }),
    [PgWallet.onDidChangeBalance, PgSettings.onDidChangeWalletAutomaticAirdrop]
  );
};

const errorCache = new Set<Cluster>();
