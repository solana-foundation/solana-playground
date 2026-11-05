import { CircleAlert, ExternalLink } from "lucide-react";

import type { FundingFailure } from "@/commands/deploy/run";
import { networkInSentence, solOn } from "@/constants";
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

/** Solana's web faucet; it serves devnet and testnet */
export const WEB_FAUCET_URL = "https://faucet.solana.com";

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
  onSignIn: () => void;
}

const reasonLine = (reason: FundingFailure, network: string | undefined) => {
  const lines: Record<FundingFailure, string> = {
    signed_out: `Sign in with GitHub to request ${solOn(network)}.`,
    no_faucet: "This network has no faucet. Send SOL to the wallet below.",
    airdrop_failed: "The faucet did not send SOL.",
  };
  return lines[reason];
};

/** The deploy stopped because the paying wallet holds too little SOL */
const BaseNotEnoughSol = (p: BaseNotEnoughSolProps) => {
  const network = networkInSentence(p.cluster);
  const hasWebFaucet = p.cluster === "devnet" || p.cluster === "testnet";

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
        {p.reason === "signed_out" ? (
          <CalloutAction onClick={p.onSignIn}>Sign in</CalloutAction>
        ) : (
          <CalloutAction onClick={p.onRetry}>Try again</CalloutAction>
        )}
        {hasWebFaucet && (
          <CalloutAction asChild>
            <a href={WEB_FAUCET_URL} target="_blank" rel="noopener noreferrer">
              Open faucet
              <ExternalLink data-icon="inline-end" />
            </a>
          </CalloutAction>
        )}
      </CalloutActions>
    </Callout>
  );
};

export default BaseNotEnoughSol;
