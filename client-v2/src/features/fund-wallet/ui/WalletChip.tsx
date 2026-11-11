import { useEffect, useRef, useState } from "react";

import { isAirdropRefused, refusalOf } from "@/commands/airdrop/report";
import { isAirdropSignInGated } from "@/commands/airdrop/sign-in-gate";
import {
  disconnectStandard,
  makeStandardCurrent,
} from "@/commands/connect/connect";
import { PgDeployRun } from "@/commands/deploy/run";
import { useAirdrop } from "@/components/Wallet/hooks";
import { useBalance, useRenderOnChange, useWallet } from "@/hooks";
import { faucetLink, webFaucetSteps } from "@/shared/lib/faucet";
import type { AirdropRefusal } from "@/shared/lib/faucet-limit";
import { createLogger } from "@/shared/lib/logger";
import {
  markFailureShown,
  reportButtonFailure,
} from "@/shared/lib/report-button-failure";
import { PgConnection, PgWallet } from "@/utils";

import { classify } from "../model/fund";
import { openFundDialog } from "../model/open";
import { fundTelemetry } from "../model/telemetry";
import type { AirdropState, ConnectState } from "./BaseWalletChip";
import BaseWalletChip from "./BaseWalletChip";

const log = createLogger("fund-wallet:wallet-chip");

export interface WalletChipProps {
  /** Nobody is signed in: a public faucet then asks for GitHub first */
  signedOut: boolean;
  /** A sign-in that failed on the way to the airdrop; the account row shows
   * it, so the chip says nothing more */
  isSignInFailure: (error: unknown) => boolean;
}

/**
 * The wallet chip, connected: the current wallet and its live balance from
 * `PgWallet`, the cluster from `PgConnection`, the airdrop through the
 * wallet menu's own `useAirdrop`, and Send from your wallet through the Fund
 * dialog. Nothing shows without a wallet. Back from the web faucet, the
 * balance rising over what it was ends the wait.
 */
