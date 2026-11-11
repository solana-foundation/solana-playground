import { CircleAlert, ExternalLink } from "lucide-react";

import type { FundingFailure } from "@/commands/deploy/run";
import { networkInSentence, solOn } from "@/constants";
import {
  DEVNET_FAUCET_SOL,
  faucetUrlWith,
  isFaucetCluster,
  webFaucetSteps,
} from "@/shared/lib/faucet";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import {
  Callout,
  CalloutAction,
  CalloutActions,
  CalloutDescription,
  CalloutTitle,
} from "@/shared/ui/callout";
import { CopyButton } from "@/shared/ui/copy-button";

import { formatSol, shortKey } from "../model/format";

export interface BaseNotEnoughSolProps {
  cluster: string | undefined;
  reason: FundingFailure;
  /** Lamports the wallet holds */
  balance: number;
  /** Lamports the deploy needs */
  needed: number;
  address: string;
  /** What the airdrop said when it refused */
  cause: string | null;
  onRetry: () => void;
  /**
   * Deploy again, requesting an airdrop: offered when automatic airdrop is
   * off, and on Try again after the faucet refused
   */
  onAirdrop: () => void;
  onSignIn: () => void;
  /**
   * Open the Fund dialog, to pay the wallet from one the user has: offered
   * for every reason, and the only way in on a network with no faucet. The
   * card draws it only when given
   */
  onFund?: () => void;
}

const reasonLine = (reason: FundingFailure, network: string | undefined) => {
  const lines: Record<FundingFailure, string> = {
    signed_out: `Sign in with GitHub to request ${solOn(network)}.`,
    no_faucet: "This network has no faucet. Send SOL to the wallet below.",
    airdrop_off: `Request ${solOn(
      network
    )} from the faucet, or send SOL to the wallet below.`,
    airdrop_failed: "The faucet did not send SOL.",
  };
  return lines[reason];
};

/** The card's first action: what moves this reason forward */
const FundingAction = ({ p }: { p: BaseNotEnoughSolProps }) => {
  if (p.reason === "signed_out") {
    return <CalloutAction onClick={p.onSignIn}>Sign in</CalloutAction>;
  }
  if (p.reason === "airdrop_off") {
    return <CalloutAction onClick={p.onAirdrop}>Request airdrop</CalloutAction>;
  }
  // The faucet refused the airdrop the user asked for: trying again asks it
  // again, even with automatic airdrop off
  if (p.reason === "airdrop_failed") {
    return <CalloutAction onClick={p.onAirdrop}>Try again</CalloutAction>;
  }
  return <CalloutAction onClick={p.onRetry}>Try again</CalloutAction>;
};

/** The deploy stopped because the paying wallet holds too little SOL */
const BaseNotEnoughSol = (p: BaseNotEnoughSolProps) => {
  const network = networkInSentence(p.cluster);
  const faucetUrl =
    p.cluster !== undefined && isFaucetCluster(p.cluster)
      ? faucetUrlWith(DEVNET_FAUCET_SOL)(p.cluster)(p.address)
      : undefined;
  // A refused airdrop rarely goes through on Try again soon after: the web
  // faucet is the way round, spelled out for someone who has never used it
  const steps =
    p.reason === "airdrop_failed" && faucetUrl
      ? webFaucetSteps(DEVNET_FAUCET_SOL, "Come back here and press Try again")
      : undefined;

  return (
    <Callout variant="error" role="alert" aria-label="Not enough SOL">
      <CircleAlert />
      <CalloutTitle>Not enough {solOn(network)}</CalloutTitle>
      <CalloutDescription className="flex flex-col gap-2">
        <span>
          Your wallet has {formatSol(p.balance)} SOL, this deploy needs about{" "}
          {formatSol(p.needed)} SOL.
        </span>
        <span>
          {reasonLine(p.reason, network)}
          {p.cause && <span className="text-subtle"> {p.cause}</span>}
        </span>
        {steps && (
          <ol
            aria-label="Get SOL from the web faucet"
            className="flex flex-col gap-1"
          >
            {steps.map((step, i) => (
              <li key={step} className="flex gap-2">
                <span className="w-3 shrink-0 text-subtle tabular-nums">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        )}
        <span className="flex items-center gap-2 rounded-lg bg-surface-base px-3 py-1.5">
          <span className="text-caption text-subtle">Wallet</span>
          <code className="font-mono text-code" title={p.address}>
            {shortKey(p.address)}
          </code>
          <CopyButton
            value={p.address}
            label="Copy the wallet address"
            className="ml-auto"
            onError={reportButtonFailure("copy the wallet address")}
          />
        </span>
      </CalloutDescription>
      <CalloutActions>
        <FundingAction p={p} />
        {faucetUrl && (
          <CalloutAction asChild>
            <a href={faucetUrl} target="_blank" rel="noopener noreferrer">
              Open the web faucet
              <ExternalLink data-icon="inline-end" />
            </a>
          </CalloutAction>
        )}
        {p.onFund && (
          <CalloutAction onClick={p.onFund}>
            Send from your wallet
          </CalloutAction>
        )}
      </CalloutActions>
    </Callout>
  );
};

export default BaseNotEnoughSol;
