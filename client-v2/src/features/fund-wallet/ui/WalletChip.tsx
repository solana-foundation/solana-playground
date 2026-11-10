import { useEffect, useRef, useState } from "react";

import { isRateLimited } from "@/commands/airdrop/report";
import { isAirdropSignInGated } from "@/commands/airdrop/sign-in-gate";
import { useAirdrop } from "@/components/Wallet/hooks";
import { useBalance, useRenderOnChange, useWallet } from "@/hooks";
import { faucetLink, webFaucetSteps } from "@/shared/lib/faucet";
import {
  markFailureShown,
  reportButtonFailure,
} from "@/shared/lib/report-button-failure";
import { PgConnection, PgWallet } from "@/utils";

import { fundTelemetry } from "../model/telemetry";
import type { AirdropState } from "./BaseWalletChip";
import BaseWalletChip from "./BaseWalletChip";
import FundDialog from "./FundDialog";

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
  const [funding, setFunding] = useState(false);
  // The balance an ask or the web faucet started from, to tell when SOL came
  const from = useRef<number | undefined>(undefined);

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

  const wallet = PgWallet.current;
  // eslint-disable-next-line unicorn/no-null -- a component that draws nothing returns `null`; React's types refuse `undefined`
  if (!wallet) return null;
  const address = wallet.publicKey.toBase58();
  const cluster = PgConnection.cluster ?? undefined;
  const amount = PgConnection.getAirdropAmount();
  const airdropSol = typeof amount === "number" ? amount : 0;

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
      if (isRateLimited(error)) {
        // The popover says it, with the way round; no toast on top
        markFailureShown(error);
        fundTelemetry.track("fund_airdrop_refused", { reason: "rate-limited" });
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
        received={received}
        signInFirst={signedOut && isAirdropSignInGated(cluster)}
        onOpenChange={(open) => {
          // A result is read once; the next opening starts fresh
          if (!open && state === "received") setState("idle");
        }}
        onAirdrop={() => void ask()}
        onOpenFaucet={() => {
          from.current = balance;
          fundTelemetry.track("fund_web_faucet_opened", {
            from: "wallet-chip",
          });
          setState("away");
        }}
        onFund={() => setFunding(true)}
      />
      <FundDialog open={funding} onOpenChange={setFunding} from="wallet-chip" />
    </>
  );
};

export default WalletChip;
