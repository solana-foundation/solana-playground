import {
  getAirdropEndpoint,
  isFaucetKnownClosed,
} from "../../commands/airdrop/closed-faucet";
import { isAirdropSignInGated } from "../../commands/airdrop/sign-in-gate";
import { withAirdropVia } from "../../commands/airdrop/via";
import { PgSession } from "../../features/auth";
import {
  faucetClosedLineFor,
  faucetLink,
  isFaucetClosed,
  isFaucetCluster,
} from "../../shared/lib/faucet";
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

      const address = PgWallet.current?.publicKey.toBase58();
      const disable = `To disable, run \`${PgCommand.setting.name} set wallet.automaticAirdrop false\`.`;

      // The faucet answered closed this session: asking it again would only
      // fail again, so point to the web faucet once and stop
      if (isFaucetKnownClosed(getAirdropEndpoint())) {
        log.info("faucet closed, automatic airdrop off for this cluster", {
          context: { cluster },
        });
        errorCache.add(cluster);
        PgTerminal.println(
          PgTerminal.error(faucetClosedLineFor(cluster)(address))
        );
        PgTerminal.println(
          `Note: This was an automatic airdrop request. ${disable}`
        );
        return;
      }

      // Execute the `airdrop` command (handles the default amount)
      try {
        await withAirdropVia(() => PgCommand.airdrop.execute(), "automatic");
      } catch (e) {
        // Under Home no terminal is mounted to run the command in. That says
        // nothing about the cluster: the next balance change tries again
        if (isTerminalUnmounted(e)) {
          log.info("no terminal mounted, airdrop deferred");
          return;
        }
        // The airdrop's line for a closed faucet already links the web
        // faucet, with the wallet's address: the log names the reason instead.
        // Read from the error, not the endpoint, which may have changed since
        const hasLinkedFaucet = e instanceof Error && isFaucetClosed(e.message);
        // Off for this cluster until a reload; the terminal said why
        log.warn("automatic airdrop failed, off for this cluster", {
          context: {
            cluster,
            error: hasLinkedFaucet ? "faucet closed" : String(e),
          },
        });
        errorCache.add(cluster);
        PgTerminal.println(
          [
            "Note: This was an automatic airdrop request.",
            ...(isFaucetCluster(cluster) && !hasLinkedFaucet
              ? [
                  // The web faucet filled in, the amount too, so the user only confirms
                  `Visit ${faucetLink({
                    walletAddress: address,
                    amount: airdropAmount,
                    cluster,
                  })} to obtain SOL.`,
                ]
              : []),
            disable,
          ].join(" ")
        );
      }
    }),
    [PgWallet.onDidChangeBalance, PgSettings.onDidChangeWalletAutomaticAirdrop]
  );
};

const errorCache = new Set<Cluster>();