const WalletChip = ({ signedOut, isSignInFailure }: WalletChipProps) => {
  useWallet();
  useRenderOnChange(PgConnection.onDidChangeCluster);
  const balance = useBalance() ?? undefined;
  const { airdrop, faucet } = useAirdrop();
  const [state, setState] = useState<AirdropState>("idle");
  const [received, setReceived] = useState<number | undefined>();
  const [refusal, setRefusal] = useState<AirdropRefusal>("limit");
  // The balance an ask or the web faucet started from, to tell when SOL came
  const from = useRef<number | undefined>(undefined);
  const [connect, setConnect] = useState<ConnectState>({ kind: "idle" });
  const attempts = useRef(0);
  // A deploy from the extension still needs it to sign: no disconnect then
  const [deploying, setDeploying] = useState(
    () => PgDeployRun.state.step !== null
  );
  useEffect(() => {
    const sub = PgDeployRun.onDidChange((run) =>
      setDeploying(run.step !== null)
    );
    return () => sub.dispose();
  }, []);

  useEffect(() => {
    if (state !== "away" && state !== "received") return;
    if (balance === undefined || from.current === undefined) return;
    if (balance > from.current) {
      setReceived(balance - from.current);
      if (state === "away") {
        fundTelemetry.track("fund_airdrop_received", { via: "web-faucet" });
        setState("received");
      }
    }
  }, [balance, state]);

  // A wallet made current by another way (the terminal, the Fund dialog)
  // ends whatever the connect list was saying
  const ownerName =
    PgWallet.current && !PgWallet.current.isPg
      ? PgWallet.current.name
      : undefined;
  useEffect(() => {
    if (ownerName) setConnect({ kind: "idle" });
  }, [ownerName]);

  const wallet = PgWallet.current;
  // eslint-disable-next-line unicorn/no-null -- a component that draws nothing returns `null`; React's types refuse `undefined`
  if (!wallet) return null;
  const address = wallet.publicKey.toBase58();
  const cluster = PgConnection.cluster ?? undefined;
  const amount = PgConnection.getAirdropAmount();
  const airdropSol = typeof amount === "number" ? amount : 0;

  // A bridged extension leaves `isPg` unset, so only `true` means Playground
  const owner = wallet.isPg
    ? undefined
    : { name: wallet.name, icon: wallet.icon };

  // The extension answers whenever it does, the popover open or not; a late
  // approval makes it current, a late decline says so on the next opening
  const handleConnect = async (name: string) => {
    // Only the latest request speaks: an older one's late answer would
    // otherwise overwrite the wait for the wallet picked after it
    const attempt = ++attempts.current;
    setConnect({ kind: "waiting", wallet: name });
    fundTelemetry.track("fund_wallet_connect_started", { wallet: name });
    try {
      await makeStandardCurrent(name);
      fundTelemetry.track("fund_wallet_connected", {
        wallet: name,
        as: "current",
      });
      if (attempt === attempts.current) setConnect({ kind: "idle" });
    } catch (error) {
      const reason = classify(error);
      fundTelemetry.track("fund_wallet_connect_failed", {
        wallet: name,
        reason,
      });
      if (attempt !== attempts.current) return;
      if (reason === "rejected") {
        // Declining is the user's answer; it is logged, never reported
        log.warn("the wallet declined to connect", {
          context: { wallet: name, error: String(error) },
        });
        setConnect({ kind: "declined", wallet: name });
        return;
      }
      log.error(error, {
        report: true,
        context: { action: "connect a wallet from the chip", wallet: name },
      });
      setConnect({
        kind: "failed",
        wallet: name,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const ask = async () => {
    from.current = balance;
    setReceived(undefined);
    setState("asking");
    fundTelemetry.track("fund_airdrop_requested", { from: "wallet-chip" });
    try {
      await airdrop();
      fundTelemetry.track("fund_airdrop_received", { via: "faucet" });
      setState("received");
    } catch (error) {
      if (isAirdropRefused(error)) {
        // The popover says it, with the way round; no toast on top. A
        // refusal other than the limit is still logged, by the reporter
        const cause = refusalOf(error);
        markFailureShown(error);
        fundTelemetry.track("fund_airdrop_refused", {
          reason: cause === "limit" ? "rate-limited" : "failed",
        });
        if (cause === "other") reportButtonFailure("airdrop")(error);
        setRefusal(cause);
        setState("refused");
        return;
      }
      if (isSignInFailure(error)) markFailureShown(error);
      else fundTelemetry.track("fund_airdrop_refused", { reason: "failed" });
      reportButtonFailure("airdrop")(error);
      setState("idle");
    }
  };

  return (
    <>
      <BaseWalletChip
        address={address}
        balance={balance}
        cluster={cluster}
        faucet={faucet === "available"}
        airdropSol={airdropSol}
        faucetHref={faucetLink({
          walletAddress: address,
          amount: airdropSol,
          cluster,
        })}
        faucetSteps={webFaucetSteps(
          airdropSol,
          "Come back here. The balance updates by itself"
        )}
        state={state}
        refusal={refusal}
        received={received}
        signInFirst={signedOut && isAirdropSignInGated(cluster)}
        onOpenChange={(open) => {
          // A result is read once; the next opening starts fresh
          if (!open && state === "received") setState("idle");
          // A wait for the extension outlives the popover; a list does not
          if (!open && connect.kind !== "waiting") setConnect({ kind: "idle" });
        }}
        onAirdrop={() => void ask()}
        onOpenFaucet={() => {
          from.current = balance;
          fundTelemetry.track("fund_web_faucet_opened", {
            from: "wallet-chip",
          });
          setState("away");
        }}
        onFund={() => openFundDialog("wallet-chip")}
        owner={owner}
        wallets={PgWallet.standardWallets.map((w) => ({
          name: w.name,
          icon: w.icon,
        }))}
        connect={connect}
        onConnectOpen={() => setConnect({ kind: "listing" })}
        onConnect={(name) => void handleConnect(name)}
        disconnectHeld={deploying}
        onDisconnect={() => {
          if (!owner) return;
          disconnectStandard(owner.name)
            .then(() =>
              fundTelemetry.track("fund_wallet_disconnected", {
                wallet: owner.name,
              })
            )
            .catch(reportButtonFailure(`disconnect from ${owner.name}`));
        }}
      />
    </>
  );
};

export default WalletChip;
