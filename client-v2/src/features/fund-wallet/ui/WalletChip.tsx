import { useEffect, useRef, useState } from "react";

import {
  isAirdropClosed,
  isAirdropRefused,
  isNetworkUnreachable,
  refusalOf,
} from "@/commands/airdrop/report";
import { isAirdropSignInGated } from "@/commands/airdrop/sign-in-gate";
import {
  disconnectStandard,
  setStandardCurrentWith,
} from "@/commands/connect/connect";
import { PgDeployRun } from "@/commands/deploy/run";
import { useAirdrop } from "@/components/Wallet/hooks";
import { useBalance, useRenderOnChange, useWallet } from "@/hooks";
import {
  DEVNET_FAUCET_SOL,
  faucetLink,
  webFaucetSteps,
} from "@/shared/lib/faucet";
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

/** The standard wallet that is current, `undefined` for the Playground wallet or none */
const standardNameOf = (
  wallet: { isPg?: boolean; name?: string } | null | undefined
) => (wallet && !wallet.isPg ? wallet.name : undefined);

export interface WalletChipProps {
  /** Nobody is signed in: a public faucet then asks for GitHub first */
  isSignedOut: boolean;
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
const WalletChip = ({ isSignedOut, isSignInFailure }: WalletChipProps) => {
  useWallet();
  useRenderOnChange(PgConnection.onDidChangeCluster);
  const balance = useBalance() ?? undefined;
  const { airdrop, faucet } = useAirdrop("wallet");
  const [state, setState] = useState<AirdropState>("idle");
  const [received, setReceived] = useState<number | undefined>();
  const [refusal, setRefusal] = useState<AirdropRefusal>("limit");
  // The balance an ask or the web faucet started from, to tell when SOL came
  const from = useRef<number | undefined>(undefined);
  const [connect, setConnect] = useState<ConnectState>({ kind: "idle" });
  const attempts = useRef(0);
  // A deploy from the extension still needs it to sign: no disconnect then,
  // and no connect, which would change who signs the rest of the run
  const [isDeploying, setIsDeploying] = useState(() => PgDeployRun.isActive);
  useEffect(() => {
    const sub = PgDeployRun.onDidChange(() => {
      const isActive = PgDeployRun.isActive;
      // A connect still pending when a run starts must not make its wallet
      // current: it is superseded, as by a newer request
      if (isActive) {
        attempts.current++;
        setConnect({ kind: "idle" });
      }
      setIsDeploying(isActive);
    });
    return () => sub.dispose();
  }, []);

  // An airdrop's state belongs to the wallet and cluster it started on: on
  // another, a balance that differs is not SOL that came, and a refusal is
  // not this faucet's. Declared before the balance effect, so that one sees
  // the cleared start.
  const shownAddress = PgWallet.current?.publicKey.toBase58();
  const shownCluster = PgConnection.cluster ?? undefined;
  useEffect(() => {
    from.current = undefined;
    setState("idle");
    setReceived(undefined);
  }, [shownAddress, shownCluster]);

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
  const ownerName = standardNameOf(PgWallet.current);
  useEffect(() => {
    if (ownerName) {
      // Whatever the chip still waits on is older than that wallet
      attempts.current++;
      setConnect({ kind: "idle" });
    }
  }, [ownerName]);

  const wallet = PgWallet.current;
  // eslint-disable-next-line unicorn/no-null -- a component that draws nothing returns `null`; React's types refuse `undefined`
  if (!wallet) return null;
  const address = wallet.publicKey.toBase58();
  const cluster = PgConnection.cluster ?? undefined;
  const amount = PgConnection.getAirdropAmount();
  const airdropSol = typeof amount === "number" ? amount : DEVNET_FAUCET_SOL;

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
    // Which wallet is current now: an approval that finds another one current
    // by then (the terminal's `connect`, the Fund dialog) is older than that
    // choice and must not replace it, even before the chip has drawn it
    const startedOwner = standardNameOf(PgWallet.current);
    const isStillWanted = () =>
      attempt === attempts.current &&
      standardNameOf(PgWallet.current) === startedOwner;
    setConnect({ kind: "waiting", wallet: name });
    fundTelemetry.track("fund_wallet_connect_started", { wallet: name });
    try {
      // A request superseded while it waited does not take over on approval
      await setStandardCurrentWith(isStillWanted)(name);
      if (attempt !== attempts.current) return;
      fundTelemetry.track("fund_wallet_connected", {
        wallet: name,
        as: "current",
      });
      setConnect({ kind: "idle" });
    } catch (error) {
      const reason = classify(error);
      fundTelemetry.track("fund_wallet_connect_failed", {
        wallet: name,
        reason,
      });
      // Declining is the user's answer; it is logged, never reported
      if (reason === "rejected") {
        log.warn("the wallet declined to connect", {
          context: { wallet: name, error: String(error) },
        });
      } else {
        log.error(error, {
          report: true,
          context: { action: "connect a wallet from the chip", wallet: name },
        });
      }
      // Only the latest request speaks on screen; a superseded one is logged
      if (attempt !== attempts.current) return;
      if (reason === "rejected") {
        setConnect({ kind: "declined", wallet: name });
        return;
      }
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
    fundTelemetry.track("fund_airdrop_requested", { via: "wallet-chip" });
    try {
      await airdrop();
      fundTelemetry.track("fund_airdrop_received", { via: "faucet" });
      setState("received");
    } catch (error) {
      if (isAirdropRefused(error)) {
        // The popover says it, with the way round; no toast on top. A
        // refusal other than the limit is still logged, by the reporter; a
        // closed faucet is expected, and its line says so
        const cause = refusalOf(error);
        markFailureShown(error);
        fundTelemetry.track("fund_airdrop_refused", {
          reason: cause === "limit" ? "rate-limited" : "failed",
        });
        if (cause === "other" && !isAirdropClosed(error)) {
          reportButtonFailure("airdrop")(error);
        }
        setRefusal(cause);
        setState("refused");
        return;
      }
      // No faucet answered: the web faucet is no way round, so the popover
      // says the network is down and keeps the button for another try
      if (isNetworkUnreachable(error)) {
        markFailureShown(error);
        fundTelemetry.track("fund_airdrop_refused", { reason: "failed" });
        log.warn("the airdrop could not reach the network", {
          context: { error: String(error.cause) },
        });
        setState("unreachable");
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
        hasFaucet={faucet === "available"}
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
        shouldSignInFirst={isSignedOut && isAirdropSignInGated(cluster)}
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
            via: "wallet-chip",
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
        // A wallet that connects mid-deploy must not change who signs
        onConnectOpen={
          isDeploying ? undefined : () => setConnect({ kind: "listing" })
        }
        onConnect={isDeploying ? undefined : (name) => void handleConnect(name)}
        isDisconnectHeld={isDeploying}
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
